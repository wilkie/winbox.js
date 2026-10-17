//! The file boxes' procedures, `FileOpenDlgProc` and `FileSaveDlgProc`
//! (`COMMDLG.DLL` seg2 `42a3`, `446a`), their `WM_INITDIALOG` (seg2
//! `1153`), and the subclassed folders' list and OK button (seg2 `10a5`,
//! `100f`). As `file-dialogs.ts`.

use super::api::{self, Arg, item, send, send_item, set_item_text, text};
use super::file_dialogs::{
    CB_ADDSTRING, CB_GETITEMDATA, CB_INSERTSTRING, CB_LIMITTEXT, CB_SETCURSEL, CB_SETEXTENDEDUI,
    CB_SETITEMDATA, CDERR_NOHOOK, CHX_READONLY, CMB_DRIVES, CMB_TYPES, DW_LB_SUBCLASS,
    DW_OK_SUBCLASS, EDT_NAME, EM_LIMITTEXT, FNERR_INVALIDFILENAME, FNERR_SUBCLASSFAILURE,
    FileDialog, GCL_WNDPROC, GWL_WNDPROC, IDOK, LB_SETCURSEL, LPFNHOOK, LPSTRCUSTOMFILTER,
    LPSTRFILE, LPSTRFILTER, LPSTRINITIALDIR, LPSTRTITLE, LST_FILES, LST_FOLDERS, NFILTERINDEX,
    NMAXCUSTFILTER, OFN_CREATEPROMPT, OFN_ENABLEHOOK, OFN_ENABLETEMPLATE, OFN_ENABLETEMPLATEHANDLE,
    OFN_FILEMUSTEXIST, OFN_HIDEREADONLY, OFN_NOCHANGEDIR, OFN_NOVALIDATE, OFN_PATHMUSTEXIST,
    OFN_READONLY, OFN_SHOWHELP, Ofn, PSH_HELP, STC_TYPES, SW_HIDE, SWP_NOZORDER, TAKE, WM_ACTIVATE,
    WM_COMMAND, WM_DRAWITEM, WM_INITDIALOG, WM_KILLFOCUS, WM_MEASUREITEM, WM_SYSCOLORCHANGE,
    after_string, commdlg_string, custom_pattern, has_wildcard, lower,
};
use super::file_lists::{draw_item, fill_drives, measure_item, refresh_drives, select_drive};
use super::parse::{EMPTY, parse_file};
use crate::call::{Answer, Args, Later, Stop};
use crate::engine::Engine;

pub(crate) fn file_open_dlg_proc(engine: &Engine, args: Args) -> Later<'_> {
    Box::pin(dialog_proc(engine, args, false))
}

pub(crate) fn file_save_dlg_proc(engine: &Engine, args: Args) -> Later<'_> {
    Box::pin(dialog_proc(engine, args, true))
}

