//! MMSYSTEM's interrupt stacks, which a driver moves to for the time it
//! runs at interrupt time: `StackEnter` and `StackLeave`.
//!
//! **Read out** of `MMSYSTEM.DLL` (seg2 `152`-`282`, seg1 `2bd`,
//! `312`-`3aa`); **recorded** by `mmmisc`:
//!
//! * In standard mode, as the first load ends, if there is any waveform or
//!   MIDI device -- and else at the first `timeSetEvent` -- MMSYSTEM
//!   allocates its stacks in one block, `GMEM_SHARE` and fixed: as many as
//!   `SYSTEM.INI`'s `[mmsystem]` `StackFrames` says, or one for the timer's
//!   driver, one if there is a MIDI device and one if a waveform one; each
//!   as big as `StackSize` says, 600h, no fewer than 40h bytes, made even. A
//!   block of 64 K or more, or one not had, is three of 600h. In 386
//!   enhanced mode there are none. The block's top is where the next stack
//!   begins.
//! * `StackEnter`, in standard mode, takes the next stack down: the program
//!   goes on there, the stack it came from -- its pointer past the return
//!   address, and its segment -- the two words on top, and the carry flag
//!   clear. With no stack left, or none made, it puts a word of nought under
//!   its return address and sets the carry flag. In 386 enhanced mode it
//!   only sets the carry flag.
//! * `StackLeave` moves back to the stack the two words on top name, giving
//!   the stack back; under a word of nought it takes that word away. AX, BX
//!   and DS are kept by both.

use winbox_cpu::{SP, SS};

use crate::call::{Answer, Args, Stop, call_named};
use crate::engine::{Engine, GuestArg};
use crate::system::System;

use super::devices::Kind;

const WF_STANDARD: u32 = 0x10;
const WF_ENHANCED: u32 = 0x20;
const CARRY: u16 = 0x0001;

/// MMSYSTEM's stacks.
#[derive(Debug, Default)]
pub struct Stacks {
    /// Each stack's size: nought until they are first made.
    size: u16,
    /// How many there are, as asked for.
    frames: u16,
    /// The block's selector, or nought.
    selector: u16,
    /// Where the next stack begins: nought with none left.
    top: u16,
}

fn win_flags(system: &mut System) -> u32 {
    crate::kernel::get_win_flags(system, &mut Args::repeat(0))
        .ok()
        .and_then(Answer::value)
        .unwrap_or(0)
}

/// A string as a structure for a call that takes one: its bytes and a nought.
fn text(bytes: &[u8]) -> GuestArg {
    GuestArg::Struct([bytes, &[0]].concat())
}

async fn profile_int(engine: &Engine, key: &[u8], default: u16) -> Result<u16, Stop> {
    let args = [
        text(b"mmsystem"),
        text(key),
        GuestArg::Word(default),
        text(b"system.ini"),
    ];
    let (answer, _) = Box::pin(call_named(engine, "KERNEL", "GetPrivateProfileInt", &args)).await?;

    Ok(answer.value().unwrap_or(0) as u16)
}

async fn global_alloc(engine: &Engine, size: u32) -> Result<u16, Stop> {
    let args = [GuestArg::Word(0x2000), GuestArg::Long(size)];
    let (answer, _) = Box::pin(call_named(engine, "KERNEL", "GlobalAlloc", &args)).await?;

    Ok(answer.value().unwrap_or(0) as u16)
}

/// The stacks made, as MMSYSTEM makes them (seg2 `152`): whether there are
/// any.
pub async fn make_stacks(engine: &Engine) -> Result<bool, Stop> {
    if win_flags(&mut engine.system()) & WF_ENHANCED != 0 {
        return Ok(true);
    }

    let size = profile_int(engine, b"StackSize", 0x600).await?;

    engine.system().mmsystem.stacks.size = size.max(0x40);

    let mut frames = profile_int(engine, b"StackFrames", 0xffff).await?;

    if frames == 0xffff {
        let system = engine.system();
        let devices = &system.mmsystem.devices;

        frames = u16::from(system.mmsystem.driver.timer != 0)
            + u16::from(
                devices
                    .count(Kind::MidiOut)
                    .wrapping_add(devices.count(Kind::MidiIn))
                    != 0,
            )
            + u16::from(
                devices
                    .count(Kind::WaveOut)
                    .wrapping_add(devices.count(Kind::WaveIn))
                    != 0,
            );
    }

    if engine.system().mmsystem.stacks.frames == frames {
        return Ok(true);
    }

    free_stacks(engine).await?;

    let frames = frames.max(1);
    let size = {
        let mut system = engine.system();
        let stacks = &mut system.mmsystem.stacks;

        stacks.frames = frames;
        stacks.size = stacks.size.wrapping_add(1) & 0xfffe;
        stacks.size
    };
    let mut total = u32::from(size) * u32::from(frames);
    let mut selector = 0;

    if total < 0x10000 {
        selector = global_alloc(engine, total).await?;
    }

    if total >= 0x10000 || selector == 0 {
        total = 0x1200;

        {
            let mut system = engine.system();

            system.mmsystem.stacks.frames = 3;
            system.mmsystem.stacks.size = 0x600;
        }

        selector = global_alloc(engine, total).await?;
    }

    let mut system = engine.system();
    let stacks = &mut system.mmsystem.stacks;

    stacks.selector = selector;
    stacks.top = if selector == 0 { 0 } else { total as u16 };

    Ok(selector != 0)
}

