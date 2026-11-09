//! The groups an instance has loaded, and what loads, unloads, makes,
//! renames, writes and deletes them, as `PROGMAN.EXE` seg4 does.
//!
//! `PROGMAN.EXE` keeps a group as a structure of 14h bytes in its data
//! segment (seg4 `1d8a`: the next, its MDI child, its block, its items,
//! its file's path, its number, whether its file is read-only, the file's
//! time), linked in the order loaded from `[13Ah]`, `[13Eh]` the last and
//! `[13Ch]` the current one; its window, a real MDI child of class
//! `PMGroup`, holds the structure in its word 0. WinBox's keeps the same
//! fields here, by a key of its own in place of the structure's address,
//! the window holding the key; the block is the group file's bytes as the
//! model has them (`crate::groups::GroupFile`), which `PROGMAN.EXE` keeps
//! in a discardable global block and reads again where it was discarded --
//! WinBox's is never discarded but where a change fails (`157c`).

use std::collections::BTreeMap;

use super::items::{self, Item};
use super::main::{self, Pm, R};
use crate::commdlg::api::{self, Arg};
use crate::groups::{GroupFile, IconMetrics};

/// A group loaded.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Loaded {
    /// `[si+2]`: its MDI child.
    pub hwnd: u16,
    /// `[si+0Ah]`: its number, `GroupN=`'s.
    pub n: u16,
    /// `[si+8]`: its file's path.
    pub path: Vec<u8>,
    /// `[si+4]`: its block, none until it is read.
    pub block: Option<GroupFile>,
    /// `[si+6]`: its items, in the order they lie in memory.
    pub items: Vec<Item>,
    /// `[si]`: the next in the list from `[13Ah]`, by key; nought for none.
    pub next: u16,
    /// `[si+0Ch]`: its file read-only, as seg4 `0093` last found it.
    pub read_only: bool,
}

/// An instance's groups.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct Groups {
    /// Every group loaded, by key.
    pub map: BTreeMap<u16, Loaded>,
    /// `[13Ah]`: the first in the list; nought for none.
    pub head: u16,
    /// `[13Eh]`: the last linked, or nought for `[13Ah]` itself. It may name
    /// a group let go (seg4 `1f9a`), to which nothing then links.
    pub tail: u16,
    /// `[13Ch]`: the current group; nought for none.
    pub current: u16,
    /// The last key given.
    pub keys: u16,
    /// `[452h]`: `SYSTEM.INI`'s path, as start-up made it.
    pub system_ini: Vec<u8>,
}

impl Groups {
    /// The list from `[13Ah]`, in its order: the keys.
    pub(crate) fn list(&self) -> Vec<u16> {
        let mut list = Vec::new();
        let mut at = self.head;

        while at != 0 && !list.contains(&at) {
            let Some(group) = self.map.get(&at) else {
                break;
            };

            list.push(at);
            at = group.next;
        }

        list
    }

    /// A group linked after `[13Eh]` (seg4 `1f6a`-`1f74`): the list's first
    /// where `[13Eh]` is `[13Ah]`, the next of the group it names, or
    /// nothing reachable where that group was let go.
    fn link(&mut self, key: u16) {
        if let Some(group) = self.map.get_mut(&key) {
            group.next = 0;
        }

        if self.tail == 0 {
            self.head = key;
        } else if let Some(last) = self.map.get_mut(&self.tail) {
            last.next = key;
        }

        self.tail = key;
    }

    /// A group taken out of the list: the link that names it made to name
    /// its next. The place of that link, a group's key or nought for
    /// `[13Ah]`; none where no link names it.
    fn unlink(&mut self, key: u16) -> Option<u16> {
        let next = self.map.get(&key)?.next;

        if self.head == key {
            self.head = next;
            return Some(0);
        }

        let before = self
            .map
            .iter()
            .find(|(_, group)| group.next == key)
            .map(|(&at, _)| at)?;

        self.map.get_mut(&before)?.next = next;
        Some(before)
    }
}

/// An instance's groups, read.
pub(crate) fn with<T>(pm: &Pm<'_>, f: impl FnOnce(&Groups) -> T) -> T {
    let instance = pm.ds.wrapping_sub(1);
    let system = pm.e.system();

    match system.progman.instances.get(&instance) {
        Some(groups) => f(groups),
        None => f(&Groups::default()),
    }
}

/// An instance's groups, changed.
pub(crate) fn change<T>(pm: &Pm<'_>, f: impl FnOnce(&mut Groups) -> T) -> T {
    let instance = pm.ds.wrapping_sub(1);
    let mut system = pm.e.system();

    f(system.progman.instances.entry(instance).or_default())
}

/// A group, changed, where it is loaded.
pub(crate) fn change_group<T>(
    pm: &Pm<'_>,
    key: u16,
    f: impl FnOnce(&mut Loaded) -> T,
) -> Option<T> {
    change(pm, |groups| groups.map.get_mut(&key).map(f))
}

/// A group, read, where it is loaded.
pub(crate) fn group(pm: &Pm<'_>, key: u16) -> Option<Loaded> {
    with(pm, |groups| groups.map.get(&key).cloned())
}