async fn dialog_proc(engine: &Engine, mut args: Args, save: bool) -> Result<Answer, Stop> {
    let (hwnd, message, wparam, lparam) = {
        let system = engine.system();

        (
            args.word(&system),
            args.word(&system),
            args.word(&system),
            args.dword(&system),
        )
    };
    let (data, shared_hook) = {
        let system = engine.system();
        let shared = &system.commdlg.files;

        (shared.dialogs.get(&hwnd).map(|d| d.ofn), shared.hook)
    };

    // The program's hook first: each message it answers is not COMMDLG's.
    // Before the box has its block, the hook kept as the box was asked for
    // is sent what comes before `WM_INITDIALOG` (seg2 `42b3`, `430c`).
    if let Some(ofn) = data {
        let hook = Ofn(ofn).dword(engine, LPFNHOOK);

        if hook != 0 {
            let answer = super::call_hook(engine, hook, hwnd, message, wparam, lparam).await?;

            if answer != 0 {
                return Ok(Answer::Word(answer));
            }
        }
    } else if shared_hook != 0 && message != WM_INITDIALOG {
        let answer = super::call_hook(engine, shared_hook, hwnd, message, wparam, lparam).await?;

        if answer != 0 {
            return Ok(Answer::Word(answer));
        }
    }

    Ok(Answer::Word(match message {
        WM_INITDIALOG => {
            engine.system().commdlg.files.hook = 0;

            // Save As's caption and its types' label, unless the program's
            // template is used (seg2 `4523`).
            if save
                && Ofn(lparam).flags(engine) & (OFN_ENABLETEMPLATE | OFN_ENABLETEMPLATEHANDLE) == 0
            {
                api::api(
                    engine,
                    "USER",
                    "SetWindowText",
                    &[Arg::W(hwnd), text(&commdlg_string(0x181))],
                )
                .await?;
                set_item_text(engine, hwnd, STC_TYPES, &commdlg_string(0x182)).await?;
            }

            engine.system().commdlg.initialising = true;

            let answer = init(engine, hwnd, wparam, lparam).await;

            engine.system().commdlg.initialising = false;
            super::wait_cursor(&mut engine.system(), false);
            answer?
        }
        WM_COMMAND => super::file_command::command(engine, hwnd, wparam, lparam, save).await?,
        WM_ACTIVATE => {
            let (prompting, first) = {
                let system = engine.system();

                (
                    system.commdlg.files.prompting,
                    system.commdlg.files.first_activate,
                )
            };

            if !prompting {
                if first {
                    engine.system().commdlg.files.first_activate = false;
                } else if wparam != 0 {
                    refresh_drives(engine, hwnd).await?;
                }
            }

            0
        }
        WM_SYSCOLORCHANGE => {
            colors_changed(engine).await?;
            1
        }
        WM_MEASUREITEM => {
            measure_item(engine, hwnd, lparam).await?;
            1
        }
        WM_DRAWITEM => {
            if save || engine.system().commdlg.files.redraw_off == 0 {
                draw_item(engine, hwnd, lparam, save).await?;
            }

            1
        }
        _ => 0,
    }))
}

/// The system's colours changed: read again, and the pictures made again
/// for them (seg2 `43ee`).
async fn colors_changed(engine: &Engine) -> Result<(), Stop> {
    super::file_lists::colors_and_pictures(engine).await
}

