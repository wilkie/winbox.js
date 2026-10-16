//! The file boxes' `WM_COMMAND` (`COMMDLG.DLL` seg2 `31f4`): OK, Cancel,
//! Help, and what each list, combo box and the name tell the box. As
//! `file-dialogs.ts`.

use super::api::{self, Arg, item, item_text, list_text, send, send_item, set_item_text, text};
use super::file_dialogs::{
    BM_SETSTYLE, CB_GETCURSEL, CB_GETITEMDATA, CB_GETLBTEXT, CB_SHOWDROPDOWN, CBN_CLOSEUP,
    CBN_DROPDOWN, CBN_SELCHANGE, CMB_DRIVES, CMB_TYPES, DRIVES_DROPPED, EDT_NAME, EM_SETSEL,
    EN_CHANGE, FNERR_BUFFERTOOSMALL, FOLDER_MOVED, HWNDOWNER, IDABORT, IDCANCEL, IDOK,
    LB_FINDSTRING, LB_GETCARETINDEX, LB_GETCURSEL, LB_GETSEL, LB_GETSELCOUNT, LB_GETSELITEMS,
    LB_GETTEXT, LB_GETTOPINDEX, LB_SETCARETINDEX, LB_SETTOPINDEX, LBN_DBLCLK, LBN_KILLFOCUS,
    LBN_SELCHANGE, LBN_SETFOCUS, LPFNHOOK, LPSTRCUSTOMFILTER, LPSTRFILE, LPSTRFILTER, LST_FILES,
    LST_FOLDERS, NFILTERINDEX, NMAXCUSTFILTER, OFN_ALLOWMULTISELECT, OFN_ENABLEHOOK,
    OFN_NOCHANGEDIR, OFN_NOVALIDATE, Ofn, PSH_HELP, TAKE, TYPES_DROPPED, WM_COMMAND, WM_GETTEXT,
    after_string, custom_pattern, has_wildcard, lower, terminated,
};
use super::file_init::{dialog_of, with_dialog};
use super::file_lists::{
    apply_spec, change_directory, current_drive, drive_ready, refresh, select_drive,
    show_drive_error, strip_path,
};
use crate::call::Stop;
use crate::engine::Engine;

/// What the box does with a command: its answer, nought for one it
/// leaves be.
pub(super) async fn command(
    engine: &Engine,
    hwnd: u16,
    id: u16,
    lparam: u32,
    save: bool,
) -> Result<u16, Stop> {
    let code = (lparam >> 16) as u16;
    let control = lparam as u16;

    match id {
        LST_FILES => files(engine, hwnd, code, control).await,
        IDOK => ok(engine, hwnd, lparam, save).await,
        IDCANCEL => end(engine, hwnd, IDCANCEL, 0).await,
        // A hook ends the box with what it gives (seg2 `33a6`).
        IDABORT => end(engine, hwnd, IDABORT, lparam as u16).await,
        PSH_HELP => help(engine, hwnd).await,
        LST_FOLDERS => folders(engine, hwnd, code).await,
        CMB_TYPES => types(engine, hwnd, code, lparam).await,
        CMB_DRIVES => drives(engine, hwnd, code, lparam).await,
        EDT_NAME => name(engine, hwnd, code, control).await,
        _ => Ok(0),
    }
}

fn flags_of(engine: &Engine, hwnd: u16) -> u32 {
    dialog_of(engine, hwnd).map_or(0, |data| Ofn(data.ofn).flags(engine))
}

fn change_flags(engine: &Engine, hwnd: u16, change: impl FnOnce(u32) -> u32) {
    if let Some(data) = dialog_of(engine, hwnd) {
        let ofn = Ofn(data.ofn);

        ofn.set_flags(engine, change(ofn.flags(engine)));
    }
}

fn hook_of(engine: &Engine, hwnd: u16) -> u32 {
    dialog_of(engine, hwnd).map_or(0, |data| Ofn(data.ofn).dword(engine, LPFNHOOK))
}

async fn tell_hook(
    engine: &Engine,
    hwnd: u16,
    message: u16,
    wparam: u16,
    lparam: u32,
) -> Result<u16, Stop> {
    let hook = hook_of(engine, hwnd);

    if hook == 0 {
        return Ok(0);
    }

    super::call_hook(engine, hook, hwnd, message, wparam, lparam).await
}

