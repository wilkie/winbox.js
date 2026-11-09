//! A group's items: made from its file (seg4 `1735`), made by `AddItem`
//! (`CreateNewItem`, seg4 `105d`), placed (seg2 `1325`), taken out (seg4
//! `15a8`), and the group window's scroll bars made to fit them (seg2
//! `0b04`), as `PROGMAN.EXE` does each.
//!
//! `PROGMAN.EXE` keeps an item in memory as a structure of 16h bytes (seg4
//! `0f27`): the next, its slot, the instance of the program it started,
//! its icon's rectangle in the group's window and its title's. Its place is
//! the icon's top left, which saving writes to the file (seg4 `2518`) and a
//! group's text answers (seg7 `1337`).

use super::loaded::{self, Loaded};
use super::main::{self, Pm, R};
use crate::commdlg::api::{self, Arg};
use crate::groups::{Extracted, NewItem};

/// An item in memory.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct Item {
    /// `[+2]`: its slot in the group's table.
    pub slot: u16,
    /// `[+6]`: its icon's rectangle, left, top, right, bottom.
    pub icon: [i16; 4],
    /// `[+0Eh]`: its title's.
    pub title: [i16; 4],
}

/// Half of a number as the file halves one: `cwd`, `sub ax,dx`, `sar ax,1`
/// -- toward nought.
fn half(value: i16) -> i16 {
    value / 2
}

fn word(data: &[u8], at: usize) -> u16 {
    data.get(at..at + 2)
        .map_or(0, |bytes| u16::from_le_bytes([bytes[0], bytes[1]]))
}

fn rect_bytes(rect: [i16; 4]) -> Vec<u8> {
    rect.iter().flat_map(|value| value.to_le_bytes()).collect()
}

fn rect_of(bytes: &[u8]) -> [i16; 4] {
    [0, 2, 4, 6].map(|at| word(bytes, at) as i16)
}

/// `UnionRect` or `IntersectRect` of two rectangles, by USER as the file
/// calls it: the rectangle, and USER's answer.
async fn combined(pm: &Pm<'_>, name: &str, a: [i16; 4], b: [i16; 4]) -> R<([i16; 4], bool)> {
    let called = pm
        .call(
            "USER",
            name,
            &[api::buffer(8), Arg::B(rect_bytes(a)), Arg::B(rect_bytes(b))],
        )
        .await?;

    Ok((rect_of(&called.buffers[0]), called.word() != 0))
}

/// The metrics start-up keeps (seg3 `0a43`-`0aea`).
struct Spacing {
    /// `[444h]`: an icon's cell, `SM_CXICON` and four borders.
    cell_x: i16,
    /// `[44Ah]`: `SM_CYICON` and four borders.
    cell_y: i16,
    /// `[446h]`: two `SM_CXBORDER`s.
    border_x: i16,
    /// `[798h]`: `SM_CYBORDER`.
    border_y: i16,
    /// `[4D4h]`, `[558h]`: `SPI_ICONHORIZONTALSPACING`, `..VERTICAL..`.
    across: i16,
    down: i16,
}

fn spacing(pm: &Pm<'_>) -> Spacing {
    Spacing {
        cell_x: pm.d16(main::D_CELL_X) as i16,
        cell_y: pm.d16(main::D_CELL_Y) as i16,
        border_x: pm.d16(main::D_BORDER_X) as i16,
        border_y: pm.d16(main::D_BORDER_Y) as i16,
        across: pm.d16(main::D_ACROSS) as i16,
        down: pm.d16(main::D_DOWN) as i16,
    }
}

/// seg2 `1291`: the cell an icon at a place takes, its spacing wide and
/// high, centred across on the icon, less the scroll positions.
fn cell(spacing: &Spacing, place: (i16, i16), scroll: (i16, i16)) -> [i16; 4] {
    let left = half(spacing.cell_x.wrapping_sub(spacing.across))
        .wrapping_sub(scroll.0)
        .wrapping_add(place.0);
    let top = place.1.wrapping_sub(scroll.1);

    [
        left,
        top,
        left.wrapping_add(spacing.across).wrapping_sub(1),
        top.wrapping_add(spacing.down).wrapping_sub(1),
    ]
}

