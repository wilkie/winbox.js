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

/// A global block's lock count, as KERNEL keeps it: one byte in the block's
/// arena, which `GlobalFlags` answers in its low byte. **Recorded** by
/// `glocks` and `misc`, and **read out** of `KRNL386.EXE` seg1:
///
/// * `GlobalLock` (`0f9d`) counts a block up only where its descriptor
///   marks it discardable, and without a ceiling: 255 locks more is nought.
///   `glocks`: a discardable block shows 101h, then 102h; a moveable or a
///   fixed one 0 however often it is locked.
/// * `GlobalUnlock` (`0fe6`) counts a discardable block down and answers
///   the count left, nought for any other block; a count of nought, or of
///   `FFh`, is left as it is and answers nought. `glocks`: 1 after two locks
///   and one unlock, 0 for a moveable or a fixed block.
/// * `GlobalWire` (`1046`) counts any block it finds up, discardable or not
///   (`misc`: a moveable block wired shows a count of one), and
///   `GlobalUnWire` (`10da`) counts it down as `GlobalUnlock` does,
///   answering -1 once it is nought and nought while it is not.
/// * `LockSegment` (`0f1e`) and `GlobalFix` (`0f2d`) count up to `FFh` and no
///   further (`45f7`); `UnlockSegment` (`0f37`) and `GlobalUnfix` (`0f46`)
///   count down as `GlobalUnlock` does (`4602`), leaving the count in CX.
///   `LockSegment` and `UnlockSegment` count only a discardable block,
///   `GlobalFix` and `GlobalUnfix` any block.
/// * A fixed block has no count: the routine each of these finds a block
///   with (`2519`) gives a count only for a block whose handle is not its
///   selector, so none of them counts one and `GlobalFlags` shows nought.
/// * `GlobalReAlloc` will not discard a block whose count is not nought
///   (`40f9`, at `4129`): it answers NULL. `GlobalFree` frees a locked
///   block all the same (`glocks`).
///
/// KERNEL's own `LockResource` locks with `GlobalLock` (seg1 `8768`). The
/// pointers winbox.js's own modules take to blocks are not counted
/// (`global_pointer`): what a program sees of a count is only what it, or
/// KERNEL for it, has counted.
impl System {
    /// A block there to be counted: given out, and not discarded.
    fn present_block(&self, index: usize) -> bool {
        index != 0 && self.global.block(index).is_some() && !self.global.is_discarded(index)
    }

    /// Whether a block is discardable: `GMEM_DISCARDABLE`.
    pub(crate) fn is_discardable(&self, index: usize) -> bool {
        self.present_block(index) && self.global.flags_of(index) & GMEM_DISCARDABLE != 0
    }

    /// Whether a block is not fixed: moveable, or discardable.
    pub(crate) fn is_moveable(&self, index: usize) -> bool {
        self.present_block(index)
            && self.global.flags_of(index) & (GMEM_MOVEABLE | GMEM_DISCARDABLE) != 0
    }

    /// Counted up, as `GlobalLock` and `GlobalWire` count: 255 and one is
    /// nought.
    fn lock_up(&mut self, index: usize) {
        let count = self.global.locks_of(index);

        self.global.set_locks(index, count.wrapping_add(1));
    }

    /// Counted up, as `LockSegment` and `GlobalFix` count: no further than
    /// `FFh`.
    pub(crate) fn lock_up_to_ceiling(&mut self, index: usize) {
        let count = self.global.locks_of(index);

        if count < 0xff {
            self.global.set_locks(index, count + 1);
        }
    }

    /// Counted down: the count left. A count of nought or `FFh` is left as it
    /// is, and answers nought.
    pub(crate) fn lock_down(&mut self, index: usize) -> u8 {
        let count = self.global.locks_of(index);

        if count == 0 || count == 0xff {
            return 0;
        }

        self.global.set_locks(index, count - 1);
        count - 1
    }

    /// A block's address, as `GlobalLock` answers it, without counting a
    /// lock: for winbox.js's own modules, whose pointers to a block are not
    /// a program's to see in its count.
    pub(crate) fn global_pointer(&self, handle: u16) -> u32 {
        global_address(self, handle)
    }
}