/// OK (seg2 `3225`): a dropped combo box closed, or the folders' list's
/// row gone into, rather than the name taken when they have the focus.
async fn ok(engine: &Engine, hwnd: u16, lparam: u32, save: bool) -> Result<u16, Stop> {
    let flags = flags_of(engine, hwnd);

    if engine.system().commdlg.files.ok_from_folders {
        engine.system().commdlg.files.ok_from_folders = false;
        return folder_chosen(engine, hwnd).await;
    }

    let focus = api::word(engine, "USER", "GetFocus", &[]).await?;

    if focus == item(engine, hwnd, LST_FOLDERS).await? && flags & FOLDER_MOVED != 0 {
        engine.system().commdlg.files.ok_from_folders = false;
        return folder_chosen(engine, hwnd).await;
    }

    let drives = item(engine, hwnd, CMB_DRIVES).await?;

    if focus == drives && flags & DRIVES_DROPPED != 0 {
        send_item(engine, hwnd, CMB_DRIVES, CB_SHOWDROPDOWN, 0, 0).await?;
        return Ok(0);
    }

    let types = item(engine, hwnd, CMB_TYPES).await?;

    if focus == types && flags & TYPES_DROPPED != 0 {
        send_item(engine, hwnd, CMB_TYPES, CB_SHOWDROPDOWN, 0, 0).await?;

        let _ = lparam;
        return type_taken(engine, hwnd).await;
    }

    if super::file_ok::name_taken(engine, hwnd, save).await? == 0 {
        send_item(engine, hwnd, EDT_NAME, EM_SETSEL, 0, 0x7fff_0000).await?;
        return Ok(1);
    }

    let Some(data) = dialog_of(engine, hwnd) else {
        return Ok(1);
    };
    let ofn = Ofn(data.ofn);
    let file = ofn.dword(engine, LPSTRFILE);
    let result = if file == 0 {
        1
    } else {
        let bytes = engine.system().read_far(file.wrapping_add(2), 1);

        if bytes[0] != 0 || ofn.flags(engine) & OFN_NOVALIDATE != 0 {
            1
        } else {
            super::set_error(&mut engine.system(), FNERR_BUFFERTOOSMALL);
            0
        }
    };

    end(engine, hwnd, IDOK, result).await
}

/// The box ended (seg2 `33ad`): the type chosen and the spec written back,
/// the hook asked with `FILEOKSTRING` for OK, the block let go, the folder
/// gone back to with `OFN_NOCHANGEDIR`, and `EndDialog`.
async fn end(engine: &Engine, hwnd: u16, id: u16, result: u16) -> Result<u16, Stop> {
    let Some(data) = dialog_of(engine, hwnd) else {
        return Ok(0);
    };
    let ofn = Ofn(data.ofn);
    let index = send_item(engine, hwnd, CMB_TYPES, CB_GETCURSEL, 0, 0).await? as u16;

    ofn.set_dword(engine, NFILTERINDEX, u32::from(index));

    let custom = ofn.dword(engine, LPSTRCUSTOMFILTER);

    if custom != 0 {
        let description = engine.system().read_string(custom).len() as u32 + 1;
        let spec = &data.spec;

        if description + (spec.len() as u32) < ofn.dword(engine, NMAXCUSTFILTER) {
            let mut copy = spec.clone();

            copy.push(0);
            engine.system().write_far(
                (custom & 0xffff_0000) | (custom.wrapping_add(description) & 0xffff),
                &copy,
            );
        }
    }

    if custom == 0 || engine.system().read_string(custom).is_empty() {
        ofn.set_dword(
            engine,
            NFILTERINDEX,
            ofn.dword(engine, NFILTERINDEX).wrapping_add(1),
        );
    }

    if id == IDOK {
        let message = super::message(&mut engine.system(), "commdlg_FileNameOK");

        if tell_hook(engine, hwnd, message, 0, data.ofn).await? != 0 {
            super::wait_cursor(&mut engine.system(), false);
            return Ok(0);
        }
    }

    engine.system().commdlg.files.dialogs.remove(&hwnd);

    let flags = ofn.flags(engine);

    if flags & OFN_ENABLEHOOK != 0 {
        engine.system().commdlg.files.hook = ofn.dword(engine, LPFNHOOK);
    }

    if flags & OFN_NOCHANGEDIR != 0 && !data.saved.is_empty() {
        change_directory(engine, &data.saved, false);
    }

    engine.end_dialog(hwnd, result as i16).await?;
    Ok(1)
}

