//! The file boxes' lists and drives, DOS as COMMDLG asks it, its message
//! boxes, and its owner-drawn rows (`COMMDLG.DLL` seg2 `039b`, `0180`,
//! `4827`, `4732`, `2107`, `4ae2`, `1a26`, `4dcc`, `4e8a`, and seg1's DOS
//! calls). As `file-dialogs.ts`.

use super::api::{self, Arg, item, item_text, list_text, send, send_item, set_item_text, text};
use super::file_dialogs::{
    CB_FINDSTRING, CB_GETCOUNT, CB_GETCURSEL, CB_GETITEMDATA, CB_GETLBTEXT, CB_INSERTSTRING,
    CB_RESETCONTENT, CB_SETCURSEL, CB_SETITEMDATA, CMB_DRIVES, EDT_NAME, IDRETRY, IDYES,
    LB_ADDSTRING, LB_GETTEXT, LB_INSERTSTRING, LB_RESETCONTENT, LB_SETCURSEL, LB_SETTOPINDEX,
    LPSTRDEFEXT, LST_FILES, LST_FOLDERS, MB_DEFBUTTON2, MB_ICONEXCLAMATION, MB_ICONQUESTION,
    MB_RETRYCANCEL, MB_YESNO, Ofn, PICTURES_HEIGHT, PICTURES_WIDTH, STC_DIRECTORY, TAKE,
    WM_COMMAND, WM_DRAWITEM, WM_GETFONT, WM_NEXTDLGCTL, WM_SETREDRAW, commdlg_string, filled,
    has_wildcard, lower, make_pictures_now, read_colors_now, terminated,
};
use super::file_init::{dialog_of, with_dialog};
use super::file_ok::add_extension;
use super::parse::parse_file;
use crate::call::Stop;
use crate::engine::Engine;

const DISK_CHANGE: u16 = 0x22;
const ATTR_DIRECTORY: u8 = 0x10;
/// The refresh's flags: the folders too, and the folders' list's top
/// left at its first row (seg2 `03c7`).
const WITH_FOLDERS: u16 = 0x0010;
const FROM_TOP: u16 = 0x4000;

const SRCCOPY: u32 = 0x00cc_0020;
const ETO_OPAQUE_CLIPPED: u16 = 0x0006;
const ODS_SELECTED: u16 = 0x0001;
const ODS_FOCUS: u16 = 0x0010;

// ---------------------------------------------------------------------
// DOS, as COMMDLG asks it.

/// The current drive, nought for A: (seg1 `2c1d`, DOS 19h).
pub(super) fn current_drive(engine: &Engine) -> u8 {
    engine.system().files.drive as u8 - b'A'
}

/// A drive selected, where it is there (seg1 `2c37`, DOS 0Eh).
fn set_drive(engine: &Engine, drive: u8) {
    let mut system = engine.system();
    let letter = char::from(b'A' + drive);

    if drive < 26 && system.files.mounted(letter) {
        system.files.drive = letter;
    }
}

/// The current directory, its drive first (seg2 `54c1`, seg1 `2c83`): DOS's
/// error kept where it cannot be read.
pub(super) fn current_directory(engine: &Engine) -> Option<Vec<u8>> {
    let mut system = engine.system();
    let letter = system.files.drive;

    match system.directory_of(letter) {
        Ok(directory) => {
            system.commdlg.files.dos_error = 0;
            Some(format!("{letter}:\\{directory}").into_bytes())
        }
        Err(code) => {
            system.commdlg.files.dos_error = code;
            None
        }
    }
}

/// A drive selected and read (seg2 `5344`): whether its directory could
/// be had; where not, the drive before is selected again.
pub(super) fn drive_ready(engine: &Engine, letter: u8) -> bool {
    let before = current_drive(engine);
    let wanted = (letter | 0x60).wrapping_sub(b'a');

    set_drive(engine, wanted);

    if current_drive(engine) != wanted {
        return false;
    }

    if current_directory(engine).is_some() {
        return true;
    }

    set_drive(engine, before);
    false
}

/// The current directory changed (seg2 `53e4`): `oem`, the name made OEM
/// first. Nought, done; 1, its drive could not be read; 2, the directory
/// is not there, and the drive before is selected again; `FFFFh`, no name.
pub(super) fn change_directory(engine: &Engine, path: &[u8], oem: bool) -> u16 {
    let before = current_drive(engine);

    if path.is_empty() {
        return 0xffff;
    }

    let mut rest = path;

    if path.get(1) == Some(&b':') {
        if !drive_ready(engine, path[0]) {
            return 1;
        }

        rest = &path[2..];
    }

    if rest.is_empty() {
        return 0;
    }

    let name = if oem {
        crate::keyboard::translate_bytes(true, rest)
    } else {
        rest.to_vec()
    };
    let text: String = name.iter().map(|&b| char::from(b)).collect();

    if engine.system().change_directory_to(&text) {
        return 0;
    }

    set_drive(engine, before);
    2
}

