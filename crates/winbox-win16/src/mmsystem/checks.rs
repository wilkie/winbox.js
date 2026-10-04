//! What MMSYSTEM checks of a call's arguments before any driver hears of
//! it, and the error texts it gives itself.
//!
//! **Read out** of `MMSYSTEM.DLL` (seg4 `353`-`548`, seg3 `95a`, seg6
//! `21e`). Each failing check is logged with KERNEL's `LogParamError`.
//! The retail KERNEL passes that on only to a debugger, by `INT 41h`, and
//! to the notification hook the tool helper sets (**Read out** of
//! `KRNL386.EXE`, seg1 `94f2`, `9a50`); winbox.js has no debugger and
//! delivers no tool helper notification, and so does not log.

use winbox_machine::index_for;

use crate::call::{Answer, Args};
use crate::handles::Object;
use crate::system::System;

use super::devices::{MMSYSERR_BADERRNUM, MMSYSERR_INVALPARAM, MMSYSERR_NOERROR};
use super::strings;

/// A header's flags: done, prepared, queued -- waveform's `WHDR_INQUEUE`,
/// MIDI's `MHDR_INQUEUE`.
pub const DONE: u32 = 0x01;
pub const PREPARED: u32 = 0x02;
pub const WAVE_INQUEUE: u32 = 0x10;
pub const MIDI_INQUEUE: u32 = 0x04;

/// Where a header keeps its flags.
pub const FLAGS_AT: u32 = 0x10;

/// Whether a block can be written, `IsBadHugeWritePtr` as MMSYSTEM asks it
/// (seg4 `442`).
pub fn writable(system: &System, far: u32, count: u32) -> bool {
    !system.bad_huge(far, count, true)
}

/// Whether a block can be read, `IsBadHugeReadPtr` (seg4 `40d`).
pub fn readable(system: &System, far: u32, count: u32) -> bool {
    !system.bad_huge(far, count, false)
}

/// A doubleword at a far pointer.
pub fn dword_at(system: &System, far: u32) -> u32 {
    let bytes = system.read_far(far, 4);

    u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
}

/// A header's flags.
pub fn header_flags(system: &System, header: u32) -> u32 {
    dword_at(system, step(header, FLAGS_AT))
}

pub fn set_header_flags(system: &mut System, header: u32, flags: u32) {
    system.write_far(step(header, FLAGS_AT), &flags.to_le_bytes());
}

/// A far pointer and some bytes more, within its segment.
fn step(far: u32, bytes: u32) -> u32 {
    (far & 0xffff_0000) | (far.wrapping_add(bytes) & 0xffff)
}

/// Whether a header is one MMSYSTEM takes (seg4 `353`): writable for its
/// size; its size a waveform header's, 20h, for a waveform handle, a MIDI
/// header's, 1Ch, for a MIDI one; no flag in the low word of its flags but
/// those its kind has; and its data writable for its length.
pub fn header_ok(system: &System, header: u32, size: u16, handle_type: u16) -> bool {
    if system.bad_range(header, u32::from(size), true) {
        return false;
    }

    let (expected, mask) = if handle_type <= 2 {
        (0x20, 0xffe0)
    } else {
        (0x1c, 0xfff8)
    };

    if size != expected || header_flags(system, header) as u16 & mask != 0 {
        return false;
    }

    let data = dword_at(system, header);
    let length = dword_at(system, step(header, 4));

    writable(system, data, length)
}

/// Whether a callback is one MMSYSTEM takes (seg4 `477`), by the kind the
/// high word of the open's flags gives: none; a window, by a handle of
/// one; a task, by a handle of one; a function, in a code segment of a
/// module's that is neither moveable nor discardable, as `GetCodeInfo`
/// reads its flags. Another kind is refused.
pub fn callback_ok(system: &mut System, callback: u32, kind: u16) -> bool {
    let low = callback as u16;

    match kind & 7 {
        0 => true,
        1 => {
            callback >> 16 == 0
                && crate::window_queries::is_window(system, &mut Args::repeat(low))
                    == Ok(Answer::Word(1))
        }
        2 => callback >> 16 == 0 && matches!(system.handles.resolve(low), Some(Object::Task(_))),
        3 => code_flags(system, (callback >> 16) as u16).is_some_and(|flags| flags & 0x1011 == 0),
        _ => false,
    }
}

/// A code segment's flags, as `GetCodeInfo` gives them: its module's
/// segment table's. None for a selector no module's segment is.
fn code_flags(system: &System, selector: u16) -> Option<u16> {
    let index = index_for(selector);

    system.modules.iter().find_map(|module| {
        let number = module.segments.iter().position(|&each| each == index)?;

        module
            .executable
            .segments
            .get(number)
            .map(|segment| segment.flags)
    })
}

/// An error's text, as `waveOutGetErrorText` and `midiOutGetErrorText` give
/// it (seg3 `95a`, seg6 `21e`): the buffer's first byte made nought; an
/// error not the general ones, 0 to 11, nor the kind's own -- 32 to 35 for
/// waveform, 64 to 69 for MIDI -- `MMSYSERR_BADERRNUM`; else MMSYSTEM's
/// string loaded into a buffer of two bytes or more.
pub fn error_text(system: &mut System, error: u16, far: u32, size: u16, own: (u16, u16)) -> u16 {
    if size == 0 {
        return MMSYSERR_NOERROR;
    }

    if !writable(system, far, u32::from(size)) {
        return MMSYSERR_INVALPARAM;
    }

    system.write_far(far, &[0]);

    if error > 11 && !(own.0..=own.1).contains(&error) {
        return MMSYSERR_BADERRNUM;
    }

    if size > 1 {
        let Some(text) = strings::string(error) else {
            return MMSYSERR_BADERRNUM;
        };

        system.copy_text(text, far, usize::from(size));
    }

    MMSYSERR_NOERROR
}
