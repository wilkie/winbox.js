//! USER's "Print To File" box: `GetFilePortName`, ordinal 343, which a
//! printer's driver calls for the port `FILE:`. **Read out** of `USER.EXE`
//! (seg1 `9c7c`, the box's procedure `9d0f`, the message helper `9cca`, its
//! dialog 10) and **recorded** by `filport`.
//!
//! The dialog is WinBox's own, laid out from its controls: no Windows file
//! is shipped and none of its bytes is copied here.

use crate::call::{Args, Later, Stop};
use crate::commdlg::api::{Arg, api, item, item_text, send_item, text, word};
use crate::dialog_template::{DialogTemplate, parse_dialog_template};
use crate::dialogs::DialogProc;
use crate::engine::Engine;

const WS_POPUP: u32 = 0x8000_0000;
const WS_CHILD: u32 = 0x4000_0000;
const WS_VISIBLE: u32 = 0x1000_0000;
const WS_CAPTION: u32 = 0x00c0_0000;
const WS_BORDER: u32 = 0x0080_0000;
const WS_SYSMENU: u32 = 0x0008_0000;
const WS_TABSTOP: u32 = 0x0001_0000;
const DS_SETFONT: u32 = 0x40;
const DS_MODALFRAME: u32 = 0x80;
const ES_AUTOHSCROLL: u32 = 0x0080;
const BS_DEFPUSHBUTTON: u32 = 1;

const CLASS_BUTTON: u8 = 0x80;
const CLASS_EDIT: u8 = 0x81;
const CLASS_STATIC: u8 = 0x82;

/// The edit control the file's name is typed in.
const ID_NAME: u16 = 10;
const ID_LABEL: u16 = 101;
const IDOK: u16 = 1;
const IDCANCEL: u16 = 2;
const IDYES: u16 = 6;

const STYLE: u32 = WS_POPUP | WS_CAPTION | WS_SYSMENU | DS_MODALFRAME | DS_SETFONT;
const BOX: (u16, u16, u16, u16) = (97, 60, 200, 52);
const CAPTION: &str = "Print To File";
const FONT_SIZE: u16 = 8;
const FONT: &str = "MS Sans Serif";

struct Control {
    place: (u16, u16, u16, u16),
    id: u16,
    style: u32,
    class: u8,
    text: &'static str,
}

const CONTROLS: [Control; 4] = [
    Control {
        place: (8, 6, 63, 10),
        id: ID_LABEL,
        style: WS_CHILD | WS_VISIBLE,
        class: CLASS_STATIC,
        text: "&Output File Name:",
    },
    Control {
        place: (9, 18, 140, 12),
        id: ID_NAME,
        style: WS_CHILD | WS_VISIBLE | WS_BORDER | WS_TABSTOP | ES_AUTOHSCROLL,
        class: CLASS_EDIT,
        text: "",
    },
    Control {
        place: (160, 6, 35, 14),
        id: IDOK,
        style: WS_CHILD | WS_VISIBLE | WS_TABSTOP | BS_DEFPUSHBUTTON,
        class: CLASS_BUTTON,
        text: "OK",
    },
    Control {
        place: (160, 25, 35, 14),
        id: IDCANCEL,
        style: WS_CHILD | WS_VISIBLE | WS_TABSTOP,
        class: CLASS_BUTTON,
        text: "Cancel",
    },
];

/// The box's `DLGTEMPLATE`, made from its controls.
pub fn build_template() -> Vec<u8> {
    let mut bytes = Vec::new();
    let string = |bytes: &mut Vec<u8>, value: &str| {
        bytes.extend(value.bytes());
        bytes.push(0);
    };

    bytes.extend(STYLE.to_le_bytes());
    bytes.push(CONTROLS.len() as u8);

    for value in [BOX.0, BOX.1, BOX.2, BOX.3] {
        bytes.extend(value.to_le_bytes());
    }

    string(&mut bytes, ""); // menu
    string(&mut bytes, ""); // class
    string(&mut bytes, CAPTION);
    bytes.extend(FONT_SIZE.to_le_bytes());
    string(&mut bytes, FONT);

    for control in &CONTROLS {
        for value in [
            control.place.0,
            control.place.1,
            control.place.2,
            control.place.3,
            control.id,
        ] {
            bytes.extend(value.to_le_bytes());
        }

        bytes.extend(control.style.to_le_bytes());
        bytes.push(control.class);
        string(&mut bytes, control.text);
        bytes.push(0); // no extra data
    }

    bytes
}