/// `WM_INITDIALOG` (seg2 `1153`): the box's block, the controls set up
/// from the structure, the lists filled, and the hook told.
#[allow(clippy::too_many_lines)]
async fn init(engine: &Engine, hwnd: u16, wparam: u16, far: u32) -> Result<u16, Stop> {
    let ofn = Ofn(far);
    let mut data = FileDialog {
        ofn: far,
        ..FileDialog::default()
    };

    // USER's procedures, which the subclasses hand on to (seg2 `1192`).
    let list_proc = class_proc(engine, hwnd, LST_FOLDERS).await?;
    let button_proc = class_proc(engine, hwnd, IDOK).await?;

    {
        let mut system = engine.system();

        system.commdlg.files.list_proc = list_proc;
        system.commdlg.files.button_proc = button_proc;
    }

    if list_proc == 0 || button_proc == 0 {
        return fail(engine, hwnd, FNERR_SUBCLASSFAILURE).await;
    }

    let mut flags = ofn.flags(engine);

    if flags & OFN_NOCHANGEDIR != 0 {
        data.saved = super::file_lists::current_directory(engine).unwrap_or_default();
    }

    // The program's file name, lowered, checked (seg2 `1220`).
    if let Some(mut file) = ofn
        .string(engine, LPSTRFILE)
        .filter(|file| !file.is_empty())
        && flags & OFN_NOVALIDATE == 0
    {
        {
            lower(&mut file);

            if file.get(2..4) == Some(b"\\\\") && file.get(1) == Some(&b':') {
                file.drain(..2);
            }

            // Changed in the program's own buffer, as the parser changes it.
            let mut name = file.clone();

            name.push(0);

            let (offset, at) = parse_file(&mut name);
            let far = ofn.dword(engine, LPSTRFILE);

            engine.system().write_far(far, &name);

            if offset < 0 && offset != EMPTY && name.get(usize::from(at)) != Some(&b';') {
                return fail(engine, hwnd, FNERR_INVALIDFILENAME).await;
            }
        }
    }

    if let Some(directory) = ofn.string(engine, LPSTRINITIALDIR) {
        super::file_lists::change_directory(engine, &directory, true);
    }

    if flags & OFN_ENABLEHOOK != 0 {
        if ofn.dword(engine, LPFNHOOK) == 0 {
            return fail(engine, hwnd, CDERR_NOHOOK).await;
        }
    } else {
        ofn.set_dword(engine, LPFNHOOK, 0);
    }

    // The block is the box's from now: its hook is sent all it is sent.
    flags &= 0x8fff_ffff;
    ofn.set_flags(engine, flags);
    engine.system().commdlg.files.dialogs.insert(hwnd, data);

    if flags & OFN_SHOWHELP == 0 {
        let help = item(engine, hwnd, PSH_HELP).await?;

        api::api(
            engine,
            "USER",
            "ShowWindow",
            &[Arg::W(help), Arg::W(SW_HIDE)],
        )
        .await?;
        api::api(engine, "USER", "EnableWindow", &[Arg::W(help), Arg::W(0)]).await?;
    }

    if flags & OFN_CREATEPROMPT != 0 {
        flags |= OFN_PATHMUSTEXIST | OFN_FILEMUSTEXIST;
    } else if flags & OFN_FILEMUSTEXIST != 0 {
        flags |= OFN_PATHMUSTEXIST;
    }

    ofn.set_flags(engine, flags);

    if flags & OFN_HIDEREADONLY != 0 {
        let check = item(engine, hwnd, CHX_READONLY).await?;

        api::api(
            engine,
            "USER",
            "ShowWindow",
            &[Arg::W(check), Arg::W(SW_HIDE)],
        )
        .await?;
        api::api(engine, "USER", "EnableWindow", &[Arg::W(check), Arg::W(0)]).await?;
    } else {
        api::api(
            engine,
            "USER",
            "CheckDlgButton",
            &[
                Arg::W(hwnd),
                Arg::W(CHX_READONLY),
                Arg::W(u16::from(flags & OFN_READONLY != 0)),
            ],
        )
        .await?;
    }

    send_item(engine, hwnd, EDT_NAME, EM_LIMITTEXT, 0x100, 0).await?;
    send_item(engine, hwnd, CMB_TYPES, CB_SETEXTENDEDUI, 1, 0).await?;
    send_item(engine, hwnd, CMB_DRIVES, CB_SETEXTENDEDUI, 1, 0).await?;

    let file = ofn.string(engine, LPSTRFILE);

    with_dialog(engine, hwnd, |data| {
        data.spec = file
            .clone()
            .filter(|file| has_wildcard(file))
            .unwrap_or_default();
    });

    // The custom filter, first among the types (seg2 `1587`).
    let custom = ofn.dword(engine, LPSTRCUSTOMFILTER);
    let custom_given = custom != 0 && !engine.system().read_string(custom).is_empty();

    if custom_given {
        let description = engine.system().read_string(custom);

        api::send_item_bytes(
            engine,
            hwnd,
            CMB_TYPES,
            CB_INSERTSTRING,
            0,
            text(&description),
        )
        .await?;
        send_item(
            engine,
            hwnd,
            CMB_TYPES,
            CB_SETITEMDATA,
            0,
            description.len() as u32 + 1,
        )
        .await?;
        send_item(
            engine,
            hwnd,
            CMB_TYPES,
            CB_LIMITTEXT,
            ofn.word(engine, NMAXCUSTFILTER),
            0,
        )
        .await?;

        let pattern = custom_pattern(engine, custom);

        with_dialog(engine, hwnd, |data| {
            if data.spec.is_empty() {
                data.spec.clone_from(&pattern);
            }
        });
    } else {
        let index = ofn.dword(engine, NFILTERINDEX).wrapping_sub(1);

        ofn.set_dword(engine, NFILTERINDEX, index);
    }

    // The types (seg2 `1646`).
    let filter = ofn.dword(engine, LPSTRFILTER);

    if filter != 0 {
        let last = add_filters(engine, hwnd, filter).await?;
        let index = ofn.dword(engine, NFILTERINDEX);

        if index > u32::from(last) || (index as u16 as i16) < 0 {
            ofn.set_dword(engine, NFILTERINDEX, 0);
        }
    } else {
        ofn.set_dword(engine, NFILTERINDEX, 0);
    }

    if filter != 0 || custom_given {
        let index = ofn.word(engine, NFILTERINDEX);

        send_item(engine, hwnd, CMB_TYPES, CB_SETCURSEL, index, 0).await?;

        let types = item(engine, hwnd, CMB_TYPES).await?;

        send(
            engine,
            hwnd,
            WM_COMMAND,
            CMB_TYPES,
            u32::from(TAKE) << 16 | u32::from(types),
        )
        .await?;

        let file = ofn.string(engine, LPSTRFILE).unwrap_or_default();

        if file.is_empty() {
            let index = ofn.word(engine, NFILTERINDEX);
            let pattern = if index == 0 && custom_given {
                custom_pattern(engine, custom)
            } else {
                let offset = send_item(engine, hwnd, CMB_TYPES, CB_GETITEMDATA, index, 0).await?;

                after_string(engine, filter, offset as u16)
            };

            if !pattern.is_empty() {
                let mut pattern = pattern;

                lower(&mut pattern);
                with_dialog(engine, hwnd, |data| {
                    if data.spec.is_empty() {
                        data.spec.clone_from(&pattern);
                    }
                });
                set_item_text(engine, hwnd, EDT_NAME, &pattern).await?;
            }
        }
    }

    // The drives, the current one chosen, and the lists filled for it
    // (seg2 `1818`).
    let drive = super::file_lists::current_drive(engine) + b'a';

    fill_drives(engine, hwnd).await?;
    select_drive(engine, hwnd, drive).await?;

    {
        let mut system = engine.system();

        system.commdlg.files.first_activate = true;
        system.commdlg.files.prompting = false;
    }

    let drives = item(engine, hwnd, CMB_DRIVES).await?;

    send(
        engine,
        hwnd,
        WM_COMMAND,
        CMB_DRIVES,
        u32::from(TAKE) << 16 | u32::from(drives),
    )
    .await?;

    if let Some(file) = ofn
        .string(engine, LPSTRFILE)
        .filter(|file| !file.is_empty())
    {
        set_item_text(engine, hwnd, EDT_NAME, &file).await?;
    }

    // The folders' list and OK subclassed (seg2 `18ad`).
    let (list, ok) = {
        let mut system = engine.system();

        (
            super::proc_address(&mut system, DW_LB_SUBCLASS),
            super::proc_address(&mut system, DW_OK_SUBCLASS),
        )
    };
    let folders = item(engine, hwnd, LST_FOLDERS).await?;
    let button = item(engine, hwnd, IDOK).await?;

    api::api(
        engine,
        "USER",
        "SetWindowLong",
        &[Arg::W(folders), Arg::W(GWL_WNDPROC as u16), Arg::D(list)],
    )
    .await?;
    api::api(
        engine,
        "USER",
        "SetWindowLong",
        &[Arg::W(button), Arg::W(GWL_WNDPROC as u16), Arg::D(ok)],
    )
    .await?;

    if let Some(title) = ofn
        .string(engine, LPSTRTITLE)
        .filter(|title| !title.is_empty())
    {
        api::api(
            engine,
            "USER",
            "SetWindowText",
            &[Arg::W(hwnd), text(&title)],
        )
        .await?;
    }

    // The files' rows' height, until a row is measured (seg2 `191c`).
    if engine.system().commdlg.files.item_height == 0 {
        let files = item(engine, hwnd, LST_FILES).await?;
        let rect = api::api(
            engine,
            "USER",
            "GetClientRect",
            &[Arg::W(files), api::buffer(8)],
        )
        .await?;
        let bottom = i16::from_le_bytes([rect.buffers[0][6], rect.buffers[0][7]]);
        let rows = bottom / 8;

        engine.system().commdlg.files.text_height = if rows == 0 { 8 } else { rows as u16 };
    }

    // COMMDLG's own template: the name as wide as the files' list (seg2
    // `195f`).
    if flags & (OFN_ENABLETEMPLATE | OFN_ENABLETEMPLATEHANDLE) == 0 {
        let files = item(engine, hwnd, LST_FILES).await?;
        let name = item(engine, hwnd, EDT_NAME).await?;
        let list = api::api(
            engine,
            "USER",
            "GetWindowRect",
            &[Arg::W(files), api::buffer(8)],
        )
        .await?;
        let edit = api::api(
            engine,
            "USER",
            "GetWindowRect",
            &[Arg::W(name), api::buffer(8)],
        )
        .await?;
        let list = &list.buffers[0];
        let mut rect = edit.buffers[0].clone();

        rect[0..2].copy_from_slice(&list[0..2]);
        rect[4..6].copy_from_slice(&list[4..6]);

        let left = api::api(
            engine,
            "USER",
            "ScreenToClient",
            &[Arg::W(hwnd), Arg::B(rect[0..4].to_vec())],
        )
        .await?;
        let right = api::api(
            engine,
            "USER",
            "ScreenToClient",
            &[Arg::W(hwnd), Arg::B(rect[4..8].to_vec())],
        )
        .await?;
        let word = |bytes: &[u8], at: usize| i16::from_le_bytes([bytes[at], bytes[at + 1]]);
        let (x, y) = (word(&left.buffers[0], 0), word(&left.buffers[0], 2));
        let (right, bottom) = (word(&right.buffers[0], 0), word(&right.buffers[0], 2));

        api::api(
            engine,
            "USER",
            "SetWindowPos",
            &[
                Arg::W(name),
                Arg::W(0),
                Arg::W(x as u16),
                Arg::W(y as u16),
                Arg::W((right - x) as u16),
                Arg::W((bottom - y) as u16),
                Arg::W(SWP_NOZORDER),
            ],
        )
        .await?;
    }

    let hook = ofn.dword(engine, LPFNHOOK);

    if hook != 0 {
        return super::call_hook(engine, hook, hwnd, WM_INITDIALOG, wparam, far).await;
    }

    Ok(1)
}

