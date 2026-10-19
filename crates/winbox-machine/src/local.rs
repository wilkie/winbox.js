//! A local heap, kept as KERNEL keeps one: in the segment itself, its
//! arenas, its free list, its information and its handle tables all words
//! of the segment, where a program finds them. Each routine follows
//! `KRNL386.EXE`'s, step for step, and cites it: seg2 `28b7`
//! (`LocalInit`), seg1 `8a28`-`93cc` (the rest). As winbox.js's `Heap`
//! (`src/win16/heap.ts`).
//!
//! * **Arenas.** Each block has an arena before it: the previous arena's
//!   address, with the block's flags in its two low bits -- 1 in use, 2
//!   moveable -- and the next arena's. A fixed block's bytes follow those
//!   four; a moveable block's arena holds its handle's address after them,
//!   and its bytes start six bytes in. A free arena keeps its size and the
//!   previous and next free arenas after its four (`+4`, `+6`, `+8`), the
//!   free list in the order of the arenas. The first arena and the last
//!   are KERNEL's own, ten bytes each, the free list's ends. A block's size
//!   is the next arena less its bytes' start.
//! * **The information.** DS:6 points at it, in a block of KERNEL's own
//!   after the first arena (`Info`).
//! * **Handles.** A moveable block's handle is an entry of a handle table:
//!   its block's address, its flags -- 40h discarded, the low four its
//!   discard level -- and its lock count, four bytes. A table is a fixed
//!   block of the heap: its count, its entries, and the next table's
//!   address. The free entries are a list through their first words, their
//!   second `FFFFh`; the last entry freed is given first.
//!
//! Recorded: the rounding (`memory`), the growth (`localgro`), the whole
//! free block given (`ddeheap`), `LocalReAlloc` (`localre`), the handles
//! and the places of moveable blocks (`lheapseg`, `lochand`).

use crate::Memory;

/// Offsets in the heap's information, which DS:6 points at (seg2
/// `2916`-`2938`).
struct Info;

impl Info {
    /// How many callers asked for `LMEM_NOCOMPACT`: no block is moved while
    /// it is not nought.
    const NO_COMPACT: u16 = 0x02;
    /// How many arenas there are.
    const ARENAS: u16 = 0x04;
    const FIRST: u16 = 0x06;
    const LAST: u16 = 0x0a;
    /// Bytes the compaction counts its passes and discard levels in
    /// (`8f26`).
    const PASS: u16 = 0x0e;
    const LEVEL: u16 = 0x0f;
    /// The first handle table, and the first free handle.
    const TABLES: u16 = 0x14;
    const FREE_HANDLE: u16 = 0x16;
    /// How many handles a table is made with: 32, `LocalHandleDelta`'s.
    const DELTA: u16 = 0x18;
    /// KERNEL's routine that makes a handle table (`8a41`), a near address.
    const TABLE_PROC: u16 = 0x1a;
    /// The notify procedure, a far address: KERNEL's own, `8de2`.
    const NOTIFY: u16 = 0x1e;
    /// The bytes the default notify procedure grows a heap by beyond the
    /// block: 200h.
    const EXTRA: u16 = 0x24;
    /// The heap's span as `LocalInit` made it, which `LocalShrink` will not
    /// go below.
    const SPAN: u16 = 0x26;
    /// `LH`.
    const SIGNATURE: u16 = 0x28;
}

const LMEM_MOVEABLE: u16 = 0x0002;
const LMEM_NOCOMPACT: u16 = 0x0010;
const LMEM_ZEROINIT: u16 = 0x0040;
const LMEM_MODIFY: u16 = 0x0080;

/// A handle entry's flags: discarded.
const DISCARDED: u16 = 0x40;

/// What a value stands for (seg1 `8a83`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Found {
    /// The handle, or nought for a fixed block's pointer.
    pub handle: u16,
    /// The block's bytes' address; nought for none.
    pub pointer: u16,
    /// Its arena.
    pub arena: u16,
    /// For a handle, its lock count in the high byte and 40h for a
    /// discarded block; else nought.
    pub state: u16,
}

/// A local heap.
#[derive(Debug, Clone)]
pub struct LocalHeap {
    /// Where the segment is in the machine's memory: its index times 64 KiB.
    base: u32,
    /// Whether it may grow: the heap of a moveable data segment, or of a
    /// block of `GlobalAlloc`'s.
    pub growable: bool,
    /// The segment's size when it last grew or shrank, for its block to
    /// follow.
    grown: Option<u32>,
    /// The size of the segment the heap is in, as `GlobalSize` answers it,
    /// where it is known (`LocalHeap::segment_size`).
    segment_size: Option<u32>,
}

/// What a block is asked for with, by winbox.js's own code.
#[derive(Debug, Clone, Copy, Default)]
pub struct Options {
    pub movable: bool,
    pub zero_init: bool,
}

impl LocalHeap {
    /// A heap in the segment of descriptor index `segment`, made by `init`.
    pub fn new(segment: usize) -> Self {
        Self {
            base: (segment as u32) << 16,
            growable: false,
            grown: None,
            segment_size: None,
        }
    }

    fn read8(&self, memory: &Memory, at: u16) -> u16 {
        u16::from(memory.read8(self.base + u32::from(at)))
    }

    fn write8(&self, memory: &mut Memory, at: u16, value: u16) {
        memory.write8(self.base + u32::from(at), value as u8);
    }

    fn read16(&self, memory: &Memory, at: u16) -> u16 {
        self.read8(memory, at) | self.read8(memory, at.wrapping_add(1)) << 8
    }

    fn write16(&self, memory: &mut Memory, at: u16, value: u16) {
        self.write8(memory, at, value);
        self.write8(memory, at.wrapping_add(1), value >> 8);
    }

    /// Where the heap's information is: DS:6.
    fn info(&self, memory: &Memory) -> u16 {
        self.read16(memory, 6)
    }

    fn get(&self, memory: &Memory, field: u16) -> u16 {
        let info = self.info(memory);

        self.read16(memory, info.wrapping_add(field))
    }

    fn set(&self, memory: &mut Memory, field: u16, value: u16) {
        let info = self.info(memory);

        self.write16(memory, info.wrapping_add(field), value);
    }

    /// A request's span rounded as KERNEL rounds one (seg1 `8a68`): ten
    /// bytes at least, up to four; `FFFCh` for one that overflowed.
    pub fn round(span: u32, carry: bool) -> u16 {
        let bx = if carry || span > 0xffff { 0xfffc } else { span }.max(0xa);
        let dx = (bx + 3) & 0xfffc;

        if dx > 0xffff || dx < bx {
            0xfffc
        } else {
            dx as u16
        }
    }

    /// Where `LocalInit` lays a heap from `start` to `end` out (seg2
    /// `28e3`-`2957`): its first arena at `start`, rounded; then an arena
    /// of the heap's own, four bytes and the 2Ah of its information; the
    /// free block after that, rounded; and the last arena ten bytes short
    /// of `end`, rounded down to four: `(first, free, last)`, or `None`
    /// where they do not fit.
    pub fn layout(start: u32, end: u32) -> Option<(u32, u32, u32)> {
        let first = u32::from(Self::round(start, false));
        let arena = u32::from(Self::round(first + 0xa, false));

        if arena >= end {
            return None;
        }

        let free = u32::from(Self::round(arena + 4 + 0x2a, false));
        let last = end.wrapping_sub(0xa) & 0xfffc;

        (last > free && last <= end).then_some((first, free, last))
    }

