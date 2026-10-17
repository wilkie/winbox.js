//! COMMDLG's Find and Replace dialogs: `FindText` (11), `ReplaceText`
//! (12) and their procedures, `FindTextDlgProc` (13) and
//! `ReplaceTextDlgProc` (14), which USER calls at COMMDLG's own exports as
//! it would Microsoft's. **Read out** of `COMMDLG.DLL` seg5 and
//! **recorded** by `findrepl`; each step is COMMDLG's, at the address the
//! comments give ([[topic:find-and-replace]] in the knowledge base).

use std::collections::HashMap;

use super::guest_calls::{self as support, A, api};
use crate::call::{Answer, Args, Later, Stop};
use crate::engine::Engine;

const WM_CLOSE: u16 = 0x0010;
const WM_INITDIALOG: u16 = 0x0110;
const WM_COMMAND: u16 = 0x0111;
const WM_GETTEXTLENGTH: u16 = 0x000e;
const EN_CHANGE: u16 = 0x0300;

const IDOK: u16 = 1;
const IDCANCEL: u16 = 2;
const PSH_REPLACE: u16 = 0x400;
const PSH_REPLACE_ALL: u16 = 0x401;
const PSH_HELP: u16 = 0x40e;
const CHX_WHOLE_WORD: u16 = 0x410;
const CHX_MATCH_CASE: u16 = 0x411;
const RAD_UP: u16 = 0x420;
const RAD_DOWN: u16 = 0x421;
const GRP_DIRECTION: u16 = 0x430;
const EDT_FIND: u16 = 0x480;
const EDT_REPLACE: u16 = 0x481;

const FR_DOWN: u32 = 0x1;
const FR_WHOLEWORD: u32 = 0x2;
const FR_MATCHCASE: u32 = 0x4;
const FR_FINDNEXT: u32 = 0x8;
const FR_REPLACE: u32 = 0x10;
const FR_REPLACEALL: u32 = 0x20;
const FR_SHOWHELP: u32 = 0x80;
const FR_ENABLEHOOK: u32 = 0x100;
const FR_ENABLETEMPLATE: u32 = 0x200;
const FR_NOUPDOWN: u32 = 0x400;
const FR_NOMATCHCASE: u32 = 0x800;
const FR_NOWHOLEWORD: u32 = 0x1000;
const FR_ENABLETEMPLATEHANDLE: u32 = 0x2000;
const FR_HIDEUPDOWN: u32 = 0x4000;
const FR_HIDEMATCHCASE: u32 = 0x8000;
const FR_HIDEWHOLEWORD: u32 = 0x1_0000;

const CDERR_STRUCTSIZE: u32 = 0x1;
const CDERR_LOADSTRFAILURE: u32 = 0x5;
const CDERR_FINDRESFAILURE: u32 = 0x6;
const CDERR_LOADRESFAILURE: u32 = 0x7;
const CDERR_LOCKRESFAILURE: u32 = 0x8;
const CDERR_NOHOOK: u32 = 0xb;
const CDERR_REGISTERMSGFAIL: u32 = 0xc;
const FRERR_BUFFERLENGTHZERO: u32 = 0x4001;

const SW_HIDE: u16 = 0;
const SW_SHOWNORMAL: u16 = 1;
const SW_SHOW: u16 = 5;
const RT_DIALOG: u32 = 5;

/// COMMDLG's dialogs 1540 and 1541, Find and Replace.
const FIND_DIALOG: u16 = 0x604;
const REPLACE_DIALOG: u16 = 0x605;

/// The structure's fields, by offset.
const HWND_OWNER: u32 = 0x04;
const H_INSTANCE: u32 = 0x06;
const FLAGS: u32 = 0x08;
const FIND_WHAT: u32 = 0x0c;
const REPLACE_WITH: u32 = 0x10;
const FIND_LENGTH: u32 = 0x14;
const REPLACE_LENGTH: u32 = 0x16;
const HOOK: u32 = 0x1c;
const TEMPLATE_NAME: u32 = 0x20;

/// What COMMDLG keeps for its Find and Replace dialogs in its data.
#[derive(Debug, Default)]
pub(crate) struct FindGlobals {
    /// `[118h]`: the hook, from `FindText` until its dialog's
    /// `WM_INITDIALOG`.
    pending_hook: u32,
    /// `[780h]`: `FINDMSGSTRING`'s message.
    find_message: u16,
    /// Each dialog's structure, by the number under its property A000h --
    /// COMMDLG's four bytes of local memory.
    structures: HashMap<u16, u32>,
}

