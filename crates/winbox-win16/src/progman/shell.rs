//! What Program Manager's start-up does once its groups are loaded
//! (`PROGMAN.EXE` seg3 `0e15`-`0ee3`): as the shell, the programs
//! `WIN.INI`'s `load=` and `run=` name (`0221`, `0142`); then its command
//! line, the program Windows was started with (`0e23`-`0ec5`); each
//! started by `ShellExecute` in its own directory (seg5 `01b3`). As
//! `src/win16/progman/shell.ts`.
//!
//! Not yet done: the box for a program that could not be started (seg1
//! `00ec`, with strings of `PROGMAN.EXE`'s own), `MinOnRun`'s minimizing of
//! the frame, which is never shown, and the start-up group (`00a6`).

use crate::commdlg::api::{self, Arg};

use super::items::{directory_of, file_part};
use super::main::{D_FRAME, D_INSTANCE, D_SHELL, Pm, R};

/// The directory current as it started (seg3 `0b31`-`0b37`), the Windows
/// directory (`0b3c`-`0b43`), the command line copied (`0e2f`-`0e35`), and
/// a program's directory as it is started (seg6 `0398`).
pub(super) const D_STARTED_IN: u16 = 0x4d6;
pub(super) const D_WINDOWS: u16 = 0x822;
const D_COMMAND: u16 = 0x668;
const D_DIRECTORY: u16 = 0x79a;
/// Set while `ShellExecute` starts a program, and what it answered (seg5
/// `0226`-`025b`); the window of a program it started, nought before
/// (`01c5`).
const D_STARTING: u16 = 0x26;
const D_STARTED: u16 = 0x128;
const D_STARTED_WINDOW: u16 = 0x12c;

/// `ShellExecute`'s answers below 32 as the errors seg5 `0309`'s table
/// makes of them: a string's number, the answer itself where the table
/// sends it to `02d7`, or nought for 15 (`02f5`).
const ERRORS: [u16; 32] = [
    0x3e, 1, 0x3f, 0x35, 0x40, 0x85, 6, 7, 0x3e, 9, 0x75, 11, 0x74, 13, 14, 0, 0x42, 17, 0x76,
    0x96, 0x97, 21, 22, 23, 24, 25, 0x98, 0x43, 0x41, 0x41, 0x41, 0x41,
];

/// A string kept in its data, up to its nought.
fn data_string(pm: &Pm<'_>, offset: u16, size: usize) -> Vec<u8> {
    let bytes = pm.e.system().read_far(pm.at(offset), size);
    let end = bytes.iter().position(|&b| b == 0).unwrap_or(bytes.len());

    bytes[..end].to_vec()
}

/// A string written into its data with its nought.
fn set_data_string(pm: &Pm<'_>, offset: u16, text: &[u8]) {
    pm.e.system()
        .write_far(pm.at(offset), &[text, b"\0"].concat());
}

/// seg5 `0b93` for drive nought: the current drive (DOS 19h, seg5 `0b5a`)
/// and its directory (DOS 47h), `C:\` and the folders after it.
pub(super) async fn current_directory(pm: &Pm<'_>) -> R<Vec<u8>> {
    let (_, ax, _) = super::main::dos(pm, 0x1900, 0, &[]).await?;
    let drive = (ax as u8).wrapping_add(1);
    let (carry, _, folders) = super::main::dos(pm, 0x4700, u16::from(drive), &[0; 0x40]).await?;
    let mut path = vec![drive.wrapping_add(0x40), b':', b'\\'];

    if !carry {
        let end = folders
            .iter()
            .position(|&b| b == 0)
            .unwrap_or(folders.len());

        path.extend_from_slice(&folders[..end]);
    }

    Ok(path)
}

/// seg5 `0bdc`: a path's drive made current where it names one (DOS 0Eh,
/// its letter less `A`, seg5 `0b74`), and the rest, where there is any,
/// made its current directory (DOS 3Bh).
async fn change_to(pm: &Pm<'_>, path: &[u8]) -> R<()> {
    let mut rest = path;

    if path.get(1) == Some(&b':') {
        let drive = path[0].wrapping_sub(b'A');

        super::main::dos(pm, 0x0e00, u16::from(drive), &[]).await?;
        rest = &path[2..];
    }

    if !rest.is_empty() {
        super::main::dos_path(pm, 0x3b00, rest).await?;
    }

    Ok(())
}

