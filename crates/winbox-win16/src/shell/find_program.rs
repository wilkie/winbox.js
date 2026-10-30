//! SHELL's box for finding a program, "Program Not Found": what
//! `ShellExecute` shows where the program a registry association names
//! cannot be started for want of its file. **Read out** of `SHELL.DLL`
//! (the box's procedure, ordinal 101 `FindExeDlgProc`, seg8 `010e`; the
//! routine that shows it, unnamed ordinal 119, seg8 `0570`; its dialog 200)
//! and **recorded** by `findexe`. As `src/win16/shell/find-program.ts`,
//! which says more of each step.
//!
//! The dialog is WinBox's own, laid out from its controls: no Windows file
//! is shipped and none of its bytes is copied here.

use crate::call::{Answer, Args, Later, Stop};
use crate::commdlg::api::{Arg, api, buffer, item_text, set_item_text, text, word};
use crate::dialog_template::{DialogTemplate, parse_dialog_template};
use crate::dialogs::DialogProc;
use crate::engine::Engine;

const WS_POPUP: u32 = 0x8000_0000;
const WS_CHILD: u32 = 0x4000_0000;
const WS_VISIBLE: u32 = 0x1000_0000;
const WS_CAPTION: u32 = 0x00c0_0000;
const WS_BORDER: u32 = 0x0080_0000;
const WS_SYSMENU: u32 = 0x0008_0000;
const WS_GROUP: u32 = 0x0002_0000;
const WS_TABSTOP: u32 = 0x0001_0000;
const DS_SETFONT: u32 = 0x40;
const DS_MODALFRAME: u32 = 0x80;
const ES_AUTOHSCROLL: u32 = 0x0080;
const ES_OEMCONVERT: u32 = 0x0400;
const BS_DEFPUSHBUTTON: u32 = 1;

const CLASS_BUTTON: u8 = 0x80;
const CLASS_EDIT: u8 = 0x81;
const CLASS_STATIC: u8 = 0x82;

const IDOK: u16 = 1;
const IDCANCEL: u16 = 2;
const ID_LOCATE: u16 = 201;
const ID_FOLDER: u16 = 203;
const ID_HELP: u16 = 204;
const ID_TEXT: u16 = 205;
const ID_LOCATION: u16 = 206;

/// SHELL's ordinal for the box's procedure.
const FIND_EXE_DLG_PROC: u16 = 101;

const STYLE: u32 = WS_POPUP | WS_CAPTION | WS_SYSMENU | DS_MODALFRAME | DS_SETFONT;
const BOX: (u16, u16, u16, u16) = (20, 20, 210, 82);
const CAPTION: &str = "Program Not Found";
const FONT_SIZE: u16 = 8;
const FONT: &str = "MS Sans Serif";

const TEXT_STYLE: u32 = WS_CHILD | WS_VISIBLE | WS_GROUP;
const BUTTON_STYLE: u32 = WS_CHILD | WS_VISIBLE | WS_TABSTOP;

struct Control {
    place: (u16, u16, u16, u16),
    id: u16,
    style: u32,
    class: u8,
    text: &'static str,
}