    /// `LocalInit` (seg2 `28e3`-`29b5`): the bytes from the information to
    /// `end` made nought, the information written, DS:6 pointed at it, and
    /// the four arenas made -- the first and the last, KERNEL's, the
    /// information's, and one free block between. False where they do not
    /// fit.
    pub fn init(&mut self, memory: &mut Memory, start: u32, end: u32) -> bool {
        let first = Self::round(start, false);
        let arena = Self::round(u32::from(first) + 0xa, false);
        let info = arena.wrapping_add(4);

        if u32::from(arena) >= end {
            return false;
        }

        let mut at = info;

        for _ in 0..(end.wrapping_sub(u32::from(info)) & 0xffff) >> 1 {
            self.write16(memory, at, 0);
            at = at.wrapping_add(2);
        }

        let free = Self::round(u32::from(info) + 0x2a, false);

        self.write8(memory, info + Info::DELTA, 0x20);
        self.write8(memory, info + Info::ARENAS, 4);
        self.write16(memory, info + Info::FIRST, first);
        // KERNEL's own notify procedure, `8de2` in its first code segment:
        // its offset; the segment, KERNEL's code, winbox.js has none of,
        // and is left nought.
        self.write16(memory, info + Info::NOTIFY, 0x8de2);
        self.write16(memory, info + Info::TABLE_PROC, 0x8a41);
        self.write16(memory, info + Info::EXTRA, 0x200);
        self.write16(memory, info + Info::SIGNATURE, 0x484c);

        let last = (end.wrapping_sub(0xa) & 0xfffc) as u16;

        if last <= free {
            return false;
        }

        self.write16(memory, info + Info::LAST, last);
        self.write16(memory, 6, info);

        self.write16(memory, first, first + 1);
        self.write16(memory, first + 2, arena);
        self.write16(memory, first + 6, first);
        self.write16(memory, first + 8, free);
        self.write16(memory, first + 4, 0xa);

        self.write16(memory, arena, first + 1);
        self.write16(memory, arena + 2, free);

        self.write16(memory, free, arena);
        self.write16(memory, free + 2, last);
        self.write16(memory, free + 6, first);
        self.write16(memory, free + 8, last);
        self.write16(memory, free + 4, last - free);

        self.write16(memory, last + 2, last);
        self.write16(memory, last, free + 1);
        self.write16(memory, last + 6, free);
        self.write16(memory, last + 8, last);
        self.write16(memory, last + 4, 0xa);

        self.write16(
            memory,
            info + Info::SPAN,
            last.wrapping_add(0xa).wrapping_sub(first),
        );

        true
    }

    /// The size of the segment the heap is in, as `GlobalSize` would answer
    /// it, which its growth goes by: where nothing has said, what its last
    /// arena's place makes it, ten bytes and a rounding past it.
    pub fn segment_size(&self, memory: &Memory) -> u32 {
        self.segment_size
            .unwrap_or_else(|| u32::from(self.get(memory, Info::LAST)) + 12)
    }

    pub fn set_segment_size(&mut self, size: u32) {
        self.segment_size = Some(size);
    }

    /// The segment's size, if the heap grew or shrank since this was last
    /// asked.
    pub fn take_growth(&mut self) -> Option<u32> {
        self.grown.take()
    }

    // The free list.

    /// An arena put in the free list after `after`, or where it falls by
    /// address (seg1 `9386`); its size set.
    fn insert_free(&self, memory: &mut Memory, arena: u16, after: u16) {
        let mut si = after;

        if si == 0 {
            si = self.get(memory, Info::FIRST);

            for _ in 0..0x8000 {
                let next = self.read16(memory, si + 8);

                if arena < next {
                    break;
                }

                si = next;
            }
        }

        let di = self.read16(memory, si.wrapping_add(8));

        self.write16(memory, arena.wrapping_add(8), di);
        self.write16(memory, si.wrapping_add(8), arena);
        self.write16(memory, arena.wrapping_add(6), si);
        self.write16(memory, di.wrapping_add(6), arena);

        let next = self.read16(memory, arena.wrapping_add(2));

        self.write16(memory, arena.wrapping_add(4), next.wrapping_sub(arena));
    }

    /// An arena taken out of the free list (seg1 `93bc`).
    fn remove_free(&self, memory: &mut Memory, arena: u16) {
        let before = self.read16(memory, arena.wrapping_add(6));
        let after = self.read16(memory, arena.wrapping_add(8));

        self.write16(memory, before.wrapping_add(8), after);
        self.write16(memory, after.wrapping_add(6), before);
    }

    /// The arena after `arena` joined to it (seg1 `923a`): taken out of the
    /// free list if it was free, and `arena`'s size set if it is free. The
    /// arena after the one joined.
    fn join(&self, memory: &mut Memory, arena: u16, next: u16) -> u16 {
        let arenas = self.get(memory, Info::ARENAS);

        self.set(memory, Info::ARENAS, arenas.wrapping_sub(1));

        let after = self.read16(memory, next.wrapping_add(2));
        let flags = self.read16(memory, after) & 3;

        self.write16(memory, after, flags | arena);
        self.write16(memory, arena.wrapping_add(2), after);

        if self.read16(memory, next) & 1 == 0 {
            self.remove_free(memory, next);
        }

        if self.read16(memory, arena) & 1 == 0 {
            self.write16(memory, arena.wrapping_add(4), after.wrapping_sub(arena));
        }

        after
    }

    /// Bytes made nought from `from` to `to` (seg1 `926f`), a word at a time.
    fn zero(&self, memory: &mut Memory, from: u16, to: u16) {
        if from >= to {
            return;
        }

        let mut at = from;

        for _ in 0..(to - from) >> 1 {
            self.write16(memory, at, 0);
            at = at.wrapping_add(2);
        }
    }

    /// A block's arena freed (seg1 `9347`): put in the free list, its flags
    /// cleared, and joined to a free arena after it and before it. The
    /// handle it held, for a moveable block; else nought.
    fn free_arena(&self, memory: &mut Memory, arena: u16) -> u16 {
        if arena == 0 {
            return 0;
        }

        let held = self.read16(memory, arena.wrapping_add(4));

        self.insert_free(memory, arena, 0);

        let word = self.read16(memory, arena);
        let flags = word & 3;

        self.write16(memory, arena, word ^ flags);

        let handle = if flags & 2 != 0 { held } else { 0 };
        let next = self.read16(memory, arena.wrapping_add(2));

        if self.read16(memory, next) & 1 == 0 {
            self.join(memory, arena, next);
        }

        let before = self.read16(memory, arena);

        if self.read16(memory, before) & 1 == 0 {
            self.join(memory, before, arena);
        }

        handle
    }

    // Placing a block.

    /// Splits the free arena `lower` at `upper` (seg1 `930b`-`9328`):
    /// `upper` a new arena from there to where `lower` ended, put in the
    /// free list after `lower`; `lower`'s size set.
    fn split(&self, memory: &mut Memory, lower: u16, upper: u16) {
        let next = self.read16(memory, lower.wrapping_add(2));

        self.write16(memory, lower.wrapping_add(2), upper);
        self.write16(memory, upper, lower);
        self.write16(memory, upper.wrapping_add(2), next);

        let flags = self.read16(memory, next) & 3;

        self.write16(memory, next, flags | upper);

        let arenas = self.get(memory, Info::ARENAS);

        self.set(memory, Info::ARENAS, arenas.wrapping_add(1));
        self.insert_free(memory, upper, lower);
        self.write16(memory, lower.wrapping_add(4), upper.wrapping_sub(lower));
    }