/// seg2 `12cc`: whether an item's cell meets the cell, those whose icon's
/// left is -1 -- the one being placed -- passed over.
async fn overlaps(pm: &Pm<'_>, items: &[Item], wanted: [i16; 4], scroll: (i16, i16)) -> R<bool> {
    let spacing = spacing(pm);

    for item in items {
        if item.icon[0] == -1 {
            continue;
        }

        let theirs = cell(&spacing, (item.icon[0], item.icon[1]), scroll);

        if combined(pm, "IntersectRect", theirs, wanted).await?.1 {
            return Ok(true);
        }
    }

    Ok(false)
}

/// A scroll bar's position less its range's start, where the style has the
/// bar; else nought.
async fn scrolled(pm: &Pm<'_>, hwnd: u16, style: u32, bar: u16) -> R<i16> {
    if style & (0x0010_0000 << bar) == 0 {
        return Ok(0);
    }

    let position = pm
        .user("GetScrollPos", &[Arg::W(hwnd), Arg::W(bar)])
        .await? as i16;
    let range = pm
        .call(
            "USER",
            "GetScrollRange",
            &[Arg::W(hwnd), Arg::W(bar), api::buffer(2), api::buffer(2)],
        )
        .await?;

    Ok(position.wrapping_sub(word(&range.buffers[0], 0) as i16))
}

/// seg2 `1325`-`146e`: the first place where there is room: from half the
/// spacing less half a cell and two borders across, the top less the
/// scroll positions, a spacing on each time, a row down where the next
/// would pass the client area's right -- the restored window's rectangle
/// where it is minimized -- until no other item's cell meets its cell. The
/// item being placed is passed over, its icon's left made -1.
async fn room(pm: &Pm<'_>, key: u16, at: usize, hwnd: u16) -> R<(i16, i16)> {
    let spacing = spacing(pm);
    let style = pm
        .user("GetWindowLong", &[Arg::W(hwnd), Arg::W(0xfff0)])
        .await?;
    let client = if style & 0x2000_0000 != 0 {
        let placement = pm
            .call(
                "USER",
                "GetWindowPlacement",
                &[Arg::W(hwnd), Arg::B(loaded::placement_buffer())],
            )
            .await?
            .buffers[0]
            .clone();
        let normal = rect_of(&placement[0x0e..0x16]);

        [
            0,
            0,
            normal[2].wrapping_sub(normal[0]),
            normal[3].wrapping_sub(normal[1]),
        ]
    } else {
        let called = pm
            .call("USER", "GetClientRect", &[Arg::W(hwnd), api::buffer(8)])
            .await?;

        rect_of(&called.buffers[0])
    };
    let scroll = (
        scrolled(pm, hwnd, style, 0).await?,
        scrolled(pm, hwnd, style, 1).await?,
    );
    let first = half(spacing.across.wrapping_sub(spacing.cell_x))
        .wrapping_sub(scroll.0)
        .wrapping_add(spacing.border_x);
    let mut place = (first, scroll.1.wrapping_neg());

    loaded::change_group(pm, key, |group| group.items[at].icon[0] = -1);

    loop {
        let wanted = cell(&spacing, place, scroll);
        let items = loaded::group(pm, key)
            .map(|group| group.items)
            .unwrap_or_default();

        if !overlaps(pm, &items, wanted, scroll).await? {
            return Ok(place);
        }

        if wanted[2].wrapping_add(spacing.across) > client[2] {
            place = (first, place.1.wrapping_add(spacing.down));
        } else {
            place.0 = place.0.wrapping_add(spacing.across);
        }
    }
}

