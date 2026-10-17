//! The Print dialog's procedure, `PrintDlgProc` (21): COMMDLG's dialog
//! 1538 set up from the structure, the printer shown, the checks of OK,
//! Setup... and Help (`COMMDLG.DLL` seg3 `371f`). As `print-proc.ts`.

use super::api::{Arg, buffer};
use super::print_dlg::{
    CB_GETCURSEL, CB_GETITEMDATA, CB_SETEXTENDEDUI, CDERR_MEMLOCKFAILURE, CDERR_NOHOOK, COPIES,
    DEFAULT, DEVICE, DEVMODE, DEVNAMES, DRIVER, EDIT_INTEGER_ONLY, EM_LIMITTEXT, EM_SETSEL, FLAGS,
    FROM_PAGE, GWL_WNDPROC, HDC, MAX_PAGE, MIN_PAGE, OWNER, PD_COLLATE, PD_DISABLEPRINTTOFILE,
    PD_ENABLEPRINTHOOK, PD_ENABLESETUPHOOK, PD_HIDEPRINTTOFILE, PD_NOPAGENUMS, PD_NOSELECTION,
    PD_NOWARNING, PD_PAGENUMS, PD_PRINTTOFILE, PD_SELECTION, PD_SHOWHELP, PD_USEDEVMODECOPIES,
    PDERR_CREATEICFAILURE, PDERR_DEFAULTDIFFERENT, PDERR_DNDMMISMATCH, PDERR_GETDEVMODEFAIL,
    PDERR_INITFAILURE, PDERR_LOADDRVFAILURE, PDERR_NODEFAULTPRN, PORT, PRINT_HOOK,
    PRINT_SETUP_DLG_PROC, QUERYESCSUPPORT, SETCOPYCOUNT, SETUP_HOOK, SW_HIDE, TO_PAGE, WM_COMMAND,
    WM_INITDIALOG, WM_NEXTDLGCTL, call, called, check, check_radio, checked, dev_mode, dialog_data,
    dword, enable, error, export, find_names, flags, free, free_library, give_property, globals,
    hooks, item, let_go, load_driver, lock, make_dc, message_box, name_of, number, printer_line,
    qualities, resource, send, send_item, set_dword, set_error, set_item_int, set_word, show,
    take_property, template, unlock, version, wait, window_args, word,
};
use crate::call::{Answer, Args, Later, Stop};
use crate::engine::Engine;

const IDOK: u16 = 1;
const IDCANCEL: u16 = 2;
const PSH_SETUP: u16 = 0x400;
const PSH_HELP: u16 = 0x40e;
const CHX_PRINT_TO_FILE: u16 = 0x410;
const CHX_COLLATE: u16 = 0x411;
const RAD_ALL: u16 = 0x420;
const RAD_SELECTION: u16 = 0x421;
const RAD_PAGES: u16 = 0x422;
const STC_FROM: u16 = 0x441;
const STC_TO: u16 = 0x442;
const STC_QUALITY: u16 = 0x443;
const STC_PRINTER: u16 = 0x440;
const CMB_QUALITY: u16 = 0x470;
const EDT_FROM: u16 = 0x480;
const EDT_TO: u16 = 0x481;
const EDT_COPIES: u16 = 0x482;
const EN_CHANGE: u16 = 0x0300;

pub fn print_dlg_proc(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let words = window_args(engine, &mut args);

        Ok(Answer::Word(procedure(engine, words).await?))
    })
}

/// The procedure (seg3 `371f`).
async fn procedure(engine: &Engine, words: (u16, u16, u16, u32)) -> Result<u16, Stop> {
    if let Some(answer) = hooks(engine, PRINT_HOOK, words).await? {
        return Ok(answer);
    }

    let (dialog, message, wparam, lparam) = words;

    match message {
        WM_INITDIALOG => {
            globals(engine).hook = 0;

            let answer = start(engine, dialog, wparam, lparam).await?;

            wait(engine, false);
            Ok(answer)
        }
        WM_COMMAND => {
            let number = number(engine, dialog).await?;
            let lppd = dialog_data(engine, number).lppd;

            command(engine, dialog, lppd, wparam, lparam).await
        }
        _ => Ok(0),
    }
}