/// `GetDriveType`.
pub(super) async fn drive_type(engine: &Engine, drive: i16) -> Result<u16, Stop> {
    api::word(engine, "KERNEL", "GetDriveType", &[Arg::W(drive as u16)]).await
}

/// What `OpenFile` made of a name.
#[derive(Debug, Clone, Default)]
pub(super) struct Opened {
    pub handle: u16,
    /// DOS's error.
    pub code: u16,
    /// The path it made whole, OEM, its nought kept.
    pub path: Vec<u8>,
}

/// `OpenFile`, a name with no folder looked for in the current one alone:
/// `.\` put before it (seg2 `0948`). A network path is given as it is.
pub(super) async fn open_quietly(
    engine: &Engine,
    name: &[u8],
    mode: u16,
    network: bool,
) -> Result<Opened, Stop> {
    let given = if network || name.iter().any(|&b| matches!(b, b'\\' | b'/' | b':')) {
        name.to_vec()
    } else {
        [&b".\\"[..], name].concat()
    };
    let called = api::api(
        engine,
        "KERNEL",
        "OpenFile",
        &[text(&given), api::buffer(136), Arg::W(mode)],
    )
    .await?;
    let structure = &called.buffers[1];
    let mut path = terminated(&structure[8..]);

    // COMMDLG's copy ends at its 128th byte (seg2 `2ad2`).
    path.truncate(127);

    Ok(Opened {
        handle: called.word(),
        code: u16::from_le_bytes([structure[2], structure[3]]),
        path,
    })
}

/// `_lclose`.
pub(super) async fn close(engine: &Engine, handle: u16) -> Result<(), Stop> {
    api::api(engine, "KERNEL", "_lclose", &[Arg::W(handle)]).await?;
    Ok(())
}

/// A file's attributes (seg1 `2e1b`, DOS 4300h): the error in the high
/// byte, 80h, where it is not there.
pub(super) async fn file_attributes(engine: &Engine, path: &[u8]) -> Result<u16, Stop> {
    let text: String = path.iter().map(|&b| char::from(b)).collect();

    Ok(engine
        .system()
        .attributes_of(&text)
        .map_or(0x8000, u16::from))
}

/// Whether a file can be made in a path's folder: a temporary file made
/// there and deleted (seg2 `224f`, DOS 5Ah). Nought where it can, or the
/// path is in a drive's root; DOS's error where it cannot.
pub(super) async fn can_create(engine: &Engine, path: &[u8]) -> Result<u16, Stop> {
    let mut copy = path.to_vec();

    copy.push(0);

    let (offset, _) = parse_file(&mut copy);

    if offset <= 3 {
        return Ok(0);
    }

    let folder: String = copy[..offset as usize - 1]
        .iter()
        .map(|&b| char::from(b))
        .collect();
    let mut system = engine.system();
    let mut index = 0u16;

    // A name of DOSBox's making is no name the program can see: the file
    // goes as soon as it is made.
    let made = loop {
        let name = format!("{folder}\\WB{index:06X}");

        if system.attributes_of(&name).is_err() {
            break system.make_file(&name, true).map(|handle| (handle, name));
        }

        index += 1;
    };

    match made {
        Ok((handle, name)) => {
            system.files.close(handle);
            let _ = system.delete_path(&name);
            Ok(0)
        }
        Err(code) => Ok(code),
    }
}

/// Whether a name is one of DOS's devices (seg2 `21a8`), a period after its
/// third or fourth character taken off.
pub(super) fn reserved_name(name: &[u8]) -> bool {
    const DEVICES: [&[u8]; 14] = [
        b"LPT1", b"LPT2", b"LPT3", b"LPT4", b"COM1", b"COM2", b"COM3", b"COM4", b"EPT", b"NUL",
        b"PRN", b"CLOCK$", b"CON", b"AUX",
    ];
    let mut name = name.to_vec();

    if name.get(4) == Some(&b'.') {
        name.truncate(4);
    }

    if name.get(3) == Some(&b'.') {
        name.truncate(3);
    }

    DEVICES
        .iter()
        .any(|device| device.eq_ignore_ascii_case(&name))
}

// ---------------------------------------------------------------------
// The lists.

