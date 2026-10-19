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
//! * Each block has KERNEL's arena of four bytes before it, six for a
//!   moveable one, and a free block that would keep too little to be one
//!   is given whole (read out; `ddeheap`).
//! * `LocalInit` lays its own arenas out before the blocks and after them
//!   (`LocalHeap::layout`).
//! * A heap out of room grows -- a moveable data segment's -- as KERNEL's
//!   default `LocalNotify` grows it (`LocalHeap::grow`; `localgro`).
//! * `LocalReAlloc` of a moveable block keeps it where it is when it
//!   shrinks, its leftover freed only at 20 bytes or more, and when it
//!   grows into free space before the next block (`localre`).
//! * With `LMEM_ZEROINIT` a block is noughts; without, what the segment
//!   held (`lzero`).

use std::collections::HashMap;

use crate::Memory;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Allocation {
    /// Where its span starts: a data block's arena, or a handle.
    start: u32,
    /// The bytes it takes: a data block's and its arena, or a handle's two.
    span: u32,
    /// A data block's bytes; `None` for a handle's slot.
    data: Option<u32>,
    /// Its arena's bytes before its data: `HEADER` or `MOVEABLE_HEADER`.
    header: u32,
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
    /// The segment's size when it last grew, for its block to follow.
    grown: Option<u32>,
    /// The size of the segment the heap is in, as `GlobalSize` answers it,
    /// where it is known (`LocalHeap::segment_size`).
    segment_size: Option<u32>,
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
            segment_size: None,
        }
    }

    /// The bytes of a block's arena before its own: KERNEL's four, the
    /// previous arena's address with the block's flags in its low bits and
    /// the next's (`KRNL386.EXE` seg2 `2962`-`2992`, seg1 `930b`-`9331`),
    /// the block's bytes after them (`932c`-`932f`) -- and for a moveable
    /// block, its handle's address after those (`92d7`, `8b0f`), six. A
    /// fixed block of 2Eh bytes, as DDEML asks for each transaction it
    /// keeps, takes 52 (`ddeheap`).
    pub const HEADER: u32 = 4;
    pub const MOVEABLE_HEADER: u32 = 6;

    /// Where `LocalInit` lays a heap from `start` to `end` out
    /// (`KRNL386.EXE` seg2 `28e3`-`2957`): its first arena at `start`, at
    /// least 0Ah and rounded up to four; then an arena of the heap's own,
    /// four bytes and the 2Ah of its information; the free block after
    /// that, at a four-byte boundary; and the last arena ten bytes short of
    /// `end`, rounded down to four. The blocks go between the free block's
    /// start and the last arena: `(first, free, last)`, or `None` where they
    /// do not fit.
    pub fn layout(start: u32, end: u32) -> Option<(u32, u32, u32)> {
        let align = |at: u32| (at.max(0xa) + 3) & !3;
        let first = align(start);
        let info = align(first + 0xa);

        if info >= end {
            return None;
        }

        let free = align(info + 4 + 0x2a);
        let last = end.wrapping_sub(0xa) & !3;

        (last > free && last <= end).then_some((first, free, last))
    }

    /// The size of the segment the heap is in, as `GlobalSize` would answer
    /// it, which its growth goes by: where nothing has said, what its last
    /// arena's place makes it, ten bytes and a rounding past it.
    pub fn segment_size(&self) -> u32 {
        self.segment_size.unwrap_or(self.offset + self.size + 12)
    }

    pub fn set_segment_size(&mut self, size: u32) {
        self.segment_size = Some(size);
    }

    pub fn offset(&self) -> u32 {
        self.offset
    }

    pub fn size(&self) -> u32 {
        self.size
    }

    /// The segment's size, if the heap grew since this was last asked.
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

    /// Grows a heap that is out of room, as KERNEL's default `LocalNotify`
    /// grows one (`KRNL386.EXE` seg1 `8de2`), and answers whether it grew.
    /// Read out: refused when the segment's size, less the largest free
    /// block, with the block and 18h, passes 64 KiB (`8e0a`-`8e1c`);
    /// otherwise the segment is given the block and 218h more (`8e1e`, 200h
    /// of them the heap's own, set by `LocalInit`, seg2 `2933`), and no
    /// more than `FFF0h` (`8e2c`-`8e36`), by `GlobalReAlloc`, which rounds up
    /// to 32 bytes; and the heap's last arena moved to ten bytes short of
    /// its end, at a four-byte boundary, 64 KiB counting as `FFFFh`
    /// (`8e5c`-`8e6b`). Measured by `localgro`: a data segment of 12,160
    /// bytes grew by 1,568 for 1,000 bytes asked for (a block of 1,004).
    fn grow(&mut self, needed: u32) -> bool {
        if !self.growable {
            return false;
        }

        let size = self.segment_size();

        if (size + needed + 0x18).saturating_sub(self.largest_free()) > 0xffff {
            return false;
        }

        let asked = (size + needed + 0x218).min(0xfff0);
        let grown = ((asked + 31) & !31).min(0x10000);
        let last = (grown.min(0xffff) - 0xa) & !3;

        if last <= self.offset + self.size {
            return false;
        }

        self.segment_size = Some(grown);
        self.size = last - self.offset;
        self.grown = Some(grown);
        true
    }

    /// Where a block of `needed` bytes, its arena and all, goes: the first
    /// gap it fits, else after the heap has grown for it, if it may.
    fn place(&mut self, needed: u32) -> Option<u32> {
        loop {
            if let Some(address) = self.find(needed) {
                return Some(address);
            }

            if !self.grow(needed) {
                return None;
            }
        }
    }

    /// The free bytes from an address to the next block, or to the heap's
    /// end.
    fn gap_at(&self, address: u32) -> u32 {
        self.allocations
            .iter()
            .find(|allocation| allocation.start >= address)
            .map_or(self.size + self.offset, |next| next.start)
            .saturating_sub(address)
    }

    /// A handle's slot: two bytes of the heap, where room is found.
    fn allocate_handle(&mut self) -> Option<u32> {
        let at = self.place(2)?;

        self.allocations.push(Allocation {
            start: at,
            span: 2,
            data: None,
            header: 0,
        });
        self.sort();
        self.handles.insert(at, 0);
        Some(at)
    }

    /// A block of `length` bytes placed, with an arena of `header` bytes:
    /// its address, or its handle for a moveable one; `None` where there is
    /// no room. A free block that would keep too little to be one is given
    /// whole: a fixed block's where 16 bytes or less would be left, a
    /// moveable one's where less than 16 (`KRNL386.EXE` seg1 `92a4`-`92b5`,
    /// `92f9`-`9308`); its bytes are the block's, `LocalSize` and all. After
    /// each growth of a heap DDEML fills with blocks of 52, what was left
    /// past the last of them is lost so (`ddeheap`).
    fn insert(
        &mut self,
        memory: &mut Memory,
        length: u32,
        options: Options,
        header: u32,
    ) -> Option<u32> {
        if length == 0 {
            return None;
        }

        let needed = length + header;
        let start = self.place(needed)?;
        let left = self.gap_at(start) - needed;
        let whole = if header == Self::MOVEABLE_HEADER {
            left < 16
        } else {
            left <= 16
        };
        let extra = if whole { left } else { 0 };

        self.allocations.push(Allocation {
            start,
            span: needed + extra,
            data: Some(length + extra),
            header,
        });
        self.sort();

        let address = start + header;

        if options.zero_init {
            self.write_bytes(memory, address, &vec![0; (length + extra) as usize]);
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

        let header = if options.movable {
            Self::MOVEABLE_HEADER
        } else {
            Self::HEADER
        };

        self.insert(
            memory,
            Self::block_for(size, options.movable),
            options,
            header,
        )
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
        self.allocations.iter().position(|allocation| {
            allocation.data.is_some() && allocation.start + allocation.header == address
        })
    }

    /// The size of the block behind a handle or a pointer, nought for none.
    pub fn size_of(&self, value: u32) -> u32 {
        let address = self.resolve(value);

        self.allocation_at(address)
            .and_then(|index| self.allocations[index].data)
            .unwrap_or(0)
    }

    /// A block freed, its handle with it.
    pub fn free(&mut self, value: u32) {
        if let Some(pointer) = self.handles.remove(&value) {
            self.release(u32::from(pointer));

            // And the handle's own slot.
            if let Some(index) = self
                .allocations
                .iter()
                .position(|a| a.start == value && a.data.is_none())
            {
                self.allocations.remove(index);
            }

            return;
        }

        self.release(value);
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
        let header = if handle.is_some() {
            Self::MOVEABLE_HEADER
        } else {
            Self::HEADER
        };
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

        let Some(placed) = self.insert(memory, length, Options::default(), header) else {
            // The old bytes put back where they will go.
            if !old.is_empty()
                && let Some(again) =
                    self.insert(memory, old.len() as u32, Options::default(), header)
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

        let Allocation {
            start,
            span,
            data,
            header,
        } = self.allocations[index];
        let wanted = ((size + header + 3) & !3).max(header + 10);

        if wanted <= span {
            if span - wanted >= 20 {
                self.allocations[index].span = wanted;
                self.allocations[index].data = Some(wanted - header);
            }

            return true;
        }

        match self.allocations.get(index + 1) {
            Some(next) if next.start >= start + wanted => {}
            _ => return false,
        }

        let was = data.unwrap_or(0);

        self.allocations[index].span = wanted;
        self.allocations[index].data = Some(wanted - header);

        if zero_init {
            self.write_bytes(
                memory,
                start + header + was,
                &vec![0; (wanted - header - was) as usize],
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
        let (_, free, last) = LocalHeap::layout(12160 - 1 - 1024, 12160 - 1).unwrap();
        let mut heap = LocalHeap::new(100, free, last - free);

        heap.growable = true;
        heap.set_segment_size(12160);

        let sizes = [1000, 1000, 1000, 3072]
            .into_iter()
            .chain(std::iter::repeat_n(4096, 12));
        let made: Vec<(u32, u32)> = sizes
            .map(|size| {
                let block = heap
                    .allocate(&mut memory, size, Options::default())
                    .unwrap_or(0);

                (block, heap.segment_size())
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
        assert_eq!(heap.take_growth(), Some(65312));
    }

    #[test]
    fn gives_a_free_block_whole_where_16_bytes_or_less_would_be_left() {
        let mut memory = Memory::new();
        let mut heap = LocalHeap::new(100, 0x100, 52 + 16);
        let block = heap
            .allocate(&mut memory, 0x2e, Options::default())
            .unwrap();

        assert_eq!(heap.size_of(block), 0x30 + 16);
        assert!(heap.allocate(&mut memory, 1, Options::default()).is_none());
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
