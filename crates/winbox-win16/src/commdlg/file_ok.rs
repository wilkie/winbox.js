//! OK in the file boxes: the name taken, checked and answered
//! (`COMMDLG.DLL` seg2 `22e7`), or with several files the names taken
//! (seg2 `1c16`). As `file-dialogs.ts`.

use super::api::{self, Arg, item, item_text, send, send_item, set_item_text};
use super::file_dialogs::{
    CB_FINDSTRING, CB_GETCURSEL, CHX_READONLY, CMB_DRIVES, CMB_TYPES, EDT_NAME, IDYES, LPFNHOOK,
    LPSTRDEFEXT, LPSTRFILE, LPSTRFILETITLE, NFILEEXTENSION, NFILEOFFSET, NFILTERINDEX, NMAXFILE,
    NMAXFILETITLE, OFN_ALLOWMULTISELECT, OFN_CREATEPROMPT, OFN_EXTENSIONDIFFERENT,
    OFN_FILEMUSTEXIST, OFN_NOREADONLYRETURN, OFN_NOTESTFILECREATE, OFN_NOVALIDATE,
    OFN_OVERWRITEPROMPT, OFN_PATHMUSTEXIST, OFN_READONLY, OFN_SHAREAWARE, Ofn, TAKE, WM_COMMAND,
    WM_GETTEXTLENGTH, WM_NEXTDLGCTL, WM_SETREDRAW, has_wildcard, terminated,
};
use super::file_init::{dialog_of, with_dialog};
use super::file_lists::{
    Opened, apply_spec, can_create, change_directory, close, create_prompt, current_directory,
    current_drive, drive_type, file_attributes, open_quietly, overwrite_prompt, refresh,
    refresh_drives, reserved_name, select_drive, show_error,
};
use super::parse::{DIRECTORY, EMPTY, INVALID_CHARACTER, INVALID_SPACE, parse_file};
use crate::call::Stop;
use crate::engine::Engine;

const OF_EXIST_SHARED: u16 = 0x4040;
const OF_CREATE: u16 = 0x1000;
const OF_DELETE: u16 = 0x0200;
const HFILE_ERROR: u16 = 0xffff;
/// A file another program holds: COMMDLG's own mark (seg2 `2ae0`).
const SHARED: u16 = 0xfffe;
/// DOS's sharing violation.
const SHARING: u16 = 0x20;
/// The answers a hook gives `SHAREVISTRING` (`OFN_SHARENOWARN`,
/// `OFN_SHAREFALLTHROUGH`).
const SHARE_NO_WARN: u16 = 1;
const SHARE_FALL_THROUGH: u16 = 2;
/// `CBN_CLOSEUP`, which COMMDLG sends its own types' combo box to have the
/// type's pattern put back in the name (seg2 `26a1`).
const CLOSE_UP: u16 = 8;

/// The bytes up to a nought, from `at`.
fn from(bytes: &[u8], at: usize) -> Vec<u8> {
    terminated(bytes.get(at..).unwrap_or(&[]))
}

/// The default extension added: a period and its first three characters,
/// a `*` before them for a wildcard (seg2 `4a38`).
pub(super) fn add_extension(name: &mut Vec<u8>, extension: &[u8], star: bool) {
    let end = name.iter().position(|&b| b == 0).unwrap_or(name.len());

    name.truncate(end);

    if star {
        name.push(b'*');
    }

    name.push(b'.');
    name.extend(extension.iter().take_while(|&&b| b != 0).take(3));
    name.push(0);
}

/// Where a check of the name goes next.
enum Next {
    Error(u16),
    Share,
    Done,
    Keep,
}