/// `GetWindowWord(hwnd, 0)`: the group a window holds.
pub(crate) async fn key_of(pm: &Pm<'_>, hwnd: u16) -> R<u16> {
    Ok(pm.user("GetWindowWord", &[Arg::W(hwnd), Arg::W(0)]).await? as u16)
}

/// The MDI client's children that are groups' windows, from the top
/// (`GetWindow(client, GW_CHILD)`, then `GW_HWNDNEXT`), those with an owner
/// -- icons' titles -- passed over, as every walk of them does.
pub(crate) async fn windows_top_down(pm: &Pm<'_>) -> R<Vec<u16>> {
    let mut found = Vec::new();
    let mut child = pm
        .user("GetWindow", &[Arg::W(pm.d16(main::D_CLIENT)), Arg::W(5)])
        .await? as u16;

    while child != 0 {
        if pm.user("GetWindow", &[Arg::W(child), Arg::W(4)]).await? as u16 == 0 {
            found.push(child);
        }

        child = pm.user("GetWindow", &[Arg::W(child), Arg::W(2)]).await? as u16;
    }

    Ok(found)
}

/// The same from the bottom (`GW_CHILD`, `GW_HWNDLAST`, then
/// `GW_HWNDPREV`), as saving and the profile's groups walk them (seg4
/// `268f`-`26d8`, `28e0`-`290b`).
pub(crate) async fn windows_bottom_up(pm: &Pm<'_>) -> R<Vec<u16>> {
    let mut found = Vec::new();
    let first = pm
        .user("GetWindow", &[Arg::W(pm.d16(main::D_CLIENT)), Arg::W(5)])
        .await? as u16;

    if first == 0 {
        return Ok(found);
    }

    let mut child = pm.user("GetWindow", &[Arg::W(first), Arg::W(1)]).await? as u16;

    while child != 0 {
        if pm.user("GetWindow", &[Arg::W(child), Arg::W(4)]).await? as u16 == 0 {
            found.push(child);
        }

        child = pm.user("GetWindow", &[Arg::W(child), Arg::W(3)]).await? as u16;
    }

    Ok(found)
}

/// `PMGroup`, the groups' class (string 3).
pub(crate) const GROUP_CLASS: &[u8] = b"PMGroup";

/// `WM_MDICREATE`, `WM_MDIDESTROY`.
const WM_MDICREATE: u16 = 0x220;
const WM_MDIDESTROY: u16 = 0x221;

/// `LoadGroup` (seg4 `1d4d`): a group loaded from its file as `n` -- the
/// lowest number no group in the list has where it is nought (`1d5c`,
/// `1d21`). Its structure made; its window made by `WM_MDICREATE` to the
/// MDI client -- class `PMGroup`, no title, `CW_USEDEFAULT` each way, style
/// 115h, the structure its `lParam`, `[16h]` set meanwhile; its file read
/// (`018a`) and checked (`1c95`), else the window destroyed and nothing
/// loaded; its title the group's name; placed by `SetWindowPlacement` where
/// the file's `nCmdShow` is not nought, its icon at `ptMin`; its icons
/// checked against the display (`17ae`) and its items made (`1735`); linked
/// last and made current; `CalcChildScroll` of the client; and its file's
/// read-only state taken (`0093`). Its window, or nought.
pub(crate) async fn load(pm: &Pm<'_>, path: &[u8], n: u16) -> R<u16> {
    let mut n = n;

    if n == 0 {
        n = 1;

        while with(pm, |groups| {
            groups.list().iter().any(|key| groups.map[key].n == n)
        }) {
            n = n.wrapping_add(1);
        }
    }

    let key = change(pm, |groups| {
        groups.keys = groups.keys.wrapping_add(1).max(1);

        let key = groups.keys;

        groups.map.insert(
            key,
            Loaded {
                hwnd: 0,
                n,
                path: path.to_vec(),
                block: None,
                items: Vec::new(),
                next: 0,
                read_only: false,
            },
        );
        key
    });
    let (class, saved) = pm.reserve(&[GROUP_CLASS, b"\0"].concat());
    let (title, inner) = pm.reserve(b"\0");
    let mut create = class.to_le_bytes().to_vec();

    create.extend_from_slice(&title.to_le_bytes());

    for word in [pm.d16(main::D_INSTANCE), 0x8000, 0x8000, 0x8000, 0x8000] {
        create.extend_from_slice(&word.to_le_bytes());
    }

    create.extend_from_slice(&0x115u32.to_le_bytes());
    create.extend_from_slice(&u32::from(key).to_le_bytes());
    pm.sd16(main::D_CREATING, 1);

    let made = pm
        .call(
            "USER",
            "SendMessage",
            &[
                Arg::W(pm.d16(main::D_CLIENT)),
                Arg::W(WM_MDICREATE),
                Arg::W(0),
                Arg::B(create),
            ],
        )
        .await;

    pm.release(inner);
    pm.release(saved);
    pm.sd16(main::D_CREATING, 0);

    let hwnd = made?.word();

    if hwnd == 0 {
        change(pm, |groups| groups.map.remove(&key));
        return Ok(0);
    }

    change_group(pm, key, |group| group.hwnd = hwnd);
    pm.sd16(main::D_LOADING, 1);

    let block = lock(pm, key).await?;

    pm.sd16(main::D_LOADING, 0);

    let Some(block) = block else {
        destroy(pm, key, hwnd).await?;
        return Ok(0);
    };

    if !valid(&block.data) {
        // `1ece`: "invalid or damaged" (75), not shown; then as seg4
        // `03eb` and the window gone.
        destroy(pm, key, hwnd).await?;
        return Ok(0);
    }

    let name = crate::groups::c_string(&block.data, word(&block.data, 0x16).into());

    pm.user("SetWindowText", &[Arg::W(hwnd), api::text(&name)])
        .await?;

    let show = word(&block.data, 0x08);

    if show != 0 {
        let mut placement = vec![0x16, 0, 1, 0];

        placement.extend_from_slice(&show.to_le_bytes());
        placement.extend_from_slice(&block.data[0x12..0x16]);
        placement.extend_from_slice(&[0; 4]);
        placement.extend_from_slice(&block.data[0x0a..0x12]);
        pm.user("SetWindowPlacement", &[Arg::W(hwnd), Arg::B(placement)])
            .await?;
    }

    display_check(pm, key).await?;
    items::make_items(pm, key).await?;
    change(pm, |groups| {
        groups.link(key);
        groups.current = key;
    });
    pm.user(
        "CalcChildScroll",
        &[Arg::W(pm.d16(main::D_CLIENT)), Arg::W(3)],
    )
    .await?;
    writable(pm, key).await?;
    Ok(hwnd)
}