/// The files' list, and the folders' with `WITH_FOLDERS`, filled for a
/// spec (seg2 `039b`): the edit's name where it is a bare wildcard, else
/// the box's own; each spec of it, between `;`, spaces or tabs, matched
/// by COMMDLG's own matching. The spec is changed as COMMDLG changes it:
/// cut at the separators, its parts capitalised. 1 for a drive read, else
/// nought.
#[allow(clippy::too_many_lines)]
pub(super) async fn refresh(
    engine: &Engine,
    hwnd: u16,
    spec: Option<&mut Vec<u8>>,
    flags: u16,
) -> Result<u16, Stop> {
    let files = item(engine, hwnd, LST_FILES).await?;
    let folders = item(engine, hwnd, LST_FOLDERS).await?;
    let from_top = flags & FROM_TOP;
    let mut flags = flags & !FROM_TOP;
    let mut answer = 0;
    let mut own;
    let spec = if let Some(spec) = spec {
        spec
    } else {
        own = item_text(engine, hwnd, EDT_NAME, 0xff).await?;

        let bare = !own.iter().any(|&b| matches!(b, b'\\' | b'/' | b':')) && has_wildcard(&own);

        if !bare {
            own = dialog_of(engine, hwnd)
                .map(|data| data.filter)
                .unwrap_or_default();
        }

        &mut own
    };

    // The spec cut into its parts as `strtok` cuts it, each capitalised
    // and made OEM in place, at most 36 (seg2 `0463`, `0083`).
    let mut parts: Vec<Vec<u8>> = Vec::new();
    let length = spec.iter().position(|&b| b == 0).unwrap_or(spec.len());
    let mut at = 0;

    while parts.len() < 0x24 {
        while at < length && matches!(spec[at], b';' | b' ' | b'\t') {
            at += 1;
        }

        if at >= length {
            break;
        }

        let start = at;

        while at < length && !matches!(spec[at], b';' | b' ' | b'\t') {
            at += 1;
        }

        if at < length {
            spec[at] = 0;
            at += 1;
        }

        let end = spec[start..]
            .iter()
            .position(|&b| b == 0)
            .map_or(spec.len(), |n| start + n);

        for byte in &mut spec[start..end] {
            let upper = crate::user_misc::ansi_upper_byte(*byte);

            *byte = crate::keyboard::translate_bytes(true, &[upper])[0];
        }

        parts.push(spec[start..end].to_vec());
    }

    send(engine, files, WM_SETREDRAW, 0, 0).await?;
    send(engine, files, LB_RESETCONTENT, 0, 0).await?;

    if flags & WITH_FOLDERS != 0 {
        engine.system().commdlg.files.redraw_off = 1;
        send(engine, folders, WM_SETREDRAW, 0, 0).await?;
        send(engine, folders, LB_RESETCONTENT, 0, 0).await?;
    }

    let found = engine.system().search_directory("*.*", flags as u8);

    match found {
        None => flags = FROM_TOP,
        Some(entries) => {
            answer = 1;
            flags &= WITH_FOLDERS;

            for entry in entries {
                let name = entry.name.as_bytes();

                if flags != 0 && entry.attributes & ATTR_DIRECTORY != 0 {
                    if name.first() != Some(&b'.') {
                        let ansi = crate::keyboard::translate_bytes(false, name);

                        api::send_bytes(engine, folders, LB_ADDSTRING, 0, text(&ansi)).await?;
                    }
                } else if parts.iter().any(|part| matches(part, name)) {
                    let ansi = crate::keyboard::translate_bytes(false, name);

                    api::send_bytes(engine, files, LB_ADDSTRING, 0, text(&ansi)).await?;
                }
            }
        }
    }

    if flags != 0 {
        if flags == WITH_FOLDERS {
            fill_path(engine, hwnd, folders).await?;
            api::api(
                engine,
                "USER",
                "DlgDirList",
                &[
                    Arg::W(hwnd),
                    Arg::D(0),
                    Arg::W(0),
                    Arg::W(STC_DIRECTORY),
                    Arg::W(0),
                ],
            )
            .await?;

            let depth = dialog_of(engine, hwnd).map_or(0, |data| data.depth);

            send(engine, folders, LB_SETCURSEL, depth.wrapping_sub(1), 0).await?;

            let top = if from_top != 0 {
                0
            } else {
                (depth as i16 - 2).max(0) as u16
            };

            send(engine, folders, LB_SETTOPINDEX, top, 0).await?;
        } else {
            set_item_text(engine, hwnd, STC_DIRECTORY, b"").await?;
        }

        engine.system().commdlg.files.redraw_off = 0;
        send(engine, folders, WM_SETREDRAW, 1, 0).await?;

        let rect = api::api(
            engine,
            "USER",
            "GetWindowRect",
            &[Arg::W(folders), api::buffer(8)],
        )
        .await?;
        let word = |at: usize| i16::from_le_bytes([rect.buffers[0][at], rect.buffers[0][at + 1]]);
        let inset = [word(0) + 1, word(2) + 1, word(4) - 1, word(6) - 1];
        let mut points = Vec::new();

        for pair in inset.chunks(2) {
            let point: Vec<u8> = pair.iter().flat_map(|v| v.to_le_bytes()).collect();
            let back = api::api(
                engine,
                "USER",
                "ScreenToClient",
                &[Arg::W(hwnd), Arg::B(point)],
            )
            .await?;

            points.extend_from_slice(&back.buffers[0]);
        }

        api::api(
            engine,
            "USER",
            "InvalidateRect",
            &[Arg::W(hwnd), Arg::B(points), Arg::W(0)],
        )
        .await?;
    }

    send(engine, files, WM_SETREDRAW, 1, 0).await?;
    api::api(
        engine,
        "USER",
        "InvalidateRect",
        &[Arg::W(files), Arg::D(0), Arg::W(1)],
    )
    .await?;
    Ok(answer)
}