/// A class's procedure, by one of the box's controls (`GetClassLong`
/// with `GCL_WNDPROC`).
async fn class_proc(engine: &Engine, hwnd: u16, id: u16) -> Result<u32, Stop> {
    let control = item(engine, hwnd, id).await?;

    Ok(api::api(
        engine,
        "USER",
        "GetClassLong",
        &[Arg::W(control), Arg::W(GCL_WNDPROC as u16)],
    )
    .await?
    .value)
}

/// The box refused as it starts: the error set and the box ended with
/// nought, its block let go.
async fn fail(engine: &Engine, hwnd: u16, code: u32) -> Result<u16, Stop> {
    {
        let mut system = engine.system();

        super::set_error(&mut system, code);
        system.commdlg.files.dialogs.remove(&hwnd);
    }

    engine.end_dialog(hwnd, 0).await?;
    Ok(0)
}

/// The box's block changed.
pub(super) fn with_dialog(engine: &Engine, hwnd: u16, change: impl FnOnce(&mut FileDialog)) {
    if let Some(data) = engine.system().commdlg.files.dialogs.get_mut(&hwnd) {
        change(data);
    }
}

/// The box's block, as it is.
pub(super) fn dialog_of(engine: &Engine, hwnd: u16) -> Option<FileDialog> {
    engine.system().commdlg.files.dialogs.get(&hwnd).cloned()
}