/// Help (seg2 `420d`): the owner sent `HELPMSGSTRING`, with the box and
/// the structure.
async fn help(engine: &Engine, hwnd: u16) -> Result<u16, Stop> {
    let Some(data) = dialog_of(engine, hwnd) else {
        return Ok(0);
    };
    let owner = Ofn(data.ofn).word(engine, HWNDOWNER);

    if owner != 0 {
        let message = super::message(&mut engine.system(), "commdlg_help");

        send(engine, owner, message, hwnd, data.ofn).await?;
    }

    Ok(0)
}

/// The files' list (seg2 `3640`): a double click is OK; a selection puts
/// its name, lowered, a period after one with none, in the name.
async fn files(engine: &Engine, hwnd: u16, code: u16, control: u16) -> Result<u16, Stop> {
    if code == LBN_DBLCLK {
        send(engine, hwnd, WM_COMMAND, IDOK, 0).await?;
        return Ok(1);
    }

    let Some(data) = dialog_of(engine, hwnd) else {
        return Ok(0);
    };

    if code != LBN_SELCHANGE {
        return Ok(0);
    }

    let ofn = Ofn(data.ofn);
    let hook = ofn.dword(engine, LPFNHOOK);
    let (index, kind): (u16, u16) = if ofn.flags(engine) & OFN_ALLOWMULTISELECT != 0 {
        several_chosen(engine, hwnd, control).await?;

        if hook == 0 {
            (0, 0)
        } else {
            let caret = send(engine, control, LB_GETCARETINDEX, 0, 0).await? as u16;

            if caret & 0x8000 != 0 {
                (caret, 0xffff)
            } else {
                let selected = send(engine, control, LB_GETSEL, caret, 0).await?;

                (caret, if selected != 0 { 2 } else { 1 })
            }
        }
    } else {
        let at = send(engine, control, LB_GETCURSEL, 0, 0).await? as u16;
        let mut name = api::send_bytes(engine, control, LB_GETTEXT, at, api::buffer(256))
            .await?
            .string(0);

        if !name.contains(&b'.') {
            name.push(b'.');
        }

        lower(&mut name);
        set_item_text(engine, hwnd, EDT_NAME, &name).await?;

        if hook == 0 {
            (0, 0)
        } else {
            (send(engine, control, LB_GETCURSEL, 0, 0).await? as u16, 0)
        }
    };

    if hook != 0 {
        let message = super::message(&mut engine.system(), "commdlg_LBSelChangedNotify");

        tell_hook(
            engine,
            hwnd,
            message,
            LST_FILES,
            u32::from(kind) << 16 | u32::from(index),
        )
        .await?;
    }

    send_item(engine, hwnd, EDT_NAME, EM_SETSEL, 0, 0x7fff_0000).await?;
    Ok(1)
}

/// Several files chosen: their names, each with a period where it has
/// none, a space between, lowered, in the name (seg2 `368a`).
async fn several_chosen(engine: &Engine, hwnd: u16, control: u16) -> Result<(), Stop> {
    let count = send(engine, control, LB_GETSELCOUNT, 0, 0).await? as u16;

    if count == 0 {
        set_item_text(engine, hwnd, EDT_NAME, b"").await?;
        return Ok(());
    }

    let items = api::send_bytes(
        engine,
        control,
        LB_GETSELITEMS,
        count,
        api::buffer(usize::from(count) * 2),
    )
    .await?;
    let got = items.word();
    let indices: Vec<u16> = items.buffers[0]
        .chunks(2)
        .take(usize::from(got))
        .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
        .collect();
    let mut names: Vec<u8> = Vec::new();

    for index in indices {
        let mut name = api::send_bytes(engine, control, LB_GETTEXT, index, api::buffer(256))
            .await?
            .string(0);

        if !name.contains(&b'.') {
            name.push(b'.');
        }

        names.extend_from_slice(&name);
        names.push(b' ');

        if names.len() > 0x7f1 {
            break;
        }
    }

    if names.last() == Some(&b' ') {
        names.pop();
    }

    lower(&mut names);
    set_item_text(engine, hwnd, EDT_NAME, &names).await
}