/// COMMDLG's own match of a name to a spec (seg2 `0283`): `*` and `*.*`
/// match all; a `*` the rest of the name's part, to its period; a `?` any
/// one character, a period too.
fn matches(pattern: &[u8], name: &[u8]) -> bool {
    if pattern == b"*" || pattern == b"*.*" {
        return true;
    }

    let (mut p, mut n) = (0, 0);
    let at = |text: &[u8], i: usize| text.get(i).copied().unwrap_or(0);

    while at(name, n) != 0 && at(pattern, p) != 0 {
        match at(pattern, p) {
            b'*' => {
                while at(pattern, p) != b'.' && at(pattern, p) != 0 {
                    p += 1;
                }

                if at(pattern, p) == b'.' {
                    p += 1;
                }

                while at(name, n) != b'.' && at(name, n) != 0 {
                    n += 1;
                }

                if at(name, n) == b'.' {
                    n += 1;
                }
            }
            b'?' => {
                n += 1;
                p += 1;
            }
            c => {
                if c != at(name, n) {
                    return false;
                }

                p += 1;
                n += 1;
            }
        }
    }

    at(name, n) == 0 && (at(pattern, p) == 0 || at(pattern, p) == b'*')
}

/// The current folder's path put at the folders' list's top, a row each
/// (seg2 `0180`): the root, then each folder, as DOS has them.
async fn fill_path(engine: &Engine, hwnd: u16, folders: u16) -> Result<(), Stop> {
    let path = current_directory(engine).unwrap_or_default();
    let ansi = crate::keyboard::translate_bytes(false, &path);
    let mut lowered = ansi.clone();

    for byte in &mut lowered {
        *byte = crate::user_misc::ansi_lower_byte(*byte);
    }

    with_dialog(engine, hwnd, |data| {
        data.scratch = lowered;
        data.depth = 0;
    });

    let Some(root) = ansi.iter().position(|&b| b == b'\\') else {
        return Ok(());
    };
    let mut rows = vec![ansi[..=root].to_vec()];

    rows.extend(
        ansi[root + 1..]
            .split(|&b| b == b'\\')
            .filter(|part| !part.is_empty())
            .map(<[u8]>::to_vec),
    );

    for row in rows {
        let depth = dialog_of(engine, hwnd).map_or(0, |data| data.depth);

        api::send_bytes(engine, folders, LB_INSERTSTRING, depth, text(&row)).await?;
        with_dialog(engine, hwnd, |data| data.depth += 1);
    }

    Ok(())
}

/// A spec taken (seg2 `4ae2`): lowered; with a folder before it, the folder
/// gone to and the spec the name; the files' list filled. Nought, or what
/// changing the folder answered.
pub(super) async fn apply_spec(
    engine: &Engine,
    spec: &mut Vec<u8>,
    hwnd: u16,
) -> Result<u16, Stop> {
    lower(spec);

    let text = terminated(spec);
    let last = text.iter().rposition(|&b| b == b'\\');
    let initialising = engine.system().commdlg.initialising;

    if last.is_none() && !text.contains(&b':') {
        with_dialog(engine, hwnd, |data| data.filter.clone_from(&text));

        if !initialising {
            refresh(engine, hwnd, Some(spec), 0).await?;
        }

        return Ok(0);
    }

    let first = text.iter().position(|&b| b == b'\\');
    let folder;
    let name;

    // Only a root, or a drive, before the spec (seg2 `4b87`).
    let rooted = first == last
        && match last {
            None => true,
            Some(at) => at == 0 || (at == 2 && text.get(1) == Some(&b':')),
        };

    if rooted {
        let at = match last {
            None => 2,
            Some(at) => at + 1,
        };

        if text.get(at) == Some(&b'.') {
            folder = text.clone();
            let defext = dialog_of(engine, hwnd)
                .and_then(|data| Ofn(data.ofn).string(engine, LPSTRDEFEXT))
                .unwrap_or_default();
            let mut appended = text.clone();

            add_extension(&mut appended, &defext, true);
            name = terminated(&appended[text.len()..]);
            *spec = appended;
        } else {
            folder = text[..at].to_vec();
            name = text[at..].to_vec();
        }
    } else {
        let at = last.unwrap_or(0);

        folder = text[..at].to_vec();
        name = text[at + 1..].to_vec();
        spec[at] = 0;
    }

    let answer = change_directory(engine, &folder, true);

    if answer != 0 {
        return Ok(answer);
    }

    with_dialog(engine, hwnd, |data| data.filter.clone_from(&name));
    set_item_text(engine, hwnd, EDT_NAME, &name).await?;
    select_drive(engine, hwnd, current_drive(engine) + b'a').await?;

    if !initialising {
        let drives = item(engine, hwnd, CMB_DRIVES).await?;

        send(
            engine,
            hwnd,
            WM_COMMAND,
            CMB_DRIVES,
            u32::from(TAKE) << 16 | u32::from(drives),
        )
        .await?;
    }

    Ok(0)
}

