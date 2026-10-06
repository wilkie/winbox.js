//! KERNEL's files: `OpenFile`, `_lopen` and its kin, and the huge reads,
//! writes and copies, over DOS's files.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

use std::io::SeekFrom;

use crate::call::{Answer, Args, Stop};
use crate::search::{directory_of, has_directory};
use crate::system::System;

/// `HFILE_ERROR`, as the TypeScript engine answers it.
const HFILE_ERROR: u16 = 0xffff;

const OF_DELETE: u16 = 0x0200;
const OF_SEARCH: u16 = 0x0400;
const OF_CREATE: u16 = 0x1000;
const OF_EXIST: u16 = 0x4000;
const OF_REOPEN: u16 = 0x8000;

/// An `OFSTRUCT`'s size: its count, whether the disk is fixed, DOS's error,
/// four reserved bytes and 128 of path.
const OFSTRUCT_SIZE: u8 = 136;

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

/// A file opened, created, deleted or looked for, as `fuMode` says, and the
/// `OFSTRUCT` filled: its size, a fixed disk, no error, and the file's path.
pub fn open_file(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let name = args.dword(system);
    let buffer = args.dword(system);
    let mode = args.word(system);
    // With `OF_REOPEN`, the file the structure names from an earlier call.
    let reopened = (mode & OF_REOPEN != 0 && buffer != 0)
        .then(|| text(system, buffer.wrapping_add(8)))
        .filter(|path| !path.is_empty());
    let Some(name) = reopened.or_else(|| (name != 0).then(|| text(system, name))) else {
        return Ok(Answer::Word(HFILE_ERROR));
    };
    // A name without a directory, or any with `OF_SEARCH`, is looked for
    // where KERNEL looks (`search.rs`), a directory named looked in first;
    // one with a directory is opened there alone (**recorded** by `search`:
    // DOS's error 3 for a directory not there). A file made, or one opened
    // again by its structure, is not looked for. Not found, the error is 2,
    // and the name stays as given. As `OpenFile.ts`.
    let mut error = 0;
    let looks = mode & (OF_CREATE | OF_REOPEN) == 0;
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

        if handle != HFILE_ERROR {
            path = full.to_ascii_uppercase();

            // KERNEL's own create tells `FileCdr`'s procedure, as 3C01h.
            system.note_file_change(0x3c01, &latin1_bytes(&name), None);
        }
    }

    if mode & OF_DELETE != 0 {
        if let Some(open) = opened {
            system.files.close(open);
        }

        if system.delete_path(&path).is_err() {
            handle = HFILE_ERROR;
        } else {
            system.note_file_change(0x4100, &latin1_bytes(&name), None);
        }
    }

    if mode & OF_EXIST != 0 {
        handle = match opened {
            Some(open) => {
                system.files.close(open);
                1
            }
            None => HFILE_ERROR,
        };
    }

    if buffer != 0 {
        let path = &path.as_bytes()[..path.len().min(127)];
        let mut bytes = path.to_vec();

        bytes.push(0);

        // DOS's error for a file not found: **recorded** by `search`.
        let [low, high] = if handle == HFILE_ERROR { error } else { 0 }.to_le_bytes();

        system.write_far(buffer, &[OFSTRUCT_SIZE, 1, low, high]);
        system.write_far(buffer.wrapping_add(8), &bytes);
    }

    Ok(Answer::Word(handle))
}

/// A path made whole as KERNEL makes it, as text.
fn whole(system: &System, path: &str) -> String {
    system
        .whole_path(&latin1_bytes(path))
        .into_iter()
        .map(char::from)
        .collect()
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

    system.write_far(buffer, &bytes);
    Ok(Answer::Word(bytes.len() as u16))
}

/// A file's position moved, from its start, from where it is, or from its
/// end, the offset added as DOS adds it -- the TypeScript engine takes it
/// from the end: the new position, or `HFILE_ERROR`, as that engine
/// answers it, a word.
pub fn llseek(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = usize::from(args.word(system));
    let offset = args.dword(system) as i32;
    let origin = args.signed(system);
    let Some(file) = system.files.resolve(handle) else {
        return Ok(Answer::Dword(u32::from(HFILE_ERROR)));
    };
    let to = match origin {
        0 => SeekFrom::Start(u64::from(offset as u32)),
        1 => SeekFrom::Current(i64::from(offset)),
        2 => SeekFrom::End(i64::from(offset)),
        _ => return Ok(Answer::Dword(u32::from(HFILE_ERROR))),
    };

    Ok(Answer::Dword(file.seek(to).unwrap_or(0) as u32))
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
