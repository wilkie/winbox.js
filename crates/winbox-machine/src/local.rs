//! A local heap in a segment, as winbox.js's `Heap` keeps one: the blocks
//! it gives out, by address in the segment, and the moveable blocks'
//! handles, each a word in the segment holding its block's address, which
//! a program reads there itself.
//!
//! Its rules are recorded:
//!
//! * A block is four-byte units, never under eight bytes, a moveable one
//!   spending two on its handle's link: 15 to 18 bytes asked for are 18
//!   (`memory`).
//! * A heap out of room grows -- a moveable data segment's -- by the
//!   request and 544 more, rounded up to 32, to 64 KiB at most
//!   (`localgro`).
//! * `LocalReAlloc` of a moveable block keeps it where it is when it
//!   shrinks, its leftover freed only at 20 bytes or more, and when it
//!   grows into free space before the next block (`localre`).
//! * With `LMEM_ZEROINIT` a block is noughts; without, what the segment
//!   held (`lzero`).

use std::collections::HashMap;

use crate::Memory;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Allocation {
    /// Where its span starts: a data block's size word, or a handle.
    start: u32,
    /// The bytes it takes: a data block's and its size word, or a handle's
    /// two.
    span: u32,
    /// A data block's bytes; `None` for a handle's slot.
    data: Option<u32>,
}

/// A local heap.
#[derive(Debug, Clone)]
pub struct LocalHeap {
    /// Where the segment is in the machine's memory: its index times 64 KiB.
    base: u32,
    /// Where the heap starts in the segment, and how big it is.
    offset: u32,
    size: u32,
    /// Whether it may grow: the heap of a moveable data segment.
    pub growable: bool,
    /// Its allocations, by address.
    allocations: Vec<Allocation>,
    /// Each handle's word, as the heap last wrote it.
    handles: HashMap<u32, u16>,
    /// The heap's end when it last grew, for its segment's block to follow.
    grown: Option<u32>,
}

/// What a block is asked for with.
#[derive(Debug, Clone, Copy, Default)]
pub struct Options {
    pub movable: bool,
    pub zero_init: bool,
}

impl LocalHeap {
    /// A heap of `size` bytes from `offset` in the segment of descriptor
    /// index `segment`.
    pub fn new(segment: usize, offset: u32, size: u32) -> Self {
        Self {
            base: (segment as u32) << 16,
            offset,
            size,
            growable: false,
            allocations: Vec::new(),
            handles: HashMap::new(),
            grown: None,
        }
    }

    pub fn offset(&self) -> u32 {
        self.offset
    }

    pub fn size(&self) -> u32 {
        self.size
    }

    /// The heap's end, if it grew since this was last asked.
    pub fn take_growth(&mut self) -> Option<u32> {
        self.grown.take()
    }

    /// The size a request turns into: four-byte units, eight at least, a
    /// moveable block two less than the block it sits in.
    pub fn block_for(request: u32, movable: bool) -> u32 {
        let block = ((request + if movable { 2 } else { 0 } + 3) & !3).max(8);

        if movable { block - 2 } else { block }
    }

    fn write_word(&mut self, memory: &mut Memory, at: u32, value: u16) {
        self.handles.insert(at, value);
        memory.write16(self.base + (at & 0xffff), value);
    }

    fn write_bytes(&self, memory: &mut Memory, at: u32, bytes: &[u8]) {
        for (step, byte) in bytes.iter().enumerate() {
            memory.write8(self.base + ((at + step as u32) & 0xffff), *byte);
        }
    }

    fn read_bytes(&self, memory: &Memory, at: u32, length: u32) -> Vec<u8> {
        (0..length)
            .map(|step| memory.read8(self.base + ((at + step) & 0xffff)))
            .collect()
    }

    fn sort(&mut self) {
        self.allocations.sort_by_key(|allocation| allocation.start);
    }

    /// Where `size` bytes fit, in a gap or after the last allocation; an
    /// address of nought is no room, as winbox.js reads it.
    fn find(&self, size: u32) -> Option<u32> {
        let mut last = self.offset;

        for allocation in &self.allocations {
            if allocation.start.saturating_sub(last) >= size && allocation.start >= last {
                return (last != 0).then_some(last);
            }

            last = allocation.start + allocation.span;
        }

        let space = (self.size + self.offset).saturating_sub(last);

        (space >= size && last != 0).then_some(last)
    }

    /// The heap grown for a request that does not fit, if it may: where
    /// the block goes.
    fn grow(&mut self, request: u32, needed: u32) -> Option<u32> {
        if !self.growable {
            return None;
        }

        let limit = 0x10000 - self.offset;
        let size = (self.size + (((request + 544 + 31) >> 5) << 5)).min(limit);

        if size <= self.size {
            return None;
        }

        let previous = self.size;

        self.size = size;

        let Some(address) = self.find(needed) else {
            self.size = previous;
            return None;
        };

        self.grown = Some(self.offset + size);
        Some(address)
    }

