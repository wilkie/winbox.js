//! KERNEL's calls answered beside its memory, modules and files: `Catch`
//! and `Throw`, temporary files' names, a local heap shrunk, and starting a
//! program as far as it goes without a second task.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

mod catch_throw;
pub mod file_cdr;
mod temp_files;

pub(crate) use file_cdr::{dos3_call, lcreat, open_file, tells};
pub use temp_files::temp_drive;

use winbox_cpu::DS;
use winbox_machine::index_for;

use crate::call::{Answer, Args, Implementation, Later, Stop};
use crate::engine::Engine;
use crate::shell::programs::locate;
use crate::shell::{Text, text_argument};
use crate::system::System;

/// What KERNEL keeps for these calls.
#[derive(Debug, Clone, Default)]
pub struct KernelCalls {
    pub file_cdr: file_cdr::FileCdr,
}

pub fn implementation(name: &str) -> Option<Implementation> {
    Some(match name {
        "FileCdr" => Implementation::Sync(file_cdr::file_cdr),
        "Catch" => Implementation::Sync(catch_throw::catch),
        "Throw" => Implementation::Sync(catch_throw::throw),
        "GetTempDrive" => Implementation::Sync(temp_files::get_temp_drive),
        "GetTempFileName" => Implementation::Sync(temp_files::get_temp_file_name),
        "WinExec" => Implementation::Sync(win_exec),
        "LoadModule" => Implementation::Async(load_module),
        "LocalShrink" => Implementation::Sync(local_shrink),
        _ => return None,
    })
}

/// A string argument as text, as the TypeScript engine makes one of it: a
/// null pointer empty, a number its digits; `None` for one that cannot be
/// read, which turns the call away.
fn text_of(system: &System, far: u32) -> Option<String> {
    Some(match text_argument(system, far) {
        Text::Refused => return None,
        Text::Null => String::new(),
        Text::Number(number) => number.to_string(),
        Text::Read(bytes) => bytes.iter().map(|&byte| char::from(byte)).collect(),
    })
}

/// A program's file found as `WinExec` and `LoadModule` find it: its name
/// upper case and given `.EXE` where it has no extension, then found as
/// `OpenFile` finds it. DOS's error, 2 for no name or no file and 3 for no
/// path, or where it is.
fn program_file(system: &mut System, name: &str) -> Result<String, u16> {
    let mut name = name.to_uppercase();

    if name.is_empty() {
        return Err(2);
    }

    let part = name.rfind(['\\', ':']).map_or(0, |at| at + 1);

    if !name[part..].contains('.') {
        name.push_str(".EXE");
    }

    locate(system, &name, "")
}

/// Starts a program. **Recorded** by `winexec`, a program of the probe's
/// own started twice:
///
/// * The command line is the program's name, and after a space what the
///   program is given. A name with no extension is given `.EXE`.
/// * The program is found as `OpenFile` finds it; not found, `WinExec`
///   answers the DOS error, 2 for no file and 3 for no path, and 2 for no
///   name.
/// * The new program runs before `WinExec` answers, to the point it waits
///   for a message with none waiting; `WinExec` answers its instance.
///
/// The program found is a second task, which this engine does not run yet:
/// it stops there.
fn win_exec(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);
    let _show = args.word(system);
    let Some(text) = text_of(system, far) else {
        return Ok(Answer::Word(0));
    };
    let text = text.trim_start_matches(' ');
    let name = text.split(' ').next().unwrap_or("");

    match program_file(system, name) {
        Ok(_) => Err(Stop::Unsupported("WinExec starting a program")),
        Err(error) => Ok(Answer::Word(error)),
    }
}

/// Starts a program with a parameter block, as `WinExec` does with a
/// command line (**recorded** by `tasks2`); a block of -1 loads a library
/// instead, as `LoadLibrary` does. The program found is a second task, and
/// stops as `WinExec`'s does.
fn load_module(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (name, block) = {
            let system = engine.system();
            let far = args.dword(&system);
            let block = args.dword(&system);
            let Some(name) = text_of(&system, far) else {
                return Ok(Answer::Word(0));
            };

            (name, block)
        };

        if block == 0xffff_ffff {
            return Ok(Answer::Word(
                crate::modules_kernel::load_library_named(engine, &name).await?,
            ));
        }

        match program_file(&mut engine.system(), &name) {
            Ok(_) => Err(Stop::Unsupported("LoadModule starting a program")),
            Err(error) => Ok(Answer::Word(error)),
        }
    })
}

/// A local heap shrunk as far as what is in it allows. **Read out of
/// `KRNL386.EXE`**: it answers the heap's span, from its first arena to
/// past its last, which is not what `LocalCompact` answers -- **recorded**
/// by `minis3` for the caller's own heap. A segment of nought is the
/// caller's data segment.
///
/// The local heaps here do not shrink, as the TypeScript engine's do not:
/// it answers the heap's size, nought for no heap.
fn local_shrink(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let segment = args.word(system);
    let _size = args.word(system);
    let segment = if segment == 0 {
        system.cpu.segments[DS].selector
    } else {
        segment
    };
    let size = system
        .heaps
        .get(&index_for(segment))
        .map_or(0, |heap| heap.size() as u16);

    Ok(Answer::Word(size))
}