/// A group whose file could not be loaded let go: its window destroyed by
/// `WM_MDIDESTROY`, and its structure (`1e97`-`1ebb`).
async fn destroy(pm: &Pm<'_>, key: u16, hwnd: u16) -> R<()> {
    pm.send(pm.d16(main::D_CLIENT), WM_MDIDESTROY, hwnd, 0)
        .await?;
    change(pm, |groups| groups.map.remove(&key));
    Ok(())
}

fn word(data: &[u8], at: usize) -> u16 {
    data.get(at..at + 2)
        .map_or(0, |bytes| u16::from_le_bytes([bytes[0], bytes[1]]))
}

/// seg4 `1c95`: the file's slots, each empty or its six offsets within
/// `cbGroup`; `cItems` not nought.
fn valid(data: &[u8]) -> bool {
    let cb_group = word(data, 6);
    let slots = word(data, 0x20);

    if slots == 0 {
        return false;
    }

    (0..usize::from(slots)).all(|slot| {
        let def = usize::from(word(data, 0x22 + slot * 2));

        def == 0
            || (word(data, 0x22 + slot * 2) <= cb_group
                && [0x12, 0x14, 0x16, 0x0c, 0x0e, 0x10]
                    .iter()
                    .all(|field| word(data, def + field) <= cb_group))
    })
}

/// `LockGroup` (seg4 `018a`): the group's block, read from its file where
/// it is not in memory -- `_lopen` with `OF_SHARE_DENY_NONE`, its size by
/// `_llseek`, 24h bytes at least, `_lread` whole, `cbGroup` within it, its
/// sum nought and `PMCC` first. None where it cannot be, the box the file
/// shows for it not shown (`02e4`-`0387`; the one that would offer to take
/// its key out of `PROGMAN.INI` answered as not taking it), and the window
/// shown minimized (`03d4`).
///
/// Not followed: the file's time kept and compared as it is read again
/// (`01f1`-`0263`, 465h), as WinBox's block is never discarded.
pub(crate) async fn lock(pm: &Pm<'_>, key: u16) -> R<Option<GroupFile>> {
    let Some(group) = group(pm, key) else {
        return Ok(None);
    };

    if let Some(block) = group.block {
        return Ok(Some(block));
    }

    let data = read_file(pm, &group.path).await?;
    let good = data.filter(|data| {
        usize::from(word(data, 6)) <= data.len()
            && crate::groups::group_sum(data) == 0
            && data.starts_with(b"PMCC")
    });

    let Some(data) = good else {
        pm.user("ShowWindow", &[Arg::W(group.hwnd), Arg::W(7)])
            .await?;
        return Ok(None);
    };
    let block = GroupFile::new(&data);

    change_group(pm, key, |group| group.block = Some(block.clone()));
    Ok(Some(block))
}

/// A file's bytes, read as the group loader reads it; none where it cannot
/// be opened or is too short to be a group.
async fn read_file(pm: &Pm<'_>, path: &[u8]) -> R<Option<Vec<u8>>> {
    let file = pm
        .kernel("_lopen", &[api::text(path), Arg::W(0x40)])
        .await? as u16;

    if file == 0xffff {
        return Ok(None);
    }

    let size = pm
        .kernel("_llseek", &[Arg::W(file), Arg::D(0), Arg::W(2)])
        .await?;
    let mut data = None;

    if (0x24..0x10000).contains(&size) {
        pm.kernel("_llseek", &[Arg::W(file), Arg::D(0), Arg::W(0)])
            .await?;

        let memory = pm
            .kernel("GlobalAlloc", &[Arg::W(0x42), Arg::D(size)])
            .await? as u16;

        if memory != 0 {
            let at = pm.kernel("GlobalLock", &[Arg::W(memory)]).await?;
            let read = pm
                .kernel("_lread", &[Arg::W(file), Arg::D(at), Arg::W(size as u16)])
                .await?;

            if read as u16 == size as u16 {
                data = Some(pm.e.system().read_far(at, size as usize));
            }

            pm.kernel("GlobalUnlock", &[Arg::W(memory)]).await?;
            pm.kernel("GlobalFree", &[Arg::W(memory)]).await?;
        }
    }

    pm.kernel("_lclose", &[Arg::W(file)]).await?;
    Ok(data)
}