/// The name (seg2 `3563`): as it changes, the files' list scrolled to the
/// first file it begins.
async fn name(engine: &Engine, hwnd: u16, code: u16, control: u16) -> Result<u16, Stop> {
    if code != EN_CHANGE {
        return Ok(0);
    }

    let list = item(engine, hwnd, LST_FILES).await?;
    let caret = send(engine, list, LB_GETCARETINDEX, 0, 0).await? as u16;
    let typed = api::send_bytes(engine, control, WM_GETTEXT, 0x100, api::buffer(0x100))
        .await?
        .string(0);
    let found = api::send_bytes(engine, list, LB_FINDSTRING, caret, text(&typed))
        .await?
        .word();

    if found != 0xffff {
        let top = send(engine, list, LB_GETTOPINDEX, 0, 0).await? as u16;
        let rect = api::api(
            engine,
            "USER",
            "GetClientRect",
            &[Arg::W(list), api::buffer(8)],
        )
        .await?;
        let bottom = u16::from_le_bytes([rect.buffers[0][6], rect.buffers[0][7]]);
        let height = engine.system().commdlg.files.text_height.max(1);

        if top > found || bottom / height + top <= found {
            send(engine, list, LB_SETCARETINDEX, found, 0).await?;
            send(engine, list, LB_SETTOPINDEX, found, 0).await?;
        }
    }

    Ok(1)
}

/// The types' combo box (seg2 `391f`): with the extended interface, a
/// selection made while it is dropped is taken as it closes.
async fn types(engine: &Engine, hwnd: u16, code: u16, lparam: u32) -> Result<u16, Stop> {
    match code {
        CBN_SELCHANGE => {
            if flags_of(engine, hwnd) & TYPES_DROPPED != 0 {
                return Ok(1);
            }

            change_flags(engine, hwnd, |flags| flags & !TYPES_DROPPED);
            type_taken(engine, hwnd).await
        }
        CBN_DROPDOWN => {
            change_flags(engine, hwnd, |flags| flags | TYPES_DROPPED);
            Ok(1)
        }
        CBN_CLOSEUP => {
            api::post(
                engine,
                hwnd,
                WM_COMMAND,
                CMB_TYPES,
                u32::from(TAKE) << 16 | (lparam & 0xffff),
            )
            .await?;
            Ok(1)
        }
        TAKE => {
            change_flags(engine, hwnd, |flags| flags & !TYPES_DROPPED);
            type_taken(engine, hwnd).await
        }
        _ => Ok(0),
    }
}

/// A type taken (seg2 `398f`): its pattern the files' spec, and the
/// name's, where the name is nothing or a wildcard.
async fn type_taken(engine: &Engine, hwnd: u16) -> Result<u16, Stop> {
    let index = send_item(engine, hwnd, CMB_TYPES, CB_GETCURSEL, 0, 0).await? as u16;

    if index & 0x8000 != 0 {
        return Ok(0);
    }

    super::wait_cursor(&mut engine.system(), true);

    let Some(data) = dialog_of(engine, hwnd) else {
        return Ok(0);
    };
    let ofn = Ofn(data.ofn);
    let custom = ofn.dword(engine, LPSTRCUSTOMFILTER);
    let pattern = if index == 0 && custom != 0 && !engine.system().read_string(custom).is_empty() {
        custom_pattern(engine, custom)
    } else {
        let offset = send_item(engine, hwnd, CMB_TYPES, CB_GETITEMDATA, index, 0).await?;

        after_string(engine, ofn.dword(engine, LPSTRFILTER), offset as u16)
    };

    if !pattern.is_empty() {
        let typed = item_text(engine, hwnd, EDT_NAME, 0xff).await?;
        let replace = typed.is_empty() || has_wildcard(&typed);
        let mut spec = pattern;

        if replace {
            lower(&mut spec);
            set_item_text(engine, hwnd, EDT_NAME, &spec).await?;
            send_item(engine, hwnd, EDT_NAME, EM_SETSEL, 0, 0x7fff_0000).await?;
        }

        apply_spec(engine, &mut spec, hwnd).await?;

        if !engine.system().commdlg.initialising {
            let spec = terminated(&spec);

            with_dialog(engine, hwnd, |data| data.spec = spec);
        }
    }

    let message = super::message(&mut engine.system(), "commdlg_LBSelChangedNotify");

    tell_hook(engine, hwnd, message, CMB_TYPES, u32::from(index)).await?;
    super::wait_cursor(&mut engine.system(), false);
    Ok(1)
}