/// seg2 `14a4`-`15bd`: an item's title as `DrawText` measures its name in
/// the icons' title font, a spacing less four borders wide, wrapped where
/// `IconTitleWrap` is on; two borders more each way, and centred beneath
/// the icon at the place.
async fn title(pm: &Pm<'_>, hwnd: u16, place: (i16, i16), name: &[u8]) -> R<[i16; 4]> {
    let spacing = spacing(pm);
    let dc = pm.user("GetDC", &[Arg::W(hwnd)]).await? as u16;
    let old = pm
        .call(
            "GDI",
            "SelectObject",
            &[Arg::W(dc), Arg::W(pm.d16(main::D_TITLE_FONT))],
        )
        .await?
        .word();
    let flags = 0x0c10
        | if pm.d16(main::D_TITLE_WRAP) == 0 {
            0x20
        } else {
            0
        };
    let width = spacing
        .across
        .wrapping_sub(spacing.border_x.wrapping_mul(2));
    let measured = pm
        .call(
            "USER",
            "DrawText",
            &[
                Arg::W(dc),
                api::text(name),
                Arg::W(0xffff),
                Arg::B(rect_bytes([0, 0, width, 0])),
                Arg::W(flags),
            ],
        )
        .await?;
    let mut title = rect_of(&measured.buffers[1]);

    if old != 0 {
        pm.call("GDI", "SelectObject", &[Arg::W(dc), Arg::W(old)])
            .await?;
    }

    pm.user("ReleaseDC", &[Arg::W(hwnd), Arg::W(dc)]).await?;
    title[2] = title[2].wrapping_add(spacing.border_x.wrapping_mul(2));
    title[3] = title[3].wrapping_add(spacing.border_y.wrapping_mul(2));

    let dx = half(spacing.cell_x)
        .wrapping_add(half(title[0].wrapping_sub(title[2])))
        .wrapping_add(place.0);
    let dy = place
        .1
        .wrapping_sub(spacing.border_y)
        .wrapping_add(spacing.cell_y);

    Ok([
        title[0].wrapping_add(dx),
        title[1].wrapping_add(dy),
        title[2].wrapping_add(dx),
        title[3].wrapping_add(dy),
    ])
}

/// seg2 `1325`: an item's icon and title rectangles: at -1 across, where
/// there is room (`room`); the icon a cell's size at the place; its title
/// beneath it (`title`).
async fn place(pm: &Pm<'_>, key: u16, at: usize, given: (i16, i16), name: &[u8]) -> R<()> {
    let spacing = spacing(pm);
    let Some(group) = loaded::group(pm, key) else {
        return Ok(());
    };
    let hwnd = group.hwnd;
    let place = if given.0 == -1 {
        room(pm, key, at, hwnd).await?
    } else {
        given
    };
    let icon = [
        place.0,
        place.1,
        place.0.wrapping_add(spacing.cell_x),
        place.1.wrapping_add(spacing.cell_y),
    ];
    let title = title(pm, hwnd, place, name).await?;

    loaded::change_group(pm, key, |group| {
        group.items[at].icon = icon;
        group.items[at].title = title;
    });
    Ok(())
}

/// seg2 `0863`: an item's icon and title invalidated in its group's window
/// -- gathered meanwhile where `[16h]` is set.
///
/// Not followed: the gathering (`[65Ch]`), for painting a window that is
/// never shown.
async fn invalidate(pm: &Pm<'_>, group: &Loaded, item: Option<&Item>) -> R<()> {
    let Some(item) = item else {
        return Ok(());
    };
    let (both, _) = combined(pm, "UnionRect", item.icon, item.title).await?;

    if pm.d16(main::D_CREATING) == 0 {
        pm.user(
            "InvalidateRect",
            &[Arg::W(group.hwnd), Arg::B(rect_bytes(both)), Arg::W(1)],
        )
        .await?;
    }

    Ok(())
}

/// seg4 `0f09`: an item put in memory for a slot, first or last in the
/// group's order, and placed where its file's place says (`1325`). Whether
/// it was.
async fn made(pm: &Pm<'_>, key: u16, slot: u16, first: bool) -> R<bool> {
    let Some(block) = loaded::lock(pm, key).await? else {
        return Ok(false);
    };
    let Some(group) = loaded::group(pm, key) else {
        return Ok(false);
    };
    let item = Item {
        slot,
        ..Item::default()
    };
    let at = if first {
        invalidate(pm, &group, group.items.first()).await?;
        loaded::change_group(pm, key, |group| group.items.insert(0, item));
        0
    } else {
        loaded::change_group(pm, key, |group| group.items.push(item));
        group.items.len()
    };
    let def = block.def(slot);
    let data = &block.data;
    let name = crate::groups::c_string(data, word(data, def + 0x12).into());

    place(
        pm,
        key,
        at,
        (word(data, def) as i16, word(data, def + 2) as i16),
        &name,
    )
    .await?;

    if let Some(group) = loaded::group(pm, key) {
        invalidate(pm, &group, group.items.get(at)).await?;
    }

    Ok(true)
}