/// seg4 `0093`: whether the group's file may be written -- DOS 4300h's
/// attributes without the read-only bit (seg5 `0af7`), unless Program
/// Manager is closing (`[32h]`) -- kept as `[si+0Ch]`.
pub(crate) async fn writable(pm: &Pm<'_>, key: u16) -> R<bool> {
    let Some(group) = group(pm, key) else {
        return Ok(false);
    };
    let read_only = read_only(pm, &group.path).await? && pm.d16(main::D_CLOSING) == 0;

    change_group(pm, key, |group| group.read_only = read_only);
    Ok(!read_only)
}

/// seg5 `0af7`: a file's read-only bit, by DOS 4300h on its OEM path; not
/// read-only where DOS fails.
async fn read_only(pm: &Pm<'_>, path: &[u8]) -> R<bool> {
    let oem = oem(pm, path).await?;
    let (carry, ax) = main::dos_path(pm, 0x4300, &oem).await?;

    Ok(!carry && ax & 1 != 0)
}

/// A path made OEM, as `AnsiToOem` makes it.
async fn oem(pm: &Pm<'_>, path: &[u8]) -> R<Vec<u8>> {
    Ok(pm
        .call(
            "KEYBOARD",
            "AnsiToOem",
            &[api::text(path), api::buffer(0x80)],
        )
        .await?
        .string(1))
}

/// `WriteGroup` (seg4 `04a5`): nothing where the file is read-only; else
/// the block's sum set, the file opened for writing or made, made long
/// enough first where it is shorter -- a byte written at its new end -- the
/// block written from its start and the file ended there by a write of
/// nought bytes. Whether it was written; the boxes for what fails not
/// shown, and the block then let go.
pub(crate) async fn write(pm: &Pm<'_>, key: u16) -> R<bool> {
    let Some(group) = group(pm, key) else {
        return Ok(false);
    };

    if read_only(pm, &group.path).await? {
        return Ok(false);
    }

    let Some(mut block) = group.block else {
        return Ok(false);
    };
    let bytes = block.bytes();

    change_group(pm, key, |group| group.block = Some(block));

    let mut file = pm
        .kernel("_lopen", &[api::text(&group.path), Arg::W(1)])
        .await? as u16;

    if file == 0xffff {
        file = pm
            .kernel("_lcreat", &[api::text(&group.path), Arg::W(0)])
            .await? as u16;
    }

    if file == 0xffff {
        change_group(pm, key, |group| group.block = None);
        return Ok(false);
    }

    let length = bytes.len() as u32;
    let size = pm
        .kernel("_llseek", &[Arg::W(file), Arg::D(0), Arg::W(2)])
        .await?;
    let mut failed = false;

    if size < length {
        let at = pm
            .kernel("_llseek", &[Arg::W(file), Arg::D(length - 1), Arg::W(0)])
            .await?;

        if at.wrapping_sub(length) as u16 != 0xffff
            || pm
                .kernel(
                    "_lwrite",
                    &[Arg::W(file), Arg::B(vec![file as u8]), Arg::W(1)],
                )
                .await? as u16
                != 1
        {
            // `05a9`: no room (153); the file put back as it was.
            pm.kernel("_llseek", &[Arg::W(file), Arg::D(size), Arg::W(0)])
                .await?;
            failed = true;
        }
    }

    if !failed {
        pm.kernel("_llseek", &[Arg::W(file), Arg::D(0), Arg::W(0)])
            .await?;

        failed = write_bytes(pm, file, &bytes).await? != length as u16;
    }

    pm.kernel("_lwrite", &[Arg::W(file), Arg::D(pm.at(0x36)), Arg::W(0)])
        .await?;
    pm.kernel("_lclose", &[Arg::W(file)]).await?;

    if failed {
        change_group(pm, key, |group| group.block = None);
        pm.user(
            "InvalidateRect",
            &[Arg::W(group.hwnd), Arg::D(0), Arg::W(1)],
        )
        .await?;
    }

    Ok(!failed)
}