/// The types from the program's filter: each description added, its
/// pattern's offset from the filter's start kept as its data (seg2
/// `469c`). The last one's index.
async fn add_filters(engine: &Engine, hwnd: u16, filter: u32) -> Result<u16, Stop> {
    let mut offset: u16 = 0;
    let mut last = 0;

    loop {
        let description = after_string(engine, filter, offset);

        if description.is_empty() {
            return Ok(last);
        }

        last = api::send_item_bytes(engine, hwnd, CMB_TYPES, CB_ADDSTRING, 0, text(&description))
            .await?
            .word();
        offset = offset.wrapping_add(description.len() as u16 + 1);
        send_item(
            engine,
            hwnd,
            CMB_TYPES,
            CB_SETITEMDATA,
            last,
            u32::from(offset),
        )
        .await?;

        let pattern = after_string(engine, filter, offset);

        offset = offset.wrapping_add(pattern.len() as u16 + 1);
    }
}

/// The folders' list subclassed (`dwLBSubclass`, seg2 `10a5`): losing the
/// focus to anything but OK, its selection goes back to the current
/// folder.
pub(crate) fn dw_lb_subclass(engine: &Engine, args: Args) -> Later<'_> {
    Box::pin(async move {
        let (hwnd, message, wparam, lparam) = read_four(engine, args);

        if message == WM_KILLFOCUS {
            let dialog = api::word(engine, "USER", "GetParent", &[Arg::W(hwnd)]).await?;
            let ok = item(engine, dialog, IDOK).await?;
            let to_ok = wparam == ok;

            engine.system().commdlg.files.ok_from_folders = to_ok;

            if !to_ok && let Some(data) = dialog_of(engine, dialog) {
                send(engine, hwnd, LB_SETCURSEL, data.depth.wrapping_sub(1), 0).await?;
            }
        }

        let proc = engine.system().commdlg.files.list_proc;

        call_window_proc(engine, proc, hwnd, message, wparam, lparam).await
    })
}