/// seg4 `1735`: a group's items made from its slots, the last first, each
/// put first; then its scroll bars fitted (seg2 `0b04`) unless it is being
/// made.
///
/// Not followed: arranging them where `AutoArrange` is on (seg2 `1d87`).
pub(crate) async fn make_items(pm: &Pm<'_>, key: u16) -> R<()> {
    let Some(block) = loaded::lock(pm, key).await? else {
        return Ok(());
    };

    for slot in (0..word(&block.data, 0x20)).rev() {
        if block.def(slot) != 0 {
            made(pm, key, slot, true).await?;
        }
    }

    fitted(pm, key).await
}

/// After items change (seg7 `0728`-`0756`, seg4 `16f2`-`171a`, `177f`):
/// the scroll bars fitted unless the group is being made; arranging where
/// `AutoArrange` is on is not followed.
pub(crate) async fn fitted(pm: &Pm<'_>, key: u16) -> R<()> {
    if pm.d16(main::D_CREATING) != 0 {
        return Ok(());
    }

    if let Some(group) = loaded::group(pm, key) {
        scroll_bars(pm, group.hwnd).await?;
    }

    Ok(())
}

/// A window's client rectangle were its style the one given (seg2
/// `0a9c`): the style set, its window rectangle in its own client's
/// coordinates, `WM_NCCALCSIZE`.
async fn client_with(pm: &Pm<'_>, hwnd: u16, style: u32) -> R<[i16; 4]> {
    pm.user("GetWindowLong", &[Arg::W(hwnd), Arg::W(0xfff0)])
        .await?;
    pm.user(
        "SetWindowLong",
        &[Arg::W(hwnd), Arg::W(0xfff0), Arg::D(style)],
    )
    .await?;

    let mut rect = pm
        .call("USER", "GetWindowRect", &[Arg::W(hwnd), api::buffer(8)])
        .await?
        .buffers[0]
        .clone();

    for at in [0, 4] {
        let point = pm
            .call(
                "USER",
                "ScreenToClient",
                &[Arg::W(hwnd), Arg::B(rect[at..at + 4].to_vec())],
            )
            .await?
            .buffers[0]
            .clone();

        rect[at..at + 4].copy_from_slice(&point);
    }

    let called = pm
        .call(
            "USER",
            "SendMessage",
            &[Arg::W(hwnd), Arg::W(0x83), Arg::W(0), Arg::B(rect)],
        )
        .await?;

    Ok(rect_of(&called.buffers[0]))
}

/// seg2 `0b29`-`0bc4`: the extent of a group's items -- each icon, and its
/// title as wide as the icon -- its left less half a cell's overhang and
/// two borders; empty with no items.
async fn extent(pm: &Pm<'_>, hwnd: u16) -> R<[i16; 4]> {
    let spacing = spacing(pm);
    let key = loaded::key_of(pm, hwnd).await?;
    let items = loaded::group(pm, key)
        .map(|group| group.items)
        .unwrap_or_default();
    let mut extent = [0; 4];

    if !items.is_empty() {
        for item in &items {
            extent = combined(pm, "UnionRect", extent, item.icon).await?.0;

            let tall = [item.icon[0], item.title[1], item.icon[2], item.title[3]];

            extent = combined(pm, "UnionRect", extent, tall).await?.0;
        }

        if extent[2] != extent[0] {
            extent[0] = extent[0]
                .wrapping_add(half(spacing.cell_x.wrapping_sub(spacing.across)))
                .wrapping_sub(spacing.border_x);
        }
    }

    Ok(extent)
}