/// `_lwrite` of bytes from a global block of their own, as the file writes
/// from its group's block: what was written.
async fn write_bytes(pm: &Pm<'_>, file: u16, bytes: &[u8]) -> R<u16> {
    let memory = pm
        .kernel("GlobalAlloc", &[Arg::W(0x42), Arg::D(bytes.len() as u32)])
        .await? as u16;

    if memory == 0 {
        return Ok(0);
    }

    let at = pm.kernel("GlobalLock", &[Arg::W(memory)]).await?;

    pm.e.system().write_far(at, bytes);

    let written = pm
        .kernel(
            "_lwrite",
            &[Arg::W(file), Arg::D(at), Arg::W(bytes.len() as u16)],
        )
        .await? as u16;

    pm.kernel("GlobalUnlock", &[Arg::W(memory)]).await?;
    pm.kernel("GlobalFree", &[Arg::W(memory)]).await?;
    Ok(written)
}

/// The screen's icon format and size: `GetDeviceCaps` `BITSPIXEL` and
/// `PLANES` of the screen's DC, `SM_CXICON` and `SM_CYICON` (seg4
/// `2214`-`225e`, `1844`-`18a5`).
async fn metrics(pm: &Pm<'_>) -> R<IconMetrics> {
    let dc = pm.user("GetDC", &[Arg::W(0)]).await? as u16;
    let bits_pixel = pm
        .call("GDI", "GetDeviceCaps", &[Arg::W(dc), Arg::W(12)])
        .await?
        .word();
    let planes = pm
        .call("GDI", "GetDeviceCaps", &[Arg::W(dc), Arg::W(14)])
        .await?
        .word();

    pm.user("ReleaseDC", &[Arg::W(0), Arg::W(dc)]).await?;

    let cx = pm.user("GetSystemMetrics", &[Arg::W(11)]).await? as u16;
    let cy = pm.user("GetSystemMetrics", &[Arg::W(12)]).await? as u16;

    Ok(IconMetrics {
        cx,
        cy,
        bits_pixel: bits_pixel as u8,
        planes: planes as u8,
    })
}

/// seg4 `17ae`: a group's icons made again where the display is not the one
/// they were made for -- `SYSTEM.INI`'s `[boot]` `display.drv=` not
/// `PROGMAN.INI`'s `[Settings]` `display.drv=` (`lstrcmp`), or the header's
/// icon format or size not the screen's: each item's icon extracted again
/// from its path (`GroupFile::refresh_icons`) and the file written where it
/// may be. An item left with no icon sets `[34h]`.
async fn display_check(pm: &Pm<'_>, key: u16) -> R<()> {
    let Some(block) = lock(pm, key).await? else {
        return Ok(());
    };
    let system_ini = with(pm, |groups| groups.system_ini.clone());
    let display = pm
        .profile_string(b"Boot", Some(b"display.drv"), 0x81, &system_ini)
        .await?;
    let mine = pm
        .profile_string(b"Settings", Some(b"display.drv"), 0x28, main::INI)
        .await?;
    let differs = pm
        .user("lstrcmp", &[api::text(&display), api::text(&mine)])
        .await? as u16
        != 0;
    let metrics = metrics(pm).await?;
    let data = &block.data;
    let same = data[0x1c] == metrics.bits_pixel
        && data[0x1d] == metrics.planes
        && word(data, 0x18) == metrics.cx
        && word(data, 0x1a) == metrics.cy;

    if !differs && same {
        return Ok(());
    }

    let mut block = block;
    let slots: Vec<(usize, Vec<u8>, u16)> = (0..word(&block.data, 0x20))
        .filter_map(|slot| {
            let def = block.def(slot);

            (def != 0).then(|| {
                (
                    def,
                    crate::groups::c_string(&block.data, word(&block.data, def + 0x16).into()),
                    word(&block.data, def + 4),
                )
            })
        })
        .collect();
    let mut extracted = Vec::new();

    // The icons extracted first, each as the refresh asks for it, then put
    // in the block in that order.
    for (_, path, index) in &slots {
        extracted.push(items::extract(pm, path, *index).await?);
    }

    let mut each = extracted.into_iter();

    block.refresh_icons(metrics, |_, _| each.next().flatten());

    let lost = slots
        .iter()
        .any(|(def, _, _)| word(&block.data, def + 6) == 0);

    if lost {
        pm.sd16(main::D_LOST_ICONS, 1);
    }

    change_group(pm, key, |group| group.block = Some(block));

    if writable(pm, key).await? {
        write(pm, key).await?;
    }

    Ok(())
}

/// Unloading a group (seg4 `1f9a`): its window destroyed by
/// `WM_MDIDESTROY`, its block, path and items let go, and it taken out of
/// the list -- but `[13Eh]` left as it was, so where it was the last, the
/// next group loaded is linked to it and to nothing reachable
/// (`2010`-`202f`; `kb/topics/program-manager-dde.md`, Reload).
pub(crate) async fn unload(pm: &Pm<'_>, hwnd: u16) -> R<()> {
    let key = key_of(pm, hwnd).await?;

    pm.send(pm.d16(main::D_CLIENT), WM_MDIDESTROY, hwnd, 0)
        .await?;
    change(pm, |groups| {
        groups.unlink(key);
        groups.map.remove(&key);
    });
    Ok(())
}