/// The name's path taken off, the name alone left (seg2 `30b4`).
pub(super) async fn strip_path(engine: &Engine, hwnd: u16) -> Result<(), Stop> {
    let mut typed = item_text(engine, hwnd, EDT_NAME, 0xff).await?;

    if typed.is_empty() {
        return Ok(());
    }

    typed.push(0);

    let (mut offset, at) = parse_file(&mut typed);

    if offset < 0 {
        if typed.get(usize::from(at)) == Some(&b';') {
            typed[usize::from(at)] = 0;
            offset = parse_file(&mut typed).0;
            typed[usize::from(at)] = b';';

            if offset < 0 {
                typed[0] = 0;
            }
        } else {
            typed[0] = 0;
        }
    }

    if offset > 0 {
        let rest = typed[offset as usize..].to_vec();

        typed = rest;
    }

    if offset != 0 {
        set_item_text(engine, hwnd, EDT_NAME, &terminated(&typed)).await?;
    }

    Ok(())
}

// ---------------------------------------------------------------------
// The drives.

/// The drives' combo box filled (seg2 `4827`): each drive DOS will select,
/// its letter lowered, and a fixed drive's label after it; each item's data
/// its picture.
pub(super) async fn fill_drives(engine: &Engine, hwnd: u16) -> Result<(), Stop> {
    let combo = item(engine, hwnd, CMB_DRIVES).await?;

    engine.system().commdlg.files.redraw_off |= 2;
    send(engine, combo, WM_SETREDRAW, 0, 0).await?;
    send(engine, combo, CB_RESETCONTENT, 0, 0).await?;

    let current = current_drive(engine);
    let drives: Vec<u8> = (0..26)
        .filter(|&drive| engine.system().files.mounted(char::from(b'A' + drive)))
        .collect();

    for (index, &drive) in drives.iter().enumerate() {
        let letter = b'A' + drive;
        let kind = drive_type(engine, i16::from(drive)).await?;

        if kind < 2 {
            continue;
        }

        let mut name = vec![letter, b':'];

        if kind != 2 && drive_ready(engine, letter) {
            let label = engine
                .system()
                .volume_label(char::from(letter))
                .unwrap_or_default();

            name.push(b' ');
            name.extend(crate::keyboard::translate_bytes(false, label.as_bytes()));
        }

        lower(&mut name);
        api::send_bytes(engine, combo, CB_INSERTSTRING, index as u16, text(&name)).await?;
        send(
            engine,
            combo,
            CB_SETITEMDATA,
            index as u16,
            u32::from(picture(kind)),
        )
        .await?;

        if drive == current {
            send(engine, combo, CB_SETCURSEL, index as u16, 0).await?;
        }
    }

    engine.system().commdlg.files.redraw_off &= !2;
    send(engine, combo, WM_SETREDRAW, 1, 0).await?;
    drive_ready(engine, current + b'a');
    Ok(())
}

/// A drive's picture (seg2 `551f`): a fixed drive's 4, a floppy's 3, a
/// network drive's 6. No CD-ROM is found (MSCDEX, seg2 `558a`) and no
/// RAM drive (seg2 `55c0`).
fn picture(kind: u16) -> u16 {
    match kind {
        1 => 0,
        2 => 3,
        4 => 6,
        _ => 4,
    }
}

/// The drives' combo box's item for a drive chosen, by its letter (seg2
/// `4732`); none where there is none.
pub(super) async fn select_drive(engine: &Engine, hwnd: u16, letter: u8) -> Result<(), Stop> {
    let letter = letter | 0x60;
    let count = send_item(engine, hwnd, CMB_DRIVES, CB_GETCOUNT, 0, 0).await? as u16;
    let mut at = 0;

    while at < count {
        let name = list_text(engine, hwnd, CMB_DRIVES, CB_GETLBTEXT, at).await?;

        if name.first() == Some(&letter) {
            break;
        }

        at += 1;
    }

    send_item(
        engine,
        hwnd,
        CMB_DRIVES,
        CB_SETCURSEL,
        if at == count { 0xffff } else { at },
        0,
    )
    .await?;
    Ok(())
}

/// The drives listed again as the box is activated (seg2 `2107`); where the
/// drive shown is gone, the current one chosen and listed.
pub(super) async fn refresh_drives(engine: &Engine, hwnd: u16) -> Result<(), Stop> {
    let combo = item(engine, hwnd, CMB_DRIVES).await?;
    let at = send(engine, combo, CB_GETCURSEL, 0, 0).await? as u16;
    let shown = api::send_bytes(engine, combo, CB_GETLBTEXT, at, api::buffer(256))
        .await?
        .string(0);

    fill_drives(engine, hwnd).await?;

    let found = api::send_bytes(engine, combo, CB_FINDSTRING, 0xffff, text(&shown))
        .await?
        .word();

    if found == 0xffff {
        select_drive(engine, hwnd, current_drive(engine) + b'a').await?;
        refresh(engine, hwnd, None, WITH_FOLDERS).await?;
    }

    Ok(())
}

