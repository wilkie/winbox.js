//! TOOLHELP's view of a local heap, read where KERNEL keeps it, in the
//! segment (`TOOLHELP.DLL` seg1 `0744`-`07e9`, `0a4f`-`0a8d`). As
//! `toolhelp/local.ts`.

use winbox_machine::segment_selector;

use super::structures::{Far, structure};
use crate::call::{Answer, Args, Stop};
use crate::system::System;

/// `LOCALINFO`'s and `LOCALENTRY`'s sizes.
const LOCALINFO: u16 = 6;
const LOCALENTRY: u16 = 0x16;

/// `LOCALENTRY.wFlags`: fixed, free, moveable; `wType` of a free block.
const LF_FIXED: u16 = 1;
const LF_FREE: u16 = 2;
const LF_MOVEABLE: u16 = 4;
const LT_FREE: u16 = 0xff;

/// A handle's selector, its lowest bit set (seg1 `14c4`-`14e5`).
pub(crate) fn selector_of(handle: u16) -> u16 {
    handle | 1
}

/// A word of a segment.
fn word(system: &System, selector: u16, at: u16) -> u16 {
    let bytes = system.read_far(u32::from(selector) << 16 | u32::from(at), 2);

    u16::from_le_bytes([bytes[0], bytes[1]])
}

/// Where a segment's local heap's information is, if it has one (seg1
/// `07ec`-`0847`); nought for none.
pub(crate) fn heap_information(system: &System, selector: u16) -> u16 {
    let Some(descriptor) = system.peek_descriptor(selector) else {
        return 0;
    };

    if !descriptor.present || descriptor.limit <= 0x2a {
        return 0;
    }

    let info = word(system, selector, 6);

    if info == 0
        || descriptor.limit.wrapping_sub(u32::from(info)) <= 0x2a
        || descriptor.limit < u32::from(info)
    {
        return 0;
    }

    if word(system, selector, info.wrapping_add(0x28)) == 0x484c {
        info
    } else {
        0
    }
}

/// How many arenas a heap has (seg1 `06f6`).
pub fn local_info(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);
    let heap = args.word(system);
    let Some(entry) = structure(system, far, LOCALINFO) else {
        return Ok(Answer::Word(0));
    };
    let selector = selector_of(heap);
    let info = heap_information(system, selector);
    let count = if info == 0 {
        0
    } else {
        word(system, selector, info.wrapping_add(4))
    };

    entry.write16(system, 4, count);
    Ok(Answer::Word(1))
}

/// A `LOCALENTRY` filled for the arena at `arena`; see `fill` in
/// `local.ts`.
fn fill(system: &mut System, entry: Far, selector: u16, arena: u16) {
    let data = |name: &str| {
        system
            .kept_named(name)
            .map_or(0, |kept| segment_selector(system.kept[kept].data))
    };
    let (user, gdi) = (data("USER"), data("GDI"));
    let next = word(system, selector, arena.wrapping_add(2));
    let bits = word(system, selector, arena) & 3;
    let mut address = arena.wrapping_add(4);
    let mut size = next.wrapping_sub(arena).wrapping_sub(4);
    let mut handle = word(system, selector, arena.wrapping_add(4));
    let mut lock = 0;

    if bits & 2 != 0 {
        size = size.wrapping_sub(2);
        address = address.wrapping_add(2);
        lock = system.read_far(
            u32::from(selector) << 16 | u32::from(handle.wrapping_add(3)),
            1,
        )[0];
    } else {
        handle = address;
    }

    let flags = if bits & 2 != 0 {
        LF_MOVEABLE
    } else if bits & 1 != 0 {
        LF_FIXED
    } else {
        LF_FREE
    };
    let free = flags == LF_FREE;
    let heap_type = if selector == user {
        1
    } else if selector == gdi {
        2
    } else {
        0
    };

    entry.write16(system, 0x04, if free { 0 } else { handle });
    entry.write16(system, 0x06, address);
    entry.write16(system, 0x08, size);
    entry.write16(system, 0x0a, flags);
    entry.write16(system, 0x0c, u16::from(lock));
    entry.write16(system, 0x0e, if free { LT_FREE } else { 0 });
    entry.write16(system, 0x10, selector);
    entry.write16(system, 0x12, heap_type);
    entry.write16(system, 0x14, if next == arena { 0 } else { next });
}

/// A heap's first arena (seg1 `095e`).
pub fn local_first(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);
    let heap = args.word(system);
    let Some(entry) = structure(system, far, LOCALENTRY) else {
        return Ok(Answer::Word(0));
    };
    let selector = selector_of(heap);
    let info = heap_information(system, selector);

    if info == 0 {
        return Ok(Answer::Word(0));
    }

    let first = word(system, selector, info.wrapping_add(6));

    if first == 0 {
        return Ok(Answer::Word(0));
    }

    fill(system, entry, selector, first);
    Ok(Answer::Word(1))
}

/// The arena after the one filled in (seg1 `09e9`): FALSE at the last.
/// **Recorded** by `thheap`.
pub fn local_next(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);
    let Some(entry) = structure(system, far, LOCALENTRY) else {
        return Ok(Answer::Word(0));
    };
    let selector = entry.read16(system, 0x10);
    let next = entry.read16(system, 0x14);

    fill(system, entry, selector, next);
    Ok(Answer::Word(u16::from(entry.read16(system, 0x14) != 0)))
}