/// `WM_INITDIALOG` (seg3 `1750`): the dialog set up from the structure, or
/// ended with nought.
#[allow(clippy::too_many_lines)]
async fn start(engine: &Engine, dialog: u16, wparam: u16, lppd: u32) -> Result<u16, Stop> {
    give_property(engine, dialog, lppd).await?;

    'failed: {
        let flags = flags(engine, lppd);

        for (flag, at) in [
            (PD_ENABLEPRINTHOOK, PRINT_HOOK),
            (PD_ENABLESETUPHOOK, SETUP_HOOK),
        ] {
            if flags & flag != 0 {
                if dword(engine, lppd, at) == 0 {
                    set_error(engine, CDERR_NOHOOK);
                    break 'failed;
                }
            } else {
                set_dword(engine, lppd, at, 0);
            }
        }

        if version(engine).await? >= 0x30a {
            send_item(engine, dialog, CMB_QUALITY, CB_SETEXTENDEDUI, 1, 0).await?;
        }

        let bits = find_names(engine, lppd).await?;

        if bits == 0 {
            if error(engine) == PDERR_NODEFAULTPRN && flags & PD_NOWARNING == 0 {
                message_box(engine, dialog, &resource(0x45a), &resource(0x448)).await?;
            }

            break 'failed;
        }

        let handle = word(engine, lppd, DEVNAMES);
        let names = lock(engine, handle).await?;

        if names == 0 {
            set_error(engine, CDERR_MEMLOCKFAILURE);
            break 'failed;
        }

        let wdefault = word(engine, names, DEFAULT);

        set_word(engine, names, DEFAULT, wdefault | bits);

        'unlock: {
            let driver = load_driver(engine, name_of(engine, names, DRIVER)).await?;

            if driver <= 0x20 {
                set_error(engine, PDERR_LOADDRVFAILURE);
                break 'unlock;
            }

            if word(engine, lppd, DEVMODE) == 0 {
                let devmode = dev_mode(engine, dialog, driver, 0, names, false).await?;

                set_word(engine, lppd, DEVMODE, devmode);
            }

            free_library(engine, driver).await?;

            if word(engine, lppd, DEVMODE) == 0xffff {
                set_error(engine, PDERR_GETDEVMODEFAIL);
                set_word(engine, lppd, DEVMODE, 0);
                break 'unlock;
            }

            send_item(engine, dialog, EDT_COPIES, EM_LIMITTEXT, 5, 0).await?;

            if word(engine, lppd, COPIES) == 0 {
                set_word(engine, lppd, COPIES, 1);
            }

            set_item_int(engine, dialog, EDT_COPIES, word(engine, lppd, COPIES)).await?;

            if !show_printer(engine, lppd, dialog).await? {
                break 'unlock;
            }

            let flags = super::print_dlg::flags(engine, lppd);

            if flags & PD_SHOWHELP == 0 {
                enable(engine, dialog, PSH_HELP, false).await?;
                show(engine, dialog, PSH_HELP, SW_HIDE).await?;
            }

            if flags & PD_HIDEPRINTTOFILE != 0 {
                let control = item(engine, dialog, CHX_PRINT_TO_FILE).await?;

                call(
                    engine,
                    "USER",
                    "EnableWindow",
                    &[Arg::W(control), Arg::W(0)],
                )
                .await?;
                call(
                    engine,
                    "USER",
                    "ShowWindow",
                    &[Arg::W(control), Arg::W(SW_HIDE)],
                )
                .await?;
            } else if flags & PD_DISABLEPRINTTOFILE != 0 {
                enable(engine, dialog, CHX_PRINT_TO_FILE, false).await?;
            }

            if flags & PD_PRINTTOFILE != 0 {
                check(engine, dialog, CHX_PRINT_TO_FILE, 1).await?;
            }

            if flags & PD_NOPAGENUMS != 0 {
                for id in [RAD_PAGES, STC_FROM, STC_TO, EDT_FROM, EDT_TO] {
                    enable(engine, dialog, id, false).await?;
                }

                set_dword(engine, lppd, FLAGS, flags & !PD_PAGENUMS);
            } else {
                for (at, id) in [(FROM_PAGE, EDT_FROM), (TO_PAGE, EDT_TO)] {
                    let page = word(engine, lppd, at);

                    if page != 0xffff {
                        set_item_int(engine, dialog, id, page).await?;
                    }
                }
            }

            let flags = super::print_dlg::flags(engine, lppd);

            if flags & PD_NOSELECTION != 0 {
                enable(engine, dialog, RAD_SELECTION, false).await?;
                set_dword(engine, lppd, FLAGS, flags & !PD_SELECTION);
            }

            let flags = super::print_dlg::flags(engine, lppd);
            let range = if flags & PD_PAGENUMS != 0 {
                RAD_PAGES
            } else if flags & PD_SELECTION != 0 {
                RAD_SELECTION
            } else {
                RAD_ALL
            };

            check_radio(engine, dialog, RAD_ALL, RAD_PAGES, range).await?;

            // The three edits subclassed; only the first's own procedure
            // is kept (`1b59`).
            let subclass = export(engine, EDIT_INTEGER_ONLY);

            for id in [EDT_FROM, EDT_TO, EDT_COPIES] {
                let control = item(engine, dialog, id).await?;
                let previous = call(
                    engine,
                    "USER",
                    "SetWindowLong",
                    &[Arg::W(control), Arg::W(GWL_WNDPROC), Arg::D(subclass)],
                )
                .await?;

                if id == EDT_FROM {
                    globals(engine).edit_proc = previous;
                }
            }

            if super::print_dlg::flags(engine, lppd) & PD_ENABLEPRINTHOOK != 0 {
                let hook = dword(engine, lppd, PRINT_HOOK);

                return super::call_hook(engine, hook, dialog, WM_INITDIALOG, wparam, lppd).await;
            }

            unlock(engine, handle).await?;
            return Ok(1);
        }

        // (`1955`)
        unlock(engine, word(engine, lppd, DEVNAMES)).await?;

        let devmode = word(engine, lppd, DEVMODE);

        if devmode != 0 {
            unlock(engine, devmode).await?;
        }
    }

    // (`1974`)
    take_property(engine, dialog).await?;
    call(engine, "USER", "EndDialog", &[Arg::W(dialog), Arg::W(0)]).await?;

    if error(engine) == 0 {
        set_error(engine, PDERR_INITFAILURE);
    }

    Ok(0)
}

