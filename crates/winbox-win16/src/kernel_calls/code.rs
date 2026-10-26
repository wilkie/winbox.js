//! KERNEL's calls about a code segment, a module's heap, and a few that
//! answer little. As `kernel/code-calls.ts`, which cites the read-outs.

use winbox_machine::index_for;

use crate::call::{Answer, Args, Stop};
use crate::handles::Object;
use crate::system::System;
use crate::toolhelp::global::{GT_CODE, GT_DGROUP, GlobalBlock, global_blocks};
use crate::toolhelp::modules::module_chain;

/// A word of memory at a far address.
fn word(system: &System, far: u32) -> u16 {
    let bytes = system.read_far(far, 2);

    u16::from_le_bytes([bytes[0], bytes[1]])
}

/// A procedure's address, through a `MakeProcInstance` thunk to the
/// procedure it jumps to (`KRNL386.EXE` seg1 `4865`-`4883`).
fn through_thunk(system: &System, far: u32) -> u32 {
    let selector = (far >> 16) as u16;
    let at = |delta: u16| (far & 0xffff_0000) | u32::from((far as u16).wrapping_add(delta));

    if system.peek_descriptor(selector).is_some()
        && system.read_far(at(0), 1)[0] == 0xb8
        && system.read_far(at(3), 1)[0] == 0xea
    {
        return u32::from(word(system, at(6))) << 16 | u32::from(word(system, at(4)));
    }

    far
}

/// The module segment a procedure is in, or the one a module's handle and
/// a segment number name (seg1 `483e`-`48b2`).
fn segment_of(system: &mut System, proc: u32) -> Option<GlobalBlock> {
    let far = through_thunk(system, proc);
    let selector = (far >> 16) as u16;
    let blocks: Vec<GlobalBlock> = global_blocks(system)
        .into_iter()
        .filter(|block| block.kind == GT_CODE || block.kind == GT_DGROUP)
        .collect();

    if module_chain(system)
        .iter()
        .any(|module| module.handle == selector)
    {
        return blocks
            .into_iter()
            .find(|block| block.owner == selector && block.data == far as u16);
    }

    let index = index_for(selector);

    blocks
        .into_iter()
        .find(|block| block.index != 0 && block.index == index)
}

/// The handle of a procedure's code segment in AX, its selector in DX
/// (seg1 `48fa`-`4924`). **Recorded** by `ktask2`.
pub fn get_code_handle(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let proc = args.dword(system);

    Ok(Answer::Dword(segment_of(system, proc).map_or(0, |block| {
        u32::from(block.handle | 1) << 16 | u32::from(block.handle)
    })))
}

/// A segment's entry in its module's table, copied (seg1 `48bd`-`48f7`);
/// AX the sector shift, or the data segment's heap and stack. **Recorded**
/// by `ktask2`.
pub fn get_code_info(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let proc = args.dword(system);
    let info = args.dword(system);
    let Some(block) = segment_of(system, proc) else {
        return Ok(Answer::Word(0));
    };
    let Some(Object::Library(module) | Object::Task(module)) = system.handles.resolve(block.owner)
    else {
        return Ok(Answer::Word(0));
    };
    let name = system.modules[module].name.clone();
    let latest = system
        .modules
        .iter()
        .rposition(|each| each.name == name)
        .unwrap_or(module);
    let loaded = &system.modules[latest];
    let executable = std::rc::Rc::clone(&loaded.executable);
    let Some(segment) = executable
        .segments
        .get(usize::from(block.data).wrapping_sub(1))
    else {
        return Ok(Answer::Word(0));
    };
    let header = &executable.header;
    let shift = if header.page_shift == 0 {
        9
    } else {
        header.page_shift
    };
    let own = loaded.data() == Some(block.index);
    let extra = if own {
        header
            .initial_heap_size
            .wrapping_add(header.initial_stack_size)
    } else {
        0
    };
    let words = [
        (segment.offset >> shift) as u16,
        segment.length as u16,
        segment.flags,
        segment.min_allocation.wrapping_add(extra),
        block.handle,
        shift,
    ];
    let bytes: Vec<u8> = words.iter().flat_map(|word| word.to_le_bytes()).collect();

    system.write_far(info, &bytes);
    Ok(Answer::Word(if own { extra } else { shift }))
}