/// OK: the name taken. Nought keeps the box; 1 ends it with the name
/// answered in the structure.
#[allow(clippy::too_many_lines)]
pub(super) async fn name_taken(engine: &Engine, hwnd: u16, save: bool) -> Result<u16, Stop> {
    let Some(data) = dialog_of(engine, hwnd) else {
        return Ok(0);
    };
    let ofn = Ofn(data.ofn);
    let mut network = false;
    let mut scratch = item_text(engine, hwnd, EDT_NAME, 0xff).await?;

    scratch.push(0);

    let (parsed, mut extension) = parse_file(&mut scratch);
    let flags = ofn.flags(engine);

    with_dialog(engine, hwnd, |data| data.scratch = terminated(&scratch));

    if parsed == EMPTY {
        refresh(engine, hwnd, None, 0).await?;
        return Ok(0);
    }

    // Not checked: the name as it is (seg2 `2362`).
    if parsed != DIRECTORY && flags & OFN_NOVALIDATE != 0 {
        ofn.set_word(engine, NFILEOFFSET, parsed as u16);
        ofn.set_word(engine, NFILEEXTENSION, extension);
        write_name(engine, &ofn, &terminated(&scratch));
        return Ok(1);
    }

    if parsed == INVALID_SPACE && flags & OFN_ALLOWMULTISELECT != 0 {
        return several_taken(engine, hwnd, save).await;
    }

    // Specs after a `;`: the files' list shows them (seg2 `2430`).
    if scratch.get(usize::from(extension)) == Some(&b';') {
        let at = usize::from(extension);

        scratch[at] = 0;

        let (first, _) = parse_file(&mut scratch);

        scratch[at] = b';';

        if first >= 0 && has_wildcard(&from(&scratch, first as usize)) {
            let spec = from(&scratch, first as usize);

            with_dialog(engine, hwnd, |data| data.spec.clone_from(&spec));

            let mut whole = terminated(&scratch);
            let answer = apply_spec(engine, &mut whole, hwnd).await?;

            if answer == 0 {
                return Ok(0);
            }

            return path_error(engine, hwnd, &mut scratch, answer, parsed, network).await;
        }

        return error(
            engine,
            hwnd,
            &mut scratch,
            INVALID_CHARACTER as u16,
            parsed,
            network,
            0,
        )
        .await;
    }

    if parsed == DIRECTORY {
        let at = usize::from(extension);

        if at > 1
            && matches!(scratch.get(at - 1), Some(b'\\' | b'/'))
            && scratch.get(at.wrapping_sub(2)) != Some(&b':')
        {
            scratch[at - 1] = 0;
        }
    } else if parsed < 0 {
        return error(
            engine,
            hwnd,
            &mut scratch,
            parsed as u16,
            parsed,
            network,
            0,
        )
        .await;
    }

    // A name that is a folder is gone into; the path before a file's name
    // is tried (seg2 `25fc`).
    let mut cut = parsed;
    let mut answer: u16 = 0;

    if scratch.starts_with(b"\\\\")
        || (scratch.get(1) == Some(&b':') && scratch.get(2..4) == Some(b"\\\\"))
    {
        network = true;
    } else {
        answer = change_directory(engine, &terminated(&scratch), true);

        if answer == 0 {
            return gone_into(engine, hwnd).await;
        }

        if parsed > 0 {
            let at = parsed as usize;

            if parsed > 1
                && scratch.get(at - 1) != Some(&b':')
                && scratch.get(at - 2) != Some(&b':')
            {
                cut -= 1;
            }

            let saved = current_directory(engine).unwrap_or_default();
            let at = cut as usize;
            let kept = scratch[at];

            scratch[at] = 0;
            answer = change_directory(engine, &terminated(&scratch), true);
            scratch[at] = kept;
            change_directory(engine, &saved, false);
        }
    }

    if !network && parsed != 0 && answer != 0 && flags & OFN_PATHMUSTEXIST != 0 {
        return path_error(engine, hwnd, &mut scratch, answer, parsed, network).await;
    }

    let name_at = parsed.max(0) as usize;

    // A wildcard: the files' spec (seg2 `2860`).
    if has_wildcard(&from(&scratch, name_at)) {
        if network {
            return error(engine, hwnd, &mut scratch, 2, parsed, network, 0).await;
        }

        if cut > 0 {
            let at = cut as usize;
            let kept = scratch[at];

            scratch[at] = 0;
            change_directory(engine, &terminated(&scratch), true);
            scratch[at] = kept;
        }

        let mut spec = from(&scratch, name_at);

        if extension == 0 {
            spec.push(b'.');
        }

        let mut whole = b".\\".to_vec();

        whole.extend_from_slice(&spec);
        with_dialog(engine, hwnd, |data| data.spec.clone_from(&spec));

        if apply_spec(engine, &mut whole, hwnd).await? != 0 {
            api::api(engine, "USER", "MessageBeep", &[Arg::W(0)]).await?;
        }

        return Ok(0);
    }

    if reserved_name(&from(&scratch, name_at)) {
        return error(engine, hwnd, &mut scratch, 0x62, parsed, network, 0).await;
    }

    // `C:NAME` made `C:.\NAME` (seg2 `2987`).
    if parsed == 2 && scratch.get(1) == Some(&b':') {
        let rest = from(&scratch, 2);
        let mut made = scratch[..2].to_vec();

        made.extend_from_slice(b".\\");
        made.extend_from_slice(&rest);
        made.push(0);
        scratch = made;
        extension += 2;
    }

    // The default extension, where the name has none (seg2 `29d7`).
    let defext = ofn.string(engine, LPSTRDEFEXT).unwrap_or_default();
    let at = usize::from(extension);
    let mut extension_added = false;
    let mut opened = Opened::default();
    let mut found = false;

    if extension != 0
        && scratch.get(at).copied().unwrap_or(0) == 0
        && !defext.is_empty()
        && u32::from(extension) + 4 < ofn.dword(engine, NMAXFILE)
        && extension + 4 < 0x80
    {
        extension_added = true;
        add_extension(&mut scratch, &defext, false);

        if change_directory(engine, &terminated(&scratch), true) == 0 {
            return gone_into(engine, hwnd).await;
        }

        opened = open_quietly(engine, &terminated(&scratch), OF_EXIST_SHARED, network).await?;

        if opened.code == SHARING {
            opened.handle = SHARED;
        }

        if opened.handle == HFILE_ERROR {
            scratch.truncate(at);
            scratch.push(0);
        } else {
            found = true;
        }
    }

    if !found {
        opened = open_quietly(engine, &terminated(&scratch), OF_EXIST_SHARED, network).await?;
        found = opened.handle != HFILE_ERROR;
    }

    let mut next = if found {
        // There (seg2 `2af0`).
        let path = terminated(&opened.path);

        if flags & OFN_NOREADONLYRETURN != 0 && file_attributes(engine, &path).await? & 1 != 0 {
            Next::Error(0x63)
        } else if save || flags & OFN_NOREADONLYRETURN != 0 {
            match can_create(engine, &path).await? {
                0 => Next::Done,
                code => Next::Error(code),
            }
        } else {
            Next::Done
        }
    } else {
        // Not there (seg2 `2c1f`).
        let code = opened.code;

        if (code == 2 || code == 3) && extension_added {
            add_extension(&mut scratch, &defext, false);
            add_extension(&mut opened.path, &defext, false);
        }

        if code == SHARING {
            Next::Share
        } else if !save {
            if code == 2 || code == 3 {
                if flags & OFN_FILEMUSTEXIST != 0 {
                    if flags & OFN_CREATEPROMPT != 0 {
                        engine.system().commdlg.files.prompting = true;

                        let answer = create_prompt(engine, hwnd, &terminated(&scratch)).await?;

                        engine.system().commdlg.files.prompting = false;

                        if answer == IDYES {
                            Next::Keep
                        } else {
                            return Ok(0);
                        }
                    } else {
                        Next::Error(code)
                    }
                } else {
                    Next::Keep
                }
            } else {
                Next::Error(code)
            }
        } else {
            Next::Keep
        }
    };

    // The overwrite prompt (seg2 `2b50`), and the creation tried for a name
    // not there (seg2 `2d56`).
    if found && matches!(next, Next::Done) {
        if flags & OFN_OVERWRITEPROMPT != 0
            && save
            && !overwrite_prompt(engine, hwnd, &terminated(&opened.path)).await?
        {
            let name = item(engine, hwnd, EDT_NAME).await?;

            api::post(engine, hwnd, WM_NEXTDLGCTL, name, 1).await?;
            return Ok(0);
        }

        if opened.code == SHARING {
            next = Next::Share;
        }
    }

    if matches!(next, Next::Keep) {
        next = Next::Done;

        if flags & OFN_PATHMUSTEXIST != 0 && flags & OFN_NOTESTFILECREATE == 0 {
            let name = terminated(&scratch);
            let mut made = open_quietly(engine, &name, OF_CREATE, network).await?;

            if made.handle == HFILE_ERROR {
                let code = made.code;

                next = Next::Error(if matches!(code, 0x13 | 0x52 | 0x41 | 5) {
                    code
                } else {
                    0
                });
                opened = made;
            } else {
                close(engine, made.handle).await?;
                open_quietly(engine, &name, OF_DELETE, network).await?;
                made = open_quietly(engine, &name, OF_EXIST_SHARED, network).await?;

                if made.handle != HFILE_ERROR {
                    next = Next::Error(0x60);
                    opened = made;
                }
            }
        }
    }

    // Another program has it (seg2 `2c80`).
    if matches!(next, Next::Share) {
        next = if flags & OFN_SHAREAWARE != 0 {
            Next::Done
        } else {
            let hook = ofn.dword(engine, LPFNHOOK);

            if hook == 0 {
                Next::Error(SHARING)
            } else {
                let message = super::message(&mut engine.system(), "commdlg_ShareViolation");
                let answer = super::call_hook_text(
                    engine,
                    hook,
                    hwnd,
                    message,
                    0,
                    &terminated(&opened.path),
                )
                .await?;

                match answer {
                    SHARE_NO_WARN => return Ok(0),
                    SHARE_FALL_THROUGH => Next::Done,
                    _ => Next::Error(SHARING),
                }
            }
        };
    }

    if let Next::Error(code) = next {
        let drive = opened.path.first().copied().unwrap_or(0);

        return error(engine, hwnd, &mut scratch, code, parsed, network, drive).await;
    }

    answered(engine, hwnd, &ofn, &opened, extension, extension_added).await
}