/// The printer shown (seg3 `1503`): its qualities and copies from its
/// `DEVMODE`, Collate by whether its driver can count copies, and its
/// line. Whether it was.
pub(super) async fn show_printer(engine: &Engine, lppd: u32, dialog: u16) -> Result<bool, Stop> {
    let handle = word(engine, lppd, DEVNAMES);
    let names = lock(engine, handle).await?;

    if names == 0 {
        set_error(engine, CDERR_MEMLOCKFAILURE);
        return Ok(false);
    }

    let devmode = word(engine, lppd, DEVMODE);
    let mut mode = 0;

    if devmode != 0 {
        mode = lock(engine, devmode).await?;

        if mode == 0 {
            set_error(engine, CDERR_MEMLOCKFAILURE);
            return Ok(false);
        }

        enable(engine, dialog, STC_QUALITY, true).await?;
        enable(engine, dialog, CMB_QUALITY, true).await?;

        let quality = word(engine, mode, 0x3a) as i16;
        let given = if word(engine, mode, 0x20) > 0x300 {
            lppd
        } else {
            0
        };

        qualities(engine, dialog, quality, given).await?;

        let copies = word(engine, mode, 0x36);

        if copies as i16 > 1 {
            set_item_int(engine, dialog, EDT_COPIES, copies).await?;
        }

        unlock(engine, devmode).await?;
    } else {
        enable(engine, dialog, STC_QUALITY, false).await?;
        enable(engine, dialog, CMB_QUALITY, false).await?;
    }

    // An information context of the printer, asked whether its driver
    // counts copies itself (`1631`).
    let ic = call(
        engine,
        "GDI",
        "CreateIC",
        &[
            Arg::D(name_of(engine, names, DRIVER)),
            Arg::D(name_of(engine, names, DEVICE)),
            Arg::D(name_of(engine, names, PORT)),
            Arg::D(mode),
        ],
    )
    .await? as u16;

    set_word(engine, lppd, HDC, ic);

    if ic == 0 {
        set_error(engine, PDERR_CREATEICFAILURE);
        return Ok(false);
    }

    let counts = call(
        engine,
        "GDI",
        "Escape",
        &[
            Arg::W(ic),
            Arg::W(QUERYESCSUPPORT),
            Arg::W(2),
            Arg::B(SETCOPYCOUNT.to_le_bytes().to_vec()),
            Arg::D(0),
        ],
    )
    .await? as u16;

    if counts != 0 {
        enable(engine, dialog, CHX_COLLATE, true).await?;

        if flags(engine, lppd) & PD_COLLATE != 0 {
            check(engine, dialog, CHX_COLLATE, 1).await?;
        }
    } else {
        enable(engine, dialog, CHX_COLLATE, false).await?;
        check(engine, dialog, CHX_COLLATE, 1).await?;

        if flags(engine, lppd) & PD_USEDEVMODECOPIES != 0 {
            set_item_int(engine, dialog, EDT_COPIES, 1).await?;
            enable(engine, dialog, EDT_COPIES, false).await?;
        }
    }

    call(
        engine,
        "GDI",
        "DeleteDC",
        &[Arg::W(word(engine, lppd, HDC))],
    )
    .await?;
    set_word(engine, lppd, HDC, 0);

    let line = printer_line(engine, names).await?;

    api_set_text(engine, dialog, STC_PRINTER, &line).await?;
    unlock(engine, handle).await?;
    Ok(true)
}