/// The block let go, if there is one (seg2 `283`).
async fn free_stacks(engine: &Engine) -> Result<(), Stop> {
    let selector = std::mem::take(&mut engine.system().mmsystem.stacks.selector);

    engine.system().mmsystem.stacks.top = 0;

    if selector != 0 {
        Box::pin(call_named(
            engine,
            "KERNEL",
            "GlobalFree",
            &[GuestArg::Word(selector)],
        ))
        .await?;
    }

    Ok(())
}

/// The stacks made when a timer event is first set, if they were not as
/// MMSYSTEM loaded (seg1 `2bd`).
pub async fn make_stacks_for_timer(engine: &Engine) -> Result<(), Stop> {
    {
        let mut system = engine.system();

        if win_flags(&mut system) & WF_ENHANCED != 0 || system.mmsystem.stacks.size != 0 {
            return Ok(());
        }
    }

    make_stacks(engine).await.map(|_| ())
}

fn word_at(system: &System, selector: u16, offset: u16) -> u16 {
    let bytes = system.read_far(u32::from(selector) << 16 | u32::from(offset), 2);

    u16::from_le_bytes([bytes[0], bytes[1]])
}

fn set_word(system: &mut System, selector: u16, offset: u16, value: u16) {
    system.write_far(
        u32::from(selector) << 16 | u32::from(offset),
        &value.to_le_bytes(),
    );
}

fn set_carry(system: &mut System, carry: bool) {
    if carry {
        system.cpu.flags |= CARRY;
    } else {
        system.cpu.flags &= !CARRY;
    }
}

/// `StackEnter`: the program moved to MMSYSTEM's next stack, or a word of
/// nought put under its return.
pub fn stack_enter(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    if win_flags(system) & WF_STANDARD == 0 {
        set_carry(system, true);
        return Ok(Answer::Nothing);
    }

    let ss = system.cpu.segments[SS].selector;
    let sp = system.cpu.regs[SP];
    let ip = word_at(system, ss, sp);
    let cs = word_at(system, ss, sp.wrapping_add(2));
    let top = system.mmsystem.stacks.top;

    if top == 0 {
        set_word(system, ss, sp.wrapping_sub(2), ip);
        set_word(system, ss, sp, cs);
        set_word(system, ss, sp.wrapping_add(2), 0);
        system.cpu.regs[SP] = sp.wrapping_sub(2);
        set_carry(system, true);
        return Ok(Answer::Nothing);
    }

    let selector = system.mmsystem.stacks.selector;
    let at = top.wrapping_sub(8);

    system.mmsystem.stacks.top = top.wrapping_sub(system.mmsystem.stacks.size);
    system
        .cpu
        .load_segment(SS, selector)
        .map_err(Stop::Processor)?;
    // The return address, under it the stack come from: its pointer past
    // the return address and its segment.
    set_word(system, selector, at, ip);
    set_word(system, selector, at.wrapping_add(2), cs);
    set_word(system, selector, at.wrapping_add(4), sp.wrapping_add(4));
    set_word(system, selector, at.wrapping_add(6), ss);
    system.cpu.regs[SP] = at;
    set_carry(system, false);
    Ok(Answer::Nothing)
}

/// `StackLeave`: the program moved back to the stack it came from, or the
/// word of nought taken away.
pub fn stack_leave(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    if win_flags(system) & WF_STANDARD == 0 {
        set_carry(system, false);
        return Ok(Answer::Nothing);
    }

    let ss = system.cpu.segments[SS].selector;
    let sp = system.cpu.regs[SP];
    let ip = word_at(system, ss, sp);
    let cs = word_at(system, ss, sp.wrapping_add(2));
    let below = word_at(system, ss, sp.wrapping_add(4));

    // The word compared with nought: the carry clear.
    set_carry(system, false);

    if below == 0 {
        // `retf 2`: the word of nought goes with the return.
        set_word(system, ss, sp.wrapping_add(2), ip);
        set_word(system, ss, sp.wrapping_add(4), cs);
        system.cpu.regs[SP] = sp.wrapping_add(2);
        return Ok(Answer::Nothing);
    }

    let back = word_at(system, ss, sp.wrapping_add(6));

    system.cpu.load_segment(SS, back).map_err(Stop::Processor)?;
    set_word(system, back, below.wrapping_sub(4), ip);
    set_word(system, back, below.wrapping_sub(2), cs);
    system.cpu.regs[SP] = below.wrapping_sub(4);

    // The stack given back: the carry the addition's.
    let (top, carry) = {
        let stacks = &system.mmsystem.stacks;

        stacks.top.overflowing_add(stacks.size)
    };

    system.mmsystem.stacks.top = top;
    set_carry(system, carry);
    Ok(Answer::Nothing)
}