/// A far pointer `step` bytes further into its segment.
fn at(far: u32, step: u32) -> u32 {
    (far & 0xffff_0000) | (far.wrapping_add(step) & 0xffff)
}

fn word(engine: &Engine, far: u32, step: u32) -> u16 {
    let bytes = engine.system().read_far(at(far, step), 2);

    u16::from_le_bytes([bytes[0], bytes[1]])
}

fn dword(engine: &Engine, far: u32, step: u32) -> u32 {
    let bytes = engine.system().read_far(at(far, step), 4);

    u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
}

fn set_dword(engine: &Engine, far: u32, step: u32, value: u32) {
    engine
        .system()
        .write_far(at(far, step), &value.to_le_bytes());
}

/// A control of the dialog's: nought for none.
async fn item(engine: &Engine, dialog: u16, id: u16) -> Result<u16, Stop> {
    Ok(api(engine, "USER", "GetDlgItem", &[A::W(dialog), A::W(id)]).await? as u16)
}

async fn show(engine: &Engine, hwnd: u16, how: u16) -> Result<(), Stop> {
    api(engine, "USER", "ShowWindow", &[A::W(hwnd), A::W(how)]).await?;
    Ok(())
}

async fn enable(engine: &Engine, hwnd: u16, on: u16) -> Result<(), Stop> {
    api(engine, "USER", "EnableWindow", &[A::W(hwnd), A::W(on)]).await?;
    Ok(())
}

/// The two calls: Find, or Replace (seg5 `0000`, `019c`).
#[allow(clippy::too_many_lines)]
async fn open(engine: &Engine, lpfr: u32, replace: bool) -> Result<u16, Stop> {
    if lpfr == 0 {
        return Ok(0);
    }

    let fail = |code: u32| {
        support::set_extended_error(&mut engine.system(), code);
        Ok(0)
    };

    if dword(engine, lpfr, 0) != 0x24 {
        return fail(CDERR_STRUCTSIZE);
    }

    let owner = word(engine, lpfr, HWND_OWNER);
    let is_window = api(engine, "USER", "IsWindow", &[A::W(owner)]).await? != 0;

    if !is_window
        || dword(engine, lpfr, FIND_WHAT) == 0
        || word(engine, lpfr, FIND_LENGTH) == 0
        || replace
            && (dword(engine, lpfr, REPLACE_WITH) == 0 || word(engine, lpfr, REPLACE_LENGTH) == 0)
    {
        return fail(FRERR_BUFFERLENGTHZERO);
    }

    let flags = dword(engine, lpfr, FLAGS);

    if flags & FR_ENABLEHOOK != 0 {
        if dword(engine, lpfr, HOOK) == 0 {
            return fail(CDERR_NOHOOK);
        }
    } else {
        set_dword(engine, lpfr, HOOK, 0);
    }

    // Replace loads "Close" for Cancel, from its string 40Dh (`0231`).
    if replace && support::string(0x40d).is_none() {
        return fail(CDERR_LOADSTRFAILURE);
    }

    let message = support::registered_message(engine, "commdlg_FindReplace");

    if message == 0 {
        return fail(CDERR_REGISTERMSGFAIL);
    }

    engine.system().commdlg.find.find_message = message;

    // The template: the program's by name, its handle, or COMMDLG's own.
    let instance = support::instance(engine);
    let program = word(engine, lpfr, H_INSTANCE);
    let (handle, own) = if flags & FR_ENABLETEMPLATE != 0 {
        let name = dword(engine, lpfr, TEMPLATE_NAME);
        let found = api(
            engine,
            "KERNEL",
            "FindResource",
            &[A::W(program), A::D(name), A::D(RT_DIALOG)],
        )
        .await? as u16;

        if found == 0 {
            return fail(CDERR_FINDRESFAILURE);
        }

        let loaded = api(
            engine,
            "KERNEL",
            "LoadResource",
            &[A::W(program), A::W(found)],
        )
        .await? as u16;

        if loaded == 0 {
            return fail(CDERR_LOADRESFAILURE);
        }

        (loaded, false)
    } else if flags & FR_ENABLETEMPLATEHANDLE != 0 {
        (program, false)
    } else {
        (0, true)
    };
    let handle = if own {
        let hex = if replace {
            super::templates::REPLACE_TEMPLATE
        } else {
            super::templates::FIND_TEMPLATE
        };

        support::own_template(engine, hex).await?
    } else {
        handle
    };
    let template = api(engine, "KERNEL", "LockResource", &[A::W(handle)]).await?;

    if template == 0 {
        return fail(CDERR_LOCKRESFAILURE);
    }

    support::set_extended_error(&mut engine.system(), 0);
    engine.system().commdlg.find.pending_hook = dword(engine, lpfr, HOOK);

    let proc = support::export_address(engine, if replace { 14 } else { 13 });
    let dialog = api(
        engine,
        "USER",
        "CreateDialogIndirectParam",
        &[
            A::W(instance),
            A::D(template),
            A::W(owner),
            A::D(proc),
            A::D(lpfr),
        ],
    )
    .await? as u16;

    api(engine, "KERNEL", "GlobalUnlock", &[A::W(handle)]).await?;

    if own {
        support::free_template(engine, handle).await?;
    }

    if dialog == 0 {
        engine.system().commdlg.find.pending_hook = 0;
    }

    Ok(dialog)
}

