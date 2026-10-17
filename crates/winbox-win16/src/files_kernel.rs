//! KERNEL's files: `OpenFile`, `_lopen` and its kin, and the huge reads,
//! writes and copies, over DOS's files.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

use crate::call::{Answer, Args, Stop};
use crate::search::{directory_of, has_directory};
use crate::system::System;

/// `HFILE_ERROR`, as the TypeScript engine answers it.
const HFILE_ERROR: u16 = 0xffff;

const OF_DELETE: u16 = 0x0200;
const OF_PARSE: u16 = 0x0100;
const OF_SEARCH: u16 = 0x0400;
const OF_VERIFY: u16 = 0x0400;
const OF_PROMPT: u16 = 0x2000;
const OF_CREATE: u16 = 0x1000;
const OF_EXIST: u16 = 0x4000;
const OF_REOPEN: u16 = 0x8000;

fn text(system: &System, far: u32) -> String {
    system
        .read_string(far)
        .iter()
        .map(|&byte| char::from(byte))
        .collect()
}

/// A name read as text, back to its bytes.
fn latin1_bytes(text: &str) -> Vec<u8> {
    text.chars().map(|ch| ch as u8).collect()
}

/// `OpenFile`: a file opened, created, deleted or looked for, as `fuMode`
/// says, and its `OFSTRUCT` filled; the answer, and the name `OF_PROMPT`
/// asks USER's box to say it cannot find, which the caller shows (see
/// `kernel_calls::file_cdr`). As `OpenFile.ts`.
pub fn open_file(system: &mut System, args: &mut Args) -> Result<(Answer, Option<String>), Stop> {
    let name = args.dword(system);
    let buffer = args.dword(system);
    let mode = args.word(system);

    // `OF_REOPEN` opens the file the structure names, from an earlier
    // call, whatever name is given (seg1 `539c`).
    if mode & OF_REOPEN != 0 {
        return Ok((Answer::Word(reopen(system, buffer, mode)), None));
    }

    if name == 0 {
        return Ok((Answer::Word(HFILE_ERROR), None));
    }

    let name = text(system, name);

    if mode & OF_PARSE != 0 {
        parse_into(system, &name, buffer);
        return Ok((Answer::Word(0), None));
    }

    // A name without a directory, or any with `OF_SEARCH`, is looked for
    // where KERNEL looks (`search.rs`), a directory named looked in first;
    // one with a directory is opened there alone (**recorded** by
    // `search`: DOS's error 3 for a directory not there). A file made is
    // not looked for. Not found, the error is 2.
    let mut error = 0;
    let looks = mode & OF_CREATE == 0;
    let target = if looks && (!has_directory(&name) || mode & OF_SEARCH != 0) {
        let slash = name.rfind(['\\', '/', ':']);
        let first = slash.filter(|_| has_directory(&name)).map(|at| {
            let end = if name[at..].starts_with(':') {
                at + 1
            } else {
                at
            };

            whole(system, if end == 0 { "\\" } else { &name[..end] })
        });
        let base = slash.map_or(name.as_str(), |at| &name[at + 1..]);
        let module = system.task_directory();

        match system.search_file(base, module.as_deref(), first.as_deref()) {
            Ok(found) => found,
            Err(code) => {
                error = code;
                name.clone()
            }
        }
    } else {
        whole(system, &name)
    };
    let opened = if error == 0 {
        system.files.open(&target)
    } else {
        None
    };
    let mut handle = opened.map_or(HFILE_ERROR, |handle| handle as u16);
    let mut path = opened
        .and_then(|handle| system.files.resolve(handle))
        .map_or_else(|| name.clone(), |file| file.dos_path.clone());

    if opened.is_none() && error == 0 {
        error = not_there(system, &target);
    }

    if mode & OF_CREATE != 0 {
        if let Some(open) = opened {
            system.files.close(open);
        }

        // A name with no drive is made in the current directory.
        let full = if path.contains(':') {
            path.clone()
        } else if path.starts_with('\\') {
            format!("{}:{path}", system.files.drive)
        } else {
            format!("{}{path}", system.files.path())
        };

        handle = system
            .files
            .create(&full)
            .map_or(HFILE_ERROR, |handle| handle as u16);

        if handle == HFILE_ERROR {
            if error == 0 {
                error = 5;
            }
        } else {
            path = full.to_ascii_uppercase();
            error = 0;

            // KERNEL's own create tells `FileCdr`'s procedure, as 3C01h.
            system.note_file_change(0x3c01, &latin1_bytes(&name), None);
        }
    }

    // Failing, KERNEL leaves in the structure DOS's error and the name as
    // it made it whole before it looked: its own buffer, copied as it gives
    // up (`KRNL386.EXE` seg1 `5490`, `5814`). The count, the fixed disk and
    // the reserved bytes are left as they were (`openfile`). COMMDLG's
    // Save As box finds the path of a file not there yet so; Terminal,
    // handed the name as given, `.\TEST.TRM`, saved its settings as `.TRM`.
    if handle == HFILE_ERROR {
        let whole = made_whole(system, &name);
        let prompt = (mode & OF_PROMPT != 0 && error != 0)
            .then(|| whole[whole.rfind('\\').map_or(0, |at| at + 1)..].to_string())
            .filter(|name| !name.is_empty());

        if buffer != 0 {
            system.write_far(buffer.wrapping_add(2), &error.to_le_bytes());
            write_path(system, buffer, &whole);
        }

        return Ok((Answer::Word(HFILE_ERROR), prompt));
    }

    let stamp = system.handle_stamp(usize::from(handle));

    filled(system, buffer, &path, stamp);

    Ok((
        Answer::Word(closed_as_asked(system, handle, mode, buffer, &name)),
        None,
    ))
}

