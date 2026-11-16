//! KERNEL's variables that `THHOOK` points a reader at, and the global
//! heap's own block that `GlobalMasterHandle` answers, with the selector
//! table and the blocks' arenas in it. **Recorded** by `kgaps` and
//! `seltab`.

use winbox_machine::{index_for, segment_selector};

use crate::call::{Answer, Args, Stop};
use crate::system::System;
use crate::toolhelp::global::{GF_PDB_OWNER, GT_TASK, global_blocks};

/// Where `THHOOK` points, in KERNEL's data (`KRNL386.EXE` seg4 `0218`).
pub const THHOOK_OFFSET: u16 = 0x218;

const HEAP_HANDLE: u16 = 0x218;
const HEAP_SELECTOR: u16 = 0x21a;
const FIRST_MODULE: u16 = 0x21c;
const KERNEL_PDB: u16 = 0x220;
const FIRST_PDB: u16 = 0x222;
const FIRST_TASK: u16 = 0x226;
const RUNNING_TASK: u16 = 0x228;
const TASK_MADE: u16 = 0x22a;
/// The selector table's length in bytes, and its place in the heap's own
/// block (`KRNL386.EXE` seg1 `297c`-`29a3`, `be75`, `be98`).
const TABLE_LENGTH_WORD: u16 = 0x22e;
const TABLE_START_WORD: u16 = 0x230;

/// The selector table's length: one entry of four bytes for each eight
/// selector values, the whole local descriptor table's 8,192. `GlobalInit`
/// makes it 4000h, or 8000h where DPMI 0500h names 100h unlocked pages or
/// more (`KRNL386.EXE` seg1 `be25`-`be43`), rounded up to 20h (`be6f`-`be75`);
/// **recorded** by `seltab`, 8000h in both modes.
const TABLE_LENGTH: u16 = 0x8000;

/// Where the table is in the heap's own block: past the block's header,
/// 80h (seg1 `be88`-`be8e`, 9Dh with its low five bits cleared), and the
/// room for arenas, the largest free block DPMI 0500h names as Windows
/// starts divided by 128, rounded up to 20h, and no less than 8000h
/// (`be5b`-`be82`). The block runs to the table's end (`be9e`, `beb3`,
/// DPMI 0501h). **Recorded** by `seltab` on the oracle's machine: 1D7C0h
/// in standard mode, 728E0h in enhanced mode, the block's last byte
/// 257BFh and 7A8DFh -- largest blocks of `EBA000h` and `3943000h` as
/// Windows started.
const TABLE_START_STANDARD: u32 = 0x1_d7c0;
const TABLE_START_ENHANCED: u32 = 0x7_28e0;

/// The block's header, before the first arena.
const HEADER: u32 = 0x80;

/// An arena's bytes, and what of it is laid out: the words `TOOLHELP.DLL`
/// reads for a `GLOBALENTRY` (seg1 `060f`-`06b1`). The next arena's
/// place, the last's its own (`06ac`); the block's linear address; its
/// size; its handle; its owner (K404's word, seg1 `29da`); its lock
/// count; its page lock count; its flags. **Recorded** by `seltab`: an
/// entry is the arena's offset in the heap's own block, a multiple of
/// 20h; the address, size and handle are the block's; the owner is a
/// segment's module, a block of `GlobalAlloc`'s its task's prefix; the
/// flags 4 for a data segment, else nought.
const ARENA: u32 = 0x20;
const ARENA_NEXT: u32 = 0x00;
const ARENA_ADDRESS: u32 = 0x08;
const ARENA_SIZE: u32 = 0x0c;
const ARENA_HANDLE: u32 = 0x10;
const ARENA_OWNER: u32 = 0x12;
const ARENA_LOCKS: u32 = 0x14;
const ARENA_PAGE_LOCKS: u32 = 0x15;
const ARENA_FLAGS: u32 = 0x16;

/// The owner word of the heap's own block's arena (**recorded** by
/// `seltab`).
const MASTER_OWNER: u16 = 0xfffd;

/// Where the selector table is in the heap's own block, as the mode has it.
fn table_start(system: &System) -> u32 {
    match system.mode {
        crate::Mode::Standard => TABLE_START_STANDARD,
        crate::Mode::Enhanced => TABLE_START_ENHANCED,
    }
}