/// seg2 `0b04`: a group window's scroll bars made to fit its items, unless
/// it is an icon or this is already under way (`[15Ch]`). The items'
/// extent -- each icon, and its title as wide as the icon -- its left less
/// half a cell's overhang and two borders; each bar added while the extent
/// passes the client area the style so far would leave; where the style
/// changes, or a bar's position is not nought or its range not the extent
/// less the client area, both positions made nought, both ranges set and
/// the frame drawn again.
pub(crate) async fn scroll_bars(pm: &Pm<'_>, hwnd: u16) -> R<()> {
    if pm.d16(main::D_SCROLLING) != 0 || pm.user("IsIconic", &[Arg::W(hwnd)]).await? as u16 != 0 {
        return Ok(());
    }

    pm.sd16(main::D_SCROLLING, 1);

    let extent = extent(pm, hwnd).await?;
    let original = pm
        .user("GetWindowLong", &[Arg::W(hwnd), Arg::W(0xfff0)])
        .await?;
    let mut style = original & !0x0030_0000;
    let client = loop {
        let before = style;
        let client = client_with(pm, hwnd, style).await?;

        if extent[0] < client[0] || extent[2] > client[2] {
            style |= 0x0010_0000;
        }

        if extent[1] < client[1] || extent[3] > client[3] {
            style |= 0x0020_0000;
        }

        if style == before {
            break client;
        }
    };

    if style == original && style & 0x0030_0000 == 0 {
        pm.sd16(main::D_SCROLLING, 0);
        return Ok(());
    }

    let mut range = combined(pm, "UnionRect", client, extent).await?.0;

    range[2] = range[2].wrapping_add(client[0].wrapping_sub(client[2]));
    range[3] = range[3].wrapping_add(client[1].wrapping_sub(client[3]));

    if style != original || !ranges_kept(pm, hwnd, style, range).await? {
        set_ranges(pm, hwnd, range).await?;
    }

    pm.sd16(main::D_SCROLLING, 0);
    Ok(())
}

/// seg2 `0c7e`-`0cee`: whether each bar the style has is at nought and its
/// range the one wanted.
async fn ranges_kept(pm: &Pm<'_>, hwnd: u16, style: u32, range: [i16; 4]) -> R<bool> {
    for (bar, flag, low, high) in [
        (0, 0x0010_0000, range[0], range[2]),
        (1, 0x0020_0000, range[1], range[3]),
    ] {
        if style & flag == 0 {
            continue;
        }

        if pm
            .user("GetScrollPos", &[Arg::W(hwnd), Arg::W(bar)])
            .await? as u16
            != 0
        {
            return Ok(false);
        }

        let called = pm
            .call(
                "USER",
                "GetScrollRange",
                &[Arg::W(hwnd), Arg::W(bar), api::buffer(2), api::buffer(2)],
            )
            .await?;

        if word(&called.buffers[0], 0) as i16 != low || word(&called.buffers[1], 0) as i16 != high {
            return Ok(false);
        }
    }

    Ok(true)
}

/// seg2 `0cf0`-`0d3f`: both positions nought, both ranges set, the frame
/// drawn again.
async fn set_ranges(pm: &Pm<'_>, hwnd: u16, range: [i16; 4]) -> R<()> {
    for bar in [0, 1] {
        pm.user(
            "SetScrollPos",
            &[Arg::W(hwnd), Arg::W(bar), Arg::W(0), Arg::W(0)],
        )
        .await?;
    }

    for (bar, low, high) in [(0, range[0], range[2]), (1, range[1], range[3])] {
        pm.user(
            "SetScrollRange",
            &[
                Arg::W(hwnd),
                Arg::W(bar),
                Arg::W(low as u16),
                Arg::W(high as u16),
                Arg::W(0),
            ],
        )
        .await?;
    }

    pm.user(
        "SetWindowPos",
        &[
            Arg::W(hwnd),
            Arg::W(0),
            Arg::W(0),
            Arg::W(0),
            Arg::W(0),
            Arg::W(0),
            Arg::W(0x37),
        ],
    )
    .await?;
    Ok(())
}

/// seg6 `0162`: a path's parts as far as its first space: where its file's
/// name begins, and its last dot where that is within the name.
fn path_parts(path: &[u8]) -> (usize, Option<usize>) {
    let mut file = 0;
    let mut dot = None;

    for (index, &byte) in path.iter().enumerate() {
        match byte {
            0 | b' ' => break,
            b'\\' | b':' => file = index + 1,
            b'.' => dot = Some(index),
            _ => {}
        }
    }

    (file, dot.filter(|&dot| dot >= file))
}