const CONTROLS: [Control; 7] = [
    Control {
        place: (5, 5, 134, 40),
        id: ID_TEXT,
        style: TEXT_STYLE,
        class: CLASS_STATIC,
        text: "Cannot find %s.\n\nThis program is needed to run files with extension '%s'.",
    },
    Control {
        place: (5, 49, 134, 10),
        id: ID_LOCATION,
        style: TEXT_STYLE,
        class: CLASS_STATIC,
        text: "Location of %s:",
    },
    Control {
        place: (3, 61, 134, 12),
        id: ID_FOLDER,
        style: WS_CHILD | WS_VISIBLE | WS_BORDER | WS_TABSTOP | ES_AUTOHSCROLL | ES_OEMCONVERT,
        class: CLASS_EDIT,
        text: "",
    },
    Control {
        place: (165, 6, 40, 14),
        id: IDOK,
        style: BUTTON_STYLE | BS_DEFPUSHBUTTON,
        class: CLASS_BUTTON,
        text: "OK",
    },
    Control {
        place: (165, 23, 40, 14),
        id: IDCANCEL,
        style: BUTTON_STYLE,
        class: CLASS_BUTTON,
        text: "Cancel",
    },
    Control {
        place: (165, 40, 40, 14),
        id: ID_LOCATE,
        style: BUTTON_STYLE,
        class: CLASS_BUTTON,
        text: "&Locate...",
    },
    Control {
        place: (165, 61, 40, 14),
        id: ID_HELP,
        style: BUTTON_STYLE,
        class: CLASS_BUTTON,
        text: "&Help",
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

/// WIN.INI's section of programs found where they were not (seg13 `0076`).
const PROGRAMS_SECTION: &[u8] = b"programs";
/// The help file the Help button opens (seg13 `0144`), at its topics.
const HELP_FILE: &[u8] = b"progman.hlp";
const HELP_TOPIC: u32 = 0x1b5e;
const HELP_TOPIC_FROM_LOCATE: u32 = 0x1b5f;
const HELP_CONTEXT: u16 = 1;
/// The message `GetOpenFileName`'s Help button sends (seg13 `0150`).
const HELP_MESSAGE: &[u8] = b"commdlg_help";
/// What a program's name is given where it has no extension (seg13 `016e`).
const PROGRAM_EXTENSION: &str = ".exe";
/// SHELL's string for a folder with no such program (`04ee`).
const STRING_NOT_FOUND: u16 = 0xdf;

const WM_INITDIALOG: u16 = 0x0110;
const WM_COMMAND: u16 = 0x0111;
const WM_DESTROY: u16 = 0x0002;
const MB_ICONHAND: u16 = 0x0010;
const OF_EXIST: u16 = 0x4000;
const DWL_USER: u16 = 8;
/// The routine's and the procedure's buffers (`0189`, `047c`).
const BUFFER: u16 = 0x100;

/// The block the routine hands the box: the program's name at 0, the
/// folder at 4, the extension at 8, each a far pointer.
const NAME_AT: u16 = 0;
const FOLDER_AT: u16 = 4;
const EXTENSION_AT: u16 = 8;

/// The answer for the box cancelled (seg8 `0785`).
const CANCELLED: u16 = 15;

fn far_word(engine: &Engine, far: u32, at: u16) -> u16 {
    let address = (far & 0xffff_0000) | u32::from((far as u16).wrapping_add(at));
    let bytes = engine.system().read_far(address, 2);

    u16::from_le_bytes([bytes[0], bytes[1]])
}

fn pointer_at(engine: &Engine, far: u32, at: u16) -> u32 {
    u32::from(far_word(engine, far, at.wrapping_add(2))) << 16
        | u32::from(far_word(engine, far, at))
}

fn read_string(engine: &Engine, far: u32) -> Vec<u8> {
    let mut bytes = engine.system().read_string(far);

    bytes.truncate(usize::from(BUFFER));
    bytes
}

fn write_string(engine: &Engine, far: u32, value: &[u8]) {
    let mut bytes = value.to_vec();

    bytes.push(0);
    engine.system().write_far(far, &bytes);
}

/// `wsprintf` of SHELL's way: each `%s` taken in turn.
fn filled(template: &[u8], values: &[&[u8]]) -> Vec<u8> {
    let mut out = Vec::new();
    let mut next = 0;
    let mut at = 0;

    while at < template.len() {
        if template[at] == b'%' && template.get(at + 1) == Some(&b's') {
            out.extend_from_slice(values.get(next).copied().unwrap_or(&[]));
            next += 1;
            at += 2;
        } else {
            out.push(template[at]);
            at += 1;
        }
    }

    out
}

fn shell_string(id: u16) -> Vec<u8> {
    super::about::STRINGS
        .iter()
        .find(|(number, _)| *number == id)
        .map_or_else(Vec::new, |(_, value)| value.bytes().collect())
}

/// SHELL's ordinal 101, `FindExeDlgProc` (`SHELL.DLL` seg8 `010e`-`056d`).
/// **Recorded** by `findexe`.
pub fn find_exe_dlg_proc(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (dialog, message, wparam, lparam) = {
            let system = engine.system();

            (
                args.word(&system),
                args.word(&system),
                args.word(&system),
                args.dword(&system),
            )
        };

        Ok(Answer::Word(
            answer(engine, dialog, message, wparam, lparam).await?,
        ))
    })
}

