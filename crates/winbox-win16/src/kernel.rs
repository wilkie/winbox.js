//! KERNEL's functions, as far as the Rust engine answers them.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

use winbox_cpu::{BP, BX, CX, DI, DS, DX, ES, SI, SP, SS};
use winbox_machine::{handle_for, index_for, segment_selector};

use crate::call::{Answer, Args, Implementation, Stop};
use crate::memory;
use crate::system::System;

/// `HFILE_ERROR`.
const HFILE_ERROR: u16 = 0xffff;

pub fn implementation(name: &str) -> Option<Implementation> {
    Some(match name {
        "InitTask" => init_task,
        "WaitEvent" => wait_event,
        "GetVersion" => get_version,
        "GetModuleFilename" => get_module_filename,
        "GlobalHandle" => global_handle,
        "GlobalSize" => global_size,
        "_lcreat" => lcreat,
        "_lwrite" => lwrite,
        "_lclose" => lclose,
        "GlobalAlloc" => memory::global_alloc,
        "GlobalLock" => memory::global_lock,
        "GlobalUnlock" => memory::global_unlock,
        "GlobalFree" => memory::global_free,
        "GlobalReAlloc" => memory::global_realloc,
        "GlobalFlags" => memory::global_flags,
        "LocalInit" => memory::local_init,
        "LocalAlloc" => memory::local_alloc,
        "LocalFree" => memory::local_free,
        "LocalLock" => memory::local_lock,
        "LocalUnlock" => memory::local_unlock,
        "LocalSize" => memory::local_size,
        "LocalReAlloc" => memory::local_realloc,
        "LocalCompact" => memory::local_compact,
        "GetModuleHandle" => get_module_handle,
        "lstrcpy" => lstrcpy,
        "lstrcat" => lstrcat,
        "lstrlen" => lstrlen,
        "Dos3Call" => dos3_call,
        "GetWinFlags" => get_win_flags,
        "GetWindowsDirectory" => get_windows_directory,
        "GetSystemDirectory" => get_system_directory,
        "SetErrorMode" => set_error_mode,
        _ => return None,
    })
}

/// The task's start, as a program's start-up calls it: its libraries'
/// entry points run, the stack's three words written in the data
/// segment's header, the registers `WinMain` is given, and a nought pushed
/// under the return address for a walk of the stack's frames.
fn init_task(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    let task = system
        .task
        .clone()
        .ok_or(Stop::Unsupported("InitTask with no task"))?;

    if task
        .libraries
        .iter()
        .any(|&library| !system.modules[library].started)
    {
        return Err(Stop::Unsupported("a library's entry point"));
    }

    let module = &system.modules[task.program];
    let data = segment_selector(module.data().ok_or(Stop::Unsupported("no data segment"))?);
    let cpu = &mut system.cpu;
    let stack = cpu.segments[SS].base;
    let sp = cpu.regs[SP];

    // As KRNL386.EXE seg2 `268d` writes them: the stack's bottom and the
    // lowest it has reached where the stack pointer is with the return
    // address taken off, and its limit that less the stack's size, in BX
    // as the task started, and 96h more (`stackpos`). The limit in CX.
    let bottom = sp.wrapping_add(4);
    let limit = bottom.wrapping_sub(cpu.regs[BX]).wrapping_add(0x96);

    cpu.bus.write16(stack + 0x0a, limit);
    cpu.bus.write16(stack + 0x0c, bottom);
    cpu.bus.write16(stack + 0x0e, bottom);

    cpu.load_segment(DS, data).map_err(Stop::Processor)?;
    cpu.load_segment(ES, segment_selector(task.program_segment))
        .map_err(Stop::Processor)?;
    // The command line's offset in the prefix.
    cpu.regs[BX] = 0x81;
    cpu.regs[CX] = limit;
    // The instance: the data segment's handle, one below its selector
    // (`instds`).
    cpu.regs[DI] = data - 1;
    cpu.regs[SI] = task.previous;
    cpu.regs[DX] = task.show;
    cpu.regs[BP] = sp;

    let at = |sp: u16| stack + u32::from(sp);
    let return_ip = cpu.bus.read16(at(sp));
    let return_cs = cpu.bus.read16(at(sp.wrapping_add(2)));

    cpu.bus.write16(at(sp.wrapping_add(2)), 0);
    cpu.bus.write16(at(sp), return_cs);
    cpu.bus.write16(at(sp.wrapping_sub(2)), return_ip);
    cpu.regs[SP] = sp.wrapping_sub(2);

    Ok(Answer::Word(1))
}

/// Nothing waited for: nought.
fn wait_event(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    args.word(system);
    Ok(Answer::Word(0))
}

/// Windows 3.1 on DOS 6.22.
fn get_version(_: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    Ok(Answer::Dword(0x0616_0a03))
}

/// A module's file, as far as the buffer holds it with its nought: a kept
/// module's, a loaded one's, else the task's program's.
fn get_module_filename(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let instance = args.word(system);
    let buffer = args.dword(system);
    let size = args.signed(system);
    let path = system.path_of(instance);

    if size == 0 {
        return Ok(Answer::Word(0));
    }

    let room = if size > 0 { size as usize - 1 } else { 0 };
    let count = path.len().min(room);
    let mut bytes = path.as_bytes()[..count].to_vec();

    bytes.push(0);
    system.write_far(buffer, &bytes);
    Ok(Answer::Word(count as u16))
}

