//! An item run as `PROGMAN.EXE` runs one (`kb/topics/program-manager-dde.md`,
//! "Running an item"): the frame's `WM_COMMAND` (seg2 `28d3`, seg5 `05cc`),
//! File Open of the current group's first item (`067d`-`06ba`), the item
//! started (`03e7`-`05c9`), and Program Manager's boxes (seg1 `00ec`) with
//! the strings they take from `PROGMAN.EXE`'s string table, kept here by
//! their numbers. Recorded by `pmitem`.

use super::dde::{D_QUIET, describe};
use super::loaded;
use super::main::{D_CLIENT, D_FRAME, Pm, R};
use super::shell::{D_WINDOWS, change_to, current_directory, data_string, execute};
use crate::commdlg::api::{self, Arg};

/// `PROGMAN.EXE`'s strings its item boxes show, by their numbers in its
/// string table (read with `scripts/oracle/strings-table.mjs`).
mod strings {
    /// The caption of the box for a working directory not there (seg5 `04e1`).
    pub const INVALID_PATH: u16 = 0x34;
    /// Error 3, no path (seg5 `0274`).
    pub const PATH_INVALID: u16 = 0x35;
    /// The caption of the box for a program not started (seg5 `0597`).
    pub const EXECUTION_ERROR: u16 = 0x3c;
    /// The text for an error below 20h (seg1 `0126`-`014e`).
    pub const DOS_ERROR: u16 = 0x3d;
    pub const NO_MEMORY: u16 = 0x3e;
    pub const NO_FILE: u16 = 0x3f;
    pub const TOO_MANY_FILES: u16 = 0x40;
    pub const NO_ASSOCIATION: u16 = 0x41;
    pub const ONE_COPY: u16 = 0x42;
    pub const CANNOT_OPEN: u16 = 0x43;
    pub const NOT_A_PROGRAM: u16 = 0x74;
    pub const NEWER_WINDOWS: u16 = 0x75;
    pub const NEEDS_WINDOWS: u16 = 0x76;
    pub const ACCESS_DENIED: u16 = 0x85;
    /// The text of the box for a working directory not there (seg5 `04e3`).
    pub const DIRECTORY_INVALID: u16 = 0x8e;
    /// After a `StartUp` item's command (seg5 `0560`).
    pub const IN_STARTUP: u16 = 0x91;
    pub const COMPRESSED: u16 = 0x96;
    pub const DAMAGED_LIBRARY: u16 = 0x97;
    pub const IN_USE: u16 = 0x98;
}

/// A string of `PROGMAN.EXE`'s, by its number; none for one its item boxes
/// do not take.
fn string(id: u16) -> Option<&'static [u8]> {
    use strings::{
        ACCESS_DENIED, CANNOT_OPEN, COMPRESSED, DAMAGED_LIBRARY, DIRECTORY_INVALID, DOS_ERROR,
        EXECUTION_ERROR, IN_STARTUP, IN_USE, INVALID_PATH, NEEDS_WINDOWS, NEWER_WINDOWS,
        NO_ASSOCIATION, NO_FILE, NO_MEMORY, NOT_A_PROGRAM, ONE_COPY, PATH_INVALID, TOO_MANY_FILES,
    };

    Some(match id {
        INVALID_PATH => b"Invalid Path",
        PATH_INVALID => b"The path %s is invalid.",
        EXECUTION_ERROR => b"Application Execution Error",
        DOS_ERROR => b"Unexpected DOS error: %d.",
        NO_MEMORY => {
            b"Insufficient memory to run this application. Quit one or more Windows applications and then try again."
        }
        NO_FILE => {
            b"Cannot find file %s (or one of its components). Check to ensure the path and filename are correct and that all required libraries are available."
        }
        TOO_MANY_FILES => {
            b"Too many other files are currently in use. Quit one or more applications, or increase the FILES command in CONFIG.SYS."
        }
        NO_ASSOCIATION => {
            b"No application is associated with the specified file. Create an association by using File Manager."
        }
        ONE_COPY => b"Cannot start more than one copy of the specified program.",
        CANNOT_OPEN => {
            b"Cannot open file. Start the application used to create this file, and open it from there."
        }
        NOT_A_PROGRAM => b"The specified application is not a Windows or MS-DOS program.",
        NEWER_WINDOWS => b"This application requires a newer version of Microsoft Windows.",
        NEEDS_WINDOWS => b"This application requires Windows.",
        ACCESS_DENIED => b"Access to the specified device, path, or file is denied.",
        DIRECTORY_INVALID => b"The working directory is invalid.",
        IN_STARTUP => b"' specified in the startup group",
        COMPRESSED => {
            b"This program or one of its components is compressed.\n\nUse the MS-DOS Expand command to copy the file from the Windows Setup disks."
        }
        DAMAGED_LIBRARY => {
            b"One of the library files needed to run this application is damaged. Please reinstall this application."
        }
        IN_USE => b"This file is in use by some other application.",
        _ => return None,
    })
}