/// `DeleteGroup` (seg4 `23af`): its window destroyed, its file deleted
/// (DOS 41h on its OEM path, seg5 `0c1c`), its `GroupN=` written away, and
/// it taken out of the list, `[13Eh]` mended where it was the last and
/// `[13Ch]` nought where it was current. `Order=` is not written.
pub(crate) async fn delete(pm: &Pm<'_>, hwnd: u16) -> R<()> {
    let key = key_of(pm, hwnd).await?;
    let Some(group) = group(pm, key) else {
        return Ok(());
    };

    pm.send(pm.d16(main::D_CLIENT), WM_MDIDESTROY, hwnd, 0)
        .await?;

    let path = oem(pm, &group.path).await?;

    main::dos_path(pm, 0x4100, &path).await?;
    pm.kernel(
        "WritePrivateProfileString",
        &[
            api::text(b"Groups"),
            api::text(format!("Group{}", group.n as i16).as_bytes()),
            Arg::D(0),
            api::text(main::INI),
        ],
    )
    .await?;
    change(pm, |groups| {
        let before = groups.unlink(key);

        if groups.tail == key {
            groups.tail = before.unwrap_or(0);
        }

        if groups.current == key {
            groups.current = 0;
        }

        groups.map.remove(&key);
    });
    Ok(())
}

/// Renaming (seg4 `248b`): the window's title, and the block's name taken
/// out and added again (`GroupFile::rename`), the file written.
pub(crate) async fn rename(pm: &Pm<'_>, hwnd: u16, name: &[u8]) -> R<()> {
    let key = key_of(pm, hwnd).await?;
    let Some(mut block) = lock(pm, key).await? else {
        return Ok(());
    };

    pm.user("SetWindowText", &[Arg::W(hwnd), api::text(name)])
        .await?;
    block.rename(name);
    change_group(pm, key, |group| group.block = Some(block));
    write(pm, key).await?;
    Ok(())
}

/// A group file's name made from a group's name (seg4 `0ea5`): its first
/// eight letters and digits (`IsCharAlphaNumeric`) and `.GRP`, made one no
/// file has (`0d92`); empty where it has none.
pub(crate) async fn file_name(pm: &Pm<'_>, name: &[u8]) -> R<Vec<u8>> {
    let mut made = Vec::new();

    for &byte in name {
        if made.len() >= 8 {
            break;
        }

        if pm
            .user("IsCharAlphanumeric", &[Arg::W(u16::from(byte))])
            .await? as u16
            != 0
        {
            made.push(byte);
        }
    }

    if made.is_empty() {
        return Ok(made);
    }

    made.extend_from_slice(b".GRP");
    unique(pm, made).await
}

/// `OpenFile` with `OF_EXIST | OF_SHARE_DENY_NONE`: the path it found, or
/// none.
async fn exists(pm: &Pm<'_>, path: &[u8]) -> R<Option<Vec<u8>>> {
    let called = pm
        .call(
            "KERNEL",
            "OpenFile",
            &[api::text(path), api::buffer(0x88), Arg::W(0x4040)],
        )
        .await?;

    Ok((called.word() != 0xffff).then(|| crate::groups::c_string(&called.buffers[1], 8)))
}

/// seg4 `0d92`: while `OpenFile` finds the name, its eighth letter (or the
/// place of its dot, or its end) becomes `0`, the extension the found file's
/// kept after it, then `1` and on, `9` followed by `A`.
async fn unique(pm: &Pm<'_>, mut name: Vec<u8>) -> R<Vec<u8>> {
    let mut place = None;

    while let Some(found) = exists(pm, &name).await? {
        if let Some(at) = place {
            name[at] += 1;

            if name[at] == b':' {
                name[at] = b'A';
            }

            continue;
        }

        let mut count = 0;
        let mut at = None;

        for (index, &byte) in name.iter().enumerate() {
            match byte {
                b'\\' | b':' => {
                    count = 0;
                    at = None;
                }
                b'.' => {
                    at.get_or_insert(index);
                }
                _ if at.is_some() => {}
                _ if count >= 7 => at = Some(index),
                _ => count += 1,
            }
        }

        let at = at.unwrap_or(name.len());

        name.truncate(at);
        name.push(b'0');

        let extension = found.iter().rposition(|&byte| byte == b'.').filter(|&dot| {
            !found[dot..]
                .iter()
                .any(|&byte| byte == b'\\' || byte == b':')
        });

        if let Some(dot) = extension {
            name.extend_from_slice(&found[dot..]);
        }

        place = Some(at);
    }

    Ok(name)
}

/// seg4 `2044`: a path given to `CreateGroup` with its spaces made `_`,
/// and `.GRP` added where its last name has no dot.
fn given_path(path: &[u8]) -> Vec<u8> {
    let mut made: Vec<u8> = path
        .iter()
        .map(|&byte| if byte == b' ' { b'_' } else { byte })
        .collect();
    let mut dot = false;

    for &byte in &made {
        match byte {
            b'.' => dot = true,
            b':' | b'\\' => dot = false,
            _ => {}
        }
    }

    if !dot {
        made.extend_from_slice(b".GRP");
    }

    made
}