/// seg6 `01ef`: `.exe` added where the path, to its first space, has no
/// extension and there is room.
fn with_exe(path: &mut Vec<u8>, size: usize) {
    if path_parts(path).1.is_none() && path.len() + 3 < size {
        path.extend_from_slice(b".exe");
    }
}

/// seg6 `0130`: a string cut at its first space.
fn first_word(text: &mut Vec<u8>) {
    if let Some(at) = text.iter().position(|&byte| byte == b' ') {
        text.truncate(at);
    }
}

/// `DoEnvironmentSubst` of a string in a buffer of 81h, as the file does.
async fn substituted(pm: &Pm<'_>, text: &[u8]) -> R<Vec<u8>> {
    let mut buffer = text.to_vec();

    buffer.resize(0x81, 0);

    Ok(pm
        .call(
            "SHELL",
            "DoEnvironmentSubst",
            &[Arg::B(buffer), Arg::W(0x81)],
        )
        .await?
        .string(0))
}

/// An icon as `CreateNewItem` and the display check take one (seg4
/// `11ac`-`122c`, `195c`-`19e1`): the path's environment variables put in,
/// `.exe` added and cut at its first space; `ExtractAssociatedIcon` with
/// the index, `LockResource` and `DumpIcon`; the icon's header, AND and XOR
/// planes copied, the index written back; and the icon let go. None where
/// `ExtractAssociatedIcon` has none.
pub(crate) async fn extract(pm: &Pm<'_>, path: &[u8], index: u16) -> R<Option<Extracted>> {
    let mut buffer = substituted(pm, path).await?;

    with_exe(&mut buffer, 0x81);
    first_word(&mut buffer);
    buffer.resize(0x81, 0);

    let called = pm
        .call(
            "SHELL",
            "ExtractAssociatedIcon",
            &[
                Arg::W(pm.d16(main::D_INSTANCE)),
                Arg::B(buffer),
                Arg::B(index.to_le_bytes().to_vec()),
            ],
        )
        .await?;
    let icon = called.word();
    let written = word(&called.buffers[1], 0);

    if icon == 0 {
        return Ok(None);
    }

    let at = pm.kernel("LockResource", &[Arg::W(icon)]).await?;
    let dumped = pm
        .call(
            "USER",
            "DumpIcon",
            &[Arg::D(at), api::buffer(2), api::buffer(4), api::buffer(4)],
        )
        .await?;
    let far = |bytes: &[u8]| u32::from(word(bytes, 2)) << 16 | u32::from(word(bytes, 0));
    let extracted = {
        let system = pm.e.system();
        let header_size = usize::from(word(&dumped.buffers[0], 0));

        Extracted {
            icon_index: written,
            header: system.read_far(at, header_size),
            and: system.read_far(far(&dumped.buffers[1]), (dumped.value & 0xffff) as usize),
            xor: system.read_far(far(&dumped.buffers[2]), (dumped.value >> 16) as usize),
        }
    };

    pm.kernel("GlobalUnlock", &[Arg::W(icon)]).await?;
    pm.user("DestroyIcon", &[Arg::W(icon)]).await?;
    Ok(Some(extracted))
}

/// What `AddItem` gives `CreateNewItem` (seg7 `06ed`-`071c`).
pub(crate) struct Adding {
    pub name: Vec<u8>,
    pub command: Vec<u8>,
    pub icon_path: Vec<u8>,
    pub directory: Vec<u8>,
    pub hot_key: u16,
    pub minimized: bool,
    pub icon_index: u16,
    pub place: Option<(i16, i16)>,
    pub first: bool,
}