async fn api_set_text(engine: &Engine, dialog: u16, id: u16, value: &[u8]) -> Result<(), Stop> {
    super::api::set_item_text(engine, dialog, id, value).await
}

/// `WM_COMMAND` (seg3 `37d7`).
async fn command(
    engine: &Engine,
    dialog: u16,
    lppd: u32,
    id: u16,
    lparam: u32,
) -> Result<u16, Stop> {
    match id {
        IDOK => return ok(engine, dialog, lppd, lparam).await,
        IDCANCEL => {
            // A `DEVNAMES` COMMDLG made let go (`3b0e`).
            let handle = word(engine, lppd, DEVNAMES);
            let names = lock(engine, handle).await?;
            let made = word(engine, names, DEFAULT) & 0x4000 != 0;

            unlock(engine, handle).await?;

            if made {
                free(engine, handle).await?;
                set_word(engine, lppd, DEVNAMES, 0);
            }

            finish(engine, dialog, lppd, id, lparam, 0).await?;
        }
        3 => finish(engine, dialog, lppd, id, lparam, 0).await?,
        PSH_SETUP => setup(engine, dialog, lppd).await?,
        PSH_HELP => {
            let help = super::message(&mut engine.system(), "commdlg_help");
            let owner = word(engine, lppd, OWNER);

            if help != 0 && owner != 0 {
                send(engine, owner, help, dialog, lppd).await?;
            }
        }
        RAD_ALL..=RAD_PAGES => {
            check_radio(engine, dialog, RAD_ALL, RAD_PAGES, id).await?;

            if id == RAD_PAGES {
                let from = item(engine, dialog, EDT_FROM).await?;

                send(engine, dialog, WM_NEXTDLGCTL, from, 1).await?;
            }
        }
        EDT_FROM | EDT_TO if (lparam >> 16) as u16 == EN_CHANGE => {
            check_radio(engine, dialog, RAD_ALL, RAD_PAGES, RAD_PAGES).await?;
        }
        _ => {}
    }

    Ok(0)
}

/// The dialog ended (seg3 `3b6b`): its property taken, the print hook
/// kept for the messages it is still sent, with `WM_COMMAND` 3 `lParam`'s
/// low word as the answer.
async fn finish(
    engine: &Engine,
    dialog: u16,
    lppd: u32,
    id: u16,
    lparam: u32,
    answer: u16,
) -> Result<(), Stop> {
    take_property(engine, dialog).await?;

    if flags(engine, lppd) & PD_ENABLEPRINTHOOK != 0 {
        globals(engine).hook = dword(engine, lppd, PRINT_HOOK);
    }

    let answer = if id == 3 { lparam as u16 } else { answer };

    call(
        engine,
        "USER",
        "EndDialog",
        &[Arg::W(dialog), Arg::W(answer)],
    )
    .await?;
    Ok(())
}