/// `CreateGroup`'s making of a group (seg4 `210e`): refused at forty
/// groups' windows (`214e`); given a path, a file there loaded under the
/// name unless a group has it already (`20be`), else made there; given
/// none, made in a file named from the name (`0ea5`). A file is made as a
/// new group's block (`2178`-`22b4`), its path by `OpenFile`'s `OF_PARSE`,
/// `_lcreat` and `_lwrite` whole; then loaded (`1d4d`), renamed to the name
/// (`248b`), and `PROGMAN.INI`'s groups written (`2662`) whether or not it
/// loaded. Its window, or nought.
pub(crate) async fn create(pm: &Pm<'_>, name: &[u8], given: &[u8]) -> R<u16> {
    if windows_top_down(pm).await?.len() >= 40 {
        return Ok(0);
    }

    let path = if given.is_empty() {
        file_name(pm, name).await?
    } else {
        let path = given_path(given);

        if let Some(found) = exists(pm, &path).await? {
            let found = ansi(pm, &found).await?;

            return if loaded_from(pm, &found).await? {
                Ok(0)
            } else {
                made(pm, name, &found).await
            };
        }

        path
    };
    let metrics = metrics(pm).await?;
    let mut block = GroupFile::create(name, metrics);
    let bytes = block.bytes();
    let parsed = pm
        .call(
            "KERNEL",
            "OpenFile",
            &[api::text(&path), api::buffer(0x88), Arg::W(0x100)],
        )
        .await?;

    if parsed.word() == 0xffff {
        return Ok(0);
    }

    let full = ansi(pm, &crate::groups::c_string(&parsed.buffers[1], 8)).await?;
    let file = pm.kernel("_lcreat", &[api::text(&full), Arg::W(0)]).await? as u16;

    if file == 0xffff {
        return Ok(0);
    }

    let written = write_bytes(pm, file, &bytes).await?;

    pm.kernel("_lclose", &[Arg::W(file)]).await?;

    if written != bytes.len() as u16 {
        return Ok(0);
    }

    made(pm, name, &full).await
}

/// A path made ANSI, as `OemToAnsi` makes it.
async fn ansi(pm: &Pm<'_>, path: &[u8]) -> R<Vec<u8>> {
    Ok(pm
        .call(
            "KEYBOARD",
            "OemToAnsi",
            &[api::text(path), api::buffer(0x80)],
        )
        .await?
        .string(1))
}

/// seg4 `20be`: whether a group's window has a group whose path is this one
/// (`lstrcmpi`).
async fn loaded_from(pm: &Pm<'_>, path: &[u8]) -> R<bool> {
    for hwnd in windows_top_down(pm).await? {
        let key = key_of(pm, hwnd).await?;
        let Some(group) = group(pm, key) else {
            continue;
        };

        if pm
            .user("lstrcmpi", &[api::text(path), api::text(&group.path)])
            .await? as u16
            == 0
        {
            return Ok(true);
        }
    }

    Ok(false)
}

/// seg4 `2353`-`23a0`: a group's file loaded, renamed where a name is
/// given, and the profile's groups written.
async fn made(pm: &Pm<'_>, name: &[u8], path: &[u8]) -> R<u16> {
    pm.sd16(main::D_SAVE_ERRORS, 0);
    pm.sd16(main::D_LOST_ICONS, 0);

    let hwnd = load(pm, path, 0).await?;

    if hwnd != 0 && !name.is_empty() {
        rename(pm, hwnd, name).await?;
    }

    write_profile(pm).await?;
    Ok(hwnd)
}

/// `PROGMAN.INI`'s groups (seg4 `2662`-`2826`): the groups' windows from
/// the bottom up, each one's path -- one made from its name where it has
/// none (`0ea5`) -- through `OpenFile`'s `OF_PARSE`, made ANSI and written
/// as `[Groups]` `GroupN=`, a space and N added to `Order=`, a 41st
/// stopping it; then `[Settings]` `Order=`.
pub(crate) async fn write_profile(pm: &Pm<'_>) -> R<()> {
    let mut order = Vec::new();
    let mut count = 0;

    // With no child at all, nothing is written, `Order=` neither
    // (`2695`-`26a2`).
    if pm
        .user("GetWindow", &[Arg::W(pm.d16(main::D_CLIENT)), Arg::W(5)])
        .await?
        == 0
    {
        return Ok(());
    }

    for hwnd in windows_bottom_up(pm).await? {
        if count > 40 {
            pm.user("MessageBeep", &[Arg::W(0)]).await?;
            break;
        }

        let key = key_of(pm, hwnd).await?;
        let Some(mut group) = group(pm, key) else {
            continue;
        };

        if group.path.is_empty() {
            let Some(block) = lock(pm, key).await? else {
                continue;
            };
            let name = crate::groups::c_string(&block.data, word(&block.data, 0x16).into());
            let path = file_name(pm, &name).await?;

            if path.is_empty() {
                pm.user("MessageBeep", &[Arg::W(0)]).await?;
                continue;
            }

            change_group(pm, key, |each| each.path.clone_from(&path));
            group.path = path;
        }

        let parsed = pm
            .call(
                "KERNEL",
                "OpenFile",
                &[api::text(&group.path), api::buffer(0x88), Arg::W(0x100)],
            )
            .await?;

        if parsed.word() as i16 >= 0 {
            let full = ansi(pm, &crate::groups::c_string(&parsed.buffers[1], 8)).await?;
            let n = group.n as i16;

            order.extend_from_slice(format!(" {n}").as_bytes());
            pm.kernel(
                "WritePrivateProfileString",
                &[
                    api::text(b"Groups"),
                    api::text(format!("Group{n}").as_bytes()),
                    api::text(&full),
                    api::text(main::INI),
                ],
            )
            .await?;
            count += 1;
        } else {
            pm.user("MessageBeep", &[Arg::W(0)]).await?;
        }
    }

    pm.kernel(
        "WritePrivateProfileString",
        &[
            api::text(b"Settings"),
            api::text(b"Order"),
            api::text(&order),
            api::text(main::INI),
        ],
    )
    .await?;
    Ok(())
}