/// The path into a structure, cut to fit with its nought.
fn write_path(system: &mut System, buffer: u32, path: &str) {
    let mut bytes = latin1_bytes(path);

    bytes.truncate(127);
    bytes.push(0);
    system.write_far(buffer.wrapping_add(8), &bytes);
}

/// The structure of a file opened, or a name parsed (`KRNL386.EXE` seg1
/// `575f`): its count the length of its path and eight, the offset of the
/// path's nought; a fixed disk; no error; the file's date and time in the
/// reserved bytes, the date's word first, as DOS's 5700h answers them; and
/// the path. **Recorded** by `openfile`: 28 for `C:\ORACLE\OFTEST.DAT`.
fn filled(system: &mut System, buffer: u32, path: &str, stamp: Option<(u16, u16)>) {
    if buffer == 0 {
        return;
    }

    let (time, date) = stamp.unwrap_or((0, 0));
    let [date_low, date_high] = date.to_le_bytes();
    let [time_low, time_high] = time.to_le_bytes();

    system.write_far(
        buffer,
        &[
            (path.len() + 8) as u8,
            1,
            0,
            0,
            date_low,
            date_high,
            time_low,
            time_high,
        ],
    );
    write_path(system, buffer, path);
}

/// A file opened for `OF_EXIST` or `OF_DELETE` closed again, and for
/// `OF_DELETE` deleted (`KRNL386.EXE` seg1 `57ce`-`580a`, and `5509` after
/// `OF_REOPEN`). The answer is the handle it was opened as, closed or not:
/// **recorded** by `openfile`, 6 for a file there with the probe's own open
/// as 5, and 7 with another held open too. A delete that fails is DOS's
/// error in the structure and `HFILE_ERROR`.
fn closed_as_asked(system: &mut System, handle: u16, mode: u16, buffer: u32, name: &str) -> u16 {
    if mode & (OF_EXIST | OF_DELETE) == 0 {
        return handle;
    }

    let path = system
        .files
        .resolve(usize::from(handle))
        .map(|file| file.dos_path.clone());

    system.files.close(usize::from(handle));

    if mode & OF_DELETE != 0 {
        let deleted = path.map_or(Err(2), |path| system.delete_path(&path));

        match deleted {
            Ok(()) => system.note_file_change(0x4100, &latin1_bytes(name), None),
            Err(code) => {
                if buffer != 0 {
                    system.write_far(buffer.wrapping_add(2), &code.to_le_bytes());
                }

                return HFILE_ERROR;
            }
        }
    }

    handle
}

