//! KERNEL's global and local memory, as a program asks for it.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

use winbox_cpu::DS;
use winbox_machine::{LocalHeap, LocalOptions, handle_for, index_for, segment_selector};

use crate::call::{Answer, Args, Stop};
use crate::system::System;

const GMEM_MOVEABLE: u16 = 0x0002;
const GMEM_ZEROINIT: u16 = 0x0040;
const GMEM_MODIFY: u16 = 0x0080;
const GMEM_DISCARDABLE: u16 = 0x0100;
const LMEM_MOVEABLE: u16 = 0x0002;
const LMEM_ZEROINIT: u16 = 0x0040;
const LMEM_MODIFY: u16 = 0x0080;

/// A selector of a handle: the same descriptor, at a program's privilege.
fn selector_for(handle: u16) -> u16 {
    segment_selector(index_for(handle))
}

impl System {
    /// A local heap made in a segment, as `LocalInit` makes one: a start
    /// of nought puts it at the segment's end, as big as `end` says, ending
    /// a byte short of the segment's size, 64K or more counting as `FFFFh`
    /// (`KRNL386.EXE` seg2 `28c7`); a start under 16 is 16. None where the
    /// segment has one, or the heap does not fit.
    pub fn local_init(&mut self, index: usize, start: u32, end: u32) -> bool {
        let (start, end) = if start == 0 {
            let size = match self.global.size_of(index) {
                0 => 0xffff,
                size => size.min(0xffff),
            };

            (size.wrapping_sub(1).wrapping_sub(end), size - 1)
        } else {
            (start, end)
        };
        let start = start.max(16);

        if self.heaps.contains_key(&index) {
            return false;
        }

        if end < start || end > 0xffff {
            return false;
        }

        let size = end - start;

        let mut heap = LocalHeap::new(index, start, size);

        heap.growable = self.growable.contains(&index);

        // A heap in a block of `GlobalAlloc`'s grows, and the block with it
        // (`lheapseg`).
        if self.global.block(index).is_some() {
            heap.growable = true;
            self.heap_blocks.insert(index);
        }

        self.heaps.insert(index, heap);
        true
    }

    /// The block a heap is in grown to the heap's end, if it grew past it.
    pub(crate) fn follow_growth(&mut self, index: usize) {
        let Some(end) = self.heaps.get_mut(&index).and_then(LocalHeap::take_growth) else {
            return;
        };

        if self.heap_blocks.contains(&index) && end > self.global.size_of(index) {
            self.global
                .resize(&mut self.cpu.bus, &mut self.descriptors, index, end);
        }
    }

    /// What was kept for each selector of a block let go -- a local heap
    /// made in it -- let go with it, or the next block given the selector
    /// finds it (`lheapseg`).
    fn forget_heaps(&mut self, index: usize, selectors: usize) {
        for tile in index..index + selectors {
            self.heaps.remove(&tile);
            self.heap_blocks.remove(&tile);
        }
    }

    /// The heap of the segment in DS, and its index.
    fn data_heap(&self) -> usize {
        index_for(self.cpu.segments[DS].selector)
    }
}

pub fn global_alloc(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let flags = args.word(system);
    let size = args.dword(system);
    let index = system
        .global
        .allocate(&mut system.cpu.bus, &mut system.descriptors, size, flags);

    Ok(Answer::Word(index.map_or(0, handle_for)))
}

/// A block's address: through its handle's selector, from nought. `FFFFh` is
/// the caller's own data segment (`glock`); a handle that names no
/// present segment, or a discarded block, nought.
pub fn global_lock(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);

    if handle == 0xffff {
        return Ok(Answer::Dword(
            u32::from(system.cpu.segments[DS].selector) << 16,
        ));
    }

    let index = index_for(handle);
    let present = system
        .cpu
        .bus
        .read8(system.cpu.ldt_base + 8 * index as u32 + 5)
        & 0x80
        != 0;

    if index == 0 || !present || system.global.is_discarded(index) {
        return Ok(Answer::Dword(0));
    }

    Ok(Answer::Dword(u32::from(selector_for(handle)) << 16))
}