/// The handle and the selector of a block, nought for one never given.
fn global_handle(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let selector = args.word(system);
    let index = index_for(selector);

    if system.global.size_of(index) == 0 && system.global.flags_of(index) == 0 {
        return Ok(Answer::Dword(0));
    }

    Ok(Answer::Dword(
        u32::from(segment_selector(index)) << 16 | u32::from(handle_for(index)),
    ))
}

fn global_size(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);

    Ok(Answer::Dword(system.global.size_of(index_for(handle))))
}

/// A file created, or `HFILE_ERROR`.
fn lcreat(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let name = args.dword(system);
    let _attribute = args.word(system);

    if name == 0 {
        return Ok(Answer::Word(HFILE_ERROR));
    }

    let path = String::from_utf8_lossy(&system.read_string(name)).into_owned();

    Ok(Answer::Word(
        system
            .files
            .create(&path)
            .map_or(HFILE_ERROR, |handle| handle as u16),
    ))
}

/// Bytes written to a file: how many, or `HFILE_ERROR`.
fn lwrite(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);
    let buffer = args.dword(system);
    let length = args.word(system);

    if length > 0xfffe || system.files.resolve(usize::from(handle)).is_none() {
        return Ok(Answer::Word(HFILE_ERROR));
    }

    let bytes = system.read_far(buffer, usize::from(length));
    let file = system
        .files
        .resolve(usize::from(handle))
        .expect("an open file");

    Ok(Answer::Word(file.write(&bytes) as u16))
}

fn lclose(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);

    Ok(Answer::Word(if system.files.close(usize::from(handle)) {
        0
    } else {
        HFILE_ERROR
    }))
}

/// A module's handle by its name, or by its file's name where the name has
/// a dot; nought for one not loaded, or one winbox.js keeps only as names
/// until its file is loaded.
fn get_module_handle(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let name = args.dword(system);

    // Nought, or a number in a pointer's place.
    if name >> 16 == 0 {
        return Ok(Answer::Word(0));
    }

    let text = String::from_utf8_lossy(&system.read_string(name)).to_ascii_uppercase();
    let wanted = text
        .rsplit(['\\', '/', ':'])
        .next()
        .unwrap_or("")
        .to_string();
    let file_of = |path: &str| path.rsplit('\\').next().unwrap_or("").to_ascii_uppercase();
    let dotted = wanted.contains('.');

    // A module loaded from its file is found before one kept of its name.
    let loaded = if dotted {
        system
            .modules
            .iter()
            .position(|module| file_of(&module.path) == wanted)
    } else {
        system.module_named(&wanted)
    };

    if let Some(module) = loaded {
        // The TypeScript engine registers a program with no handle.
        return if system.modules[module].executable.header.library() {
            Err(Stop::Unsupported("a library's module handle"))
        } else {
            Ok(Answer::Word(0))
        };
    }

    let kept = if dotted {
        system
            .kept
            .iter()
            .find(|kept| file_of(kept.module.path) == wanted)
    } else {
        system.kept_named(&wanted).map(|kept| &system.kept[kept])
    };

    // COMMDLG is kept only as names, until its file is loaded.
    Ok(Answer::Word(kept.map_or(0, |kept| {
        if kept.module.name.eq_ignore_ascii_case("COMMDLG") {
            0
        } else {
            kept.handle()
        }
    })))
}

/// A string copied, its nought too: the destination.
fn lstrcpy(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let to = args.dword(system);
    let from = args.dword(system);
    let mut bytes = system.read_string(from);

    bytes.push(0);
    system.write_far(to, &bytes);
    Ok(Answer::Dword(to))
}

/// A string put after another: the first.
fn lstrcat(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let to = args.dword(system);
    let from = args.dword(system);
    let end = system.read_string(to).len() as u32;
    let mut bytes = system.read_string(from);

    bytes.push(0);
    system.write_far((to & 0xffff_0000) | (to.wrapping_add(end) & 0xffff), &bytes);
    Ok(Answer::Dword(to))
}

fn lstrlen(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let string = args.dword(system);

    Ok(Answer::Word(system.read_string(string).len() as u16))
}

/// DOS called as `INT 21h` calls it, the registers its answer.
fn dos3_call(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    system.dos_call()?;
    Ok(Answer::Nothing)
}

/// Standard mode, a 486, and the coprocessor's bit as the machine has one:
/// `WF_PMODE`, `WF_STANDARD`, `WF_CPU486`, `WF_80x87`.
fn get_win_flags(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    let coprocessor = if system.coprocessor { 0x0400 } else { 0 };

    Ok(Answer::Dword(0x0001 | 0x0010 | 0x0008 | coprocessor))
}

/// A directory's path copied where it fits with its nought: its length;
/// where it does not, the room it needs.
fn directory(system: &mut System, args: &mut Args, path: &str) -> Answer {
    let buffer = args.dword(system);
    let size = usize::from(args.word(system));

    if size < path.len() + 1 {
        return Answer::Word(path.len() as u16 + 1);
    }

    system.copy_text(path.as_bytes(), buffer, size);
    Answer::Word(path.len() as u16)
}

fn get_windows_directory(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    Ok(directory(system, args, "C:\\WINDOWS"))
}

fn get_system_directory(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    Ok(directory(system, args, "C:\\WINDOWS\\SYSTEM"))
}

/// How the task wants errors handled: the mode before, nought to begin.
fn set_error_mode(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let mode = args.word(system);

    Ok(Answer::Word(std::mem::replace(
        &mut system.error_mode,
        mode,
    )))
}