/// `OF_REOPEN` (`KRNL386.EXE` seg1 `54ad`): the file the structure names
/// opened again as it is named, or made with `OF_CREATE`, the name given
/// not looked at. Only the reserved bytes are written, the file's date and
/// time; failing, only DOS's error. With `OF_VERIFY` (the bit `OF_SEARCH`
/// is without `OF_REOPEN`) a file whose date or time is not the
/// structure's is closed and answers `HFILE_ERROR` with error nought. Then
/// `OF_EXIST` and `OF_DELETE` as for any open. **Recorded** by `openfile`.
fn reopen(system: &mut System, buffer: u32, mode: u16) -> u16 {
    if buffer == 0 {
        return HFILE_ERROR;
    }

    let path = text(system, buffer.wrapping_add(8));

    if path.is_empty() {
        return HFILE_ERROR;
    }

    let opened = if mode & OF_CREATE != 0 {
        let created = system.files.create(&path);

        if created.is_some() {
            system.note_file_change(0x3c01, &latin1_bytes(&path), None);
        }

        created
    } else {
        system.files.open(&path)
    };
    let Some(handle) = opened else {
        let error = if mode & OF_CREATE != 0 {
            5
        } else {
            not_there(system, &path)
        };

        system.write_far(buffer.wrapping_add(2), &error.to_le_bytes());
        return HFILE_ERROR;
    };
    let (time, date) = system.handle_stamp(handle).unwrap_or((0, 0));
    let mut stamp = [0; 4];

    stamp[..2].copy_from_slice(&date.to_le_bytes());
    stamp[2..].copy_from_slice(&time.to_le_bytes());

    if mode & OF_VERIFY != 0 && system.read_far(buffer.wrapping_add(4), 4) != stamp {
        system.files.close(handle);
        system.write_far(buffer.wrapping_add(2), &[0, 0]);
        return HFILE_ERROR;
    }

    system.write_far(buffer.wrapping_add(4), &stamp);
    closed_as_asked(system, handle as u16, mode, buffer, &path)
}

/// `OF_PARSE`: the name made whole into the structure, and nothing opened
/// -- `OpenFile` answers nought (`KRNL386.EXE` seg1 `53f1`, `575f`, the
/// handle it is given nought). Cardfile parses the file to merge so, and
/// took the handle a file opened left as "Filename not valid". Made whole
/// as it is before a search, capital and with `.` gone: **recorded** by
/// `mmio`, whose `MMIO_PARSE` hands back the structure's path,
/// `C:\oracle\.\mmio.wav` made `C:\ORACLE\MMIO.WAV`. KERNEL keeps in the
/// reserved bytes what DOS's 5700h answers for handle 0, the console
/// (`57bb`): under DOSBox neither nought nor the file's (`openfile`);
/// nought here, as this DOS keeps no date for the console.
fn parse_into(system: &mut System, name: &str, buffer: u32) {
    let path = made_whole(system, name);

    filled(system, buffer, &path, None);
}

/// A path made whole as KERNEL makes it, as text.
fn whole(system: &System, path: &str) -> String {
    system
        .whole_path(&latin1_bytes(path))
        .into_iter()
        .map(char::from)
        .collect()
}

/// A name made whole as `OpenFile` makes it before it looks (`KRNL386.EXE`
/// seg1 `5a34`): on the current drive and in its current directory unless
/// it names them, `/` taken for `\`, `.` and `..` gone, and each letter
/// capital as KERNEL makes it (`83e9`).
fn made_whole(system: &System, name: &str) -> String {
    let whole = system.whole_path(&latin1_bytes(name));
    let (drive, rest) = whole.split_at(2.min(whole.len()));
    let mut parts: Vec<Vec<u8>> = Vec::new();

    for part in rest.split(|&byte| byte == b'\\' || byte == b'/') {
        match part {
            b"" | b"." => {}
            b".." => {
                parts.pop();
            }
            _ => parts.push(part.iter().map(|&byte| capital(byte)).collect()),
        }
    }

    let mut made = drive.to_vec();

    made.push(b'\\');
    made.extend(parts.join(&b'\\'));
    made.into_iter().map(char::from).collect()
}

/// A letter as KERNEL makes it capital: `a` to `z`, and `E0h` to `FEh` but
/// `F7h` (`KRNL386.EXE` seg1 `83e9`).
fn capital(byte: u8) -> u8 {
    match byte {
        b'a'..=b'z' | 0xe0..=0xf6 | 0xf8..=0xfe => byte - 0x20,
        _ => byte,
    }
}

