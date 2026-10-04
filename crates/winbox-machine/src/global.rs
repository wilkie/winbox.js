//! The global heap's blocks, as winbox.js's `Allocator` gives them: each a
//! run of selectors, 64 KiB a selector, its size rounded to 32 bytes.

use std::collections::HashMap;

use crate::{Descriptors, Memory};

/// The first descriptor index a block is given.
pub const FIRST_SELECTOR: usize = 100;

/// A block given out.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Block {
    /// What was asked for, rounded to 32 bytes.
    pub size: u32,
    /// How many selectors it was given.
    pub selectors: usize,
    /// The flags it was asked for with.
    pub flags: u16,
    /// Discarded: its handle stands for nothing until it is given a size.
    pub discarded: bool,
}

/// The global heap: the blocks given out, by their first descriptor index,
/// and the selectors freed, the last on top.
#[derive(Debug, Clone, Default)]
pub struct GlobalHeap {
    blocks: HashMap<usize, Block>,
    freed: Vec<usize>,
    /// The sizes of segments modules were loaded into, as `GlobalSize`
    /// answers them: KERNEL's allocation for each, not the file's bytes.
    segment_sizes: HashMap<usize, u32>,
}

/// A size as a block is given it: rounded up to 32 bytes; nought stays
/// nought, a handle with no memory (`memory`).
fn rounded(size: u32) -> u32 {
    if size == 0 { 0 } else { (size + 0x1f) & !0x1f }
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
        let size = rounded(size);
        let selectors = selectors_for(size);
        let index = if selectors == 1 {
            self.reused(descriptors)
        } else {
            None
        };
        let index = index.or_else(|| descriptors.find(FIRST_SELECTOR, selectors))?;

        self.blocks.insert(
            index,
            Block {
                size,
                selectors,
                flags,
                discarded: false,
            },
        );

        let mut left = size;

        for tile in 0..selectors {
            let amount = left.min(0x10000);

            descriptors.map(memory, index + tile, &vec![0; amount as usize], false);
            left -= amount;
        }

        self.set_limits(memory, descriptors, index);
        Some(index)
    }

    /// The selector freed last that is free still.
    fn reused(&mut self, descriptors: &Descriptors) -> Option<usize> {
        while let Some(index) = self.freed.pop() {
            if !descriptors.used(index) {
                return Some(index);
            }
        }

        None
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
            for tile in 0..block.selectors {
                descriptors.release(memory, index + tile);
                self.freed.push(index + tile);
            }
        }

        true
    }

    pub fn block(&self, index: usize) -> Option<&Block> {
        self.blocks.get(&index)
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

    pub fn flags_of(&self, index: usize) -> u16 {
        self.blocks.get(&index).map_or(0, |block| block.flags)
    }

    /// A moveable block discarded: its handle stays, standing for nothing.
    pub fn discard(&mut self, index: usize) -> bool {
        let Some(block) = self.blocks.get_mut(&index) else {
            return false;
        };

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

                *segment = rounded(size);
                return Some(index);
            }

            return None;
        }

        let size = rounded(size);
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