// ---------------------------------------------------------------------
// The boxes COMMDLG puts up.

/// An error said (seg2 `1a26`): COMMDLG's string for DOS's error, filled
/// with the name or its drive's letter, under the box's caption; for a
/// name not valid, the name given the focus.
pub(super) async fn show_error(
    engine: &Engine,
    hwnd: u16,
    file: &[u8],
    code: u16,
) -> Result<(), Stop> {
    let mut file = file.to_vec();

    file.truncate(0x100);

    let (id, drive) = match code {
        2 => (0x187, false),
        3 => (0x188, false),
        4 => (0x191, false),
        5 => (0x184, true),
        0x13 => (0x18f, true),
        0x20 => (0x18a, false),
        0x41 => (0x18b, false),
        0x52 => (0x190, true),
        0x53 => (0x18d, false),
        0x60 => (0x193, false),
        0x61 => (0x183, true),
        0x62 => (0x18e, false),
        0x63 => (0x18c, false),
        _ => (0x189, false),
    };

    lower(&mut file);

    let value = if drive {
        file.first().map(|&b| vec![b]).unwrap_or_default()
    } else {
        file
    };
    let message = filled(&commdlg_string(id), &value);
    let caption = window_text(engine, hwnd, 0xc0).await?;

    api::api(
        engine,
        "USER",
        "MessageBox",
        &[
            Arg::W(hwnd),
            text(&message),
            text(&caption),
            Arg::W(MB_ICONEXCLAMATION),
        ],
    )
    .await?;

    if id == 0x189 {
        let name = item(engine, hwnd, EDT_NAME).await?;

        api::post(engine, hwnd, WM_NEXTDLGCTL, name, 1).await?;
    }

    Ok(())
}

async fn window_text(engine: &Engine, hwnd: u16, size: u16) -> Result<Vec<u8>, Stop> {
    Ok(api::api(
        engine,
        "USER",
        "GetWindowText",
        &[Arg::W(hwnd), api::buffer(usize::from(size)), Arg::W(size)],
    )
    .await?
    .string(0))
}

/// A drive that cannot be read said so, with Retry and Cancel, unless the
/// box is just made (seg2 `405f`). Whether Retry was chosen.
pub(super) async fn show_drive_error(engine: &Engine, hwnd: u16, letter: u8) -> Result<bool, Stop> {
    let id = if engine.system().commdlg.files.dos_error == DISK_CHANGE {
        0x185
    } else if drive_type(engine, i16::from(letter) - 0x61).await? == 2 {
        0x184
    } else {
        0x194
    };
    let message = filled(&commdlg_string(id), &[letter]);
    let caption = window_text(engine, hwnd, 0xc0).await?;

    if engine.system().commdlg.files.first_activate {
        return Ok(false);
    }

    let answer = api::word(
        engine,
        "USER",
        "MessageBox",
        &[
            Arg::W(hwnd),
            text(&message),
            text(&caption),
            Arg::W(MB_ICONEXCLAMATION | MB_RETRYCANCEL),
        ],
    )
    .await?;

    Ok(answer == IDRETRY)
}

/// The overwrite prompt (seg2 `4d23`): Yes, No preferred. Whether Yes.
pub(super) async fn overwrite_prompt(
    engine: &Engine,
    hwnd: u16,
    path: &[u8],
) -> Result<bool, Stop> {
    let path = if path.get(2..4) == Some(b"\\\\") {
        &path[2..]
    } else {
        path
    };
    let ansi = crate::keyboard::translate_bytes(false, path);
    let message = filled(&commdlg_string(0x101), &ansi);
    let caption = window_text(engine, hwnd, 0x40).await?;
    let answer = api::word(
        engine,
        "USER",
        "MessageBox",
        &[
            Arg::W(hwnd),
            text(&message),
            text(&caption),
            Arg::W(MB_YESNO | MB_ICONEXCLAMATION | MB_DEFBUTTON2),
        ],
    )
    .await?;

    Ok(answer == IDYES)
}

/// The create prompt (seg2 `2062`): Yes or No; its answer.
pub(super) async fn create_prompt(engine: &Engine, hwnd: u16, path: &[u8]) -> Result<u16, Stop> {
    let path = if path.get(2..4) == Some(b"\\\\") {
        &path[2..]
    } else {
        path
    };
    let mut path = path.to_vec();

    path.truncate(0x100);

    let message = filled(&commdlg_string(0x192), &path);
    let caption = window_text(engine, hwnd, 0x100).await?;

    api::word(
        engine,
        "USER",
        "MessageBox",
        &[
            Arg::W(hwnd),
            text(&message),
            text(&caption),
            Arg::W(MB_YESNO | MB_ICONQUESTION),
        ],
    )
    .await
}