/// DOS's error for a path that opened nothing: 3 for its directory not
/// there, else 2. A directory on no drive mounted counts as there, as the
/// TypeScript engine's file manager lists it empty.
fn not_there(system: &System, path: &str) -> u16 {
    let Some(directory) = directory_of(path) else {
        return 2;
    };

    if directory.len() == 2 && directory.ends_with(':') {
        return 2;
    }

    let parsed = winbox_machine::Files::parse(&directory);

    match parsed.drive {
        Some(letter)
            if system.files.mounted(letter)
                && !system.files.is_directory(letter, &parsed.parts) =>
        {
            3
        }
        _ => 2,
    }
}

/// A file opened from its start: its handle, or `HFILE_ERROR`.
pub fn lopen(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let name = args.dword(system);
    let _mode = args.word(system);

    if name == 0 {
        return Ok(Answer::Word(HFILE_ERROR));
    }

    let path = text(system, name);

    Ok(Answer::Word(
        system
            .files
            .open(&path)
            .map_or(HFILE_ERROR, |handle| handle as u16),
    ))
}

/// Bytes read from a file to a buffer: how many, or `HFILE_ERROR`.
pub fn lread(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = usize::from(args.word(system));
    let buffer = args.dword(system);
    let count = args.word(system);

    if count > 0xfffe {
        return Ok(Answer::Word(HFILE_ERROR));
    }

    let Some(file) = system.files.resolve(handle) else {
        return Ok(Answer::Word(HFILE_ERROR));
    };
    let bytes = file.read(usize::from(count));
    let at = system.linear(buffer);

    // DOS's read with DS:DX the buffer: on from it past offset FFFFh, where
    // its block goes on (`lwrhuge`).
    system.cpu.bus.write(at, &bytes);
    Ok(Answer::Word(bytes.len() as u16))
}

/// A file's position moved, from its start, from where it is, or from its
/// end, the offset added as DOS adds it: the new position, or
/// `HFILE_ERROR` in both words, -1 (**recorded** by `lzfiles`: LZEXPAND's
/// `LZSeek` answers KERNEL's answer for a DOS handle). A position before
/// the start puts the file at its end, as DOSBox does (`dos_seek`).
pub fn llseek(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = usize::from(args.word(system));
    let offset = args.dword(system) as i32;
    let origin = args.signed(system);
    let Some(file) = system.files.resolve(handle) else {
        return Ok(Answer::Dword(u32::MAX));
    };
    let basis = match origin {
        0..=2 => origin as u8,
        _ => return Ok(Answer::Dword(u32::MAX)),
    };

    Ok(Answer::Dword(crate::dos::dos_seek(file, offset, basis)))
}

/// Bytes read from a file, as many as 2 GB, across segments.
pub fn hread(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = usize::from(args.word(system));
    let buffer = args.dword(system);
    let count = args.dword(system);
    let Some(file) = system
        .files
        .resolve(handle)
        .filter(|_| count <= 0x7fff_ffff)
    else {
        return Ok(Answer::Dword(u32::from(HFILE_ERROR)));
    };
    let bytes = file.read(count as usize);
    let at = system.linear(buffer);

    system.cpu.bus.write(at, &bytes);
    Ok(Answer::Dword(bytes.len() as u32))
}

/// Bytes written to a file, as many as 2 GB, across segments.
pub fn hwrite(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = usize::from(args.word(system));
    let buffer = args.dword(system);
    let count = args.dword(system);

    if count > 0x7fff_ffff || system.files.resolve(handle).is_none() {
        return Ok(Answer::Dword(u32::from(HFILE_ERROR)));
    }

    let bytes = system.cpu.bus.read(system.linear(buffer), count as usize);
    let file = system.files.resolve(handle).expect("an open file");

    Ok(Answer::Dword(file.write(&bytes) as u32))
}

/// Bytes copied, as many as 2 GB, across segments, as if through a
/// buffer.
pub fn hmemcpy(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let to = args.dword(system);
    let from = args.dword(system);
    let count = args.dword(system);
    let bytes = system.cpu.bus.read(system.linear(from), count as usize);
    let at = system.linear(to);

    system.cpu.bus.write(at, &bytes);
    Ok(Answer::Nothing)
}