/// The folders' list (seg2 `3b94`).
async fn folders(engine: &Engine, hwnd: u16, code: u16) -> Result<u16, Stop> {
    match code {
        // A row other than the current folder's chosen: kept to be gone
        // into by OK, the name's path taken off.
        LBN_SELCHANGE => {
            if flags_of(engine, hwnd) & FOLDER_MOVED == 0 {
                let at = send_item(engine, hwnd, LST_FOLDERS, LB_GETCURSEL, 0, 0).await? as u16;
                let depth = dialog_of(engine, hwnd).map_or(0, |data| data.depth);

                if depth.wrapping_sub(at).wrapping_sub(1) != 0 {
                    strip_path(engine, hwnd).await?;
                    change_flags(engine, hwnd, |flags| flags | FOLDER_MOVED);
                }
            }

            Ok(1)
        }
        LBN_SETFOCUS => {
            let ok = item(engine, hwnd, IDOK).await?;

            api::api(engine, "USER", "EnableWindow", &[Arg::W(ok), Arg::W(1)]).await?;

            let cancel = item(engine, hwnd, IDCANCEL).await?;

            send(engine, cancel, BM_SETSTYLE, 0, 1).await?;
            Ok(0)
        }
        LBN_KILLFOCUS => {
            if dialog_of(engine, hwnd).is_some() && flags_of(engine, hwnd) & FOLDER_MOVED != 0 {
                change_flags(engine, hwnd, |flags| flags & !FOLDER_MOVED);
            } else {
                engine.system().commdlg.files.ok_from_folders = false;
            }

            Ok(0)
        }
        LBN_DBLCLK => folder_chosen(engine, hwnd).await,
        _ => Ok(0),
    }
}

/// A folder's row gone into (seg2 `3c7e`): the path to it made from the
/// rows above it, or its name below the current folder.
pub(super) async fn folder_chosen(engine: &Engine, hwnd: u16) -> Result<u16, Stop> {
    change_flags(engine, hwnd, |flags| flags & !FOLDER_MOVED);

    let at = send_item(engine, hwnd, LST_FOLDERS, LB_GETCURSEL, 0, 0).await? as u16;
    let depth = dialog_of(engine, hwnd).map_or(0, |data| data.depth);
    let (path, row) = if depth <= at {
        (
            list_text(engine, hwnd, LST_FOLDERS, LB_GETTEXT, at).await?,
            depth,
        )
    } else {
        let mut path = list_text(engine, hwnd, LST_FOLDERS, LB_GETTEXT, 0).await?;

        for row in 1..=at {
            path.extend(list_text(engine, hwnd, LST_FOLDERS, LB_GETTEXT, row).await?);
            path.push(b'\\');
        }

        if at != 0 {
            path.pop();
        }

        (path, at)
    };

    with_dialog(engine, hwnd, |data| data.scratch.clone_from(&path));

    if !path.is_empty() && change_directory(engine, &path, true) != 0 {
        return Ok(0);
    }

    refresh(engine, hwnd, None, 0x10).await?;

    let message = super::message(&mut engine.system(), "commdlg_LBSelChangedNotify");

    tell_hook(engine, hwnd, message, LST_FOLDERS, u32::from(row)).await?;
    Ok(1)
}