/// The name answered (seg2 `2e90`): the path `OpenFile` made of it, its
/// offsets, its title, and the read-only box's state.
async fn answered(
    engine: &Engine,
    hwnd: u16,
    ofn: &Ofn,
    opened: &Opened,
    extension: u16,
    extension_added: bool,
) -> Result<u16, Stop> {
    super::wait_cursor(&mut engine.system(), true);

    let mut path = terminated(&opened.path);

    path = crate::keyboard::translate_bytes(false, &path);
    path.push(0);

    let (offset, at) = parse_file(&mut path);
    let path = terminated(&path);

    ofn.set_word(engine, NFILEOFFSET, offset as u16);
    ofn.set_word(
        engine,
        NFILEEXTENSION,
        if extension != 0 || extension_added {
            at
        } else {
            0
        },
    );

    let mut flags = ofn.flags(engine) & !OFN_EXTENSIONDIFFERENT;

    if let Some(defext) = ofn.string(engine, LPSTRDEFEXT)
        && ofn.word(engine, NFILEEXTENSION) != 0
    {
        let wanted: Vec<u8> = defext.iter().take(3).copied().collect();
        let given = from(&path, usize::from(at));

        if !wanted.eq_ignore_ascii_case(&given) {
            flags |= OFN_EXTENSIONDIFFERENT;
        }
    }

    ofn.set_flags(engine, flags);
    write_name(engine, ofn, &path);

    if ofn.dword(engine, LPSTRFILETITLE) != 0 {
        let mut title = from(&path, offset.max(0) as usize);
        let room = ofn.dword(engine, NMAXFILETITLE);

        if room <= title.len() as u32 {
            title.truncate(room.saturating_sub(1) as usize);
        }

        ofn.write(engine, LPSTRFILETITLE, &title);
    }

    let checked = api::word(
        engine,
        "USER",
        "IsDlgButtonChecked",
        &[Arg::W(hwnd), Arg::W(CHX_READONLY)],
    )
    .await?;
    let flags = ofn.flags(engine);

    ofn.set_flags(
        engine,
        if checked != 0 {
            flags | OFN_READONLY
        } else {
            flags & !OFN_READONLY
        },
    );
    Ok(1)
}

