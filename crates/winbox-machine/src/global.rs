//! The global heap's blocks, as winbox.js's `Allocator` gives them: each a
//! run of selectors, 64 KiB a selector, its size rounded as KERNEL rounds it ([`block_size`]).

use std::collections::HashMap;

use crate::{Descriptors, Memory};

/// The first descriptor index a block is given.
pub const FIRST_SELECTOR: usize = 100;

/// A block given out.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Block {
    /// What was asked for, rounded by [`block_size`].
    pub size: u32,
    /// How many selectors it was given.
    pub selectors: usize,
    /// The flags it was asked for with.
    pub flags: u16,
    /// Discarded: its handle stands for nothing until it is given a size.
    pub discarded: bool,
    /// Its lock count: one byte, kept in the block's own arena by
    /// `KRNL386.EXE` (offset 14h, seg1 `0fd7`), so it goes with the block
    /// when it is freed.
    pub locks: u8,
}

/// The global heap: the blocks given out, by their first descriptor index,
/// and the selectors freed, the last on top.
#[derive(Debug, Clone, Default)]
pub struct GlobalHeap {
    blocks: HashMap<usize, Block>,
    /// The sizes of segments modules were loaded into, as `GlobalSize`
    /// answers them: KERNEL's allocation for each, not the file's bytes.
    segment_sizes: HashMap<usize, u32>,
    /// The bytes the blocks given hold, as `GetFreeSpace` counts them.
    held: u64,
    /// What was held when a program first asked (see [`MOST`]).
    baseline: Option<u64>,
}

/// The largest size KERNEL lets through: 16 MiB less 64 KiB, the most 255
/// selectors of a block reach.
///
/// **Read out** of `KRNL386.EXE` seg1. `GlobalAlloc` (`022b`, `0d2f`),
/// `GlobalReAlloc` (`028c`, `0d68`) and `GlobalDosAlloc` (`139a`, which
/// calls `0d2f` with KERNEL's flag 8000h) all take the size through
/// `0c7c`: rounded up to 16 bytes, and anything that carries past 32 bits
/// or comes to more than `FF0000h` made `7FFFFFFFh`, a size no block can have.
/// `GlobalAlloc`'s `4025` refuses more than `FF0000h` at once, logging
/// `ERR_GALLOC` and answering nought; `GlobalReAlloc`'s `40f9` refuses it
/// when no selectors or room are found for it (`20a8` takes no more than
/// `FEh` selectors).
///
/// Within the limit, a block is searched for (`379e`); not found, KERNEL
/// asks DPMI for more memory (`397e`, `int 31h` `0501h`), compacts the heap
/// and discards what can be discarded (`34c4`, `2f28`), and searches again;
/// still not found, the request is refused with nought.
///
/// How much there is depends on the machine. **Recorded** by `galimit`
/// under DOSBox, as the probe started: [`FREE`], [`COMPACT`] and
/// [`LARGEST`]. A block held makes `GetFreeSpace` less by its size, and
/// freed gives it back. This machine is the one modelled: what winbox.js
/// holds when a program first asks KERNEL for memory or how much there is,
/// through `GlobalAlloc`, `GlobalReAlloc`, `GlobalDosAlloc`, `GetFreeSpace`
/// or `GlobalCompact`, stands for what Windows held then
/// ([`GlobalHeap::settle`]); every byte held beyond it is taken from all
/// three figures, every byte given back returns to them.
pub const MOST: u32 = 0x00ff_0000;

/// `GetFreeSpace(0)` on the oracle's machine as a program starts.
pub const FREE: u32 = 0x00eb_b4e0;

/// The largest block `GlobalAlloc` grants there.
pub const LARGEST: u32 = 0x00e3_4000;

/// `GlobalCompact(0)` there: the largest block less 64 KiB.
pub const COMPACT: u32 = 0x00e2_4000;

/// How much memory the machine has to give, as a program first asks: the
/// three figures of [`MOST`]'s model, which differ by the mode Windows runs
/// in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Figures {
    /// `GetFreeSpace(0)`.
    pub free: u32,
    /// The largest block there is.
    pub largest: u32,
    /// `GlobalCompact(0)`'s figure, before `3fde` makes it no more than
    /// [`MOST`].
    pub compact: u32,
}

impl Figures {
    /// Standard mode's: [`FREE`], [`LARGEST`] and [`COMPACT`].
    pub const STANDARD: Self = Self {
        free: FREE,
        largest: LARGEST,
        compact: COMPACT,
    };

