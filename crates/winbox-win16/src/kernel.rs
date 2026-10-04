//! KERNEL's functions, as far as the Rust engine answers them.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

use winbox_cpu::{BP, BX, CX, DI, DS, DX, ES, SI, SP, SS};
use winbox_machine::{handle_for, index_for, segment_selector};

use crate::call::{Answer, Args, Implementation, Stop};
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