/// The name answered in the program's buffer, or its length where it does
/// not fit (seg2 `2387`, `2f7b`).
fn write_name(engine: &Engine, ofn: &Ofn, name: &[u8]) {
    if ofn.dword(engine, LPSTRFILE) == 0 {
        return;
    }

    let length = name.len() as u16;

    if ofn.word(engine, NMAXFILE) >= length {
        ofn.write(engine, LPSTRFILE, name);
    } else {
        ofn.write_size(engine, LPSTRFILE, length);
    }
}

/// A folder named gone into: the name `*.*` until the types' combo box
/// puts the type's pattern back, and both lists filled again (seg2 `264f`).
async fn gone_into(engine: &Engine, hwnd: u16) -> Result<u16, Stop> {
    send_item(engine, hwnd, EDT_NAME, WM_SETREDRAW, 0, 0).await?;
    set_item_text(engine, hwnd, EDT_NAME, b"*.*").await?;
    select_drive(engine, hwnd, current_drive(engine) + b'a').await?;

    let types = item(engine, hwnd, CMB_TYPES).await?;

    send(
        engine,
        hwnd,
        WM_COMMAND,
        CMB_TYPES,
        u32::from(CLOSE_UP) << 16 | u32::from(types),
    )
    .await?;

    let drives = item(engine, hwnd, CMB_DRIVES).await?;

    send(
        engine,
        hwnd,
        WM_COMMAND,
        CMB_DRIVES,
        u32::from(TAKE) << 16 | u32::from(drives),
    )
    .await?;
    send_item(engine, hwnd, EDT_NAME, WM_SETREDRAW, 1, 0).await?;

    let name = item(engine, hwnd, EDT_NAME).await?;

    api::api(
        engine,
        "USER",
        "InvalidateRect",
        &[Arg::W(name), Arg::D(0), Arg::W(0)],
    )
    .await?;
    Ok(0)
}