pub fn find_text(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let lpfr = args.dword(&engine.system());

        Ok(Answer::Word(open(engine, lpfr, false).await?))
    })
}

pub fn replace_text(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let lpfr = args.dword(&engine.system());

        Ok(Answer::Word(open(engine, lpfr, true).await?))
    })
}

pub fn find_text_dlg_proc(engine: &Engine, args: Args) -> Later<'_> {
    Box::pin(async move { Ok(Answer::Word(procedure(engine, args, false).await?)) })
}

pub fn replace_text_dlg_proc(engine: &Engine, args: Args) -> Later<'_> {
    Box::pin(async move { Ok(Answer::Word(procedure(engine, args, true).await?)) })
}

/// The dialog's structure, by the number under its property A000h: nought
/// before `WM_INITDIALOG` and after the dialog ends.
fn structure(engine: &Engine, handle: u16) -> u32 {
    engine
        .system()
        .commdlg
        .find
        .structures
        .get(&handle)
        .copied()
        .unwrap_or(0)
}

/// The two dialogs' procedure (seg5 `036d`, `0582`).
#[allow(clippy::too_many_lines)]
async fn procedure(engine: &Engine, mut args: Args, replace: bool) -> Result<u16, Stop> {
    let (dialog, message, wparam, lparam) = {
        let system = engine.system();
        let dialog = args.word(&system);
        let message = args.word(&system);
        let wparam = args.word(&system);
        let lparam = args.dword(&system);

        (dialog, message, wparam, lparam)
    };
    let words = [
        dialog,
        message,
        wparam,
        (lparam >> 16) as u16,
        lparam as u16,
    ];
    let handle = api(engine, "USER", "GetProp", &[A::W(dialog), A::D(0xa000)]).await? as u16;
    let mut lpfr = structure(engine, handle);

    // Once the dialog has its property, the hook first, through the
    // structure; then the one `FindText` left in COMMDLG's data, but for
    // `WM_INITDIALOG`. Before it, neither: the messages USER sends as it
    // makes the dialog (`WM_SETFONT`, `WM_PARENTNOTIFY`) reach no hook
    // (seg5 `0390`, `03ca`).
    if handle != 0 {
        if lpfr != 0 && dword(engine, lpfr, FLAGS) & FR_ENABLEHOOK != 0 {
            let hook = dword(engine, lpfr, HOOK);
            let answer = support::call_hook(engine, hook, &words).await?;

            if answer != 0 {
                return Ok(answer);
            }
        }

        let pending = engine.system().commdlg.find.pending_hook;

        if pending != 0 && message != WM_INITDIALOG {
            let answer = support::call_hook(engine, pending, &words).await?;

            if answer != 0 {
                return Ok(answer);
            }
        }
    }

    match message {
        WM_CLOSE => {
            api(
                engine,
                "USER",
                "SendMessage",
                &[A::W(dialog), A::W(WM_COMMAND), A::W(IDCANCEL), A::D(0)],
            )
            .await?;
            Ok(1)
        }
        WM_INITDIALOG => {
            let handle = support::next_number(engine);

            api(
                engine,
                "USER",
                "SetProp",
                &[A::W(dialog), A::D(0xa000), A::W(handle)],
            )
            .await?;
            engine.system().commdlg.find.pending_hook = 0;
            engine
                .system()
                .commdlg
                .find
                .structures
                .insert(handle, lparam);
            lpfr = lparam;
            start(engine, dialog, lpfr, !replace).await?;

            let answer = if dword(engine, lpfr, FLAGS) & FR_ENABLEHOOK != 0 {
                let hook = dword(engine, lpfr, HOOK);

                support::call_hook(engine, hook, &words).await?
            } else {
                1
            };

            if answer != 0 {
                let how = if replace { SW_SHOW } else { SW_SHOWNORMAL };

                show(engine, dialog, how).await?;
                api(engine, "USER", "UpdateWindow", &[A::W(dialog)]).await?;
            }

            Ok(answer)
        }
        WM_COMMAND => command(engine, dialog, lpfr, wparam, lparam, replace).await,
        _ => Ok(0),
    }
}