    /// 386 enhanced mode's, where WIN386 gives KERNEL virtual memory, its
    /// swap file's pages with the machine's. **Recorded** by `galimit` in
    /// enhanced mode (`enhanced/galimit`): `GetFreeSpace(0)` 38F5C60h;
    /// `GlobalCompact(0)` `FF0000h` and the largest block `FF0000h`, the limit
    /// itself, where standard mode's machine runs out first. What lies
    /// past the limit is not seen through these calls; the largest free
    /// block DPMI 0500h names, 3868000h (`enhmode`), stands for it
    /// (inferred), `GlobalCompact`'s 64 KiB less as in standard mode. The
    /// 1000h more the first block of `FE0000h` moveable costs, and keeps, is
    /// KERNEL growing its descriptor table, which it does in enhanced mode
    /// alone as its free selectors fall under 100h (`KRNL386.EXE` seg1
    /// `1ed4`-`1f0d`), and is not followed: WinBox's selectors are not
    /// KERNEL's. As `memory-model.ts`'s.
    pub const ENHANCED: Self = Self {
        free: 0x038f_5c60,
        largest: 0x0386_8000,
        compact: 0x0386_8000 - 0x0001_0000,
    };
}

/// Whether a size passes `0c7c`: rounded up to 16 bytes without carrying
/// past 32 bits, no more than [`MOST`].
pub fn within_limit(size: u32) -> bool {
    size.checked_add(0xf)
        .is_some_and(|rounded| rounded & !0xf <= MOST)
}

/// A size as a block is given it (`KRNL386.EXE` seg1 `3fde`): rounded up to
/// 32 bytes, and past 1 MiB up to a 4 KiB page (`galimit`: 100001h bytes
/// are given 101000h); nought stays nought, a handle with no memory
/// (`memory`).
pub fn block_size(size: u32) -> u32 {
    if size == 0 {
        return 0;
    }

    let rounded = size.div_ceil(0x20).saturating_mul(0x20);

    if rounded > 0x0010_0000 {
        rounded.div_ceil(0x1000).saturating_mul(0x1000)
    } else {
        rounded
    }
}

fn selectors_for(size: u32) -> usize {
    ((size as usize + 0xffff) >> 16).max(1)
}

impl GlobalHeap {
    pub fn new() -> Self {
        Self::default()
    }

    /// A block of `size` bytes: its first descriptor index, or `None`. A
    /// block of one selector takes the selector freed last, as Windows'
    /// does (`greuse`); its bytes are its own, noughts, whatever the
    /// selector held before (`grealloc`, `lzero`).
    pub fn allocate(
        &mut self,
        memory: &mut Memory,
        descriptors: &mut Descriptors,
        size: u32,
        flags: u16,
    ) -> Option<usize> {
        let size = block_size(size);
        let selectors = selectors_for(size);
        let index = if selectors == 1 {
            descriptors.take(FIRST_SELECTOR)
        } else {
            descriptors.find(FIRST_SELECTOR, selectors)
        }?;

        self.blocks.insert(
            index,
            Block {
                size,
                selectors,
                flags,
                discarded: false,
                locks: 0,
            },
        );
        self.held += u64::from(size);

        let mut left = size;

        for tile in 0..selectors {
            let amount = left.min(0x10000);

            descriptors.map(memory, index + tile, &vec![0; amount as usize], false);
            left -= amount;
        }

        self.set_limits(memory, descriptors, index);
        Some(index)
    }

    /// A block's selectors' limits: the first reaches the whole block, its
    /// size less one (`selinfo`), each after it what is left from there. A
    /// block of nothing keeps 64 KiB.
    fn set_limits(&self, memory: &mut Memory, descriptors: &mut Descriptors, index: usize) {
        let Some(block) = self.blocks.get(&index) else {
            return;
        };

        if block.size == 0 {
            return;
        }

        for tile in 0..block.selectors {
            let left = block.size.saturating_sub(tile as u32 * 0x10000);

            descriptors.set_limit(memory, index + tile, left.saturating_sub(1));
        }
    }

    /// A block freed: its selectors emptied and free to be given again
    /// (`gcycle`), the last of them given first.
    pub fn free(
        &mut self,
        memory: &mut Memory,
        descriptors: &mut Descriptors,
        index: usize,
    ) -> bool {
        if let Some(block) = self.blocks.remove(&index) {
            self.held -= u64::from(block.size);

            for tile in 0..block.selectors {
                descriptors.give(memory, index + tile);
            }
        }

        true
    }

    /// A program has asked: what is held now stands for what Windows held
    /// then (see [`MOST`]).
    pub fn settle(&mut self) {
        self.baseline.get_or_insert(self.held);
    }