fn template() -> DialogTemplate {
    let bytes = build_template();

    parse_dialog_template(|at| bytes.get(at as usize).copied().unwrap_or(0))
}

const WM_INITDIALOG: u16 = 0x0110;
const WM_COMMAND: u16 = 0x0111;
const WM_GETTEXTLENGTH: u16 = 0x000e;
const EM_LIMITTEXT: u16 = 0x0415;
const EN_CHANGE: u32 = 0x0300;

/// The longest name the edit control takes (`9d3b`).
const NAME_LIMIT: u16 = 63;
/// The buffer the name is read into (`9d7a`).
const NAME_BUFFER: u16 = 64;

/// `OpenFile`'s modes: the name tried for writing, then made.
const OF_WRITE: u16 = 0x0001;
const OF_SHARE_EXCLUSIVE: u16 = 0x0010;
const OF_CREATE: u16 = 0x1000;

/// USER's strings: the caption of its questions, the error, the question.
const STRING_CAPTION: u16 = 0x3c;
const STRING_CANNOT_OPEN: u16 = 0x3d;
const STRING_OVERWRITE: u16 = 0x3e;

/// The message boxes' styles (`9da4`, `9dd1`).
const MB_YESNO_ASTERISK: u16 = 0x0044;
const MB_OK_EXCLAMATION: u16 = 0x0030;

/// What `GetFilePortName` answers for Cancel: the spooler's `SP_USERABORT`.
const SP_USERABORT: i16 = -3;

/// The box that is up: the `OFSTRUCT` to fill (USER's 4E0h) and the
/// task's other windows it disabled.
#[derive(Debug, Clone, Default)]
pub struct PrintBox {
    ofs: u32,
    disabled: Vec<u16>,
}

fn string_of(id: u16) -> Vec<u8> {
    crate::user_misc::USER_STRINGS
        .iter()
        .find(|(number, _)| *number == id)
        .map_or_else(Vec::new, |(_, value)| value.bytes().collect())
}

/// The message box the procedure asks with (`9cca`).
async fn ask(engine: &Engine, dialog: u16, id: u16, style: u16) -> Result<u16, Stop> {
    word(
        engine,
        "USER",
        "MessageBox",
        &[
            Arg::W(dialog),
            text(&string_of(id)),
            text(&string_of(STRING_CAPTION)),
            Arg::W(style),
        ],
    )
    .await
}

/// The task's other top-level windows disabled (seg42 `0000`-`006d`).
async fn disable_task(engine: &Engine, dialog: u16) -> Result<Vec<u16>, Stop> {
    let task = word(engine, "KERNEL", "GetCurrentTask", &[]).await?;
    let desktop = word(engine, "USER", "GetDesktopWindow", &[]).await?;
    let mut windows = Vec::new();
    let mut hwnd = word(engine, "USER", "GetWindow", &[Arg::W(desktop), Arg::W(5)]).await?;

    while hwnd != 0 {
        windows.push(hwnd);
        hwnd = word(engine, "USER", "GetWindow", &[Arg::W(hwnd), Arg::W(2)]).await?;
    }

    let mut disabled = Vec::new();

    for each in windows {
        if each != dialog
            && word(engine, "USER", "GetWindowTask", &[Arg::W(each)]).await? == task
            && word(engine, "USER", "IsWindowEnabled", &[Arg::W(each)]).await? != 0
        {
            word(engine, "USER", "EnableWindow", &[Arg::W(each), Arg::W(0)]).await?;
            disabled.push(each);
        }
    }

    Ok(disabled)
}

/// Those windows enabled again (seg42 `0073`).
async fn enable_task(engine: &Engine) -> Result<(), Stop> {
    let disabled = engine
        .system()
        .print_to_file
        .as_mut()
        .map(|state| std::mem::take(&mut state.disabled))
        .unwrap_or_default();

    for each in disabled {
        word(engine, "USER", "EnableWindow", &[Arg::W(each), Arg::W(1)]).await?;
    }

    Ok(())
}