/// `ExitProgman(1)` and `WM_CLOSE`'s saving (seg4 `2845`): nothing with
/// `NoSaveSettings`; else `Window=` from the frame's `GetWindowPlacement`,
/// a show command of 7 written as 1; the profile's groups unless `[1Eh]`;
/// and each group from the bottom up given its window's place and its
/// items' (`2518`) and its file written.
///
/// Not followed: the hourglass cursor shown meanwhile.
pub(crate) async fn save(pm: &Pm<'_>) -> R<()> {
    if pm.d16(main::D_NO_SAVE_SETTINGS) != 0 {
        return Ok(());
    }

    pm.sd16(main::D_SAVE_ERRORS, 0);

    let placement = pm
        .call(
            "USER",
            "GetWindowPlacement",
            &[Arg::W(pm.d16(main::D_FRAME)), Arg::B(placement_buffer())],
        )
        .await?
        .buffers[0]
        .clone();
    let at = |offset: usize| word(&placement, offset) as i16;
    let show = if at(4) == 7 { 1 } else { at(4) };
    let line = format!(
        "{} {} {} {} {}",
        at(0x0e),
        at(0x10),
        at(0x12),
        at(0x14),
        show
    );

    pm.kernel(
        "WritePrivateProfileString",
        &[
            api::text(b"Settings"),
            api::text(b"Window"),
            api::text(line.as_bytes()),
            api::text(main::INI),
        ],
    )
    .await?;

    if pm.d16(main::D_INI_READ_ONLY) == 0 {
        write_profile(pm).await?;
    }

    for hwnd in windows_bottom_up(pm).await? {
        save_group(pm, hwnd).await?;
        write(pm, key_of(pm, hwnd).await?).await?;
    }

    Ok(())
}

/// A `WINDOWPLACEMENT` to be filled: its length, 16h.
pub(crate) fn placement_buffer() -> Vec<u8> {
    let mut buffer = vec![0; 0x16];

    buffer[0] = 0x16;
    buffer
}

/// seg4 `2518`: a group's window's place into its block -- `nCmdShow`,
/// `rcNormal` and `ptMin` from `GetWindowPlacement` -- and each item's,
/// the slots made the window's order (`GroupFile::save`).
async fn save_group(pm: &Pm<'_>, hwnd: u16) -> R<()> {
    let key = key_of(pm, hwnd).await?;
    let Some(mut block) = lock(pm, key).await? else {
        return Ok(());
    };
    let placement = pm
        .call(
            "USER",
            "GetWindowPlacement",
            &[Arg::W(hwnd), Arg::B(placement_buffer())],
        )
        .await?
        .buffers[0]
        .clone();
    let at = |offset: usize| word(&placement, offset) as i16;
    let Some(group) = group(pm, key) else {
        return Ok(());
    };
    let placed: Vec<crate::groups::Placed> = group
        .items
        .iter()
        .map(|item| crate::groups::Placed {
            slot: item.slot,
            x: item.icon[0],
            y: item.icon[1],
        })
        .collect();
    let slots = block.save(
        crate::groups::Placement {
            show: at(4) as u16,
            rc_normal: [at(0x0e), at(0x10), at(0x12), at(0x14)],
            pt_min: [at(6), at(8)],
        },
        &placed,
    );

    change_group(pm, key, |group| {
        for (item, slot) in group.items.iter_mut().zip(slots) {
            item.slot = slot;
        }

        group.block = Some(block);
    });
    Ok(())
}

/// The Reload command with no group (seg7 `09b3`-`0a1f`): the MDI client
/// hidden, the frame validated, each group unloaded, the groups loaded
/// again from `PROGMAN.INI` (seg3 `0809`) and the client shown.
pub(crate) async fn reload_all(pm: &Pm<'_>) -> R<()> {
    pm.user("ShowWindow", &[Arg::W(pm.d16(main::D_CLIENT)), Arg::W(0)])
        .await?;
    pm.user("ValidateRect", &[Arg::W(pm.d16(main::D_FRAME)), Arg::D(0)])
        .await?;

    while let Some(&hwnd) = windows_top_down(pm).await?.first() {
        unload(pm, hwnd).await?;
    }

    let system_ini = with(pm, |groups| groups.system_ini.clone());

    main::load_groups(pm, &system_ini).await?;
    pm.user("ShowWindow", &[Arg::W(pm.d16(main::D_CLIENT)), Arg::W(5)])
        .await?;
    Ok(())
}
