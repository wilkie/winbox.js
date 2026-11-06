//! TOOLHELP's view of the global heap (`TOOLHELP.DLL` seg1 `02a2`-`06cc`,
//! types `14f7`-`168d`). As `toolhelp/global.ts`, which says what each
//! block is.

use winbox_machine::{handle_for, index_for, segment_selector};

use super::local::{heap_information, selector_of};
use super::modules::module_chain;
use super::structures::{Far, structure};
use crate::call::{Answer, Args, Stop};
use crate::handles::Object;
use crate::kernel_calls::tasks::module_of_task;
use crate::system::System;

/// `GLOBALINFO`'s and `GLOBALENTRY`'s sizes.
const GLOBALINFO: u16 = 0x0a;
const GLOBALENTRY: u16 = 0x24;

/// `GLOBALENTRY.wType`s.
const GT_UNKNOWN: u16 = 0;
pub(crate) const GT_DGROUP: u16 = 1;
pub(crate) const GT_CODE: u16 = 3;
pub(crate) const GT_TASK: u16 = 4;
pub(crate) const GT_MODULE: u16 = 6;
const GT_SENTINEL: u16 = 9;

/// The block is a task's, its owner given as the task.
pub(crate) const GF_PDB_OWNER: u16 = 0x0100;

/// A data segment's flag in its arena.
const DGROUP: u16 = 0x0004;

/// `GMEM_SHARE`: a block that is its task's module's.
const GMEM_SHARE: u16 = 0x2000;

/// A block as TOOLHELP sees it.
#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct GlobalBlock {
    pub index: usize,
    pub handle: u16,
    pub size: u32,
    pub lock: u16,
    pub page_lock: u16,
    pub flags: u16,
    pub owner: u16,
    pub kind: u16,
    pub data: u16,
}

impl System {
    fn toolhelp_block(
        &self,
        index: usize,
        owner: u16,
        kind: u16,
        data: u16,
        flags: u16,
    ) -> GlobalBlock {
        GlobalBlock {
            index,
            handle: handle_for(index),
            size: self.global.size_of(index),
            lock: u16::from(self.global.locks_of(index)),
            page_lock: self.page_locks.get(&index).copied().unwrap_or(0),
            flags,
            owner,
            kind,
            data,
        }
    }
}

/// The blocks, as `globalBlocks` gives them.
pub(crate) fn global_blocks(system: &mut System) -> Vec<GlobalBlock> {
    let mut blocks = Vec::new();
    let chain = module_chain(system);

    // Each loaded module's segments, by the module its name finds last.
    for module in &chain {
        let Some(Object::Library(index) | Object::Task(index)) =
            system.handles.resolve_module(module.handle)
        else {
            continue;
        };
        let name = system.modules[index].name.clone();
        let latest = system
            .modules
            .iter()
            .rposition(|each| each.name == name)
            .unwrap_or(index);
        let loaded = &system.modules[latest];
        let own = loaded.data();
        let segments = loaded.segments.clone();

        for (at, &segment) in segments.iter().enumerate() {
            let mine = Some(segment) == own;
            let kind = if mine { GT_DGROUP } else { GT_CODE };

            blocks.push(system.toolhelp_block(
                segment,
                module.handle,
                kind,
                at as u16 + 1,
                if mine { DGROUP } else { 0 },
            ));
        }
    }

    // A module winbox.js keeps: its data segment.
    for module in &chain {
        if let Some(Object::Kept(kept)) = system.handles.resolve_module(module.handle) {
            let data = system.kept[kept].data;

            blocks.push(system.toolhelp_block(data, module.handle, GT_DGROUP, 0, DGROUP));
        }
    }

    let indices: Vec<usize> = system.global.indices().collect();

    for index in indices {
        let task = system.block_owners.get(&index).copied().unwrap_or(0);
        let shared = system.global.flags_of(index) & GMEM_SHARE != 0;
        let owner = if !shared {
            task
        } else if system.live_task(task) {
            module_of_task(system, task)
        } else {
            0
        };

        blocks.push(system.toolhelp_block(
            index,
            owner,
            GT_UNKNOWN,
            0,
            if shared { 0 } else { GF_PDB_OWNER },
        ));
    }

    blocks.sort_by_key(|block| block.index);

    for task in system.task_list() {
        blocks.push(GlobalBlock {
            handle: task,
            owner: task,
            kind: GT_TASK,
            ..system.toolhelp_block(0, task, GT_TASK, 0, 0)
        });
    }

    // A module's database: its handle is its selector, the block's handle
    // one below (**recorded** by `thheap`).
    for module in &chain {
        blocks.push(GlobalBlock {
            size: 0,
            ..system.toolhelp_block(index_for(module.handle), module.handle, GT_MODULE, 0, 0)
        });
    }

    blocks
}

/// One of the walk's ends.
fn sentinel() -> GlobalBlock {
    GlobalBlock {
        owner: 0xffff,
        kind: GT_SENTINEL,
        ..GlobalBlock::default()
    }
}