    /// The bytes held since a program first asked; less than nought where
    /// more has been given back.
    fn taken(&self) -> i64 {
        self.baseline
            .map_or(0, |baseline| self.held as i64 - baseline as i64)
    }

    /// `GetFreeSpace`'s answer, on a machine with `figures`.
    pub fn free_space(&self, figures: Figures) -> u32 {
        (i64::from(figures.free) - self.taken()).clamp(0, i64::from(u32::MAX)) as u32
    }

    /// The largest block that can be given, on a machine with `figures`.
    pub fn largest_block(&self, figures: Figures) -> u32 {
        (i64::from(figures.largest) - self.taken()).clamp(0, i64::from(u32::MAX)) as u32
    }

    /// `GlobalCompact`'s answer, on a machine with `figures`, which goes
    /// through `3fde` and so is never more than [`MOST`] (`KRNL386.EXE`
    /// seg1 `1105`-`111d`).
    pub fn compact_answer(&self, figures: Figures) -> u32 {
        (i64::from(figures.compact) - self.taken()).clamp(0, i64::from(MOST)) as u32
    }

    pub fn block(&self, index: usize) -> Option<&Block> {
        self.blocks.get(&index)
    }

    /// The blocks given out, by their first descriptor index, in no order.
    pub fn indices(&self) -> impl Iterator<Item = usize> + '_ {
        self.blocks.keys().copied()
    }

    /// A block's size, or a module segment's.
    pub fn size_of(&self, index: usize) -> u32 {
        self.blocks
            .get(&index)
            .map(|block| block.size)
            .or_else(|| self.segment_sizes.get(&index).copied())
            .unwrap_or(0)
    }

    /// The size of a segment a module was loaded into.
    pub fn set_segment_size(&mut self, index: usize, size: u32) {
        self.segment_sizes.insert(index, size);
    }

    /// A segment a module was loaded into, freed with its module: its size
    /// forgotten.
    pub fn forget_segment(&mut self, index: usize) {
        self.segment_sizes.remove(&index);
    }

    pub fn flags_of(&self, index: usize) -> u16 {
        self.blocks.get(&index).map_or(0, |block| block.flags)
    }

    /// A moveable block discarded: its handle stays, standing for nothing.
    pub fn discard(&mut self, index: usize) -> bool {
        let Some(block) = self.blocks.get_mut(&index) else {
            return false;
        };

        self.held -= u64::from(block.size);
        block.size = 0;
        block.discarded = true;
        true
    }

    /// A block's discardable flag set or cleared, as `GMEM_MODIFY` does.
    pub fn modify(&mut self, index: usize, discardable: bool) -> bool {
        let Some(block) = self.blocks.get_mut(&index) else {
            return false;
        };

        if discardable {
            block.flags |= 0x0100;
        } else {
            block.flags &= !0x0100;
        }

        true
    }

    /// A block's lock count.
    pub fn locks_of(&self, index: usize) -> u8 {
        self.blocks.get(&index).map_or(0, |block| block.locks)
    }

    /// A block's lock count set; nothing for an index that names no block.
    pub fn set_locks(&mut self, index: usize, count: u8) {
        if let Some(block) = self.blocks.get_mut(&index) {
            block.locks = count;
        }
    }

    pub fn is_discarded(&self, index: usize) -> bool {
        self.blocks.get(&index).is_some_and(|block| block.discarded)
    }

    /// A block given a new size: its index -- the same, or where it moved
    /// to, growing past its selectors (`grow`) -- or `None`. A module's
    /// segment grows or shrinks within its 64 KiB.
    pub fn resize(
        &mut self,
        memory: &mut Memory,
        descriptors: &mut Descriptors,
        index: usize,
        size: u32,
    ) -> Option<usize> {
        if !self.blocks.contains_key(&index) {
            if let Some(segment) = self.segment_sizes.get_mut(&index) {
                if size > 0x10000 {
                    return None;
                }

                *segment = block_size(size);
                return Some(index);
            }

            return None;
        }

        let size = block_size(size);
        let selectors = selectors_for(size);
        let block = self.blocks.get_mut(&index)?;

        block.discarded = false;

        if selectors > block.selectors {
            return self.relocate(memory, descriptors, index, size);
        }

        // Shrinking gives up the selectors it no longer reaches.
        for tile in selectors..block.selectors {
            descriptors.unmap(memory, index + tile);
        }

        block.selectors = selectors;
        self.held = self.held - u64::from(block.size) + u64::from(size);
        block.size = size;
        self.set_limits(memory, descriptors, index);
        Some(index)
    }

    /// A block moved to new selectors, its bytes with it, the old ones let
    /// go: its new index.
    fn relocate(
        &mut self,
        memory: &mut Memory,
        descriptors: &mut Descriptors,
        index: usize,
        size: u32,
    ) -> Option<usize> {
        let block = *self.blocks.get(&index)?;
        let moved = self.allocate(memory, descriptors, size, block.flags)?;
        let kept = block.size.min(size) as usize;
        let bytes = memory.read((index as u32) << 16, kept);

        memory.write((moved as u32) << 16, &bytes);

        if let Some(moved) = self.blocks.get_mut(&moved) {
            moved.discarded = false;
            // Its lock count is the block's, kept in its arena, and goes
            // with it.
            moved.locks = block.locks;
        }

        self.free(memory, descriptors, index);
        Some(moved)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn machine() -> (Memory, Descriptors, GlobalHeap) {
        let mut memory = Memory::new();
        let mut descriptors = Descriptors::new();

        descriptors.reset(&mut memory);
        (memory, descriptors, GlobalHeap::new())
    }

    #[test]
    fn gives_back_freed_selectors_last_first() {
        let (mut memory, mut descriptors, mut heap) = machine();
        let a = heap
            .allocate(&mut memory, &mut descriptors, 100, 0)
            .unwrap();
        let b = heap
            .allocate(&mut memory, &mut descriptors, 100, 0)
            .unwrap();
        let c = heap
            .allocate(&mut memory, &mut descriptors, 100, 0)
            .unwrap();

        assert_eq!((a, b, c), (100, 101, 102));
        heap.free(&mut memory, &mut descriptors, a);
        heap.free(&mut memory, &mut descriptors, b);
        heap.free(&mut memory, &mut descriptors, c);

        let again: Vec<usize> = (0..3)
            .map(|_| {
                heap.allocate(&mut memory, &mut descriptors, 100, 0)
                    .unwrap()
            })
            .collect();

        assert_eq!(again, vec![102, 101, 100]);
        assert_eq!(heap.size_of(102), 128);
    }

    /// `galimit`: the sizes KERNEL lets through, and how it rounds them.
    #[test]
    fn limits_and_rounds_sizes_as_kernel_does() {
        assert!(within_limit(0x00ff_0000));
        assert!(!within_limit(0x00ff_0001));
        assert!(!within_limit(0x6800_0000));
        assert!(!within_limit(u32::MAX));
        assert_eq!(block_size(1), 0x20);
        assert_eq!(block_size(0x0010_0000), 0x0010_0000);
        assert_eq!(block_size(0x0010_0001), 0x0010_1000);
    }

    /// What is held after a program first asks is taken from the machine's
    /// free memory, and given back when freed.
    #[test]
    fn takes_what_is_held_from_the_machines_memory() {
        let (mut memory, mut descriptors, mut heap) = machine();
        let before = heap
            .allocate(&mut memory, &mut descriptors, 0x100, 0)
            .unwrap();

        heap.settle();
        assert_eq!(heap.free_space(Figures::STANDARD), FREE);

        let block = heap
            .allocate(&mut memory, &mut descriptors, 0x0010_0001, 2)
            .unwrap();

        assert_eq!(heap.free_space(Figures::STANDARD), FREE - 0x0010_1000);
        assert_eq!(heap.largest_block(Figures::STANDARD), LARGEST - 0x0010_1000);
        assert_eq!(
            heap.compact_answer(Figures::STANDARD),
            COMPACT - 0x0010_1000
        );
        // In enhanced mode, the limit: `GlobalCompact` no more than it.
        assert_eq!(heap.compact_answer(Figures::ENHANCED), MOST);
        assert_eq!(
            heap.free_space(Figures::ENHANCED),
            0x038f_5c60 - 0x0010_1000
        );
        heap.free(&mut memory, &mut descriptors, block);
        heap.free(&mut memory, &mut descriptors, before);
        assert_eq!(heap.free_space(Figures::STANDARD), FREE + 0x100);
    }

    #[test]
    fn moves_a_block_grown_past_its_selectors() {
        let (mut memory, mut descriptors, mut heap) = machine();
        let a = heap
            .allocate(&mut memory, &mut descriptors, 0x100, 0)
            .unwrap();
        let _b = heap
            .allocate(&mut memory, &mut descriptors, 0x100, 0)
            .unwrap();

        memory.write((a as u32) << 16, b"kept");

        let moved = heap
            .resize(&mut memory, &mut descriptors, a, 0x18000)
            .unwrap();

        assert_ne!(moved, a);
        assert_eq!(memory.read((moved as u32) << 16, 4), b"kept");
        assert_eq!(heap.size_of(moved), 0x18000);
        assert!(heap.block(a).is_none());
    }
}