/// `WM_COMMAND` (seg5 `04ce`, `06e2`).
async fn command(
    engine: &Engine,
    dialog: u16,
    lpfr: u32,
    id: u16,
    lparam: u32,
    replace: bool,
) -> Result<u16, Stop> {
    let notification = (lparam >> 16) as u16;

    match id {
        IDOK => {
            gather(engine, dialog, lpfr, FR_FINDNEXT, !replace).await?;
            tell_owner(engine, lpfr).await?;
        }
        IDCANCEL | 3 => end(engine, dialog, lpfr).await?,
        PSH_REPLACE | PSH_REPLACE_ALL if replace => {
            let flag = if id == PSH_REPLACE {
                FR_REPLACE
            } else {
                FR_REPLACEALL
            };

            gather(engine, dialog, lpfr, flag, false).await?;

            if tell_owner(engine, lpfr).await? == 1 {
                let cancel = item(engine, dialog, IDCANCEL).await?;
                let close = support::string(0x40d).unwrap_or_default();

                support::set_window_text(engine, cancel, &close).await?;
            }
        }
        PSH_HELP => {
            let help = support::registered_message(engine, "commdlg_help");
            let owner = word(engine, lpfr, HWND_OWNER);

            if help != 0 && owner != 0 {
                api(
                    engine,
                    "USER",
                    "SendMessage",
                    &[A::W(owner), A::W(help), A::W(dialog), A::D(lpfr)],
                )
                .await?;
            }
        }
        EDT_FIND => {
            if notification == EN_CHANGE {
                let length = api(
                    engine,
                    "USER",
                    "SendDlgItemMessage",
                    &[
                        A::W(dialog),
                        A::W(EDT_FIND),
                        A::W(WM_GETTEXTLENGTH),
                        A::W(0),
                        A::D(0),
                    ],
                )
                .await? as u16;
                let ids: &[u16] = if replace {
                    &[IDOK, PSH_REPLACE, PSH_REPLACE_ALL]
                } else {
                    &[IDOK]
                };

                for &each in ids {
                    let control = item(engine, dialog, each).await?;

                    enable(engine, control, length).await?;
                }
            }
        }
        _ => return Ok(0),
    }

    Ok(1)
}

/// The owner sent `FINDMSGSTRING`'s message: its answer.
async fn tell_owner(engine: &Engine, lpfr: u32) -> Result<u32, Stop> {
    let owner = word(engine, lpfr, HWND_OWNER);
    let message = engine.system().commdlg.find.find_message;

    api(
        engine,
        "USER",
        "SendMessage",
        &[A::W(owner), A::W(message), A::W(0), A::D(lpfr)],
    )
    .await
}

/// The dialog ended (seg5 `0831`): `FR_DIALOGTERM` told, its property
/// taken -- its memory not freed -- and its window destroyed.
async fn end(engine: &Engine, dialog: u16, lpfr: u32) -> Result<(), Stop> {
    let flags = dword(engine, lpfr, FLAGS);

    set_dword(engine, lpfr, FLAGS, (flags & !0x38) | 0x40);
    tell_owner(engine, lpfr).await?;
    let handle = api(engine, "USER", "RemoveProp", &[A::W(dialog), A::D(0xa000)]).await? as u16;

    engine.system().commdlg.find.structures.remove(&handle);
    api(engine, "USER", "DestroyWindow", &[A::W(dialog)]).await?;
    Ok(())
}