/// The drives' combo box (seg2 `3df3`).
async fn drives(engine: &Engine, hwnd: u16, code: u16, lparam: u32) -> Result<u16, Stop> {
    match code {
        CBN_SELCHANGE => {
            strip_path(engine, hwnd).await?;

            if flags_of(engine, hwnd) & DRIVES_DROPPED != 0 {
                return Ok(1);
            }

            drive_taken(engine, hwnd).await
        }
        CBN_DROPDOWN => {
            change_flags(engine, hwnd, |flags| flags | DRIVES_DROPPED);
            Ok(1)
        }
        CBN_CLOSEUP => {
            api::post(
                engine,
                hwnd,
                WM_COMMAND,
                CMB_DRIVES,
                u32::from(TAKE) << 16 | (lparam & 0xffff),
            )
            .await?;
            Ok(1)
        }
        TAKE => drive_taken(engine, hwnd).await,
        _ => Ok(0),
    }
}

/// A drive taken (seg2 `3e5a`): gone to, and its folders and files
/// listed; a drive that cannot be read said so, and the current one taken
/// again.
async fn drive_taken(engine: &Engine, hwnd: u16) -> Result<u16, Stop> {
    super::wait_cursor(&mut engine.system(), true);
    change_flags(engine, hwnd, |flags| flags & !DRIVES_DROPPED);

    let at = send_item(engine, hwnd, CMB_DRIVES, CB_GETCURSEL, 0, 0).await? as u16;
    let chosen = list_text(engine, hwnd, CMB_DRIVES, CB_GETLBTEXT, at).await?;

    if chosen.is_empty() {
        super::wait_cursor(&mut engine.system(), false);
        return Ok(1);
    }

    let mut letter = chosen[0];
    let mut current = current_drive(engine) + b'a';
    let initialising = engine.system().commdlg.initialising;
    let mut spec: Option<Vec<u8>> = None;

    // As the box starts, the spec is the program's file name where it has
    // a wildcard, else the type's pattern (seg2 `3eae`).
    if initialising && let Some(data) = dialog_of(engine, hwnd) {
        let ofn = Ofn(data.ofn);
        let file = ofn.string(engine, LPSTRFILE).unwrap_or_default();

        spec = if has_wildcard(&file) {
            Some(file)
        } else {
            let index = send_item(engine, hwnd, CMB_TYPES, CB_GETCURSEL, 0, 0).await? as u16;

            if index & 0x8000 != 0 {
                None
            } else {
                let custom = ofn.dword(engine, LPSTRCUSTOMFILTER);

                if index == 0 && custom != 0 && !engine.system().read_string(custom).is_empty() {
                    Some(custom_pattern(engine, custom))
                } else {
                    let offset =
                        send_item(engine, hwnd, CMB_TYPES, CB_GETITEMDATA, index, 0).await?;

                    Some(after_string(
                        engine,
                        ofn.dword(engine, LPSTRFILTER),
                        offset as u16,
                    ))
                }
            }
        };

        if let Some(spec) = spec.as_mut() {
            lower(spec);
        }
    }

    let mut tried = drive_ready(engine, letter);

    loop {
        if tried && refresh(engine, hwnd, spec.as_mut(), 0x4010).await? != 0 {
            let index = send_item(engine, hwnd, CMB_DRIVES, CB_GETCURSEL, 0, 0).await? as u16;
            let message = super::message(&mut engine.system(), "commdlg_LBSelChangedNotify");

            tell_hook(engine, hwnd, message, CMB_DRIVES, u32::from(index)).await?;
            break;
        }

        // Not read: said so, unless the box is just made; Retry tries it
        // again, Cancel goes back to the current drive and lists it
        // whatever it answers (seg2 `405f`).
        if show_drive_error(engine, hwnd, letter).await? {
            tried = drive_ready(engine, letter);

            if tried {
                select_drive(engine, hwnd, letter).await?;
            }

            continue;
        }

        if letter == current && change_directory(engine, b"\\", true) != 0 {
            current = b'c';
        }

        letter = current;
        drive_ready(engine, letter);
        select_drive(engine, hwnd, letter).await?;
        tried = true;
    }

    super::wait_cursor(&mut engine.system(), false);
    Ok(1)
}