/// Lock counts are not kept: nought.
pub fn global_unlock(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    args.word(system);
    Ok(Answer::Dword(0))
}

pub fn global_free(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);
    let index = index_for(handle);
    let selectors = system
        .global
        .block(index)
        .map_or(0, |block| block.selectors);
    let freed = system
        .global
        .free(&mut system.cpu.bus, &mut system.descriptors, index);

    system.forget_heaps(index, selectors);

    Ok(Answer::Word(if freed { 0 } else { handle }))
}

/// A block given a new size, or with `GMEM_MODIFY` only its flags; nought
/// and moveable, discarded, its handle kept. Grown with `GMEM_ZEROINIT`,
/// what it reaches past where it ended is noughts; grown past its
/// selectors, it moves, and has a handle of its new place.
pub fn global_realloc(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);
    let size = args.dword(system);
    let flags = args.word(system);
    let index = index_for(handle);

    if flags & GMEM_MODIFY != 0 {
        let kept = system.global.modify(index, flags & GMEM_DISCARDABLE != 0);

        return Ok(Answer::Word(if kept { handle } else { 0 }));
    }

    if size == 0 && flags & GMEM_MOVEABLE != 0 {
        return Ok(Answer::Word(if system.global.discard(index) {
            handle
        } else {
            0
        }));
    }

    let before = system.global.size_of(index);
    let selectors = system
        .global
        .block(index)
        .map_or(0, |block| block.selectors);
    let Some(moved) =
        system
            .global
            .resize(&mut system.cpu.bus, &mut system.descriptors, index, size)
    else {
        return Ok(Answer::Word(0));
    };
    let after = system.global.size_of(moved);

    if flags & GMEM_ZEROINIT != 0 && after > before {
        system
            .cpu
            .bus
            .zero(((moved as u32) << 16) + before, (after - before) as usize);
    }

    if moved != index {
        // Moved, the block's old selectors were let go.
        system.forget_heaps(index, selectors);

        let moved_handle = handle_for(moved);

        return Ok(Answer::Word(if handle & 1 != 0 {
            selector_for(moved_handle)
        } else {
            moved_handle
        }));
    }

    Ok(Answer::Word(handle))
}

/// Its discardable flag, `GMEM_DISCARDED` for a block discarded, and its
/// lock count: nought through nested locks, but a block wired counts
/// (`misc`).
pub fn global_flags(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let index = index_for(args.word(system));
    let discarded = if system.global.is_discarded(index) {
        0x4000
    } else {
        0
    };
    let wired = system.wired.get(&index).copied().unwrap_or(0) & 0xff;

    Ok(Answer::Word(
        (system.global.flags_of(index) & 0x0100) | discarded | wired,
    ))
}

/// A block locked and counted as wired: its address, as `GlobalLock`'s.
pub fn global_wire(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);
    let mut again = Args::repeat(handle);
    let far = global_lock(system, &mut again)?;

    if far != Answer::Dword(0) {
        *system.wired.entry(index_for(handle)).or_insert(0) += 1;
    }

    Ok(far)
}

/// A block's page lock counted up: the count.
pub fn global_page_lock(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let index = index_for(args.word(system));
    let count = system.page_locks.entry(index).or_insert(0);

    *count += 1;
    Ok(Answer::Word(*count))
}

/// A wired block let go, its wiring counted down; -1.
pub fn global_unwire(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let index = index_for(args.word(system));
    let count = system.wired.get(&index).copied().unwrap_or(0);

    if count > 1 {
        system.wired.insert(index, count - 1);
    } else {
        system.wired.remove(&index);
    }

    Ok(Answer::Word(0xffff))
}

/// A block's page lock counted down, not below nought: the count.
pub fn global_page_unlock(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let index = index_for(args.word(system));
    let count = system.page_locks.entry(index).or_insert(0);

    *count = count.saturating_sub(1);
    Ok(Answer::Word(*count))
}