/// The dialog set from the structure (seg5 `0870`).
#[allow(clippy::too_many_lines)]
async fn start(engine: &Engine, dialog: u16, lpfr: u32, find: bool) -> Result<(), Stop> {
    let text = dword(engine, lpfr, FIND_WHAT);

    api(
        engine,
        "USER",
        "SetDlgItemText",
        &[A::W(dialog), A::W(EDT_FIND), A::D(text)],
    )
    .await?;
    api(
        engine,
        "USER",
        "SendMessage",
        &[
            A::W(dialog),
            A::W(WM_COMMAND),
            A::W(EDT_FIND),
            A::D(u32::from(EN_CHANGE) << 16),
        ],
    )
    .await?;

    let flags = dword(engine, lpfr, FLAGS);

    if flags & FR_SHOWHELP == 0 {
        let help = item(engine, dialog, PSH_HELP).await?;

        show(engine, help, SW_HIDE).await?;
        enable(engine, help, 0).await?;
    }

    // Whole Word, then Match Case: hidden, disabled, checked.
    for (id, hide, disable, check) in [
        (
            CHX_WHOLE_WORD,
            FR_HIDEWHOLEWORD,
            FR_NOWHOLEWORD,
            FR_WHOLEWORD,
        ),
        (
            CHX_MATCH_CASE,
            FR_HIDEMATCHCASE,
            FR_NOMATCHCASE,
            FR_MATCHCASE,
        ),
    ] {
        let flags = dword(engine, lpfr, FLAGS);

        if flags & hide != 0 {
            let control = item(engine, dialog, id).await?;

            show(engine, control, SW_HIDE).await?;
            enable(engine, control, 0).await?;
        } else if flags & disable != 0 {
            let control = item(engine, dialog, id).await?;

            enable(engine, control, 0).await?;
        }

        let checked = u16::from(flags & check != 0);

        api(
            engine,
            "USER",
            "CheckDlgButton",
            &[A::W(dialog), A::W(id), A::W(checked)],
        )
        .await?;
    }

    let flags = dword(engine, lpfr, FLAGS);

    if flags & FR_HIDEUPDOWN != 0 {
        let group = item(engine, dialog, GRP_DIRECTION).await?;

        show(engine, group, SW_HIDE).await?;

        let up = item(engine, dialog, RAD_UP).await?;

        show(engine, up, SW_HIDE).await?;
        enable(engine, up, 0).await?;

        let down = item(engine, dialog, RAD_DOWN).await?;

        show(engine, down, SW_HIDE).await?;
        enable(engine, down, 0).await?;
    } else if flags & FR_NOUPDOWN != 0 {
        let up = item(engine, dialog, RAD_UP).await?;

        enable(engine, up, 0).await?;

        let down = item(engine, dialog, RAD_DOWN).await?;

        enable(engine, down, 0).await?;
    }

    if find {
        let checked = if flags & FR_DOWN != 0 {
            RAD_DOWN
        } else {
            RAD_UP
        };

        api(
            engine,
            "USER",
            "CheckRadioButton",
            &[A::W(dialog), A::W(RAD_UP), A::W(RAD_DOWN), A::W(checked)],
        )
        .await?;
    } else {
        let text = dword(engine, lpfr, REPLACE_WITH);

        api(
            engine,
            "USER",
            "SetDlgItemText",
            &[A::W(dialog), A::W(EDT_REPLACE), A::D(text)],
        )
        .await?;
        api(
            engine,
            "USER",
            "SendMessage",
            &[
                A::W(dialog),
                A::W(WM_COMMAND),
                A::W(EDT_REPLACE),
                A::D(u32::from(EN_CHANGE) << 16),
            ],
        )
        .await?;
    }

    Ok(())
}

/// The structure written as a search is asked for (seg5 `0a89`).
async fn gather(
    engine: &Engine,
    dialog: u16,
    lpfr: u32,
    flag: u32,
    find: bool,
) -> Result<(), Stop> {
    let checked = |id: u16| async move {
        Ok::<bool, Stop>(
            api(
                engine,
                "USER",
                "IsDlgButtonChecked",
                &[A::W(dialog), A::W(id)],
            )
            .await?
                != 0,
        )
    };
    let mut flags = dword(engine, lpfr, FLAGS) & !0x3f;

    set_dword(engine, lpfr, FLAGS, flags);

    if checked(CHX_WHOLE_WORD).await? {
        flags |= FR_WHOLEWORD;
        set_dword(engine, lpfr, FLAGS, flags);
    }

    if checked(CHX_MATCH_CASE).await? {
        flags |= FR_MATCHCASE;
        set_dword(engine, lpfr, FLAGS, flags);
    }

    set_dword(engine, lpfr, FLAGS, flags | flag);
    api(
        engine,
        "USER",
        "GetDlgItemText",
        &[
            A::W(dialog),
            A::W(EDT_FIND),
            A::D(dword(engine, lpfr, FIND_WHAT)),
            A::W(word(engine, lpfr, FIND_LENGTH)),
        ],
    )
    .await?;

    if find {
        if checked(RAD_UP).await? {
            return Ok(());
        }
    } else {
        api(
            engine,
            "USER",
            "GetDlgItemText",
            &[
                A::W(dialog),
                A::W(EDT_REPLACE),
                A::D(dword(engine, lpfr, REPLACE_WITH)),
                A::W(word(engine, lpfr, REPLACE_LENGTH)),
            ],
        )
        .await?;
    }

    let flags = dword(engine, lpfr, FLAGS);

    set_dword(engine, lpfr, FLAGS, flags | FR_DOWN);
    Ok(())
}
