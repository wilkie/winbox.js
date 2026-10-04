//! KERNEL's checks of a pointer, as the descriptor it goes through has it,
//! and its answers about free memory.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

use winbox_cpu::DS;

use crate::call::{Answer, Args, Stop};
use crate::system::System;

impl System {
    /// Whether a selector could be loaded to read through: the null
    /// selector, or a present code or data segment, code readable.
    pub(crate) fn loads(&self, selector: u16) -> bool {
        if selector & 0xfffc == 0 {
            return true;
        }

        self.peek_descriptor(selector).is_some_and(|descriptor| {
            descriptor.segment
                && (!descriptor.executable || descriptor.read_write)
                && descriptor.present
        })
    }

    /// Whether a byte at an offset is reached through a selector, for a
    /// write too where `write` says.
    pub(crate) fn reaches(&self, selector: u16, offset: u32, write: bool) -> bool {
        if selector & 0xfffc == 0 || !self.loads(selector) {
            return false;
        }

        let Some(descriptor) = self.peek_descriptor(selector) else {
            return false;
        };

        if write && (descriptor.executable || !descriptor.read_write) {
            return false;
        }

        let offset = u64::from(offset & 0xffff);

        offset >= descriptor.low_limit && offset < descriptor.past_limit
    }

    fn bad_range(&self, pointer: u32, count: u32, write: bool) -> bool {
        let selector = (pointer >> 16) as u16;
        let offset = pointer & 0xffff;

        if !self.loads(selector) {
            return true;
        }

        if count == 0 {
            return false;
        }

        let last = offset + count - 1;

        last > 0xffff || !self.reaches(selector, last, write)
    }

    fn bad_huge(&self, pointer: u32, count: u32, write: bool) -> bool {
        let mut selector = (pointer >> 16) as u16;
        let offset = u64::from(pointer & 0xffff);

        if !self.loads(selector) {
            return true;
        }

        if count == 0 {
            return false;
        }

        let last = offset + u64::from(count) - 1;

        if last > 0xffff_ffff {
            return true;
        }

        for _ in 0..last / 0x10000 {
            if !self.reaches(selector, 0xffff, write) {
                return true;
            }

            selector = selector.wrapping_add(8);

            if !self.loads(selector) {
                return true;
            }
        }

        !self.reaches(selector, (last & 0xffff) as u32, write)
    }
}

fn answer(bad: bool) -> Result<Answer, Stop> {
    Ok(Answer::Word(u16::from(bad)))
}

pub fn is_bad_read_ptr(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let pointer = args.dword(system);
    let count = u32::from(args.word(system));

    answer(system.bad_range(pointer, count, false))
}

pub fn is_bad_write_ptr(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let pointer = args.dword(system);
    let count = u32::from(args.word(system));

    answer(system.bad_range(pointer, count, true))
}

pub fn is_bad_huge_read_ptr(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let pointer = args.dword(system);
    let count = args.dword(system);

    answer(system.bad_huge(pointer, count, false))
}

pub fn is_bad_huge_write_ptr(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let pointer = args.dword(system);
    let count = args.dword(system);

    answer(system.bad_huge(pointer, count, true))
}

/// Whether a procedure's address is not in a readable code segment.
pub fn is_bad_code_ptr(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let pointer = args.dword(system);
    let selector = (pointer >> 16) as u16;
    let code = system
        .peek_descriptor(selector)
        .is_some_and(|descriptor| descriptor.segment && descriptor.executable);

    answer(!code || !system.reaches(selector, pointer & 0xffff, false))
}

/// Whether a string is not readable to its nought, or is longer than the
/// most it may be.
pub fn is_bad_string_ptr(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let pointer = args.dword(system);
    let most = args.word(system);
    let selector = (pointer >> 16) as u16;
    let offset = pointer & 0xffff;

    if !system.loads(selector) {
        return answer(true);
    }

    for length in 1..=0xffffu32 {
        let at = (offset + length - 1) & 0xffff;

        if !system.reaches(selector, at, false) {
            return answer(true);
        }

        if system.read_far(u32::from(selector) << 16 | at, 1)[0] == 0 {
            return answer(length > u32::from(most));
        }
    }

    answer(true)
}

/// Free memory: 16 MB, as the TypeScript engine answers it.
pub fn get_free_space(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    args.word(system);
    Ok(Answer::Dword(0x0100_0000))
}

/// The largest block there is room for: all the free memory.
pub fn global_compact(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    args.dword(system);
    Ok(Answer::Dword(0x0100_0000))
}

/// How many handles a local heap makes room for at a time, by its data
/// segment: set where given, 32 to begin with.
pub fn local_handle_delta(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let delta = args.word(system);
    let ds = system.cpu.segments[DS].selector;

    if delta != 0 {
        system.handle_deltas.insert(ds, delta);
    }

    Ok(Answer::Word(
        system.handle_deltas.get(&ds).copied().unwrap_or(32),
    ))
}