/// OK subclassed (`dwOKSubclass`, seg2 `100f`): losing the focus after it
/// took it from the folders' list, their selection goes back to the
/// current folder.
pub(crate) fn dw_ok_subclass(engine: &Engine, args: Args) -> Later<'_> {
    Box::pin(async move {
        let (hwnd, message, wparam, lparam) = read_four(engine, args);

        if message == WM_KILLFOCUS && engine.system().commdlg.files.ok_from_folders {
            let dialog = api::word(engine, "USER", "GetParent", &[Arg::W(hwnd)]).await?;

            if let Some(data) = dialog_of(engine, dialog) {
                send_item(
                    engine,
                    dialog,
                    LST_FOLDERS,
                    LB_SETCURSEL,
                    data.depth.wrapping_sub(1),
                    0,
                )
                .await?;
            }

            engine.system().commdlg.files.ok_from_folders = false;
        }

        let proc = engine.system().commdlg.files.button_proc;

        call_window_proc(engine, proc, hwnd, message, wparam, lparam).await
    })
}

fn read_four(engine: &Engine, mut args: Args) -> (u16, u16, u16, u32) {
    let system = engine.system();

    (
        args.word(&system),
        args.word(&system),
        args.word(&system),
        args.dword(&system),
    )
}

async fn call_window_proc(
    engine: &Engine,
    proc: u32,
    hwnd: u16,
    message: u16,
    wparam: u16,
    lparam: u32,
) -> Result<Answer, Stop> {
    Ok(Answer::Dword(
        api::api(
            engine,
            "USER",
            "CallWindowProc",
            &[
                Arg::D(proc),
                Arg::W(hwnd),
                Arg::W(message),
                Arg::W(wparam),
                Arg::D(lparam),
            ],
        )
        .await?
        .value,
    ))
}