    fn place(&mut self, request: u32, needed: u32) -> Option<u32> {
        self.find(needed).or_else(|| self.grow(request, needed))
    }

    /// A handle's slot: two bytes of the heap, where room is found.
    fn allocate_handle(&mut self) -> Option<u32> {
        let at = self.place(2, 2)?;

        self.allocations.push(Allocation {
            start: at,
            span: 2,
            data: None,
        });
        self.sort();
        self.handles.insert(at, 0);
        Some(at)
    }

    /// A block of `length` bytes placed: its address, or its handle for a
    /// moveable one; `None` where there is no room.
    fn insert(&mut self, memory: &mut Memory, length: u32, options: Options) -> Option<u32> {
        if length == 0 {
            return None;
        }

        let needed = length + 2;
        let start = self.place(length, needed)?;

        self.allocations.push(Allocation {
            start,
            span: needed,
            data: Some(length),
        });
        self.sort();

        let address = start + 2;

        if options.zero_init {
            self.write_bytes(memory, address, &vec![0; length as usize]);
        }

        if options.movable {
            // No room for its handle, and the block is not given.
            let Some(handle) = self.allocate_handle() else {
                self.release(address);
                return None;
            };

            self.write_word(memory, handle, address as u16);
            return Some(handle);
        }

        Some(address)
    }

    /// A block of `size` bytes: its address or handle, `None` for none. A
    /// moveable block of nothing is a handle standing for nothing.
    pub fn allocate(&mut self, memory: &mut Memory, size: u32, options: Options) -> Option<u32> {
        if size == 0 {
            if !options.movable {
                return None;
            }

            let handle = self.allocate_handle()?;

            self.write_word(memory, handle, 0);
            return Some(handle);
        }

        self.insert(memory, Self::block_for(size, options.movable), options)
    }

    /// Whether a value is a handle this heap gave out.
    pub fn is_handle(&self, value: u32) -> bool {
        self.handles.contains_key(&value)
    }

    /// The address a handle stands for -- nought for a discarded block --
    /// or a pointer as it is.
    pub fn resolve(&self, value: u32) -> u32 {
        self.handles
            .get(&value)
            .map_or(value, |&pointer| u32::from(pointer))
    }

    /// What `LocalHandle` answers for a value: a moveable block's handle
    /// for a pointer to its data; a fixed block's pointer, which is its
    /// handle, as it is. KERNEL tells them apart by bit 1, which only a
    /// moveable block's pointer has set: a value without it is answered as
    /// it is, and with it, the handle whose word holds that pointer, or
    /// nought (`KRNL386.EXE` seg1 `8d6a`). Here blocks need not lie as
    /// KERNEL lays them, so a block is found by what the heap gave out
    /// first, and the bit decides only for a value that is no block's.
    pub fn handle_of(&self, value: u32) -> u32 {
        if value != 0
            && let Some((&handle, _)) = self
                .handles
                .iter()
                .find(|&(_, &pointer)| u32::from(pointer) == value)
        {
            return handle;
        }

        if self.allocation_at(value).is_some() || value & 2 == 0 {
            value
        } else {
            0
        }
    }

    fn allocation_at(&self, address: u32) -> Option<usize> {
        self.allocations
            .iter()
            .position(|allocation| allocation.start + 2 == address && allocation.data.is_some())
    }

    /// The size of the block behind a handle or a pointer, nought for none.
    pub fn size_of(&self, value: u32) -> u32 {
        let address = self.resolve(value);

        self.allocations
            .iter()
            .find(|allocation| allocation.start + 2 == address)
            .map_or(0, |allocation| allocation.data.unwrap_or(2))
    }

    /// A block freed, its handle with it.
    pub fn free(&mut self, value: u32) {
        let start = if let Some(pointer) = self.handles.remove(&value) {
            self.free(u32::from(pointer));
            value
        } else {
            value.wrapping_sub(2)
        };

        if let Some(index) = self.allocations.iter().position(|a| a.start == start) {
            self.allocations.remove(index);
        }
    }

    /// The largest space between blocks, or after the last: what
    /// `LocalCompact` answers.
    pub fn largest_free(&self) -> u32 {
        let mut last = self.offset;
        let mut largest = 0;

        for allocation in &self.allocations {
            largest = largest.max(allocation.start.saturating_sub(last));
            last = allocation.start + allocation.span;
        }

        largest.max((self.size + self.offset).saturating_sub(last))
    }