/// The walk: its two ends and the blocks between.
fn walk(system: &mut System) -> Vec<GlobalBlock> {
    let mut list = vec![sentinel()];

    list.extend(global_blocks(system));
    list.push(sentinel());
    list
}

/// A `GLOBALENTRY` filled for a block, `next` its place in the walk from
/// 1, nought after the last.
fn fill(system: &mut System, entry: Far, found: GlobalBlock, next: u32) {
    let selector = if found.index != 0 {
        segment_selector(found.index)
    } else {
        0
    };
    let address = if selector == 0 {
        0
    } else {
        system
            .peek_descriptor(selector)
            .map_or(0, |descriptor| descriptor.base)
    };
    let heap = selector != 0 && heap_information(system, selector) != 0;

    entry.write32(system, 0x04, address);
    entry.write32(system, 0x08, found.size);
    entry.write16(system, 0x0c, found.handle);
    entry.write16(system, 0x0e, found.lock);
    entry.write16(system, 0x10, found.page_lock);
    entry.write16(system, 0x12, found.flags);
    entry.write16(system, 0x14, u16::from(heap));
    entry.write16(system, 0x16, found.owner);
    entry.write16(system, 0x18, found.kind);
    entry.write16(system, 0x1a, found.data);
    entry.write32(system, 0x1c, next);
    entry.write32(system, 0x20, next);
}

/// The place after `place` in a walk of `length`, nought after the last.
fn after(place: usize, length: usize) -> u32 {
    if place < length { place as u32 + 1 } else { 0 }
}

/// How many blocks the walk has; none free, none in a list of the least
/// recently used (seg1 `02a2`).
pub fn global_info(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);
    let Some(entry) = structure(system, far, GLOBALINFO) else {
        return Ok(Answer::Word(0));
    };
    let count = walk(system).len() as u16;

    entry.write16(system, 4, count);
    entry.write16(system, 6, 0);
    entry.write16(system, 8, 0);
    Ok(Answer::Word(1))
}

/// The walk's first block, for `GLOBAL_ALL` (seg1 `0318`).
pub fn global_first(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);
    let flags = args.word(system);
    let Some(entry) = structure(system, far, GLOBALENTRY) else {
        return Ok(Answer::Word(0));
    };

    if flags != 0 {
        return Ok(Answer::Word(0));
    }

    let list = walk(system);

    fill(system, entry, list[0], after(1, list.len()));
    Ok(Answer::Word(1))
}

/// The block after the one filled in (seg1 `0399`).
pub fn global_next(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);
    let flags = args.word(system);
    let Some(entry) = structure(system, far, GLOBALENTRY) else {
        return Ok(Answer::Word(0));
    };

    if flags != 0 {
        return Ok(Answer::Word(0));
    }

    let place = entry.read32(system, 0x1c) as usize;
    let list = walk(system);

    if place == 0 || place > list.len() {
        return Ok(Answer::Word(0));
    }

    fill(system, entry, list[place - 1], after(place, list.len()));
    Ok(Answer::Word(1))
}

/// A block's place in the walk from 1, by its handle or selector; nought.
fn place_of(list: &[GlobalBlock], handle: u16) -> usize {
    let exact = list.iter().position(|each| {
        (each.kind == GT_TASK && each.handle == handle)
            || (each.kind == GT_MODULE && each.owner == handle)
    });

    if let Some(exact) = exact {
        return exact + 1;
    }

    let index = index_for(selector_of(handle));

    list.iter()
        .position(|each| each.index != 0 && each.index == index)
        .map_or(0, |found| found + 1)
}

/// A block's entry, by its handle or a selector of it (seg1 `0417`).
/// **Recorded** by `thheap`.
pub fn global_entry_handle(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);
    let handle = args.word(system);
    let Some(entry) = structure(system, far, GLOBALENTRY) else {
        return Ok(Answer::Word(0));
    };
    let list = walk(system);
    let place = place_of(&list, handle);

    if place == 0 {
        return Ok(Answer::Word(0));
    }

    fill(system, entry, list[place - 1], after(place, list.len()));
    Ok(Answer::Word(1))
}

/// The block of a module's segment, by its number from 1 (seg1 `04a9`-
/// `0578`). **Recorded** by `thheap`.
pub fn global_entry_module(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);
    let module = args.word(system);
    let segment = args.word(system);
    let Some(entry) = structure(system, far, GLOBALENTRY) else {
        return Ok(Answer::Word(0));
    };

    if segment == 0 {
        return Ok(Answer::Word(0));
    }

    let list = walk(system);
    let Some(at) = list.iter().position(|each| {
        each.owner == module
            && (each.kind == GT_CODE || each.kind == GT_DGROUP)
            && each.data == segment
    }) else {
        return Ok(Answer::Word(0));
    };

    fill(system, entry, list[at], after(at + 1, list.len()));
    Ok(Answer::Word(1))
}
