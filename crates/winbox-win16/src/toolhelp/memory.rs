//! `MemoryRead` and `MemoryWrite` (`TOOLHELP.DLL` seg1 `29c4`-`2d68`). As
//! `toolhelp/memory.ts`.

use winbox_machine::index_for;

use super::global::{GT_MODULE, global_blocks};
use super::local::selector_of;
use crate::call::{Answer, Args, Stop};
use crate::system::System;

/// How many bytes from `offset` a selector reaches, and its base; see
/// `reach` in `memory.ts`.
fn reach(system: &mut System, handle: u16, offset: u32, count: u32) -> (u32, u32) {
    let selector = selector_of(handle);
    let Some(descriptor) = system.peek_descriptor(selector) else {
        return (0, 0);
    };

    if !descriptor.present && !descriptor.executable {
        return (descriptor.base, 0);
    }

    let index = index_for(selector);
    let size = global_blocks(system)
        .into_iter()
        .find(|block| block.index != 0 && block.index == index && block.kind != GT_MODULE)
        .map_or(descriptor.limit, |block| block.size);

    if offset >= size {
        return (descriptor.base, 0);
    }

    let room = u64::from(descriptor.limit) - u64::from(offset) + 1;

    (descriptor.base, u64::from(count).min(room) as u32)
}

/// Bytes read through a selector into a buffer: how many. **Recorded** by
/// `thtask`.
pub fn memory_read(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);
    let offset = args.dword(system);
    let buffer = args.dword(system);
    let count = args.dword(system);
    let (base, count) = reach(system, handle, offset, count);

    for at in 0..count {
        let byte = system
            .cpu
            .bus
            .read8(base.wrapping_add(offset).wrapping_add(at));
        let far = (buffer & 0xffff_0000) | u32::from((buffer as u16).wrapping_add(at as u16));

        system.write_far(far, &[byte]);
    }

    Ok(Answer::Dword(count))
}

/// Bytes written through a selector, even a code segment's, from a
/// buffer: how many. **Recorded** by `thtask`.
pub fn memory_write(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);
    let offset = args.dword(system);
    let buffer = args.dword(system);
    let count = args.dword(system);
    let (base, count) = reach(system, handle, offset, count);

    for at in 0..count {
        let far = (buffer & 0xffff_0000) | u32::from((buffer as u16).wrapping_add(at as u16));
        let byte = system.read_far(far, 1)[0];

        system
            .cpu
            .bus
            .write8(base.wrapping_add(offset).wrapping_add(at), byte);
    }

    Ok(Answer::Dword(count))
}