    /// A block given a new size, keeping what fits of its bytes: its handle
    /// or pointer, or `None` where it cannot be. Nought with `LMEM_MOVEABLE`
    /// discards a moveable block, its handle kept.
    pub fn reallocate(
        &mut self,
        memory: &mut Memory,
        value: u32,
        size: u32,
        movable_flag: bool,
        zero_init: bool,
    ) -> Option<u32> {
        let handle = self.is_handle(value).then_some(value);
        let address = self.resolve(value);
        let allocation = if address == 0 {
            None
        } else {
            self.allocation_at(address)
        };

        if address != 0 && allocation.is_none() {
            return None;
        }

        if size == 0 {
            let handle = handle.filter(|_| movable_flag)?;

            self.release(address);
            self.write_word(memory, handle, 0);
            return Some(handle);
        }

        if let Some(index) = allocation
            && self.in_place(memory, index, size, handle.is_some(), zero_init)
        {
            return Some(handle.unwrap_or(address));
        }

        let old = allocation.map_or_else(Vec::new, |index| {
            self.read_bytes(memory, address, self.allocations[index].data.unwrap_or(0))
        });
        let length = Self::block_for(size, handle.is_some());
        let mut data = vec![0u8; length as usize];
        let kept = old.len().min(data.len());

        data[..kept].copy_from_slice(&old[..kept]);

        if handle.is_none() && !movable_flag && data.len() > old.len() {
            return None;
        }

        if address != 0 {
            self.release(address);
        }

        let Some(placed) = self.insert(memory, length, Options::default()) else {
            // The old bytes put back where they will go.
            if !old.is_empty()
                && let Some(again) = self.insert(memory, old.len() as u32, Options::default())
            {
                self.write_bytes(memory, again, &old);

                if let Some(handle) = handle {
                    self.write_word(memory, handle, again as u16);
                }
            }

            return None;
        };

        self.write_bytes(memory, placed, &data);

        if let Some(handle) = handle {
            self.write_word(memory, handle, placed as u16);
            return Some(handle);
        }

        Some(placed)
    }

    /// A moveable block given a new size where it is, if it can be
    /// (`localre`).
    fn in_place(
        &mut self,
        memory: &mut Memory,
        index: usize,
        size: u32,
        movable: bool,
        zero_init: bool,
    ) -> bool {
        if !movable {
            return false;
        }

        let Allocation { start, span, data } = self.allocations[index];
        let wanted = ((size + 2 + 3) & !3).max(12);

        if wanted <= span {
            if span - wanted >= 20 {
                self.allocations[index].span = wanted;
                self.allocations[index].data = Some(wanted - 2);
            }

            return true;
        }

        match self.allocations.get(index + 1) {
            Some(next) if next.start >= start + wanted => {}
            _ => return false,
        }

        let was = data.unwrap_or(0);

        self.allocations[index].span = wanted;
        self.allocations[index].data = Some(wanted - 2);

        if zero_init {
            self.write_bytes(
                memory,
                start + 2 + was,
                &vec![0; (wanted - 2 - was) as usize],
            );
        }

        true
    }

    /// A block's data freed, any handle to it kept.
    fn release(&mut self, address: u32) {
        if let Some(index) = self.allocation_at(address) {
            self.allocations.remove(index);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rounds_blocks_as_windows_does() {
        // 15, 16, 17 and 18 bytes, moveable, are all 18 (`memory`).
        for size in 15..=18 {
            assert_eq!(LocalHeap::block_for(size, true), 18);
        }

        assert_eq!(LocalHeap::block_for(1, false), 8);
    }

    #[test]
    fn grows_by_the_request_and_544() {
        let mut memory = Memory::new();
        let mut heap = LocalHeap::new(100, 0x10, 1024);

        heap.growable = true;

        let block = heap
            .allocate(&mut memory, 1000, Options::default())
            .unwrap();

        assert_eq!(block, 0x12);
        assert!(
            heap.allocate(&mut memory, 1000, Options::default())
                .is_some()
        );
        // 1,000 + 544, rounded up to 32: 1,568 more.
        assert_eq!(heap.size(), 1024 + 1568);
        assert_eq!(heap.take_growth(), Some(0x10 + 1024 + 1568));
    }

    #[test]
    fn writes_a_moveable_blocks_handle_where_the_program_reads_it() {
        let mut memory = Memory::new();
        let mut heap = LocalHeap::new(100, 0x10, 1024);
        let options = Options {
            movable: true,
            zero_init: true,
        };
        let handle = heap.allocate(&mut memory, 10, options).unwrap();
        let address = heap.resolve(handle);

        assert_eq!(u32::from(memory.read16((100 << 16) + handle)), address);
        assert_eq!(heap.size_of(handle), 10);
        heap.free(handle);
        assert_eq!(heap.size_of(handle), 0);
        assert!(!heap.is_handle(handle));
    }

    #[test]
    fn reallocates_in_place_as_localre_recorded() {
        let mut memory = Memory::new();
        let movable = Options {
            movable: true,
            zero_init: false,
        };

        for (size, kept) in [(46, 46), (50, 66), (10, 10), (1, 10), (12, 14), (30, 30)] {
            let mut heap = LocalHeap::new(100, 0x10, 1024);
            let handle = heap.allocate(&mut memory, 66, movable).unwrap();
            let address = heap.resolve(handle);

            heap.allocate(&mut memory, 10, Options::default()).unwrap();
            assert_eq!(
                heap.reallocate(&mut memory, handle, size, true, false),
                Some(handle)
            );
            assert_eq!(heap.resolve(handle), address, "{size} bytes stay");
            assert_eq!(heap.size_of(handle), kept, "{size} bytes");
        }
    }
}