/// The global heap's own block, made the first time it is asked for:
/// fixed, its handle its selector.
pub(crate) fn master_block(system: &mut System) -> u16 {
    if let Some(selector) = system.kernel_calls.master_block {
        return selector;
    }

    let size = table_start(system) + u32::from(TABLE_LENGTH);
    let index = system
        .global
        .allocate(&mut system.cpu.bus, &mut system.descriptors, size, 0);

    // Windows takes it of DPMI as it starts, apart from the heap's blocks
    // (seg1 `beb3`): none of what a program is told is free.
    if let Some(index) = index {
        system.global.hold_apart(index);
    }

    let selector = index.map_or(0, segment_selector);

    system.kernel_calls.master_block = Some(selector);
    selector
}

/// The selector table and the arenas, laid out in the heap's own block
/// from WinBox's blocks as TOOLHELP sees them (`global_blocks`), again
/// whenever they may have changed: an arena for each block, in the order
/// of their selectors, from the header on, and the entry of each block's
/// first selector its arena's offset. A block of more selectors has an
/// entry for its first alone; a selector of `AllocSelector`'s, or of a
/// block freed, none (**recorded** by `seltab`).
fn lay_out_arenas(system: &mut System, master: u16) {
    let signature = (
        system.global.generation(),
        system.task_list().len(),
        system.modules.len(),
    );

    if system.kernel_calls.arenas_laid == Some(signature) || master == 0 {
        return;
    }

    system.kernel_calls.arenas_laid = Some(signature);

    let base = system.base_of(master);
    let start = table_start(system);
    let room = (start - HEADER) / ARENA;
    let mut blocks: Vec<(usize, u16, u32, u16, u8, u8, u8)> = Vec::new();

    for block in global_blocks(system) {
        let index = if block.kind == GT_TASK {
            index_for(block.handle)
        } else {
            block.index
        };

        if index == 0 || blocks.iter().any(|each| each.0 == index) {
            continue;
        }

        let owner = if index == index_for(master) {
            MASTER_OWNER
        } else if block.flags & GF_PDB_OWNER != 0 {
            system.prefix_of(block.owner)
        } else {
            block.owner
        };
        let size = if block.size != 0 {
            block.size
        } else {
            system.global.size_of(index)
        };

        blocks.push((
            index,
            block.handle,
            size,
            owner,
            block.lock as u8,
            block.page_lock as u8,
            block.flags as u8,
        ));
    }

    blocks.sort_by_key(|block| block.0);
    blocks.truncate(room as usize);

    // The entries written before made noughts again, and the arenas past
    // the last there is now.
    let before = system.kernel_calls.table_entries.len() as u32;

    for index in std::mem::take(&mut system.kernel_calls.table_entries) {
        system.cpu.bus.write32(base + start + 4 * index as u32, 0);
    }

    let count = blocks.len() as u32;

    for place in count..before {
        system
            .cpu
            .bus
            .write(base + HEADER + ARENA * place, &[0; ARENA as usize]);
    }

    for (place, &(index, handle, size, owner, locks, page_locks, flags)) in
        blocks.iter().enumerate()
    {
        let arena = HEADER + ARENA * place as u32;
        let next = if place as u32 + 1 < count {
            arena + ARENA
        } else {
            arena
        };
        let address = system.base_of(segment_selector(index));
        let at = base + arena;
        let bus = &mut system.cpu.bus;

        bus.write32(at + ARENA_NEXT, next);
        bus.write32(at + ARENA_ADDRESS, address);
        bus.write32(at + ARENA_SIZE, size);
        bus.write16(at + ARENA_HANDLE, handle);
        bus.write16(at + ARENA_OWNER, owner);
        bus.write8(at + ARENA_LOCKS, locks);
        bus.write8(at + ARENA_PAGE_LOCKS, page_locks);
        bus.write8(at + ARENA_FLAGS, flags);

        if 4 * (index as u32) < u32::from(TABLE_LENGTH) {
            bus.write32(base + start + 4 * index as u32, arena);
            system.kernel_calls.table_entries.push(index);
        }
    }
}

/// `GlobalMasterHandle` (seg1 `1190`-`119e`): the block's selector in AX
/// and DX.
pub fn global_master_handle(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    let selector = master_block(system);

    Ok(Answer::Dword(
        u32::from(selector) << 16 | u32::from(selector),
    ))
}

/// The newest live task's prefix, the head of KERNEL's chain of them.
fn newest_pdb(system: &System) -> u16 {
    let Some(slot) = system.scheduler.slots.iter().rposition(|slot| !slot.ended) else {
        return 0;
    };

    if system.scheduler.current == Some(slot) {
        return system
            .task
            .as_ref()
            .map_or(0, |task| segment_selector(task.program_segment));
    }

    system.scheduler.slots[slot]
        .saved
        .as_ref()
        .and_then(|context| context.task.as_ref())
        .map_or(0, |task| segment_selector(task.program_segment))
}

