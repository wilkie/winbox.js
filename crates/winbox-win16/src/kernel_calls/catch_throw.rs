//! `Catch` and `Throw`: a place in the program kept, and gone back to from
//! deeper down, as `setjmp` and `longjmp` are.
//!
//! **Read out**: `Throw` never returns to its caller. It reloads the stack
//! from the catch buffer and returns from the `Catch` that filled it, so
//! the `RETF` it reaches is `Catch`'s; its own two arguments are six bytes.
//!
//! The buffer is nine words (`KRNL386.EXE` seg3 `08ee`-`0925`, **read
//! out**): the return address, IP then CS; the stack pointer less the eight
//! bytes of the return address and the argument; BP, SI, DI and DS; a word
//! left as it was; and SS. `Catch` writes SS first, then DS, DI, SI, BP,
//! the return address and the stack pointer. `Throw` (seg3 `0928`-`0962`)
//! reads them back from the same places. No probe has recorded what
//! KERNEL's own buffer holds.

use winbox_cpu::{BP, DI, DS, SI, SP, SS};

use crate::call::{Answer, Args, Stop};
use crate::system::System;

/// Where each of the buffer's words is written and read (seg3 `0900`-`091b`).
const IP: u32 = 0x00;
const CS: u32 = 0x02;
const STACK: u32 = 0x04;
const FRAME: u32 = 0x06;
const SOURCE: u32 = 0x08;
const DESTINATION: u32 = 0x0a;
const DATA: u32 = 0x0c;
const STACK_SEGMENT: u32 = 0x10;

/// The place kept in the buffer, and nought answered: not come back to by
/// `Throw`.
pub(super) fn catch(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let buffer = args.dword(system);
    let stack = system.cpu.segments[SS].base;
    let sp = system.cpu.regs[SP];
    let caller_ip = system.cpu.bus.read16(stack + u32::from(sp));
    let caller_cs = system.cpu.bus.read16(stack + u32::from(sp.wrapping_add(2)));
    let address = system.linear(buffer);
    // In the order KERNEL writes them.
    let words = [
        (STACK_SEGMENT, system.cpu.segments[SS].selector),
        (DATA, system.cpu.segments[DS].selector),
        (DESTINATION, system.cpu.regs[DI]),
        (SOURCE, system.cpu.regs[SI]),
        (FRAME, system.cpu.regs[BP]),
        (IP, caller_ip),
        (CS, caller_cs),
        (STACK, sp.wrapping_sub(8)),
    ];

    // The buffer is the program's: written as KERNEL's own code writes
    // it, a page not present a page fault (`System::write_linear`).
    for (at, word) in words {
        system.write_linear16(address + at, word);
    }

    Ok(Answer::Word(0))
}

/// Back to where `Catch` kept the place, the stack as it was there, `Catch`
/// answering `ret`: the stack pointer put back six bytes up, which the
/// `RETF` of `Throw`'s own stub, popping its six bytes of arguments, brings
/// to where `Catch`'s would have left it; the return address and `Catch`'s
/// argument written there again, and `ret` after them.
pub(super) fn throw(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let buffer = args.dword(system);
    let ret = args.word(system);
    let address = system.linear(buffer);
    let read = |system: &System, at: u32| system.read_linear16(address + at);
    let caller_ip = read(system, IP);
    let caller_cs = read(system, CS);

    system.cpu.regs[SP] = read(system, STACK).wrapping_add(6);
    system.cpu.regs[BP] = read(system, FRAME);
    system.cpu.regs[SI] = read(system, SOURCE);
    system.cpu.regs[DI] = read(system, DESTINATION);

    let data = read(system, DATA);
    let stack_segment = read(system, STACK_SEGMENT);

    system.cpu.load_segment(DS, data).map_err(Stop::Processor)?;
    system
        .cpu
        .load_segment(SS, stack_segment)
        .map_err(Stop::Processor)?;

    let stack = system.cpu.segments[SS].base;
    let sp = system.cpu.regs[SP];
    let at = |offset: u16| stack + u32::from(sp.wrapping_add(offset));

    system.cpu.bus.write16(at(0), caller_ip);
    system.cpu.bus.write16(at(2), caller_cs);
    system.cpu.bus.write16(at(4), buffer as u16);
    system.cpu.bus.write16(at(6), (buffer >> 16) as u16);
    system.cpu.bus.write16(at(8), ret);

    Ok(Answer::Word(ret))
}