// ---------------------------------------------------------------------
// The rows drawn.

/// The colours read again, and the pictures made for them where they
/// changed (seg2 `43ee`, `0d58`).
pub(super) async fn colors_and_pictures(engine: &Engine) -> Result<(), Stop> {
    let before = engine.system().commdlg.files.colors;

    read_colors_now(engine).await?;

    let after = engine.system().commdlg.files.colors;

    if before[0] != after[0]
        || before[1] != after[1]
        || engine.system().commdlg.files.pictures.is_none()
    {
        make_pictures_now(engine);
    }

    Ok(())
}

/// A row's height (seg2 `4dcc`): the dialog's font's, measured once; the
/// folders' and drives' rows as high as a picture at least.
pub(super) async fn measure_item(engine: &Engine, hwnd: u16, far: u32) -> Result<(), Stop> {
    if engine.system().commdlg.files.item_height == 0 {
        let hdc = api::word(engine, "USER", "GetDC", &[Arg::W(hwnd)]).await?;
        let mut font = send(engine, hwnd, WM_GETFONT, 0, 0).await? as u16;

        if font == 0 {
            font = api::word(engine, "GDI", "GetStockObject", &[Arg::W(0x0d)]).await?;
        }

        let old = api::word(engine, "GDI", "SelectObject", &[Arg::W(hdc), Arg::W(font)]).await?;
        let metrics = api::api(
            engine,
            "GDI",
            "GetTextMetrics",
            &[Arg::W(hdc), api::buffer(31)],
        )
        .await?;

        api::api(engine, "GDI", "SelectObject", &[Arg::W(hdc), Arg::W(old)]).await?;
        api::api(engine, "USER", "ReleaseDC", &[Arg::W(hwnd), Arg::W(hdc)]).await?;

        let height = u16::from_le_bytes([metrics.buffers[0][0], metrics.buffers[0][1]]);
        let mut system = engine.system();

        system.commdlg.files.text_height = height;
        system.commdlg.files.item_height = height.max(PICTURES_HEIGHT);
    }

    let (text_height, item_height) = {
        let system = engine.system();

        (
            system.commdlg.files.text_height,
            system.commdlg.files.item_height,
        )
    };
    let control = {
        let bytes = engine.system().read_far(far, 4);

        u16::from_le_bytes([bytes[2], bytes[3]])
    };
    let height = if control == LST_FILES {
        text_height
    } else {
        item_height
    };

    engine.system().write_far(
        (far & 0xffff_0000) | (far.wrapping_add(8) & 0xffff),
        &height.to_le_bytes(),
    );
    Ok(())
}