/// `CreateNewItem` (seg4 `105d`): nothing where the group's file is
/// read-only; the icon extracted; the item put in the block
/// (`GroupFile::add_item`: its slot, `ITEMDEF`, name, the command stored
/// with the directory (`store_command`), icon path, the icon, its place as
/// given or -1, -1, and its tags); then put in memory and placed (`0f09`),
/// its place written into its `ITEMDEF`, and the file written. Where any of
/// it fails the block is let go, to be read again from the file
/// (`157c`-`1589`). Whether it was made.
///
/// Not followed: an icon `ExtractAssociatedIcon` gives none of, which the
/// file reads at nought -- here the item is not made.
pub(crate) async fn create(pm: &Pm<'_>, hwnd: u16, adding: Adding) -> R<bool> {
    let key = loaded::key_of(pm, hwnd).await?;
    let stored = crate::groups::store_command(&adding.command, Some(&adding.directory));

    if loaded::group(pm, key).is_none() || !loaded::writable(pm, key).await? {
        return Ok(false);
    }

    let Some(icon) = extract(pm, &adding.icon_path, adding.icon_index).await? else {
        return Ok(false);
    };
    let Some(mut block) = loaded::lock(pm, key).await? else {
        return Ok(false);
    };
    let (x, y) = adding.place.unwrap_or((-1, -1));
    let new = NewItem {
        name: adding.name,
        stored: stored.stored,
        icon_path: adding.icon_path,
        icon_index: icon.icon_index,
        header: icon.header,
        and: icon.and,
        xor: icon.xor,
        x,
        y,
        hot_key: adding.hot_key,
        minimized: adding.minimized,
        program_directory: stored.program_directory,
    };
    let Ok(slot) = block.add_item(&new) else {
        discard(pm, key);
        return Ok(false);
    };

    loaded::change_group(pm, key, |group| group.block = Some(block));

    if !made(pm, key, slot, adding.first).await? {
        discard(pm, key);
        return Ok(false);
    }

    let placed = loaded::change_group(pm, key, |group| {
        let item = group.items.iter().find(|item| item.slot == slot).copied()?;
        let block = group.block.as_mut()?;
        let def = block.def(slot);

        block.data[def..def + 2].copy_from_slice(&item.icon[0].to_le_bytes());
        block.data[def + 2..def + 4].copy_from_slice(&item.icon[1].to_le_bytes());
        Some(item)
    })
    .flatten();

    if placed.is_some() && loaded::write(pm, key).await? {
        return Ok(true);
    }

    forget(pm, key, slot).await?;
    discard(pm, key);
    Ok(false)
}

/// The block let go, to be read again from the file (`GlobalReAlloc` to
/// nought).
fn discard(pm: &Pm<'_>, key: u16) {
    loaded::change_group(pm, key, |group| group.block = None);
}

/// seg4 `0000`: an item taken out of memory: it invalidated, and the next
/// where it was the first.
async fn forget(pm: &Pm<'_>, key: u16, slot: u16) -> R<()> {
    let Some(group) = loaded::group(pm, key) else {
        return Ok(());
    };
    let Some(at) = group.items.iter().position(|item| item.slot == slot) else {
        return Ok(());
    };

    invalidate(pm, &group, group.items.get(at)).await?;

    if at == 0 {
        invalidate(pm, &group, group.items.get(1)).await?;
    }

    loaded::change_group(pm, key, |group| group.items.remove(at));
    Ok(())
}

/// seg4 `15a8`: an item deleted: where the file may be written, its blocks
/// and tags taken out (`GroupFile::delete_item`), it taken out of memory,
/// the scroll bars fitted and the file written.
pub(crate) async fn delete(pm: &Pm<'_>, key: u16, slot: u16) -> R<()> {
    let Some(group) = loaded::group(pm, key) else {
        return Ok(());
    };

    if !loaded::writable(pm, key).await? {
        let item = group.items.iter().find(|item| item.slot == slot);

        return invalidate(pm, &group, item).await;
    }

    if let Some(mut block) = group.block {
        block.delete_item(slot);
        loaded::change_group(pm, key, |group| group.block = Some(block));
    }

    forget(pm, key, slot).await?;
    fitted(pm, key).await?;
    loaded::write(pm, key).await?;
    Ok(())
}