/// A block's address: through its handle's selector, from nought. `FFFFh` is
/// the caller's own data segment (`glock`); a handle that names no
/// present segment, or a discarded block, nought.
fn global_address(system: &System, handle: u16) -> u32 {
    if handle == 0xffff {
        return u32::from(system.cpu.segments[DS].selector) << 16;
    }

    let index = index_for(handle);
    let present = system
        .cpu
        .bus
        .read8(system.cpu.ldt_base + 8 * index as u32 + 5)
        & 0x80
        != 0;

    if index == 0 || !present || system.global.is_discarded(index) {
        return 0;
    }

    u32::from(selector_for(handle)) << 16
}

/// A block's address, and a discardable block counted, and only one
/// (`glocks`; seg1 `0fc2`). See `System::global_pointer`.
pub fn global_lock(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);
    let far = global_address(system, handle);
    let index = index_for((far >> 16) as u16);

    if far != 0 && system.is_discardable(index) {
        system.lock_up(index);
    }

    Ok(Answer::Dword(far))
}

/// A discardable block counted down, and the count left answered; any
/// other block answers nought (`glocks`; seg1 `100b`). `FFFFh` is the
/// caller's own data segment, as for `GlobalLock` (seg1 `0fea`).
pub fn global_unlock(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = match args.word(system) {
        0xffff => system.cpu.segments[DS].selector,
        handle => handle,
    };
    let index = index_for(handle);

    if !system.is_discardable(index) {
        return Ok(Answer::Dword(0));
    }

    Ok(Answer::Dword(u32::from(system.lock_down(index))))
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
        // Not while it is locked: a block whose lock count is not nought is
        // not discarded, and NULL is answered (`KRNL386.EXE` seg1 `4129`).
        if system.is_moveable(index) && system.global.locks_of(index) != 0 {
            return Ok(Answer::Word(0));
        }

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
/// lock count in the low byte, for a block that is not fixed: a
/// discardable block counts its locks, any block its wiring (`glocks`,
/// `misc`; seg1 `2580`). See `System::global_pointer`.
pub fn global_flags(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let index = index_for(args.word(system));
    let discarded = if system.global.is_discarded(index) {
        0x4000
    } else {
        0
    };
    let locks = if system.is_moveable(index) {
        u16::from(system.global.locks_of(index))
    } else {
        0
    };

    Ok(Answer::Word(
        (system.global.flags_of(index) & 0x0100) | discarded | locks,
    ))
}

/// A block locked where it is, as `GlobalLock` locks it -- the same
/// pointer -- and counted in its lock count whether it is discardable or
/// not (`misc`; seg1 `104e`).
pub fn global_wire(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);
    let far = global_address(system, handle);
    let index = index_for(handle);

    if far != 0 && system.is_moveable(index) {
        system.lock_up(index);
    }

    Ok(Answer::Dword(far))
}

/// A block fixed where it is, counted up in its lock count no further than
/// `FFh`: its handle, nought for one that names no block there (seg1 `0f2d`).
pub fn global_fix(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let index = index_for(args.word(system));

    if system.global.size_of(index) == 0 {
        return Ok(Answer::Word(0));
    }

    if system.is_moveable(index) {
        system.lock_up_to_ceiling(index);
    }

    Ok(Answer::Word(handle_for(index)))
}

/// A fixed block let go, counted down as `GlobalUnlock` counts: its handle,
/// nought for one that names no block there (seg1 `0f46`).
pub fn global_unfix(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let index = index_for(args.word(system));

    if system.global.size_of(index) == 0 {
        return Ok(Answer::Word(0));
    }

    if system.is_moveable(index) {
        system.lock_down(index);
    }

    Ok(Answer::Word(handle_for(index)))
}

/// A block's page lock counted up: the count.
pub fn global_page_lock(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let index = index_for(args.word(system));
    let count = system.page_locks.entry(index).or_insert(0);

    *count += 1;
    Ok(Answer::Word(*count))
}

/// A wired block let go, its count counted down: -1 once the count is
/// nought, nought while it is not (seg1 `10f9`).
pub fn global_unwire(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let index = index_for(args.word(system));

    if system.is_moveable(index) && system.lock_down(index) != 0 {
        return Ok(Answer::Word(0));
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