/// A row drawn (seg2 `4e8a`): its text lowered, in the window's colours or
/// the highlight's, the folders' highlighted only with the focus; a
/// folder's picture indented by its depth, a drive's; the files' grey in
/// Save As; the focus's rectangle.
#[allow(clippy::too_many_lines)]
pub(super) async fn draw_item(
    engine: &Engine,
    hwnd: u16,
    far: u32,
    save: bool,
) -> Result<(), Stop> {
    let bytes = engine.system().read_far(far, 26);
    let word = |at: usize| u16::from_le_bytes([bytes[at], bytes[at + 1]]);
    let control = word(2);

    if !matches!(control, LST_FILES | LST_FOLDERS | CMB_DRIVES) {
        return Ok(());
    }

    let index = word(4);
    let state = word(8);
    let hdc = word(12);
    let rect: Vec<u8> = bytes[14..22].to_vec();
    let left = word(14) as i16;
    let top = word(16) as i16;
    let message = if control == CMB_DRIVES {
        CB_GETLBTEXT
    } else {
        LB_GETTEXT
    };
    let mut row = api::send_item_bytes(engine, hwnd, control, message, index, api::buffer(256))
        .await?
        .string(0);

    if row.is_empty() {
        api::api(
            engine,
            "USER",
            "DefWindowProc",
            &[Arg::W(hwnd), Arg::W(WM_DRAWITEM), Arg::W(0), Arg::D(far)],
        )
        .await?;
        return Ok(());
    }

    for byte in &mut row {
        *byte = crate::user_misc::ansi_lower_byte(*byte);
    }

    let (colors, text_height, item_height, pictures) = {
        let system = engine.system();
        let shared = &system.commdlg.files;

        (
            shared.colors,
            shared.text_height,
            shared.item_height,
            shared.pictures,
        )
    };
    let [window, highlight, window_text, highlight_text, gray_text] = colors;
    let height = if control == LST_FILES {
        text_height
    } else {
        item_height
    };
    let selected = state & (ODS_SELECTED | ODS_FOCUS);
    let (background, foreground) = if save && control == LST_FILES {
        (window, gray_text)
    } else if selected & ODS_SELECTED != 0 && (control != LST_FOLDERS || selected & ODS_FOCUS != 0)
    {
        (highlight, highlight_text)
    } else {
        (window, window_text)
    };
    let old_background = api::api(
        engine,
        "GDI",
        "SetBkColor",
        &[Arg::W(hdc), Arg::D(background)],
    )
    .await?
    .value;
    let old_foreground = api::api(
        engine,
        "GDI",
        "SetTextColor",
        &[Arg::W(hdc), Arg::D(foreground)],
    )
    .await?
    .value;
    let width = PICTURES_WIDTH >> 3;
    let depth = dialog_of(engine, hwnd).map_or(0, |data| data.depth);
    let (indent, picture, picture_width) = match control {
        CMB_DRIVES => {
            let data = send_item(engine, hwnd, CMB_DRIVES, CB_GETITEMDATA, index, 0).await? as u16;

            (
                1,
                data + if selected & ODS_SELECTED != 0 { 8 } else { 0 },
                width as i16,
            )
        }
        LST_FOLDERS => {
            let level = if index > depth { depth } else { index } + 1;
            let kind = (index as i16 - depth as i16 + 1).signum() + 1;

            (
                level,
                kind as u16 + if selected & ODS_FOCUS != 0 { 8 } else { 0 },
                width as i16,
            )
        }
        _ => (1, 0, -4),
    };
    let x = (i32::from(indent) + 1) * 4 + i32::from(picture_width) + i32::from(left);
    let y = (i32::from(height) - i32::from(text_height)) / 2 + i32::from(top);

    if save && control == LST_FILES && gray_text == 0 {
        // No grey: the row filled with the window's colour, and the text
        // greyed by USER (seg2 `5179`).
        let brush = api::word(engine, "GDI", "CreateSolidBrush", &[Arg::D(background)]).await?;
        let mode = api::word(engine, "GDI", "SetBkMode", &[Arg::W(hdc), Arg::W(1)]).await?;
        let chosen = if brush == 0 {
            api::word(engine, "GDI", "GetStockObject", &[Arg::W(0)]).await?
        } else {
            brush
        };
        let old = api::word(
            engine,
            "GDI",
            "SelectObject",
            &[Arg::W(hdc), Arg::W(chosen)],
        )
        .await?;

        api::api(
            engine,
            "USER",
            "FillRect",
            &[Arg::W(hdc), Arg::B(rect.clone()), Arg::W(brush)],
        )
        .await?;
        api::api(engine, "GDI", "SelectObject", &[Arg::W(hdc), Arg::W(old)]).await?;

        if brush != 0 {
            api::api(engine, "GDI", "DeleteObject", &[Arg::W(brush)]).await?;
        }

        let black = api::word(engine, "GDI", "GetStockObject", &[Arg::W(4)]).await?;

        api::api(
            engine,
            "USER",
            "GrayString",
            &[
                Arg::W(hdc),
                Arg::W(black),
                Arg::D(0),
                text(&row),
                Arg::W(0),
                Arg::W(left.wrapping_add(4) as u16),
                Arg::W(top as u16),
                Arg::W(0),
                Arg::W(0),
            ],
        )
        .await?;
        api::api(engine, "GDI", "SetBkMode", &[Arg::W(hdc), Arg::W(mode)]).await?;
    } else {
        api::api(
            engine,
            "GDI",
            "ExtTextOut",
            &[
                Arg::W(hdc),
                Arg::W(x as u16),
                Arg::W(y as u16),
                Arg::W(ETO_OPAQUE_CLIPPED),
                Arg::B(rect.clone()),
                text(&row),
                Arg::W(row.len() as u16),
                Arg::D(0),
            ],
        )
        .await?;
    }

    if control != LST_FILES
        && let Some((memory, _)) = pictures
    {
        let px = i32::from(indent) * 4 + i32::from(left);
        let py = (i32::from(item_height) - i32::from(PICTURES_HEIGHT)) / 2 + i32::from(top);

        api::api(
            engine,
            "GDI",
            "BitBlt",
            &[
                Arg::W(hdc),
                Arg::W(px as u16),
                Arg::W(py as u16),
                Arg::W(width),
                Arg::W(PICTURES_HEIGHT),
                Arg::W(memory),
                Arg::W(picture.wrapping_mul(width)),
                Arg::W(0),
                Arg::D(SRCCOPY),
            ],
        )
        .await?;
    }

    api::api(
        engine,
        "GDI",
        "SetTextColor",
        &[Arg::W(hdc), Arg::D(old_foreground)],
    )
    .await?;
    api::api(
        engine,
        "GDI",
        "SetBkColor",
        &[Arg::W(hdc), Arg::D(old_background)],
    )
    .await?;

    if state & ODS_FOCUS != 0 {
        api::api(
            engine,
            "USER",
            "DrawFocusRect",
            &[Arg::W(hdc), Arg::B(rect)],
        )
        .await?;
    }

    Ok(())
}