/// `GetDlgItemInt` unsigned: the number and whether it was one.
async fn item_int(engine: &Engine, dialog: u16, id: u16) -> Result<(u16, bool), Stop> {
    let answer = called(
        engine,
        "USER",
        "GetDlgItemInt",
        &[Arg::W(dialog), Arg::W(id), Arg::B(vec![0, 0]), Arg::W(0)],
    )
    .await?;
    let translated = answer.buffers[0][0] != 0 || answer.buffers[0][1] != 0;

    Ok((answer.word(), translated))
}

/// Whether a field has text: `GetDlgItemText` of four bytes.
async fn has_text(engine: &Engine, dialog: u16, id: u16) -> Result<bool, Stop> {
    Ok(called(
        engine,
        "USER",
        "GetDlgItemText",
        &[Arg::W(dialog), Arg::W(id), buffer(4), Arg::W(4)],
    )
    .await?
    .word()
        != 0)
}

/// A field refused (seg3 `1004`): a box of COMMDLG's string with the
/// dialog's caption, then the field with the focus and its text selected.
async fn refuse(engine: &Engine, dialog: u16, id: u16, message: u16) -> Result<u16, Stop> {
    if message != 0 {
        let caption = called(
            engine,
            "USER",
            "GetWindowText",
            &[Arg::W(dialog), buffer(0x100), Arg::W(0x100)],
        )
        .await?
        .string(0);

        message_box(engine, dialog, &resource(message), &caption).await?;
    }

    let control = item(engine, dialog, id).await?;

    send(engine, dialog, WM_NEXTDLGCTL, control, 1).await?;
    send(engine, control, EM_SETSEL, 0, 0xffff_0000).await?;
    Ok(1)
}