    /// A block of `size` bytes with `flags` (seg1 `9283`): a fixed one at
    /// the bottom of the first free block it fits, walking up the free
    /// list; a moveable one at the top of the last, walking down. A free
    /// block that would keep too little is given whole: a fixed block's
    /// where 16 bytes or less would be left, a moveable one's where less
    /// than 16. With no free block that fits, the heap is compacted, and
    /// the block put in the largest free block; failing that, the notify
    /// procedure is told, and where it grew the heap, all is tried again.
    /// The block's bytes' address, or nought.
    fn alloc(&mut self, memory: &mut Memory, flags: u16, size: u16) -> u16 {
        loop {
            let moveable = flags & LMEM_MOVEABLE != 0;
            let header: u16 = if moveable { 6 } else { 4 };
            let span = u32::from(size) + u32::from(header);
            let dx = Self::round(span, span > 0xffff);
            let mut bx = 0;

            if moveable {
                let mut at = self.get(memory, Info::LAST);

                for _ in 0..0x8000 {
                    let before = self.read16(memory, at.wrapping_add(6));

                    if before == at {
                        break;
                    }

                    at = before;

                    if dx <= self.read16(memory, at.wrapping_add(4)) {
                        bx = at;
                        break;
                    }
                }
            } else {
                let mut at = self.get(memory, Info::FIRST);

                for _ in 0..0x8000 {
                    let next = self.read16(memory, at.wrapping_add(8));

                    if next == at {
                        break;
                    }

                    at = next;

                    if dx <= self.read16(memory, at.wrapping_add(4)) {
                        bx = at;
                        break;
                    }
                }
            }

            if bx == 0 {
                let (largest, best) = self.compact(memory, dx);

                if largest < dx {
                    if self.out_of_memory(memory, largest, dx) {
                        continue;
                    }

                    return 0;
                }

                bx = best;
            }

            let block = if moveable {
                let left = self.read16(memory, bx.wrapping_add(4)).wrapping_sub(dx);

                if left < 0x10 {
                    bx
                } else {
                    let upper = bx.wrapping_add(left);

                    self.split(memory, bx, upper);
                    upper
                }
            } else {
                let upper = bx.wrapping_add(dx);

                if upper < self.read16(memory, bx.wrapping_add(2)).wrapping_sub(0x10) {
                    self.split(memory, bx, upper);
                }

                bx
            };

            self.remove_free(memory, block);

            let pointer = block.wrapping_add(header);
            let word = self.read16(memory, block);

            self.write16(memory, block, word | 1);

            if flags & LMEM_ZEROINIT != 0 {
                let end = self.read16(memory, block.wrapping_add(2));

                self.zero(memory, pointer, end);
            }

            return pointer;
        }
    }

    /// The default notify procedure told the heap is out of room (seg1
    /// `8de2`-`8e9d`): it refuses where the segment's size, less the
    /// largest free block, with the block and 18h, passes 64 KiB; else it
    /// gives the segment the block and 218h more, 200h of them the heap's
    /// own, no more than `FFF0h`, by `GlobalReAlloc`, which rounds up to 32
    /// bytes; and the last arena moves to ten bytes short of the new end,
    /// at a four-byte boundary, 64 KiB counting as `FFFFh`, the old last
    /// arena freed into the free block before it. Measured by `localgro`.
    /// Whether it grew.
    fn out_of_memory(&mut self, memory: &mut Memory, largest: u16, needed: u16) -> bool {
        if !self.growable {
            return false;
        }

        let size = self.segment_size(memory);
        let (largest, needed) = (u32::from(largest), u32::from(needed));

        if size >= 0x10000 || (size + needed + 0x18).saturating_sub(largest) > 0xffff {
            return false;
        }

        let extra = u32::from(self.get(memory, Info::EXTRA));
        let asked = (size + needed + 0x18 + extra).min(0xfff0);
        let grown = ((asked + 31) & !31).min(0x10000);
        let bx = ((grown.min(0xffff) - 0xa) & 0xfffc) as u16;
        let si = self.get(memory, Info::LAST);

        if bx <= si {
            return false;
        }

        self.segment_size = Some(grown);
        self.grown = Some(grown);

        self.write16(memory, bx + 2, bx);
        self.write16(memory, bx, si | 1);
        self.write16(memory, si + 2, bx);

        let before = self.read16(memory, si + 6);

        self.write16(memory, bx + 6, before);
        self.write16(memory, bx + 8, bx);
        self.write16(memory, bx + 4, 0xa);
        self.write16(memory, before.wrapping_add(8), bx);
        self.set(memory, Info::LAST, bx);

        let arenas = self.get(memory, Info::ARENAS);

        self.set(memory, Info::ARENAS, arenas.wrapping_add(1));
        self.free_arena(memory, si);

        true
    }

    // Compaction.

    /// A block's bytes moved up into the free arena `free` (seg1 `8eae`):
    /// to its top where it is the block's own next, or where the block and
    /// 16 bytes more fit; else to its bottom, taking it whole. The block's
    /// new arena, and the end of the free arena.
    fn move_block(&self, memory: &mut Memory, arena: u16, free: u16) -> (u16, u16) {
        let span = self
            .read16(memory, arena.wrapping_add(2))
            .wrapping_sub(arena);
        let end = self.read16(memory, free.wrapping_add(2));
        let after = arena.wrapping_add(span);
        let to = if after != free && end.wrapping_sub(span).wrapping_sub(0x10) < free {
            free.wrapping_add(span)
        } else {
            end
        };
        let mut step = 2;

        for _ in 0..span >> 1 {
            let word = self.read16(memory, after.wrapping_sub(step));

            self.write16(memory, to.wrapping_sub(step), word);
            step += 2;
        }

        (to.wrapping_sub(span), end)
    }

    /// The largest moveable, unlocked block below the free arena `free`
    /// that fits in it (seg1 `8ee2`), looking at `count` arenas from `free`
    /// down; nought for none. Of two the same size, the higher.
    fn fitting(&self, memory: &Memory, free: u16, count: u16) -> u16 {
        let room = self.read16(memory, free.wrapping_add(2)).wrapping_sub(free);
        let mut best = 0;
        let mut bx = free;

        for _ in 0..count {
            let word = self.read16(memory, bx);

            if word & 3 == 3 {
                let handle = self.read16(memory, bx.wrapping_add(4));

                if self.read8(memory, handle.wrapping_add(3)) == 0 {
                    let span = self.read16(memory, bx.wrapping_add(2)).wrapping_sub(bx);

                    if span <= room
                        && (best == 0
                            || span.wrapping_add(best) > self.read16(memory, best.wrapping_add(2)))
                    {
                        best = bx;
                    }
                }
            }

            bx = self.read16(memory, bx) & 0xfffc;
        }

        best
    }