async fn answer(
    engine: &Engine,
    dialog: u16,
    message: u16,
    wparam: u16,
    lparam: u32,
) -> Result<u16, Stop> {
    if message == WM_INITDIALOG {
        let name = read_string(engine, pointer_at(engine, lparam, NAME_AT));
        let folder = read_string(engine, pointer_at(engine, lparam, FOLDER_AT));
        let extension = read_string(engine, pointer_at(engine, lparam, EXTENSION_AT));
        let help = word(
            engine,
            "USER",
            "RegisterWindowMessage",
            &[text(HELP_MESSAGE)],
        )
        .await?;

        engine.system().shell.help_message = help;
        api(
            engine,
            "USER",
            "SetWindowLong",
            &[Arg::W(dialog), Arg::W(DWL_USER), Arg::D(lparam)],
        )
        .await?;

        let first = item_text(engine, dialog, ID_TEXT, BUFFER).await?;

        set_item_text(
            engine,
            dialog,
            ID_TEXT,
            &filled(&first, &[&name, &extension]),
        )
        .await?;

        let second = item_text(engine, dialog, ID_LOCATION, BUFFER).await?;

        set_item_text(engine, dialog, ID_LOCATION, &filled(&second, &[&name])).await?;
        set_item_text(engine, dialog, ID_FOLDER, &folder).await?;
        return Ok(1);
    }

    if message == WM_DESTROY {
        return Ok(1);
    }

    if message == WM_COMMAND {
        match wparam {
            ID_HELP => help(engine, dialog, HELP_TOPIC).await?,
            IDOK => accept(engine, dialog).await?,
            IDCANCEL => {
                api(
                    engine,
                    "USER",
                    "EndDialog",
                    &[Arg::W(dialog), Arg::W(wparam)],
                )
                .await?;
            }
            _ => {}
        }

        return Ok(1);
    }

    let help_message = engine.system().shell.help_message;

    if help_message != 0 && message == help_message {
        help(engine, dialog, HELP_TOPIC_FROM_LOCATE).await?;
        return Ok(1);
    }

    Ok(0)
}

async fn help(engine: &Engine, dialog: u16, topic: u32) -> Result<(), Stop> {
    api(
        engine,
        "USER",
        "WinHelp",
        &[
            Arg::W(dialog),
            text(HELP_FILE),
            Arg::W(HELP_CONTEXT),
            Arg::D(topic),
        ],
    )
    .await?;
    Ok(())
}

/// OK (`0458`-`054d`).
async fn accept(engine: &Engine, dialog: u16) -> Result<(), Stop> {
    let block = api(
        engine,
        "USER",
        "GetWindowLong",
        &[Arg::W(dialog), Arg::W(DWL_USER)],
    )
    .await?
    .value;
    let name = read_string(engine, pointer_at(engine, block, NAME_AT));
    let folder_at = pointer_at(engine, block, FOLDER_AT);
    let mut path = item_text(engine, dialog, ID_FOLDER, BUFFER).await?;

    if !matches!(path.last(), Some(b':' | b'\\')) {
        path.push(b'\\');
    }

    path.extend_from_slice(&name);
    write_string(engine, folder_at, &path);

    let found = word(
        engine,
        "KERNEL",
        "OpenFile",
        &[text(&path), buffer(136), Arg::W(OF_EXIST)],
    )
    .await?;

    if found == 0xffff {
        let message = filled(&shell_string(STRING_NOT_FOUND), &[&path]);
        let title = api(
            engine,
            "USER",
            "GetWindowText",
            &[Arg::W(dialog), buffer(usize::from(BUFFER)), Arg::W(BUFFER)],
        )
        .await?
        .string(0);

        word(
            engine,
            "USER",
            "MessageBox",
            &[
                Arg::W(dialog),
                text(&message),
                text(&title),
                Arg::W(MB_ICONHAND),
            ],
        )
        .await?;
        return Ok(());
    }

    word(
        engine,
        "KERNEL",
        "WriteProfileString",
        &[text(PROGRAMS_SECTION), text(&name), text(&path)],
    )
    .await?;
    api(engine, "USER", "EndDialog", &[Arg::W(dialog), Arg::W(IDOK)]).await?;
    Ok(())
}

async fn exists(engine: &Engine, path: &str) -> Result<bool, Stop> {
    Ok(word(
        engine,
        "KERNEL",
        "OpenFile",
        &[text(path.as_bytes()), buffer(136), Arg::W(OF_EXIST)],
    )
    .await?
        != 0xffff)
}

