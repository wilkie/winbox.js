//! TOOLHELP's stack trace (`TOOLHELP.DLL` seg1 `0f1c`-`11cb`).

use winbox_machine::index_for;

use super::global::{GT_CODE, GT_DGROUP, global_blocks};
use super::local::selector_of;
use super::structures::{Far, structure};
use crate::call::{Answer, Args, Stop};
use crate::system::System;

/// `STACKTRACEENTRY`'s size, and its flags: a far frame, a near one.
const STACKTRACEENTRY: u16 = 0x14;
const FRAME_FAR: u16 = 0;
const FRAME_NEAR: u16 = 1;

/// The module and segment number of a frame's code (seg1 `1012`-`10ab`).
fn place_code(system: &mut System, entry: Far) {
    let cs = entry.read16(system, 0x0a);

    if cs == 0 {
        return;
    }

    let index = index_for(selector_of(cs));
    let found = global_blocks(system)
        .into_iter()
        .find(|block| block.index == index && (block.kind == GT_CODE || block.kind == GT_DGROUP));

    if let Some(block) = found {
        entry.write16(system, 0x0e, block.owner);
        entry.write16(system, 0x10, block.data);
    }
}

/// A word of a segment.
fn word(system: &System, selector: u16, at: u16) -> u16 {
    let bytes = system.read_far(u32::from(selector) << 16 | u32::from(at), 2);

    u16::from_le_bytes([bytes[0], bytes[1]])
}

/// The first frame of a task's stack (seg1 `0f1c`, `10ac`-`1135`).
pub fn stack_trace_first(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);
    let task = args.word(system);
    let Some(entry) = structure(system, far, STACKTRACEENTRY) else {
        return Ok(Answer::Word(0));
    };

    if !system.live_task(task) {
        return Ok(Answer::Word(0));
    }

    let frame = system.frame_of(task).unwrap_or_default();
    let bp = frame.bp & 0xfffe;

    entry.write16(system, 0x08, bp);
    entry.write16(system, 0x0c, frame.ip);
    entry.write16(system, 0x0a, frame.cs);
    entry.write16(system, 0x04, task);
    entry.write16(system, 0x06, frame.ss);
    entry.write16(system, 0x12, FRAME_FAR);

    let (top, bottom) = (word(system, frame.ss, 0x0a), word(system, frame.ss, 0x0e));

    if bp == 0 || bp < top || bp >= bottom {
        return Ok(Answer::Word(0));
    }

    place_code(system, entry);
    Ok(Answer::Word(1))
}

/// A frame begun from given registers (seg1 `0f67`-`0fc7`). **Recorded**
/// by `thtask`.
pub fn stack_trace_csip_first(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);
    let ss = args.word(system);
    let cs = args.word(system);
    let ip = args.word(system);
    let bp = args.word(system);
    let Some(entry) = structure(system, far, STACKTRACEENTRY) else {
        return Ok(Answer::Word(0));
    };

    entry.write16(system, 0x06, ss);
    entry.write16(system, 0x0a, cs);
    entry.write16(system, 0x0c, ip);
    entry.write16(system, 0x08, bp);
    place_code(system, entry);

    let task = system.current_task().unwrap_or(0);

    entry.write16(system, 0x04, task);
    Ok(Answer::Word(1))
}

/// The frame the one filled in returns to (seg1 `0fca`, `1138`-`11cb`).
/// **Recorded** by `thtask`.
pub fn stack_trace_next(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);
    let Some(entry) = structure(system, far, STACKTRACEENTRY) else {
        return Ok(Answer::Word(0));
    };
    let ss = entry.read16(system, 0x06);
    let bp = entry.read16(system, 0x08);

    let reaches = system.peek_descriptor(ss).is_some_and(|descriptor| {
        u32::from(bp) + 6 <= 0xffff && descriptor.limit >= u32::from(bp) + 6
    });

    if !reaches {
        return Ok(Answer::Word(0));
    }

    let before = word(system, ss, bp);
    let ip = word(system, ss, bp.wrapping_add(2));
    let cs = word(system, ss, bp.wrapping_add(4));
    let (top, bottom) = (word(system, ss, 0x0a), word(system, ss, 0x0e));

    if before == 0 || before <= bp || before < top || before >= bottom {
        return Ok(Answer::Word(0));
    }

    let mut far_frame = before & 1 != 0;

    if !far_frame && cs & 3 == 3 {
        far_frame = system
            .peek_descriptor(cs)
            .is_some_and(|descriptor| descriptor.executable && descriptor.limit > u32::from(ip));
    }

    entry.write16(system, 0x0c, ip);

    if far_frame {
        entry.write16(system, 0x0a, cs);
    }

    entry.write16(system, 0x12, if far_frame { FRAME_FAR } else { FRAME_NEAR });
    entry.write16(system, 0x08, before & 0xfffe);
    place_code(system, entry);
    Ok(Answer::Word(1))
}