/// The box's procedure (`9d0f`): TRUE for what it answers, else nought.
pub(crate) async fn answer(
    engine: &Engine,
    dialog: u16,
    message: u16,
    wparam: u16,
    lparam: u32,
) -> Result<u32, Stop> {
    if message == WM_INITDIALOG {
        let disabled = disable_task(engine, dialog).await?;

        if let Some(state) = engine.system().print_to_file.as_mut() {
            state.disabled = disabled;
        }

        send_item(engine, dialog, ID_NAME, EM_LIMITTEXT, NAME_LIMIT, 0).await?;

        let ok = item(engine, dialog, IDOK).await?;

        word(engine, "USER", "EnableWindow", &[Arg::W(ok), Arg::W(0)]).await?;
        return Ok(1);
    }

    if message != WM_COMMAND {
        return Ok(0);
    }

    match wparam {
        ID_NAME => {
            if lparam >> 16 == EN_CHANGE {
                let ok = item(engine, dialog, IDOK).await?;

                if ok != 0 {
                    let length =
                        send_item(engine, dialog, ID_NAME, WM_GETTEXTLENGTH, 0, 0).await? as u16;

                    word(
                        engine,
                        "USER",
                        "EnableWindow",
                        &[Arg::W(ok), Arg::W(length)],
                    )
                    .await?;
                }
            }

            Ok(1)
        }
        IDOK => {
            let ofs = engine
                .system()
                .print_to_file
                .as_ref()
                .map_or(0, |state| state.ofs);
            let name = item_text(engine, dialog, ID_NAME, NAME_BUFFER).await?;
            let tried = word(
                engine,
                "KERNEL",
                "OpenFile",
                &[
                    text(&name),
                    Arg::D(ofs),
                    Arg::W(OF_WRITE | OF_SHARE_EXCLUSIVE),
                ],
            )
            .await?;

            if tried != 0xffff {
                word(engine, "KERNEL", "_lclose", &[Arg::W(tried)]).await?;

                if ask(engine, dialog, STRING_OVERWRITE, MB_YESNO_ASTERISK).await? != IDYES {
                    return Ok(1);
                }
            }

            let made = word(
                engine,
                "KERNEL",
                "OpenFile",
                &[text(&name), Arg::D(ofs), Arg::W(OF_CREATE | OF_WRITE)],
            )
            .await?;

            if made == 0xffff {
                ask(engine, dialog, STRING_CANNOT_OPEN, MB_OK_EXCLAMATION).await?;
                return Ok(1);
            }

            word(engine, "KERNEL", "_lclose", &[Arg::W(made)]).await?;
            enable_task(engine).await?;
            api(engine, "USER", "EndDialog", &[Arg::W(dialog), Arg::W(1)]).await?;
            Ok(1)
        }
        IDCANCEL => {
            enable_task(engine).await?;
            api(
                engine,
                "USER",
                "EndDialog",
                &[Arg::W(dialog), Arg::W(SP_USERABORT as u16)],
            )
            .await?;
            Ok(1)
        }
        _ => Ok(0),
    }
}

/// `GetFilePortName` (`USER.EXE` seg1 `9c7c`): -1 while a box is already
/// up; else USER's dialog 10, owned by the active window, and what it ended
/// with -- 1 once the file is made, -3 for Cancel. **Recorded** by
/// `filport`.
pub fn get_file_port_name(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let ofs = args.dword(&engine.system());

        if engine.system().print_to_file.is_some() {
            return Ok(crate::call::Answer::Word(0xffff));
        }

        engine.system().print_to_file = Some(PrintBox {
            ofs,
            disabled: Vec::new(),
        });

        let result = run(engine).await;

        engine.system().print_to_file = None;
        Ok(crate::call::Answer::Word(result? as u16))
    })
}

async fn run(engine: &Engine) -> Result<i16, Stop> {
    let owner = word(engine, "USER", "GetActiveWindow", &[]).await?;
    let user = {
        let system = engine.system();

        system
            .kept_named("USER")
            .map_or(0, |kept| system.kept[kept].instance())
    };
    let (owner, disabled, active) = engine.begin_modal(owner).await?;
    let hwnd = engine
        .create_dialog(user, &template(), owner, DialogProc::PrintToFile, 0, true)
        .await?;

    engine.run_modal(hwnd, owner, disabled, active).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_template_is_the_print_to_file_box() {
        let template = template();

        assert_eq!(template.caption, "Print To File");
        assert_eq!(template.items.len(), 4);
        assert!(template.items.iter().any(|item| item.id == ID_NAME));
        // Its items in order.
        assert_eq!(
            template
                .items
                .iter()
                .map(|item| item.id)
                .collect::<Vec<_>>(),
            [101, 10, 1, 2]
        );
    }

    /// Laid out from named constants, it is `USER.EXE`'s dialog 10 byte for
    /// byte, where the oracle's installation is here.
    #[test]
    fn the_template_is_in_user_exes_dialog_10() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../oracle/build/drive-c/WINDOWS/SYSTEM/USER.EXE");
        let Ok(file) = std::fs::read(path) else {
            return;
        };
        let template = build_template();

        assert!(
            file.windows(template.len())
                .any(|window| window == template.as_slice())
        );
    }
}