/// A path that is not there (seg2 `27b6`).
async fn path_error(
    engine: &Engine,
    hwnd: u16,
    scratch: &mut Vec<u8>,
    answer: u16,
    parsed: i16,
    network: bool,
) -> Result<u16, Stop> {
    let letter = scratch.first().copied().unwrap_or(0);
    let (code, drive) = match answer {
        2 => (3, 0),
        1 => {
            let found = api::send_item_bytes(
                engine,
                hwnd,
                CMB_DRIVES,
                CB_FINDSTRING,
                0xffff,
                api::text(&[letter]),
            )
            .await?
            .word();

            if found & 0x8000 != 0 {
                (0x61, letter)
            } else {
                match drive_type(engine, i16::from(letter) - 0x61).await? {
                    1 => {
                        refresh_drives(engine, hwnd).await?;
                        (0x61, letter)
                    }
                    2 => (5, letter),
                    _ => (3, letter),
                }
            }
        }
        _ => (2, 0),
    };

    error(engine, hwnd, scratch, code, parsed, network, drive).await
}

/// An error said in COMMDLG's box (seg2 `2552`): a network path's is "not
/// found"; one of the drive's says the drive's letter.
async fn error(
    engine: &Engine,
    hwnd: u16,
    scratch: &mut Vec<u8>,
    code: u16,
    parsed: i16,
    network: bool,
    drive: u8,
) -> Result<u16, Stop> {
    let mut code = code;

    if network {
        code = 2;
    } else if parsed == 2 && scratch.get(2) == Some(&b'.') {
        // `C:.\NAME` said as `C:NAME` again (seg2 `2565`).
        let rest = from(scratch, 4);

        scratch.truncate(2);
        scratch.extend_from_slice(&rest);
        scratch.push(0);
    }

    if code == 5 && drive_type(engine, i16::from(drive | 0x60) - 0x61).await? != 2 {
        code = 0x41;
    }

    if matches!(code, 0x13 | 0x52 | 5) && !scratch.is_empty() {
        scratch[0] = drive;
    }

    show_error(engine, hwnd, &terminated(scratch), code).await?;
    Ok(0)
}