/// OK (seg3 `381c`): the copies and the range checked, in that order, and
/// written; the `DEVMODE`'s copies and quality; the context asked for.
#[allow(clippy::too_many_lines)]
async fn ok(engine: &Engine, dialog: u16, lppd: u32, lparam: u32) -> Result<u16, Stop> {
    let mut flags = flags(engine, lppd) & !0x33;

    set_dword(engine, lppd, FLAGS, flags);

    if checked(engine, dialog, CHX_PRINT_TO_FILE).await? != 0 {
        flags |= PD_PRINTTOFILE;
        set_dword(engine, lppd, FLAGS, flags);
    }

    if checked(engine, dialog, CHX_COLLATE).await? != 0 {
        flags |= PD_COLLATE;
        set_dword(engine, lppd, FLAGS, flags);
    }

    let (copies, translated) = item_int(engine, dialog, EDT_COPIES).await?;

    set_word(engine, lppd, COPIES, copies);

    if !translated || copies == 0 {
        // Nought is tested before the text: 458h is never chosen (`3879`).
        let message = if has_text(engine, dialog, EDT_COPIES).await? {
            if copies == 0 { 0x459 } else { 0x458 }
        } else {
            0x457
        };

        return refuse(engine, dialog, EDT_COPIES, message).await;
    }

    if checked(engine, dialog, RAD_SELECTION).await? != 0 {
        set_dword(engine, lppd, FLAGS, flags | PD_SELECTION);
    } else if checked(engine, dialog, RAD_PAGES).await? != 0 {
        set_dword(engine, lppd, FLAGS, flags | PD_PAGENUMS);

        let (from, from_good) = item_int(engine, dialog, EDT_FROM).await?;

        set_word(engine, lppd, FROM_PAGE, from);

        if !from_good && has_text(engine, dialog, EDT_FROM).await? {
            return refuse(engine, dialog, EDT_FROM, 0x454).await;
        }

        let (to, to_good) = item_int(engine, dialog, EDT_TO).await?;

        set_word(engine, lppd, TO_PAGE, to);

        if !to_good && has_text(engine, dialog, EDT_TO).await? {
            return refuse(engine, dialog, EDT_TO, 0x455).await;
        }

        if !from_good && !to_good {
            return refuse(engine, dialog, EDT_FROM, 0x456).await;
        }

        if !from_good {
            set_word(engine, lppd, FROM_PAGE, word(engine, lppd, MIN_PAGE));
        } else if !to_good {
            set_word(engine, lppd, TO_PAGE, word(engine, lppd, MAX_PAGE));
        }

        let (min, max) = (word(engine, lppd, MIN_PAGE), word(engine, lppd, MAX_PAGE));
        let from = word(engine, lppd, FROM_PAGE);

        if min > from {
            return refuse(engine, dialog, EDT_FROM, 0x450).await;
        }

        if max < from {
            return refuse(engine, dialog, EDT_FROM, 0x451).await;
        }

        let to = word(engine, lppd, TO_PAGE);

        if min > to {
            return refuse(engine, dialog, EDT_TO, 0x452).await;
        }

        if max < to {
            return refuse(engine, dialog, EDT_TO, 0x453).await;
        }
    }

    wait(engine, true);

    let handle = word(engine, lppd, DEVNAMES);
    let names = lock(engine, handle).await?;
    let devmode = word(engine, lppd, DEVMODE);
    let mut mode = 0;

    if devmode != 0 {
        mode = lock(engine, devmode).await?;

        if super::print_dlg::flags(engine, lppd) & PD_USEDEVMODECOPIES != 0 {
            set_word(engine, mode, 0x36, word(engine, lppd, COPIES));
            set_word(engine, lppd, COPIES, 1);
        } else {
            set_word(engine, mode, 0x36, 1);
        }
    }

    if devmode != 0 {
        let chosen = send_item(engine, dialog, CMB_QUALITY, CB_GETCURSEL, 0, 0).await? as u16;

        if chosen != 0xffff {
            let data = send_item(engine, dialog, CMB_QUALITY, CB_GETITEMDATA, chosen, 0).await?;

            set_word(engine, mode, 0x3a, data as u16);

            if version(engine).await? >= 0x30a {
                set_word(engine, mode, 0x40, (data >> 16) as u16);
            }
        }

        unlock(engine, devmode).await?;
    }

    make_dc(engine, mode, names, lppd).await?;

    let wdefault = word(engine, names, DEFAULT);

    set_word(engine, names, DEFAULT, wdefault & !0x4000);
    unlock(engine, handle).await?;
    finish(engine, dialog, lppd, IDOK, lparam, 1).await?;
    Ok(0)
}

/// Setup... (seg3 `3bb4`): Print Setup opened on the dialog, again while
/// it ends with `PDERR_DEFAULTDIFFERENT`; the printer shown again once it
/// ends with OK, and the focus to OK.
async fn setup(engine: &Engine, dialog: u16, lppd: u32) -> Result<(), Stop> {
    // A template not found opens nothing, and sets no error (`3bdf`).
    let Ok((handle, from)) = template(engine, lppd, true).await? else {
        return Ok(());
    };
    let mut answer = 0;

    if call(engine, "KERNEL", "LockResource", &[Arg::W(handle)]).await? != 0 {
        loop {
            set_error(engine, 0);

            let instance = super::instance(&engine.system());
            let procedure = export(engine, PRINT_SETUP_DLG_PROC);

            answer = call(
                engine,
                "USER",
                "DialogBoxIndirectParam",
                &[
                    Arg::W(instance),
                    Arg::W(handle),
                    Arg::W(dialog),
                    Arg::D(procedure),
                    Arg::D(lppd),
                ],
            )
            .await? as u16;

            let code = error(engine);

            if code == PDERR_DEFAULTDIFFERENT || code == PDERR_DNDMMISMATCH {
                free(engine, word(engine, lppd, DEVNAMES)).await?;
                set_word(engine, lppd, DEVNAMES, 0);
                set_error(engine, PDERR_DEFAULTDIFFERENT);
            }

            if error(engine) != PDERR_DEFAULTDIFFERENT {
                break;
            }
        }

        unlock(engine, handle).await?;
    }

    let_go(engine, handle, from).await?;

    if answer != 0 {
        show_printer(engine, lppd, dialog).await?;
    }

    let ok = item(engine, dialog, IDOK).await?;

    send(engine, dialog, WM_NEXTDLGCTL, ok, 1).await?;
    Ok(())
}