/// The room in a module's local heap (seg2 `1e4d`-`1e98`): AX the free
/// bytes and what its segment could grow by, DX the bytes from its heap's
/// information to the end of 64 KiB. **Recorded** by `ktask2`.
pub fn get_heap_spaces(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let module = args.word(system);
    let Some(block) = global_blocks(system)
        .into_iter()
        .find(|block| block.kind == GT_DGROUP && block.owner == module && block.index != 0)
    else {
        return Ok(Answer::Dword(0));
    };
    let selector = u32::from(block.handle | 1) << 16;
    let at = |offset: u16| selector | u32::from(offset);
    let info = word(system, at(6));
    let mut free = 0u16;

    if word(system, at(info.wrapping_add(0x28))) == 0x484c {
        let last = word(system, at(info.wrapping_add(0x0a)));
        let mut arena = word(
            system,
            at(word(system, at(info.wrapping_add(6))).wrapping_add(8)),
        );
        let mut count = 0;

        while arena != last && count < 0x8000 {
            free = free
                .wrapping_add(word(system, at(arena.wrapping_add(4))))
                .wrapping_sub(0x0a);
            arena = word(system, at(arena.wrapping_add(8)));
            count += 1;
        }
    }

    let size = system.global.size_of(block.index) as u16;
    let low = free.wrapping_sub(size);
    let high = 0xffff_u16.wrapping_sub(info);

    Ok(Answer::Dword(u32::from(high) << 16 | u32::from(low)))
}

/// The task's signal procedure given, the one it had (TDB 2Ah, seg1
/// `7dc5`-`7de0`). **Recorded** by `ktask2`.
pub fn set_task_signal_proc(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let task = args.word(system);
    let proc = args.dword(system);
    let task = if task == 0 {
        system.current_task().unwrap_or(0)
    } else {
        task
    };

    if !system.live_task(task) {
        return Ok(Answer::Dword(0));
    }

    let user = crate::kernel::module_handle_named(system, "USER");
    let first = crate::modules_kernel::proc_named(system, user, "SignalProc");
    let Some(record) = system.task_record(task) else {
        return Ok(Answer::Dword(0));
    };
    let before = record.signal.unwrap_or(first);

    record.signal = Some(proc);
    Ok(Answer::Dword(before))
}

/// A block moved in the list of the least recently used: its handle, or
/// nought for no block (seg1 `0324`-`0349`, `11b0`, `11bb`). **Recorded**
/// by `ktask2`.
pub fn global_lru(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);
    let index = index_for(handle);
    let known =
        index != 0 && (system.global.block(index).is_some() || system.global.size_of(index) != 0);

    Ok(Answer::Word(if known { handle } else { 0 }))
}

/// The room for code to be swapped through, given in paragraphs: AX the
/// room it has, DX its most (seg1 `2ede`-`2f25`). **Recorded** by `ktask2`:
/// nought given, nought and `FFFFh`. winbox.js swaps no code, and keeps the
/// room given as had.
pub fn set_swap_area_size(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    const MOST: u16 = 0xffff;
    // Clipped to the most, which is all a word holds.
    let given = args.word(system);

    if given != 0 {
        system.swap_area = given;
    }

    Ok(Answer::Dword(
        u32::from(MOST) << 16 | u32::from(system.swap_area),
    ))
}

/// The drive whose disk was last changed, given once (seg1 `5c17`-`5c24`):
/// nought. **Recorded** by `ktask2`.
pub fn get_last_disk_change(_system: &mut System, _args: &mut Args) -> Result<Answer, Stop> {
    Ok(Answer::Word(0))
}

/// Nought where KERNEL keeps no swap figures (seg1 `2ea7`-`2edb`).
/// **Recorded** by `ktask2`.
pub fn memory_freed(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    args.word(system);
    Ok(Answer::Dword(0))
}