/// Several files taken (seg2 `1c16`): the folder and the names as typed, a
/// space between, each checked as it is opened; the extension's offset
/// nought.
#[allow(clippy::too_many_lines)]
async fn several_taken(engine: &Engine, hwnd: u16, save: bool) -> Result<u16, Stop> {
    let Some(data) = dialog_of(engine, hwnd) else {
        return Ok(0);
    };
    let ofn = Ofn(data.ofn);
    let flags = ofn.flags(engine);
    let folder = current_directory(engine).unwrap_or_default();
    let length = send_item(engine, hwnd, EDT_NAME, WM_GETTEXTLENGTH, 0, 0).await? as u16;
    let needed = length + folder.len() as u16 + 2;

    if ofn.dword(engine, LPSTRFILE) == 0 {
        return several_end(engine, hwnd, &ofn).await;
    }

    if ofn.word(engine, NMAXFILE) < needed {
        ofn.write_size(engine, LPSTRFILE, needed);
        return several_end(engine, hwnd, &ofn).await;
    }

    let mut file = folder.clone();

    file.push(b' ');

    let start = file.len();

    ofn.set_word(engine, NFILEOFFSET, start as u16);

    let room = ofn
        .word(engine, NMAXFILE)
        .wrapping_sub(start as u16)
        .wrapping_sub(1);
    let typed = item_text(engine, hwnd, EDT_NAME, room).await?;

    file.extend_from_slice(&typed);
    ofn.write(engine, LPSTRFILE, &file);

    let mut p = start;

    while file.get(p) == Some(&b' ') {
        p += 1;
    }

    if p >= file.len() {
        return Ok(0);
    }

    let mut more = false;

    loop {
        if more {
            break;
        }

        let mut q = p;

        while q < file.len() && file[q] != b' ' {
            q += 1;
        }

        if q < file.len() {
            file[q] = 0;
        } else {
            more = true;
        }

        let name = terminated(&file[p..]);
        let opened = open_quietly(engine, &name, OF_EXIST_SHARED, false).await?;

        if opened.handle == HFILE_ERROR {
            let mut code = opened.code;
            let allowed = (flags & OFN_FILEMUSTEXIST == 0 && code == 2)
                || (flags & OFN_PATHMUSTEXIST == 0 && code == 3)
                || (flags & OFN_SHAREAWARE != 0 && code == SHARING);

            if !allowed {
                let mut fallen = false;

                if code == SHARING && ofn.dword(engine, LPFNHOOK) != 0 {
                    let message = super::message(&mut engine.system(), "commdlg_ShareViolation");
                    let hook = ofn.dword(engine, LPFNHOOK);
                    let answer = super::call_hook_text(
                        engine,
                        hook,
                        hwnd,
                        message,
                        0,
                        &terminated(&opened.path),
                    )
                    .await?;

                    match answer {
                        SHARE_NO_WARN => return Ok(0),
                        SHARE_FALL_THROUGH => fallen = true,
                        _ => {}
                    }
                } else if code == 5 {
                    let drive = opened.path.first().copied().unwrap_or(0) | 0x60;

                    if drive_type(engine, i16::from(drive) - 0x61).await? != 2 {
                        code = 0x41;
                    }
                }

                if !fallen {
                    let mut name = name;

                    if matches!(code, 0x13 | 0x52 | 5) && !name.is_empty() {
                        name[0] = opened.path.first().copied().unwrap_or(0);
                    }

                    show_error(engine, hwnd, &name, code).await?;
                    return Ok(0);
                }
            }
        } else {
            let path = terminated(&opened.path);

            if flags & OFN_NOREADONLYRETURN != 0 && file_attributes(engine, &path).await? & 1 != 0 {
                show_error(engine, hwnd, &name, 0x63).await?;
                return Ok(0);
            }

            if save || flags & OFN_NOREADONLYRETURN != 0 {
                let code = can_create(engine, &path).await?;

                if code != 0 {
                    show_error(engine, hwnd, &name, code).await?;
                    return Ok(0);
                }
            }

            if flags & OFN_OVERWRITEPROMPT != 0
                && save
                && !overwrite_prompt(engine, hwnd, &path).await?
            {
                let edit = item(engine, hwnd, EDT_NAME).await?;

                api::post(engine, hwnd, WM_NEXTDLGCTL, edit, 1).await?;
                return Ok(0);
            }
        }

        if !more {
            p = q + 1;

            while file.get(p) == Some(&b' ') {
                p += 1;
            }

            if p >= file.len() {
                more = true;
            } else {
                file[q] = b' ';
            }
        }
    }

    ofn.write(engine, LPSTRFILE, &terminated(&file));
    several_end(engine, hwnd, &ofn).await
}

/// Several files answered: no extension's offset, and the type chosen
/// (seg2 `2024`).
async fn several_end(engine: &Engine, hwnd: u16, ofn: &Ofn) -> Result<u16, Stop> {
    ofn.set_word(engine, NFILEEXTENSION, 0);

    let index = send_item(engine, hwnd, CMB_TYPES, CB_GETCURSEL, 0, 0).await? as u16;

    ofn.set_dword(engine, NFILTERINDEX, u32::from(index));
    Ok(1)
}