/// SHELL's unnamed ordinal 119 (`SHELL.DLL` seg8 `0570`-`078f`), which
/// `ShellExecute` calls once where `WinExec` of a registry association's
/// command answers 2: the command to start again, or the error to answer.
/// **Recorded** by `findexe`.
#[allow(clippy::too_many_lines)]
pub(crate) async fn locate_program(
    engine: &Engine,
    owner: u16,
    command: &str,
    extension: &str,
) -> Result<Result<String, u16>, Stop> {
    let (program, rest) = match command.find(' ') {
        Some(space) => (&command[..space], &command[space..]),
        None => (command, ""),
    };
    let cut = program.rfind(['\\', ':']).map_or(0, |at| at + 1);
    let mut name = program[cut..].to_string();

    if !name.contains('.') {
        name.push_str(PROGRAM_EXTENSION);
    }

    // The name made `.exe`'s in the program's own string (`061a`-`0635`).
    let written = format!("{}{name}", &program[..cut]);

    if exists(engine, &written).await? {
        return Ok(Err(2));
    }

    let line = api(
        engine,
        "KERNEL",
        "GetProfileString",
        &[
            text(PROGRAMS_SECTION),
            text(name.as_bytes()),
            text(b""),
            buffer(usize::from(BUFFER)),
            Arg::W(BUFFER),
        ],
    )
    .await?
    .string(3);
    let mut folder: String = line.iter().map(|&byte| char::from(byte)).collect();

    if folder.is_empty() {
        let windows = api(
            engine,
            "KERNEL",
            "GetWindowsDirectory",
            &[buffer(0xff), Arg::W(0xff)],
        )
        .await?
        .string(0);

        folder = windows
            .iter()
            .take(3)
            .map(|&byte| char::from(byte))
            .collect();
    } else {
        if exists(engine, &folder).await? {
            return Ok(Ok(format!("{folder}{rest}")));
        }

        if let Some(slash) = folder.rfind('\\') {
            let end = if slash > 0 && folder.as_bytes()[slash - 1] == b':' {
                slash + 1
            } else {
                slash
            };

            folder.truncate(end);
        } else if let Some(colon) = folder.rfind(':') {
            folder.truncate(colon + 1);
        }
    }

    // The block and its strings, where the routine has its locals.
    let size = 12 + 3 * u32::from(BUFFER);
    let handle = word(
        engine,
        "KERNEL",
        "GlobalAlloc",
        &[Arg::W(0x0042), Arg::D(size)],
    )
    .await?;
    let far = api(engine, "KERNEL", "GlobalLock", &[Arg::W(handle)])
        .await?
        .value;
    let at = |offset: u16| (far & 0xffff_0000) | u32::from((far as u16).wrapping_add(offset));

    for (index, offset) in [NAME_AT, FOLDER_AT, EXTENSION_AT].into_iter().enumerate() {
        let pointer = at(12 + index as u16 * BUFFER);

        engine
            .system()
            .write_far(at(offset), &pointer.to_le_bytes());
    }

    write_string(engine, at(12), name.as_bytes());
    write_string(engine, at(12 + BUFFER), folder.as_bytes());
    write_string(engine, at(12 + 2 * BUFFER), extension.as_bytes());

    let (shell, proc) = {
        let mut system = engine.system();
        let kept = system.kept_named("SHELL");
        let shell = kept.map_or(0, |kept| system.kept[kept].instance());
        let proc = kept.map_or(0, |kept| {
            let stubs = system.stubs(kept);

            u32::from(winbox_machine::segment_selector(stubs)) << 16
                | u32::from(crate::system::STEP * (FIND_EXE_DLG_PROC + 1))
        });

        (shell, proc)
    };
    let (owner, disabled, active) = engine.begin_modal(owner).await?;
    let hwnd = engine
        .create_dialog(
            shell,
            &template(),
            owner,
            DialogProc::Guest(proc),
            far,
            true,
        )
        .await?;
    let result = engine.run_modal(hwnd, owner, disabled, active).await? as u16;
    let path: String = read_string(engine, at(12 + BUFFER))
        .iter()
        .map(|&byte| char::from(byte))
        .collect();

    api(engine, "KERNEL", "GlobalUnlock", &[Arg::W(handle)]).await?;
    word(engine, "KERNEL", "GlobalFree", &[Arg::W(handle)]).await?;

    Ok(match result {
        IDOK => Ok(format!("{path}{rest}")),
        IDCANCEL => Err(CANCELLED),
        _ => Err(2),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_template_is_the_find_program_box() {
        let template = template();

        assert_eq!(template.caption, "Program Not Found");
        assert_eq!(template.items.len(), 7);
    }

    #[test]
    fn each_percent_s_is_filled_in_turn() {
        assert_eq!(filled(b"a %s b %s", &[b"1", b"2"]), b"a 1 b 2");
    }
}