    /// The next discardable handle of the level being discarded, after
    /// `handle` (seg1 `3767`): one not free, not discarded, of the level in
    /// the information, and not locked. `count` is how many entries are
    /// left in the table being looked through, as the routine keeps it in
    /// CX.
    fn discardable(&self, memory: &Memory, handle: &mut u16, count: &mut u16) -> bool {
        let level = self.read8(memory, self.info(memory).wrapping_add(Info::LEVEL));
        let (mut si, mut cx) = (*handle, *count);

        if si == 0 {
            si = self.get(memory, Info::TABLES);

            if si == 0 {
                return false;
            }

            cx = self.read16(memory, si);
            si = si.wrapping_add(2);
        } else {
            si = si.wrapping_add(4);
            cx = cx.wrapping_sub(1);
        }

        for _ in 0..0x10000 {
            if cx == 0 {
                si = self.read16(memory, si);

                if si == 0 {
                    *handle = 0;
                    return false;
                }

                cx = self.read16(memory, si);
                si = si.wrapping_add(2);
                continue;
            }

            let word = self.read16(memory, si.wrapping_add(2));

            if word != 0xffff
                && (level == 0 || (word & DISCARDED == 0 && word & 0xf == level && word >> 8 == 0))
            {
                *handle = si;
                *count = cx;
                return true;
            }

            si = si.wrapping_add(4);
            cx = cx.wrapping_sub(1);
        }

        false
    }

    /// The moveable block `below` slid up to the top of the free arena
    /// `free` just after it (seg1 `8fbb`-`9000`): its handle given its new
    /// place, its old place freed, and joined to a free arena below it. The
    /// arena the walk goes on from: the old place, or where it was joined,
    /// the block moved (`923a` leaves BX there).
    fn slide(&self, memory: &mut Memory, below: u16, free: u16) -> u16 {
        self.remove_free(memory, free);

        let old = below;
        let (moved, end) = self.move_block(memory, old, free);

        self.write16(memory, moved, old | 3);
        self.write16(memory, moved.wrapping_add(2), end);

        let flags = self.read16(memory, end) & 3;

        self.write16(memory, end, flags | moved);
        self.write16(memory, old.wrapping_add(2), moved);

        let word = self.read8(memory, old);

        self.write8(memory, old, word & 0xfc);
        self.insert_free(memory, old, 0);

        let handle = self.read16(memory, moved.wrapping_add(4));

        self.write16(memory, handle, moved.wrapping_add(6));

        let before = self.read16(memory, old);

        if self.read8(memory, before) & 1 == 0 {
            self.join(memory, before, old)
        } else {
            old
        }
    }

    /// The moveable block `found` moved into the free arena `free` (seg1
    /// `9032`-`9091`): to its top, a new arena, where room is left, else
    /// taking it whole; its handle given its new place, and its old place
    /// freed. The arena the walk goes on from, below the block moved, and
    /// the count of arenas left to walk.
    fn fit(&self, memory: &mut Memory, found: u16, free: u16, mut cx: u16) -> (u16, u16) {
        let kept = self.read16(memory, free);

        self.remove_free(memory, free);

        let old = found;
        let (moved, end) = self.move_block(memory, old, free);
        let split = free != moved;

        if split {
            self.write16(memory, free.wrapping_add(2), moved);
        }

        self.write16(memory, moved, if split { free } else { kept } | 3);
        self.write16(memory, moved.wrapping_add(2), end);

        let flags = self.read16(memory, end) & 3;

        self.write16(memory, end, flags | moved);

        if split {
            self.insert_free(memory, free, 0);
            cx = cx.wrapping_add(1);

            let arenas = self.get(memory, Info::ARENAS);

            self.set(memory, Info::ARENAS, arenas.wrapping_add(1));
        }

        let handle = self.read16(memory, moved.wrapping_add(4));

        self.write16(memory, handle, moved.wrapping_add(6));

        let word = self.read8(memory, old);

        self.write8(memory, old, word & 0xfd);

        let before = self.get(memory, Info::ARENAS);

        self.free_arena(memory, old);
        cx = cx.wrapping_sub(before.wrapping_sub(self.get(memory, Info::ARENAS)));

        (self.read16(memory, moved) & 0xfffc, cx)
    }