/// seg5 `01b3`: a command started -- the hourglass shown, its first word
/// the file and the rest after a space its parameters, by `ShellExecute`
/// from the frame with the directory given, minimized (7) or shown
/// normally (1); the cursor as it was after. Nought where it started, else
/// the error, as `ERRORS` makes it.
async fn execute(pm: &Pm<'_>, command: &[u8], directory: &[u8], minimized: bool) -> R<u16> {
    pm.sd16(D_STARTED_WINDOW, 0);

    let wait = pm.user("LoadCursor", &[Arg::W(0), Arg::D(0x7f02)]).await?;
    let cursor = pm.user("SetCursor", &[Arg::W(wait as u16)]).await? as u16;

    if pm.user("GetSystemMetrics", &[Arg::W(0x13)]).await? as u16 == 0 {
        pm.user("ShowCursor", &[Arg::W(1)]).await?;
    }

    let start = command
        .iter()
        .position(|&b| b != b' ')
        .unwrap_or(command.len());
    let command = &command[start..];
    let (file, parameters) = match command.iter().position(|&b| b == b' ') {
        Some(space) => (&command[..space], &command[space + 1..]),
        None => (command, &b""[..]),
    };

    pm.sd16(D_STARTING, 1);

    let answer = pm
        .call(
            "SHELL",
            "ShellExecute",
            &[
                Arg::W(pm.d16(D_FRAME)),
                Arg::D(0),
                api::text(file),
                api::text(parameters),
                api::text(directory),
                Arg::W(if minimized { 7 } else { 1 }),
            ],
        )
        .await?
        .word();

    pm.sd16(D_STARTED, answer);
    pm.sd16(D_STARTING, 0);

    // Started, `MinOnRun` would minimize the frame (`02dd`-`02f0`), which
    // is never shown.
    let error = if answer < 32 {
        ERRORS[usize::from(answer)]
    } else {
        0
    };

    // `0389`-`03a7`: with no mouse, the cursor's count put back; then the
    // cursor as it was.
    if pm.user("GetSystemMetrics", &[Arg::W(0x13)]).await? as u16 == 0
        && pm.user("ShowCursor", &[Arg::W(0)]).await? as u16 != 0xffff
    {
        pm.user("ShowCursor", &[Arg::W(1)]).await?;
    }

    pm.user("SetCursor", &[Arg::W(cursor)]).await?;
    Ok(error)
}

/// seg3 `0142`: each program of a `load=` or `run=` list -- names apart by
/// a space or a comma -- started from the Windows directory, in its own
/// directory, while there is memory for it (`GetFreeSpace(1000h)` 0FFFFh
/// or more).
async fn start_list(pm: &Pm<'_>, list: &[u8], minimized: bool) -> R<()> {
    if list.is_empty() {
        return Ok(());
    }

    // The box's caption, string 90h (`0156`-`0166`).
    pm.call(
        "USER",
        "LoadString",
        &[
            Arg::W(pm.d16(D_INSTANCE)),
            Arg::W(0x90),
            api::buffer(0x101),
            Arg::W(0x101),
        ],
    )
    .await?;

    let mut at = 0;

    loop {
        let end = list[at..]
            .iter()
            .position(|&b| b == b' ' || b == b',')
            .map_or(list.len(), |end| at + end);
        let name = &list[at..end];

        if pm.kernel("GetFreeSpace", &[Arg::W(0x1000)]).await? < 0xffff {
            return Ok(());
        }

        let directory = directory_of(name);

        set_data_string(pm, D_DIRECTORY, &directory);
        change_to(pm, &data_string(pm, D_WINDOWS, 0x81)).await?;
        // A program not started is told in a box (`01d4`-`0207`): not yet.
        execute(pm, file_part(name), &directory, minimized).await?;

        if end >= list.len() {
            return Ok(());
        }

        at = end + 1;
    }
}

/// `[windows]`' `key=` of `WIN.INI`, read into a buffer of 80h.
async fn win_ini(pm: &Pm<'_>, key: &[u8]) -> R<Vec<u8>> {
    Ok(pm
        .call(
            "KERNEL",
            "GetProfileString",
            &[
                api::text(b"Windows"),
                api::text(key),
                api::text(b""),
                api::buffer(0x80),
                Arg::W(0x80),
            ],
        )
        .await?
        .string(3))
}

/// The end of the start-up (seg3 `0e15`-`0ee3`): as the shell, `load=`'s
/// programs minimized and `run=`'s shown normally (`0221`); then the
/// command line, if there is one, started from the directory current as
/// Program Manager started, in its own directory, and the Windows
/// directory made current after (`0e23`-`0ecd`).
pub(super) async fn start_programs(pm: &Pm<'_>, command_line: &[u8]) -> R<()> {
    if pm.d16(D_SHELL) != 0 {
        let load = win_ini(pm, b"Load").await?;

        start_list(pm, &load, true).await?;

        let run = win_ini(pm, b"Run").await?;

        start_list(pm, &run, false).await?;
    }

    if command_line.is_empty() {
        return Ok(());
    }

    set_data_string(pm, D_COMMAND, command_line);
    change_to(pm, &data_string(pm, D_STARTED_IN, 0x81)).await?;

    let directory = directory_of(command_line);

    set_data_string(pm, D_DIRECTORY, &directory);
    // A command line not started is told in a box (`0e6b`-`0eb9`): not yet.
    execute(pm, file_part(command_line), &directory, false).await?;
    change_to(pm, &data_string(pm, D_WINDOWS, 0x81)).await
}