/// `wsprintf` of a format with one `%s` or `%d`.
fn formatted(format: &[u8], value: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    let mut at = 0;
    let mut used = false;

    while at < format.len() {
        if !used && format[at] == b'%' && matches!(format.get(at + 1), Some(b's' | b'd')) {
            out.extend_from_slice(value);
            used = true;
            at += 2;
        } else {
            out.push(format[at]);
            at += 1;
        }
    }

    out
}

/// Where the box's text and caption are made (seg1 `0107`-`0199`).
const D_BOX_TEXT: u16 = 0x342;
const D_BOX_CAPTION: u16 = 0x6e9;
/// `WM_COMMAND`'s help context: the command and 1388h (seg5 `05ee`-`05fd`).
const D_HELP_CONTEXT: u16 = 0x154;
/// The hot key of the item being started (seg5 `045c`-`0464`).
const D_HOT_KEY: u16 = 0x12a;

/// seg1 `00ec`: a box of Program Manager's -- nothing, answered 1, while a
/// DDE execute runs (`[22h]`, seg7 `0338`); its caption string `caption`;
/// its text string `text`, `value` put in its `%s` where there is one, or
/// for a number below 20h string 3Dh with the number; owned by the last
/// active popup of `owner`; `MessageBox` with `style`. Its answer.
async fn message_box(
    pm: &Pm<'_>,
    owner: u16,
    caption: u16,
    text: u16,
    value: Option<&[u8]>,
    style: u16,
) -> R<u16> {
    if pm.d16(D_QUIET) != 0 {
        return Ok(1);
    }

    let caption = string(caption).unwrap_or_default().to_vec();
    let body = if text < 0x20 {
        formatted(
            string(strings::DOS_ERROR).unwrap_or_default(),
            text.to_string().as_bytes(),
        )
    } else {
        let format = string(text).unwrap_or_default();

        match value {
            Some(value) => formatted(format, value),
            None => format.to_vec(),
        }
    };

    pm.e.system()
        .write_far(pm.at(D_BOX_CAPTION), &[&caption[..], b"\0"].concat());
    pm.e.system()
        .write_far(pm.at(D_BOX_TEXT), &[&body[..], b"\0"].concat());

    let owner = if owner != 0 {
        pm.user("GetLastActivePopup", &[Arg::W(owner)]).await? as u16
    } else {
        owner
    };

    Ok(pm
        .user(
            "MessageBox",
            &[
                Arg::W(owner),
                api::text(&body),
                api::text(&caption),
                Arg::W(style),
            ],
        )
        .await? as u16)
}

/// seg6 `009c`: whether a path's drive is there -- `GetDriveType` of a
/// drive it names neither nought nor 1; a path naming none is.
async fn drive_there(pm: &Pm<'_>, path: &[u8]) -> R<bool> {
    if path.get(1) != Some(&b':') {
        return Ok(true);
    }

    let drive = u16::from(path[0]).wrapping_sub(0x41);
    let kind = pm.kernel("GetDriveType", &[Arg::W(drive)]).await? as u16;

    Ok(kind > 1)
}

/// A string converted by a call of the file's: `AnsiUpper`, `AnsiToOem`,
/// `OemToAnsi`.
async fn converted(pm: &Pm<'_>, module: &str, name: &str, value: &[u8]) -> R<Vec<u8>> {
    let called = if module == "USER" {
        pm.call(module, name, &[api::text(value)]).await?
    } else {
        pm.call(
            module,
            name,
            &[api::text(value), api::buffer(value.len() + 1)],
        )
        .await?
    };

    Ok(if module == "USER" {
        called.string(0)
    } else {
        called.string(1)
    })
}