    /// The heap compacted for a block of `dx` bytes, its arena and all
    /// (seg1 `8f25`-`9024`). Walking down from the last arena, each free
    /// block is filled from below, unless a caller asked for no compaction:
    /// the moveable, unlocked block just below it slid up to its top, or
    /// else the largest such block below that fits moved into it. Where
    /// the largest free block is still too small, discardable blocks are
    /// discarded, the highest level first, and the heap compacted again.
    /// The largest free block's size and its arena.
    fn compact(&self, memory: &mut Memory, dx: u16) -> (u16, u16) {
        let info = self.info(memory);
        let pass = info.wrapping_add(Info::PASS);
        let level_at = info.wrapping_add(Info::LEVEL);

        self.write16(memory, pass, 0x1001);

        if self.get(memory, Info::NO_COMPACT) != 0 {
            let value = self.read8(memory, pass);

            self.write8(memory, pass, value.wrapping_sub(1));
        }

        loop {
            let mut best: u16 = 0;
            let mut bx = self.get(memory, Info::LAST);
            let mut cx = self.get(memory, Info::ARENAS);

            loop {
                let ax = self.read16(memory, bx);

                'step: {
                    if ax & 1 != 0 {
                        bx = ax & 0xfffc;
                        break 'step;
                    }

                    // `bx` is free.
                    if self.get(memory, Info::NO_COMPACT) == 0 {
                        let below = ax;
                        let slides = self.read8(memory, below) & 2 != 0 && {
                            let handle = self.read16(memory, below.wrapping_add(4));

                            self.read8(memory, handle.wrapping_add(3)) == 0
                        };

                        if slides {
                            bx = self.slide(memory, below, bx);
                            break 'step;
                        }

                        let found = self.fitting(memory, bx, cx);

                        if found != 0 {
                            (bx, cx) = self.fit(memory, found, bx, cx);
                            break 'step;
                        }
                    }

                    // The largest free block so far (`9006`).
                    if best != bx
                        && self.read16(memory, bx) & 1 == 0
                        && (best == 0
                            || self.read16(memory, bx.wrapping_add(2))
                                > self
                                    .read16(memory, best.wrapping_add(2))
                                    .wrapping_sub(best)
                                    .wrapping_add(bx))
                    {
                        best = bx;
                    }

                    bx = self.read16(memory, bx) & 0xfffc;
                }

                cx = cx.wrapping_sub(1);

                if cx == 0 {
                    break;
                }
            }

            // `8f4a`: the largest, and whether to discard.
            loop {
                if best == 0 {
                    return (0, 0);
                }

                let largest = self.read16(memory, best.wrapping_add(2)).wrapping_sub(best);
                let value = self.read8(memory, pass).wrapping_sub(1) & 0xff;

                self.write8(memory, pass, value);

                if value & 0x80 != 0 || largest >= dx {
                    return (largest, best);
                }

                let level = self.read8(memory, level_at).wrapping_sub(1) & 0xff;

                self.write8(memory, level_at, level);

                if level == 0 {
                    continue;
                }

                let value = self.read8(memory, pass);

                self.write8(memory, pass, value.wrapping_add(1));

                let (mut handle, mut count) = (0, 0);

                while self.discardable(memory, &mut handle, &mut count) {
                    let arena = self.read16(memory, handle).wrapping_sub(6);

                    self.free_arena(memory, arena);
                    self.write16(memory, handle, 0);

                    let flags = self.read8(memory, handle.wrapping_add(2));

                    self.write8(memory, handle.wrapping_add(2), flags | DISCARDED);

                    let value = self.read8(memory, pass);

                    self.write8(memory, pass, value | 0x80);
                }

                let value = self.read8(memory, pass);

                if value & 0x80 != 0 {
                    self.write8(memory, pass, value ^ 0x80);
                    break;
                }
            }
        }
    }

    // Handles.

    /// A handle table of `count` entries (seg1 `8a41`): a fixed block of
    /// the heap, its count, the entries each linked to the next and marked
    /// free, and the first table's address after them; put first in the
    /// list of tables. Its first entry, or nought.
    fn table(&mut self, memory: &mut Memory, count: u16) -> u16 {
        let block = self.alloc(memory, 0, count.wrapping_add(1).wrapping_mul(4));

        if block == 0 {
            return 0;
        }

        let was = self.get(memory, Info::TABLES);

        self.set(memory, Info::TABLES, block);
        self.write16(memory, block, count);

        let mut at = block.wrapping_add(2);

        for _ in 0..count {
            self.write16(memory, at, at.wrapping_add(4));
            self.write16(memory, at.wrapping_add(2), 0xffff);
            at = at.wrapping_add(4);
        }

        self.write16(memory, at.wrapping_sub(4), 0);
        self.write16(memory, at, was);

        block.wrapping_add(2)
    }

    /// A free handle (seg1 `370c`): the first of the free list, a table
    /// made for more where it is empty; its flags and lock count nought,
    /// and its word `word`. Nought where no table could be made.
    fn handle(&mut self, memory: &mut Memory, word: u16) -> u16 {
        let mut bx = self.get(memory, Info::FREE_HANDLE);

        if bx == 0 {
            let count = self.get(memory, Info::DELTA);

            if count == 0 {
                return 0;
            }

            bx = self.table(memory, count);

            if bx == 0 {
                return 0;
            }
        }

        self.write16(memory, bx.wrapping_add(2), 0);

        let next = self.read16(memory, bx);

        self.write16(memory, bx, word);
        self.set(memory, Info::FREE_HANDLE, next);
        bx
    }

    /// A handle given back (seg1 `373b`): first in the free list. `FFFFh`
    /// for one that was free; else nought.
    fn free_handle(&self, memory: &mut Memory, handle: u16) -> u16 {
        if handle == 0 {
            return 0;
        }

        let was = self.read16(memory, handle.wrapping_add(2));

        self.write16(memory, handle.wrapping_add(2), 0xffff);

        if was == 0xffff {
            return 0xffff;
        }

        let head = self.get(memory, Info::FREE_HANDLE);

        self.write16(memory, handle, head);
        self.set(memory, Info::FREE_HANDLE, handle);
        0
    }

    /// What a value stands for (seg1 `8a83`, `3754`): a value with bit 1
    /// clear is a fixed block's pointer, its arena four bytes before it at
    /// a four-byte boundary; one with bit 1 set is a handle, whose word is
    /// its block's address unless the entry is free or discarded.
    pub fn deref(&self, memory: &Memory, value: u16) -> Found {
        if value & 2 == 0 {
            return Found {
                handle: 0,
                pointer: value,
                arena: if value == 0 {
                    0
                } else {
                    (value & 0xfffc).wrapping_sub(4)
                },
                state: 0,
            };
        }

        let word = self.read16(memory, value.wrapping_add(2));

        if word == 0xffff {
            return Found {
                handle: value,
                pointer: 0,
                arena: 0,
                state: 0,
            };
        }

        let state = (word & 0xff00) | (word & DISCARDED);
        let pointer = if state & DISCARDED != 0 {
            0
        } else {
            self.read16(memory, value)
        };

        Found {
            handle: value,
            pointer,
            arena: if pointer == 0 {
                0
            } else {
                pointer.wrapping_sub(6)
            },
            state,
        }
    }

    // The functions.

    /// `LocalAlloc` (seg1 `8ab6`): a fixed block's pointer, or a moveable
    /// block's handle -- an entry of a handle table, the block's arena
    /// keeping its address, its flags its discard level from the flags'
    /// high byte. A moveable block of nought bytes is a handle standing for
    /// a discarded block; a fixed one, nought. Nought where there is no
    /// room.
    pub fn local_alloc(&mut self, memory: &mut Memory, flags: u16, size: u16) -> u16 {
        if flags & LMEM_NOCOMPACT != 0 {
            let count = self.get(memory, Info::NO_COMPACT);

            self.set(memory, Info::NO_COMPACT, count.wrapping_add(1));
        }

        let answer = if size == 0 {
            if flags & LMEM_MOVEABLE == 0 {
                0
            } else {
                let handle = self.handle(memory, LMEM_MOVEABLE);

                if handle != 0 {
                    self.write16(memory, handle, 0);

                    let word = self.read8(memory, handle.wrapping_add(2));

                    self.write8(memory, handle.wrapping_add(2), word | DISCARDED);
                }

                handle
            }
        } else if flags & LMEM_MOVEABLE != 0 {
            let handle = self.handle(memory, flags);

            if handle == 0 {
                0
            } else {
                let pointer = self.alloc(memory, flags, size);

                if pointer == 0 {
                    self.free_handle(memory, handle);
                    0
                } else {
                    self.write16(memory, handle, pointer);
                    self.write16(memory, pointer.wrapping_sub(2), handle);

                    let word = self.read8(memory, pointer.wrapping_sub(6));

                    self.write8(memory, pointer.wrapping_sub(6), word | 2);

                    let level = (flags >> 8) & 0xf;

                    if level != 0 {
                        self.write8(memory, handle.wrapping_add(2), level);
                    }

                    handle
                }
            }
        } else {
            self.alloc(memory, flags, size)
        };

        if flags & LMEM_NOCOMPACT != 0 {
            let count = self.get(memory, Info::NO_COMPACT);

            self.set(memory, Info::NO_COMPACT, count.wrapping_sub(1));
        }

        answer
    }

    /// `LocalFree` (seg1 `8cc7`): the block freed, if there is one, and the
    /// handle given back. Nought; `FFFFh` for a handle already free.
    /// Neither a lock nor a value that is no block's is looked at.
    pub fn local_free(&mut self, memory: &mut Memory, value: u16) -> u16 {
        let found = self.deref(memory, value);
        let handle = if found.pointer == 0 {
            found.handle
        } else {
            self.free_arena(memory, found.arena)
        };

        self.free_handle(memory, handle)
    }

    /// `LocalSize` (seg1 `8cef`): the next arena less the block's address;
    /// nought for no block.
    pub fn local_size(&self, memory: &Memory, value: u16) -> u16 {
        let found = self.deref(memory, value);

        if found.pointer == 0 {
            return 0;
        }

        self.read16(memory, found.arena.wrapping_add(2))
            .wrapping_sub(found.pointer)
    }

    /// `LocalFlags` (seg1 `8d06`): a handle's flags in the high byte, its
    /// lock count in the low; nought for a fixed block.
    pub fn local_flags(&self, memory: &Memory, value: u16) -> u16 {
        let found = self.deref(memory, value);

        if found.handle == 0 {
            return 0;
        }

        self.read16(memory, found.handle.wrapping_add(2))
            .swap_bytes()
    }

    /// `LocalLock` (seg1 `8d1f`): a fixed block's pointer as it is; for a
    /// handle, its count up, no further than `FFh`, and its word -- nought
    /// for a discarded block, whose count is left.
    pub fn local_lock(&self, memory: &mut Memory, value: u16) -> u16 {
        if value & 2 == 0 {
            return value;
        }

        if self.read8(memory, value.wrapping_add(2)) & DISCARDED == 0 {
            let count = (self.read8(memory, value.wrapping_add(3)) + 1) & 0xff;

            if count != 0 {
                self.write8(memory, value.wrapping_add(3), count);
            }
        }

        self.read16(memory, value)
    }

    /// `LocalUnlock` (seg1 `8d43`): a handle's count down, and what is
    /// left, as a signed byte; nought for a fixed block, a discarded one,
    /// and a count of nought or `FFh`, which is left.
    pub fn local_unlock(&self, memory: &mut Memory, value: u16) -> u16 {
        if value & 2 == 0 {
            return 0;
        }

        let word = self.read16(memory, value.wrapping_add(2));

        if word & DISCARDED != 0 {
            return 0;
        }

        let count = (word >> 8).wrapping_sub(1) & 0xff;

        if count >= 0xfe {
            return 0;
        }

        self.write8(memory, value.wrapping_add(3), count);
        i16::from(count as u8 as i8) as u16
    }

    /// `LocalHandle` (seg1 `8d6a`): a value with bit 1 clear as it is, a
    /// fixed block's pointer being its handle; one with it set, the word
    /// before it, a moveable block's handle in its arena, if that handle
    /// holds the value; else nought.
    pub fn local_handle(&self, memory: &Memory, value: u16) -> u16 {
        if value & 2 == 0 {
            return value;
        }

        let handle = self.read16(memory, value.wrapping_sub(2));

        if self.read16(memory, handle) == value {
            handle
        } else {
            0
        }
    }

    /// `LocalCompact` (seg1 `8d85`): the heap compacted for `wanted` bytes,
    /// and its largest free block less six; nought for none.
    pub fn local_compact(&self, memory: &mut Memory, wanted: u16) -> u16 {
        let (largest, _) = self.compact(memory, Self::round(u32::from(wanted), false));

        if largest == 0 {
            0
        } else {
            largest.wrapping_sub(6)
        }
    }

    /// `LocalHandleDelta` (seg2 `2a0c`): how many handles a table is made
    /// with, set where a number is given.
    pub fn local_handle_delta(&self, memory: &mut Memory, delta: u16) -> u16 {
        if delta != 0 {
            self.set(memory, Info::DELTA, delta);
        }

        self.get(memory, Info::DELTA)
    }

    /// `LocalReAlloc` (seg1 `8b4b`):
    ///
    /// * `LMEM_MODIFY` sets a handle's discard level, from the flags' high
    ///   byte, and answers the value.
    /// * A discarded block is given a block of the size again, moveable.
    /// * Nought, with `LMEM_MOVEABLE`, discards an unlocked moveable block:
    ///   its handle stays, standing for nothing. A fixed block is freed,
    ///   and nought answered. Locked, or without the flag, it fails.
    /// * A block that shrinks, or stays, keeps its place; what it leaves
    ///   becomes free where more than 16 bytes would be. Its rounding is
    ///   ten bytes at least from its address, up to four.
    /// * A block that grows into the free block after it stays, the bytes
    ///   it gains nought with `LMEM_ZEROINIT`.
    /// * Else it moves: a moveable block, or a fixed one with
    ///   `LMEM_MOVEABLE`; a locked one only with it. A new block is made,
    ///   compacting or growing the heap as `LocalAlloc` does, and the bytes
    ///   copied to it. A fixed block without the flag fails.
    ///
    /// The handle or pointer; nought for a failure.
    pub fn local_realloc(&mut self, memory: &mut Memory, value: u16, size: u16, flags: u16) -> u16 {
        if flags & LMEM_NOCOMPACT != 0 {
            let count = self.get(memory, Info::NO_COMPACT);

            self.set(memory, Info::NO_COMPACT, count.wrapping_add(1));
        }

        let answer = self.realloc(memory, value, size, flags);

        if flags & LMEM_NOCOMPACT != 0 {
            let count = self.get(memory, Info::NO_COMPACT);

            self.set(memory, Info::NO_COMPACT, count.wrapping_sub(1));
        }

        answer
    }

    fn realloc(&mut self, memory: &mut Memory, value: u16, size: u16, flags: u16) -> u16 {
        let found = self.deref(memory, value);

        if found.pointer == 0 {
            if found.state & DISCARDED == 0 {
                return value;
            }

            let pointer = self.alloc(memory, LMEM_MOVEABLE | flags, size);

            if pointer == 0 {
                return 0;
            }

            let word = self.read8(memory, found.handle.wrapping_add(2));

            self.write8(memory, found.handle.wrapping_add(2), word ^ DISCARDED);
            return self.rehandle(memory, found.handle, pointer);
        }

        if flags & LMEM_MODIFY != 0 {
            if found.handle != 0 {
                let word = self.read8(memory, found.handle.wrapping_add(2));

                self.write8(
                    memory,
                    found.handle.wrapping_add(2),
                    (word & 0xe0) | ((flags >> 8) & 0x1f),
                );
            }

            return value;
        }

        let arena = found.arena;
        let reach = u32::from(found.pointer) + u32::from(size.max(0xa));
        let end = Self::round(reach & 0xffff, reach > 0xffff);
        let mut next = self.read16(memory, arena.wrapping_add(2));

        if size == 0 {
            if found.state != 0 || flags & LMEM_MOVEABLE == 0 {
                return 0;
            }

            let handle = self.free_arena(memory, arena);

            if handle == 0 {
                return 0;
            }

            self.write16(memory, handle, 0);

            let word = self.read8(memory, handle.wrapping_add(2));

            self.write8(memory, handle.wrapping_add(2), word | DISCARDED);
            return value;
        }

        if end > next {
            if self.read16(memory, next) & 1 == 0
                && end <= self.read16(memory, next.wrapping_add(2))
            {
                let from = next;

                next = self.join(memory, arena, next);

                if flags & LMEM_ZEROINIT != 0 {
                    self.zero(memory, from, next);
                }
            } else {
                return self.move_to(memory, found, value, size, flags);
            }
        }

        // `8bf3`: shrunk, or the same.
        if u32::from(end) + 0x10 > 0xffff || end + 0x10 >= next {
            return value;
        }

        let after = self.read16(memory, arena.wrapping_add(2));

        self.write16(memory, arena.wrapping_add(2), end);
        self.write16(memory, end, arena);

        let mut si = after;
        let kept = self.read16(memory, si) & 3;

        self.write16(memory, si, kept);

        if kept == 0 {
            self.remove_free(memory, si);
            si = self.read16(memory, si.wrapping_add(2));

            let flags = self.read16(memory, si) & 3;

            self.write16(memory, si, flags);
        } else {
            let arenas = self.get(memory, Info::ARENAS);

            self.set(memory, Info::ARENAS, arenas.wrapping_add(1));
        }

        let word = self.read16(memory, si);

        self.write16(memory, si, word | end);
        self.write16(memory, end.wrapping_add(2), si);
        self.insert_free(memory, end, 0);
        value
    }

    /// A block moved to a new one of `size` bytes (seg1 `8c56`-`8caf`): its
    /// handle or new pointer, nought for none.
    fn move_to(
        &mut self,
        memory: &mut Memory,
        found: Found,
        value: u16,
        size: u16,
        flags: u16,
    ) -> u16 {
        if found.state != 0 && flags & LMEM_MOVEABLE == 0 {
            return 0;
        }

        let mut kind = flags | LMEM_MOVEABLE;

        if value & 2 == 0 {
            if flags & LMEM_MOVEABLE == 0 {
                return 0;
            }

            kind ^= LMEM_MOVEABLE;
        }

        let length = self
            .read16(memory, found.arena.wrapping_add(2))
            .wrapping_sub(found.pointer);
        let pointer = self.alloc(memory, kind, size);

        if pointer == 0 {
            return 0;
        }

        // Where the block is now: the compaction may have moved it.
        let now = self.deref(memory, value);
        let mut step = 0u16;

        for _ in 0..length >> 1 {
            let word = self.read16(memory, now.pointer.wrapping_add(step));

            self.write16(memory, pointer.wrapping_add(step), word);
            step = step.wrapping_add(2);
        }

        let handle = self.free_arena(memory, now.arena);

        if handle == 0 {
            return pointer;
        }

        self.rehandle(memory, handle, pointer)
    }

    /// A handle given a moveable block (seg1 `8ca8`): the handle's word,
    /// the arena's flag and its link back.
    fn rehandle(&self, memory: &mut Memory, handle: u16, pointer: u16) -> u16 {
        self.write16(memory, handle, pointer);

        let word = self.read8(memory, pointer.wrapping_sub(6));

        self.write8(memory, pointer.wrapping_sub(6), word | 2);
        self.write16(memory, pointer.wrapping_sub(2), handle);
        handle
    }

    /// The heap's span, from its first arena to past its last.
    pub fn span(&self, memory: &Memory) -> u16 {
        self.get(memory, Info::LAST)
            .wrapping_add(0xa)
            .wrapping_sub(self.get(memory, Info::FIRST))
    }

    /// `LocalShrink` (seg1 `8db0`, `9093`): the heap compacted,
    /// discardable blocks discarded, and blocks from its top moved into
    /// free blocks below where they fit, then its end brought down to the
    /// last block, no lower than `wanted` or the span `LocalInit` gave it,
    /// and its segment shrunk with it. The heap's span after.
    pub fn local_shrink(&mut self, memory: &mut Memory, wanted: u16) -> u16 {
        let floor = wanted.max(self.get(memory, Info::SPAN));

        if self.span(memory) > floor {
            self.compact(memory, 0xfffc);

            let mut si = self.get(memory, Info::LAST);

            for _ in 0..0x8000 {
                si = self.read16(memory, si) & 0xfffc;

                let word = self.read16(memory, si);
                let mut stop = false;

                if word & 1 == 0 {
                    self.remove_free(memory, si);

                    let word = self.read16(memory, si);

                    self.write16(memory, si, word | 1);
                } else if word & 2 == 0 || {
                    let handle = self.read16(memory, si.wrapping_add(4));

                    self.read8(memory, handle.wrapping_add(3)) != 0
                } {
                    si = self.read16(memory, si.wrapping_add(2));
                    stop = true;
                } else {
                    let length = self.read16(memory, si.wrapping_add(2)).wrapping_sub(si);
                    let mut free = self.large_enough(memory, length);

                    // Not found: the heap compacted once more, and looked
                    // again (`90dd`-`90ef`).
                    if free == 0 {
                        self.compact(memory, 0xfffc);
                        free = self.large_enough(memory, length);
                    }

                    if free == 0 {
                        si = self.read16(memory, si.wrapping_add(2));
                        stop = true;
                    } else {
                        self.shrink_into(memory, si, free, length);
                    }
                }

                if !stop {
                    let end = si
                        .wrapping_add(0xa)
                        .wrapping_sub(self.get(memory, Info::FIRST));

                    if end > floor {
                        continue;
                    }
                }

                self.cut(memory, si, floor);
                break;
            }
        }

        self.compact(memory, 0xfffc);
        self.span(memory)
    }

    /// The block at `si` moved into the free block `free` for `LocalShrink`
    /// (seg1 `9101`-`9161`): what the block does not need of it split off
    /// where 16 bytes more are left, its bytes and flags copied, its handle
    /// given the new place, and the old marked in use.
    fn shrink_into(&self, memory: &mut Memory, si: u16, free: u16, length: u16) {
        self.remove_free(memory, free);

        let end = self.read16(memory, free.wrapping_add(2));

        if end.wrapping_sub(length).wrapping_sub(0x10) >= free {
            let upper = free.wrapping_add(length);

            self.write16(memory, upper, free);
            self.write16(memory, upper.wrapping_add(2), end);
            self.write16(memory, free.wrapping_add(2), upper);

            let flags = self.read16(memory, end) & 3;

            self.write16(memory, end, flags | upper);

            let before = self.read16(memory, free.wrapping_add(6));

            self.insert_free(memory, upper, before);

            let arenas = self.get(memory, Info::ARENAS);

            self.set(memory, Info::ARENAS, arenas.wrapping_add(1));
        }

        let flags = self.read16(memory, si) & 3;
        let word = self.read16(memory, free);

        self.write16(memory, free, word | flags);

        let mut step = 4;

        while step < length {
            let word = self.read16(memory, si.wrapping_add(step));

            self.write16(memory, free.wrapping_add(step), word);
            step += 2;
        }

        let handle = self.read16(memory, si.wrapping_add(4));

        self.write16(memory, handle, free.wrapping_add(6));

        let word = self.read16(memory, si);

        self.write16(memory, si, (word & 0xfffc) | 1);
    }

    /// A free block of `length` bytes or more, looking down from the top
    /// (seg1 `91af`); nought for none.
    fn large_enough(&self, memory: &Memory, length: u16) -> u16 {
        let last = self.get(memory, Info::LAST);
        let mut bx = self.read16(memory, last.wrapping_add(6));

        for _ in 0..0x8000 {
            let before = self.read16(memory, bx.wrapping_add(6));

            if bx == before {
                return 0;
            }

            if length <= self.read16(memory, bx.wrapping_add(4)) {
                return bx;
            }

            bx = before;
        }

        0
    }

    /// The heap ended at `si` (seg1 `91cb`-`9238`): a free block left below
    /// the new last arena where the span it may keep has more than 16 bytes
    /// of room past `si`, the last arena made there, and the segment shrunk
    /// to ten bytes past it, as `GlobalReAlloc` rounds it (`9182`-`919a`).
    fn cut(&mut self, memory: &mut Memory, mut si: u16, floor: u16) {
        let last = self.get(memory, Info::LAST);

        if si == last {
            return;
        }

        let mut count: u16 = 0;
        let mut at = si;

        for _ in 0..0x8000 {
            if at == last {
                break;
            }

            count = count.wrapping_add(1);
            at = self.read16(memory, at.wrapping_add(2));
        }

        let arenas = self.get(memory, Info::ARENAS);

        self.set(memory, Info::ARENAS, arenas.wrapping_sub(count));

        let end = si
            .wrapping_sub(self.get(memory, Info::FIRST))
            .wrapping_add(0xa);

        if end <= floor && floor - end > 0x10 {
            let room = Self::round(u32::from(floor - end), false);
            let upper = si.wrapping_add(room);

            self.write16(memory, si.wrapping_add(2), upper);

            let word = self.read16(memory, si);

            self.write16(memory, si, word & 0xfffc);
            self.insert_free(memory, si, 0);

            let arenas = self.get(memory, Info::ARENAS);

            self.set(memory, Info::ARENAS, arenas.wrapping_add(1));
            self.write16(memory, upper, si);
            si = upper;
        }

        self.write16(memory, si.wrapping_add(2), si);

        let word = self.read16(memory, si);

        self.write16(memory, si, (word & 0xfffc) | 1);

        let size = self.read16(memory, last.wrapping_add(4));

        self.write16(memory, si.wrapping_add(4), size);

        let before = self.read16(memory, last.wrapping_add(6));

        self.write16(memory, si.wrapping_add(6), before);
        self.write16(memory, before.wrapping_add(8), si);
        self.write16(memory, si.wrapping_add(8), si);
        self.set(memory, Info::LAST, si);

        let size = ((u32::from(si) + 0xa + 31) & !31).min(0x10000);

        self.segment_size = Some(size);
        self.grown = Some(size);
    }

    // What winbox.js's own code asks of a heap.

    /// A block, as `LocalAlloc` makes one: its pointer or handle.
    pub fn allocate(&mut self, memory: &mut Memory, size: u32, options: Options) -> Option<u32> {
        let flags = if options.movable { LMEM_MOVEABLE } else { 0 }
            | if options.zero_init { LMEM_ZEROINIT } else { 0 };
        let block = self.local_alloc(memory, flags, (size & 0xffff) as u16);

        (block != 0).then_some(u32::from(block))
    }

    /// A block freed, its handle with it.
    pub fn free(&mut self, memory: &mut Memory, value: u32) {
        self.local_free(memory, value as u16);
    }

    /// The size of the block behind a handle or a pointer.
    pub fn size_of(&self, memory: &Memory, value: u32) -> u32 {
        u32::from(self.local_size(memory, value as u16))
    }

    /// The address a handle stands for -- nought for a discarded block --
    /// or a pointer as it is; nothing counted.
    pub fn resolve(&self, memory: &Memory, value: u32) -> u32 {
        if value & 2 == 0 {
            value
        } else {
            u32::from(self.deref(memory, value as u16).pointer)
        }
    }

    /// A block given a new size, as `LocalReAlloc` gives it: its handle or
    /// pointer.
    pub fn reallocate(
        &mut self,
        memory: &mut Memory,
        value: u32,
        size: u32,
        movable_flag: bool,
        zero_init: bool,
    ) -> Option<u32> {
        let flags = if movable_flag { LMEM_MOVEABLE } else { 0 }
            | if zero_init { LMEM_ZEROINIT } else { 0 };
        let block = self.local_realloc(memory, value as u16, (size & 0xffff) as u16, flags);

        (block != 0).then_some(u32::from(block))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A heap of descriptor 100, laid out as `LocalInit` lays it.
    fn heap(memory: &mut Memory, start: u32, end: u32) -> LocalHeap {
        let mut heap = LocalHeap::new(100);

        assert!(heap.init(memory, start, end));
        heap
    }

    #[test]
    fn rounds_as_kernel_does() {
        // 15, 16, 17 and 18 bytes, moveable, are all 18 (`memory`).
        let mut memory = Memory::new();
        let mut local = heap(&mut memory, 0x10, 0x1000);

        for size in 15..=18 {
            let handle = local.local_alloc(&mut memory, LMEM_MOVEABLE, size);

            assert_eq!(local.local_size(&memory, handle), 18);
        }

        let block = local.local_alloc(&mut memory, 0, 1);

        assert_eq!(local.local_size(&memory, block), 8);
    }

    #[test]
    fn lays_the_heap_out_as_local_init_does() {
        assert_eq!(
            LocalHeap::layout(12160 - 1 - 1024, 12160 - 1),
            Some((0x2b80, 0x2bbc, 0x2f74))
        );
        // DDEML's instance heap: `LocalInit(segment, 0, 0FFFh)` in a block
        // of 1000h.
        assert_eq!(LocalHeap::layout(0, 0xfff), Some((0xc, 0x48, 0xff4)));
    }

    #[test]
    fn grows_as_localgro_recorded() {
        // `localgro`'s heap: 1,024 bytes at the end of a data segment of
        // 12,160, as `LocalInit` with a start of nought lays it.
        let mut memory = Memory::new();
        let mut local = heap(&mut memory, 12160 - 1 - 1024, 12160 - 1);

        local.growable = true;
        local.set_segment_size(12160);

        let sizes = [1000, 1000, 1000, 3072]
            .into_iter()
            .chain(std::iter::repeat_n(4096, 12));
        let made: Vec<(u16, u32)> = sizes
            .map(|size| {
                let block = local.local_alloc(&mut memory, 0, size);

                (block, local.segment_size(&memory))
            })
            .collect();

        assert_eq!(
            made,
            [
                (0x2bc0, 13728),
                (0x2fac, 13728),
                (0x3398, 15296),
                (0x3784, 18912),
                (0x4388, 23552),
                (0x538c, 28192),
                (0x6390, 32832),
                (0x7394, 37472),
                (0x8398, 42112),
                (0x939c, 42112),
                (0xa3a0, 46752),
                (0xb3a4, 51392),
                (0xc3a8, 56032),
                (0xd3ac, 60672),
                (0xe3b0, 65312),
                (0, 65312),
            ]
        );
        assert_eq!(local.take_growth(), Some(65312));
    }

    #[test]
    fn gives_a_free_block_whole_where_16_bytes_or_less_would_be_left() {
        let mut memory = Memory::new();
        // A free block of 52 and 16 bytes: from 0x100 to its last arena.
        let (_, free, _) = LocalHeap::layout(0x100, 0x200).unwrap();
        let end = free + 52 + 16 + 0xa;
        let mut local = heap(&mut memory, 0x100, end);
        let block = local.local_alloc(&mut memory, 0, 0x2e);

        assert_eq!(local.local_size(&memory, block), 0x30 + 16);
        assert_eq!(local.local_alloc(&mut memory, 0, 1), 0);
    }

    #[test]
    fn keeps_handles_in_tables_of_32() {
        let mut memory = Memory::new();
        let mut local = heap(&mut memory, 0x10, 0x820);
        let base = 100 << 16;
        // The table: a fixed block at the bottom of the free block, its
        // entries from two bytes in (`lheapseg`).
        let first = local.local_alloc(&mut memory, LMEM_MOVEABLE, 49);
        let second = local.local_alloc(&mut memory, LMEM_MOVEABLE, 49);

        assert_eq!((first, second), (0x52, 0x56));

        let pointer = local.deref(&memory, first).pointer;

        assert_eq!(memory.read16(base + u32::from(first)), pointer);
        // A moveable block at the top of the free block, under the last
        // arena.
        assert_eq!(pointer, 0x814 - 0x38 + 6);
        assert_eq!(local.local_handle(&memory, pointer), first);
        assert_eq!(local.local_handle(&memory, first), 0);

        // A handle freed is the next given.
        assert_eq!(local.local_free(&mut memory, first), 0);
        assert_eq!(local.local_size(&memory, first), 0);
        assert_eq!(local.local_alloc(&mut memory, LMEM_MOVEABLE, 8), first);
    }

    #[test]
    fn reallocates_in_place_as_localre_recorded() {
        let mut memory = Memory::new();

        for (size, kept) in [(46, 46), (50, 66), (10, 10), (1, 10), (12, 14), (30, 30)] {
            let mut local = heap(&mut memory, 0x10, 0x400);
            let handle = local.local_alloc(&mut memory, LMEM_MOVEABLE, 66);
            let address = local.deref(&memory, handle).pointer;

            local.local_alloc(&mut memory, 0, 10);
            assert_eq!(
                local.local_realloc(&mut memory, handle, size, LMEM_MOVEABLE),
                handle
            );
            assert_eq!(
                local.deref(&memory, handle).pointer,
                address,
                "{size} bytes stay"
            );
            assert_eq!(local.local_size(&memory, handle), kept, "{size} bytes");
        }
    }
}