impl System {
    /// KERNEL's words at 218h-22Bh written as they stand, once `THHOOK`'s
    /// address has been handed out: written then, and again as each call
    /// returns, since a task switches only inside a call.
    pub(crate) fn refresh_thhook(&mut self) {
        let Some(kernel) = self.kept_named("KERNEL") else {
            return;
        };
        let data = u32::from(segment_selector(self.kept[kernel].data)) << 16;
        let master = master_block(self);
        let module = crate::kernel::module_handle_named(self, "KERNEL");
        let pdb = newest_pdb(self);
        let head = self.task_list().first().copied().unwrap_or(0);
        let running = if self.live_task(self.task_handle) {
            self.task_handle
        } else {
            0
        };

        for (at, value) in [
            (HEAP_HANDLE, master),
            (HEAP_SELECTOR, master),
            (FIRST_MODULE, module),
            (KERNEL_PDB, 0),
            (FIRST_PDB, pdb),
            (FIRST_TASK, head),
            (RUNNING_TASK, running),
            (TASK_MADE, 0),
        ] {
            self.write_far(data | u32::from(at), &value.to_le_bytes());
        }

        self.write_far(
            data | u32::from(TABLE_LENGTH_WORD),
            &TABLE_LENGTH.to_le_bytes(),
        );
        self.write_far(
            data | u32::from(TABLE_START_WORD),
            &table_start(self).to_le_bytes(),
        );
        lay_out_arenas(self, master);
    }

    /// `THHOOK`'s address handed out: its words laid out, and kept so.
    pub(crate) fn thhook_handed_out(&mut self) {
        self.kernel_calls.thhook_out = true;
        self.refresh_thhook();
    }
}

#[cfg(test)]
mod tests {
    use winbox_machine::{handle_for, index_for, segment_selector};

    use super::*;

    /// The table's entry of a selector, as KERNEL reads it (seg1 `297c`).
    fn entry(system: &System, master: u16, selector: u16) -> u32 {
        let offset = u32::from(selector & !7) >> 1;

        system
            .cpu
            .bus
            .read32(system.base_of(master) + table_start(system) + offset)
    }

    /// `seltab`: a block's first selector's entry is its arena's offset in
    /// the heap's own block, a multiple of 20h, and the arena holds the
    /// block's address, size and handle; a block's second selector has
    /// none, and a block freed loses its entry.
    #[test]
    fn a_blocks_first_selector_names_its_arena() {
        let mut system = System::new();
        let master = master_block(&mut system);
        let small = system
            .global
            .allocate(&mut system.cpu.bus, &mut system.descriptors, 100, 2)
            .unwrap();
        let big = system
            .global
            .allocate(&mut system.cpu.bus, &mut system.descriptors, 0x2_0000, 2)
            .unwrap();

        lay_out_arenas(&mut system, master);

        let at = entry(&system, master, segment_selector(small));
        let arena = system.base_of(master) + at;
        let bus = &system.cpu.bus;

        assert!(at >= HEADER && at < table_start(&system));
        assert_eq!(at % ARENA, 0);
        assert_eq!(
            bus.read32(arena + ARENA_ADDRESS),
            system.base_of(segment_selector(small))
        );
        assert_eq!(bus.read32(arena + ARENA_SIZE), 128);
        assert_eq!(bus.read16(arena + ARENA_HANDLE), handle_for(small));
        assert_ne!(entry(&system, master, segment_selector(big)), 0);
        assert_eq!(entry(&system, master, segment_selector(big + 1)), 0);

        // The heap's own block has its arena too, its owner FFFDh.
        let own = system.base_of(master) + entry(&system, master, master);

        assert_eq!(system.cpu.bus.read16(own + ARENA_OWNER), MASTER_OWNER);

        system
            .global
            .free(&mut system.cpu.bus, &mut system.descriptors, small);
        lay_out_arenas(&mut system, master);

        assert_eq!(entry(&system, master, segment_selector(small)), 0);
        assert_ne!(entry(&system, master, segment_selector(big)), 0);
    }

    /// `seltab`: the heap's own block runs to the table's end, and is none
    /// of what a program is told is free.
    #[test]
    fn the_heaps_own_block_holds_the_table_and_is_not_counted() {
        let mut system = System::new();

        system.global.settle();

        let figures = system.memory_figures();
        let free = system.global.free_space(figures);
        let master = master_block(&mut system);

        assert_eq!(
            system.global.size_of(index_for(master)),
            TABLE_START_STANDARD + u32::from(TABLE_LENGTH)
        );
        assert_eq!(system.global.free_space(figures), free);
    }
}