/// seg5 `00ed`: an item's name from its command: the file's name after the
/// last `\`, to the last dot or the end, 40 characters at most -- the cut
/// a nought written into the command -- made upper case and then all but
/// its first letter lower (`AnsiUpper`, `AnsiLower`). The name, and the
/// command as it is left.
pub(crate) async fn name_of(pm: &Pm<'_>, command: &[u8]) -> R<(Vec<u8>, Vec<u8>)> {
    let mut command = command.to_vec();
    let file = command
        .iter()
        .rposition(|&byte| byte == b'\\')
        .map_or(0, |at| at + 1);
    let dot = command
        .iter()
        .rposition(|&byte| byte == b'.')
        .unwrap_or(command.len());
    let end = if dot >= file { dot } else { command.len() };
    let mut name = if dot >= file {
        command[file..end].to_vec()
    } else {
        // The nought at the dot, before the name: the name runs to the end.
        command[file..].to_vec()
    };

    if name.len() > 40 {
        name.truncate(40);

        if file + 40 < command.len() {
            command.truncate(file + 40);
        }
    }

    let upper = pm
        .call("USER", "AnsiUpper", &[api::text(&name)])
        .await?
        .string(0);
    let mut name = upper;

    if name.len() > 1 {
        let lower = pm
            .call("USER", "AnsiLower", &[api::text(&name[1..])])
            .await?
            .string(0);

        name.truncate(1);
        name.extend_from_slice(&lower);
    }

    Ok((name, command))
}

/// seg6 `0398`: an item's directory from its command: the command's path
/// to its first space, but its file's name and the `\` before it -- kept
/// for a root -- and nothing for a network path or a command with no path.
pub(crate) fn directory_of(command: &[u8]) -> Vec<u8> {
    let unc = command.starts_with(b"\\\\");
    let (file, _) = path_parts(command);

    if unc || file == 0 {
        return Vec::new();
    }

    let mut directory = command.to_vec();

    if (file <= 3 && directory.get(1) == Some(&b':')) || file == 1 {
        directory.truncate(file);
    } else {
        directory.truncate(file - 1);
    }

    directory
}

/// seg6 `0416`: a command from its file's name on -- past its path, to its
/// first space -- or the whole of a network path.
pub(crate) fn file_part(command: &[u8]) -> &[u8] {
    if command.starts_with(b"\\\\") {
        return command;
    }

    &command[path_parts(command).0..]
}

/// `AddItem`'s defaults, after its arguments are read (seg7 `04ba`-`069d`):
/// the command's environment variables put in and cut at its first space
/// for finding its program; the directory's, where it is given; else the
/// command's directory; and with no icon path, `FindExecutable`'s answer
/// for the command in that directory.
pub(crate) async fn defaults(pm: &Pm<'_>, adding: &mut Adding, given_directory: bool) -> R<()> {
    let mut program = substituted(pm, &adding.command).await?;

    first_word(&mut program);

    let mut directory = if given_directory {
        let mut directory = substituted(pm, &adding.directory).await?;

        first_word(&mut directory);
        directory
    } else {
        Vec::new()
    };

    if adding.directory.is_empty() {
        adding.directory = directory_of(&adding.command);
        directory = adding.directory.clone();
    }

    if adding.icon_path.is_empty() {
        adding.icon_path = pm
            .call(
                "SHELL",
                "FindExecutable",
                &[
                    api::text(&program),
                    api::text(&directory),
                    api::buffer(0x81),
                ],
            )
            .await?
            .string(2);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_commands_directory() {
        assert_eq!(directory_of(b"C:\\WINDOWS\\NOTEPAD.EXE"), b"C:\\WINDOWS");
        assert_eq!(
            directory_of(b"C:\\WINDOWS\\WRITE.EXE C:\\A,B.WRI"),
            b"C:\\WINDOWS"
        );
        assert_eq!(directory_of(b"C:\\CALC.EXE"), b"C:\\");
        assert_eq!(directory_of(b"C:CALC.EXE"), b"C:");
        assert_eq!(directory_of(b"\\CALC.EXE"), b"\\");
        assert_eq!(directory_of(b"SOL.EXE"), b"");
        assert_eq!(directory_of(b"\\\\SERVER\\X.EXE"), b"");
    }

    #[test]
    fn an_exe_added_where_there_is_no_extension() {
        let mut path = b"C:\\WINDOWS\\CALC".to_vec();

        with_exe(&mut path, 0x81);
        assert_eq!(path, b"C:\\WINDOWS\\CALC.exe");

        let mut path = b"C:\\A.B\\CALC.EXE".to_vec();

        with_exe(&mut path, 0x81);
        assert_eq!(path, b"C:\\A.B\\CALC.EXE");
    }
}