/// seg5 `03e7`: an item started -- the Windows directory made current; its
/// command and working directory from its group's block (seg4 `2967`);
/// minimized where Shift is held and `shift` asks for that (File Open),
/// else where its tag says; its hot key kept; the environment's variables
/// put into both (`DoEnvironmentSubst`); the directory current kept; the
/// working directory made upper case and tried -- its drive's type, then
/// made current -- and where it is not there, "The working directory is
/// invalid." asked with OK and Cancel, Cancel ending it; the directory
/// kept made current again; then the command started (seg5 `01b3`) in
/// that directory; and where it could not be, the error told in a box, the
/// command's file in it, or for a `StartUp` item the file quoted and string
/// 91h; the directory kept made current again.
pub(super) async fn run_item(
    pm: &Pm<'_>,
    key: u16,
    slot: u16,
    shift: bool,
    start_up: bool,
) -> R<()> {
    let windows = data_string(pm, D_WINDOWS, 0x81);

    change_to(pm, &windows).await?;

    let Some(block) = loaded::lock(pm, key).await? else {
        return Ok(());
    };
    let item = describe(&block, slot);
    let mut minimized = false;

    if shift {
        minimized = pm.user("GetKeyState", &[Arg::W(0x10)]).await? as u16 & 0x8000 != 0;
    }

    if !minimized {
        minimized = item.minimized != 0;
    }

    pm.sd16(D_HOT_KEY, item.hot_key);

    let command = substituted(pm, &item.command, 0x100).await?;
    let mut directory = substituted(pm, &item.directory, 0x80).await?;
    let saved = current_directory(pm).await?;
    let frame = pm.d16(D_FRAME);

    directory = converted(pm, "USER", "AnsiUpper", &directory).await?;
    directory = converted(pm, "KEYBOARD", "AnsiToOem", &directory).await?;

    if !directory.is_empty() {
        let there = drive_there(pm, &directory).await? && change_to(pm, &directory).await? == 0;

        if !there
            && message_box(
                pm,
                frame,
                strings::INVALID_PATH,
                strings::DIRECTORY_INVALID,
                None,
                0x131,
            )
            .await?
                == 2
        {
            change_to(pm, &saved).await?;
            return Ok(());
        }
    }

    change_to(pm, &saved).await?;
    directory = converted(pm, "KEYBOARD", "OemToAnsi", &directory).await?;

    let error = execute(pm, &command, &directory, minimized).await?;

    if error != 0 {
        // `01b3` ends the file at the first space after its leading ones.
        let start = command
            .iter()
            .position(|&b| b != b' ')
            .unwrap_or(command.len());
        let end = command[start..]
            .iter()
            .position(|&b| b == b' ')
            .map_or(command.len(), |end| start + end);
        let mut text = command[..end].to_vec();

        if start_up {
            let mut quoted = b"'".to_vec();

            quoted.extend_from_slice(&text);
            quoted.extend_from_slice(string(strings::IN_STARTUP).unwrap_or_default());
            text = quoted;
        }

        message_box(
            pm,
            frame,
            strings::EXECUTION_ERROR,
            error,
            Some(&text),
            0x1030,
        )
        .await?;
    }

    change_to(pm, &saved).await?;
    Ok(())
}

/// A string's environment variables put in, in a buffer of `size`.
async fn substituted(pm: &Pm<'_>, text: &[u8], size: usize) -> R<Vec<u8>> {
    let mut buffer = text.to_vec();

    buffer.resize(size.max(text.len() + 1), 0);

    Ok(pm
        .call(
            "SHELL",
            "DoEnvironmentSubst",
            &[Arg::B(buffer), Arg::W(size as u16)],
        )
        .await?
        .string(0))
}

/// File Open (seg5 `067d`-`06ba`): with a current group, an icon restored
/// (`SC_RESTORE`), else its first item started, Shift asked after.
async fn open(pm: &Pm<'_>) -> R<()> {
    let current = loaded::with(pm, |groups| groups.current);

    let Some(group) = loaded::group(pm, current) else {
        return Ok(());
    };

    // `03b9`: whether the current group is an icon.
    if pm.user("IsIconic", &[Arg::W(group.hwnd)]).await? as u16 != 0 {
        pm.user(
            "SendMessage",
            &[Arg::W(group.hwnd), Arg::W(0x112), Arg::W(0xf120), Arg::D(0)],
        )
        .await?;
        return Ok(());
    }

    // `[si+6]`: the first item in memory. With none the file would read
    // from a null item; WinBox's starts nothing.
    let Some(first) = group.items.first() else {
        return Ok(());
    };

    run_item(pm, current, first.slot, true, false).await
}

/// File Open's command, the menu's and Enter's, and what a double-click on
/// an item posts (seg2 `1b64`).
const IDM_OPEN: u16 = 102;

/// The frame's `WM_COMMAND` (seg2 `28d3`, seg5 `05cc`): the MDI client
/// asked for its active child, the command's help context kept, and the
/// command done; whether it was one of its own -- else `DefFrameProc`
/// takes it. Of its commands only File Open is done yet.
pub(super) async fn command(pm: &Pm<'_>, wparam: u16) -> R<bool> {
    pm.user(
        "SendMessage",
        &[
            Arg::W(pm.d16(D_CLIENT)),
            Arg::W(0x229),
            Arg::W(0),
            Arg::D(0),
        ],
    )
    .await?;
    pm.sd16(D_HELP_CONTEXT, wparam.wrapping_add(0x1388));
    pm.sd16(D_HELP_CONTEXT + 2, 0);

    match wparam {
        IDM_OPEN => {
            open(pm).await?;
            Ok(true)
        }
        _ => Ok(false),
    }
}