pub fn local_init(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let segment = args.word(system);
    let start = args.word(system);
    let end = args.word(system);
    // A selector, or nought for DS.
    let segment = if segment == 0 {
        system.cpu.segments[DS].selector
    } else {
        segment
    };
    let made = system.local_init(index_for(segment), u32::from(start), u32::from(end));

    Ok(Answer::Word(u16::from(made)))
}

pub fn local_alloc(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let flags = args.word(system);
    let size = args.word(system);
    let index = system.data_heap();
    let options = LocalOptions {
        movable: flags & LMEM_MOVEABLE != 0,
        zero_init: flags & LMEM_ZEROINIT != 0,
    };
    let Some(heap) = system.heaps.get_mut(&index) else {
        return Ok(Answer::Word(0));
    };
    let block = heap.allocate(&mut system.cpu.bus, u32::from(size), options);

    system.follow_growth(index);
    Ok(Answer::Word(block.map_or(0, |block| block as u16)))
}

pub fn local_free(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);
    let index = system.data_heap();
    let Some(heap) = system.heaps.get_mut(&index) else {
        return Ok(Answer::Word(handle));
    };

    heap.free(u32::from(handle));
    Ok(Answer::Word(0))
}

pub fn local_lock(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = u32::from(args.word(system));
    let index = system.data_heap();

    Ok(Answer::Word(match system.heaps.get(&index) {
        Some(heap) if handle != 0 && heap.size_of(handle) != 0 => heap.resolve(handle) as u16,
        _ => 0,
    }))
}

pub fn local_unlock(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    args.word(system);
    Ok(Answer::Word(0))
}

pub fn local_size(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = u32::from(args.word(system));
    let index = system.data_heap();

    Ok(Answer::Word(
        system
            .heaps
            .get(&index)
            .map_or(0, |heap| heap.size_of(handle) as u16),
    ))
}

pub fn local_realloc(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);
    let size = args.word(system);
    let flags = args.word(system);
    let index = system.data_heap();
    let Some(heap) = system.heaps.get_mut(&index) else {
        return Ok(Answer::Word(0));
    };

    if handle == 0 {
        return Ok(Answer::Word(0));
    }

    if flags & LMEM_MODIFY != 0 {
        return Ok(Answer::Word(handle));
    }

    let block = heap.reallocate(
        &mut system.cpu.bus,
        u32::from(handle),
        u32::from(size),
        flags & LMEM_MOVEABLE != 0,
        flags & LMEM_ZEROINIT != 0,
    );

    system.follow_growth(index);
    Ok(Answer::Word(block.map_or(0, |block| block as u16)))
}

/// The largest free block of the heap in DS, less the four bytes Windows
/// keeps before every block.
pub fn local_compact(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    args.word(system);

    let index = system.data_heap();

    Ok(Answer::Word(system.heaps.get(&index).map_or(0, |heap| {
        heap.largest_free().saturating_sub(4).min(0xffff) as u16
    })))
}

/// Shrinks a local heap as far as what is in it allows. **Read out of
/// `KRNL386.EXE`**: it answers the heap's span, from its first arena to
/// past its last, which is not what `LocalCompact` answers -- **recorded**
/// by `minis3` for the caller's own heap. A segment of nought is the
/// caller's data segment. These heaps do not shrink; it answers the heap's
/// size.
pub fn local_shrink(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let segment = args.word(system);
    let _size = args.word(system);
    let index = if segment == 0 {
        system.data_heap()
    } else {
        index_for(segment)
    };

    Ok(Answer::Word(
        system
            .heaps
            .get(&index)
            .map_or(0, |heap| heap.size() as u16),
    ))
}

/// `LocalHandle` and `LocalFlags`, which the TypeScript engine answers
/// with nothing, nought.
pub fn local_nought(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    args.word(system);
    Ok(Answer::Word(0))
}
