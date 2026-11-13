//! The machine's memory: four GiB of linear addresses, made a mebibyte at a
//! time as each is first written, as winbox.js's `Memory` makes them.
//!
//! A block never written reads as winbox.js's garbage: every byte of a read
//! the low byte of 1234h modulo the read's first address -- nought at
//! address nought -- so a program that reads memory it never wrote finds
//! what it found there.

use std::cell::Cell;
use std::collections::HashMap;

use winbox_cpu::Bus;

use crate::pages::{PAGE_BITS, PAGE_SIZE, Pages};

/// A block is a mebibyte.
const BLOCK_BITS: u32 = 20;
const BLOCK_SIZE: usize = 1 << BLOCK_BITS;
const BLOCK_MASK: u32 = (1 << BLOCK_BITS) - 1;
const BLOCKS: usize = 1 << (32 - BLOCK_BITS);

/// The machine's memory.
pub struct Memory {
    blocks: Vec<Option<Box<[u8]>>>,
    /// Linear addresses whose bytes the host makes as the processor reads
    /// them, as winbox.js's segment handlers make theirs: where they start
    /// and how many; what has been answered there since the answers were
    /// last let go; and the address last asked for and not answered.
    host: Option<(u32, u32)>,
    answers: HashMap<u32, u8>,
    asked: Cell<Option<u32>>,
    /// The first megabyte's pages that keep no write by the processor, as
    /// a ROM's (`set_rom`), a bit each.
    rom: [u64; 4],
    /// The linear addresses a processor's write is checked in for the host
    /// range and ROM, from where and how many (wrapping): the rest is
    /// written straight away.
    guard_start: u32,
    guard_length: u32,
    /// The pages WIN386 would have present (`pages.rs`), kept as blocks
    /// are given and freed, and which of a block's pages the processor has
    /// reached.
    pages: Pages,
    /// The paging audit's (`kb/guides/paging.md`, "The audit"): a test's
    /// alone, built with the `audit` feature.
    #[cfg(feature = "audit")]
    audit: Audit,
}

/// The paging audit: with `on`, an access by the processor to a page the
/// set does not hold stops it before its instruction, as a page fault
/// would, the address kept for the host (`missed`), unless the page has
/// been let through since. Built only with the `audit` feature, for the
/// paging audit's test: nothing of it is on the processor's path
/// otherwise.
#[cfg(feature = "audit")]
#[derive(Debug, Default)]
pub struct Audit {
    pub on: bool,
    allowed: std::collections::HashSet<u32>,
    missed: Cell<Option<(u32, bool)>>,
}

#[cfg(feature = "audit")]
impl Audit {
    /// The access the processor last stopped at: its address and whether
    /// it was a write.
    pub fn take_missed(&self) -> Option<(u32, bool)> {
        self.missed.take()
    }

    /// The page holding `at` let through from now on.
    pub fn allow(&mut self, at: u32) {
        self.allowed.insert(at >> PAGE_BITS);
    }
}

impl std::fmt::Debug for Memory {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let made = self.blocks.iter().filter(|block| block.is_some()).count();

        write!(f, "Memory {{ {made} MiB made }}")
    }
}

impl Default for Memory {
    fn default() -> Self {
        Self::new()
    }
}

/// The first megabyte, as a page of its ROM is told: at linear nought and
/// at WinBox's copy of it ([`crate::FIRST_MEGABYTE`]).
const MEGABYTE: u32 = 0x10_0000;

/// Where a processor's write is checked: from the first megabyte's copy's
/// C0000h, where its ROM begins, round the top of the 4 GiB to the end of
/// the first megabyte at nought -- the ROM in both, and the host's range
/// (GDI's data segment, in the first megabyte), and nothing a program is
/// given: its segments are from descriptor index 100, 640000h.
const GUARD_START: u32 = crate::FIRST_MEGABYTE + 0xc_0000;
const GUARD_LENGTH: u32 = MEGABYTE.wrapping_sub(GUARD_START);

/// The pages a block of `length` bytes is given: one at least.
fn pages_of(length: u32) -> usize {
    length.div_ceil(PAGE_SIZE).max(1) as usize
}

/// What a read of `length` bytes from `address` finds in memory never
/// written, as winbox.js's `readGarbage` makes it.
fn garbage(address: u32) -> u8 {
    if address == 0 {
        0
    } else {
        (0x1234 % address) as u8
    }
}

impl Memory {
    pub fn new() -> Self {
        Self {
            blocks: (0..BLOCKS).map(|_| None).collect(),
            host: None,
            answers: HashMap::new(),
            asked: Cell::new(None),
            rom: [0; 4],
            guard_start: GUARD_START,
            guard_length: GUARD_LENGTH,
            pages: Pages::new(),
            #[cfg(feature = "audit")]
            audit: Audit::default(),
        }
    }

    /// The pages WIN386 would have present.
    pub fn pages(&self) -> &Pages {
        &self.pages
    }

    pub fn pages_mut(&mut self) -> &mut Pages {
        &mut self.pages
    }

    #[cfg(feature = "audit")]
    pub fn audit(&self) -> &Audit {
        &self.audit
    }

    #[cfg(feature = "audit")]
    pub fn audit_mut(&mut self) -> &mut Audit {
        &mut self.audit
    }

    /// Whether the audit stops an access at `at`.
    #[cfg(feature = "audit")]
    fn audit_stops(&self, at: u32, write: bool) -> bool {
        if !self.audit.on
            || self.pages.present(at)
            || self.audit.allowed.contains(&(at >> PAGE_BITS))
        {
            return false;
        }

        self.audit.missed.set(Some((at, write)));
        true
    }

    /// A block given pages of its own (`Pages::own`): `length` bytes from
    /// `base`, on a page, in `room` bytes WinBox gave it.
    pub fn own_pages(&mut self, base: u32, length: u32, room: u32) {
        self.pages.own(base, pages_of(length), room);
    }

    /// A block with pages of its own freed (`Pages::free_own`): whether it
    /// had them.
    pub fn free_own_pages(&mut self, base: u32) -> bool {
        self.pages.free_own(base).is_some()
    }

    /// A block with pages of its own given `length` bytes in place.
    pub fn resize_own_pages(&mut self, base: u32, length: u32) {
        self.pages.resize_own(base, pages_of(length));
    }

    /// A block with pages of its own moved to `to`, given `length` bytes
    /// in `room` there (`Pages::move_own`).
    pub fn move_own_pages(&mut self, from: u32, to: u32, length: u32, room: u32) {
        self.pages.move_own(from, to, pages_of(length), room);
    }

    fn block_mut(&mut self, address: u32) -> &mut [u8] {
        self.blocks[(address >> BLOCK_BITS) as usize]
            .get_or_insert_with(|| vec![0u8; BLOCK_SIZE].into_boxed_slice())
    }

    /// The byte at `address`, or `None` where it was never written.
    fn byte(&self, address: u32) -> Option<u8> {
        self.blocks[(address >> BLOCK_BITS) as usize]
            .as_ref()
            .map(|block| block[(address & BLOCK_MASK) as usize])
    }

    /// A stretch of linear addresses whose bytes the host makes as they are
    /// read: each read of one not answered stops the processor before its
    /// instruction (`Exit::Host`), the address kept for `asked`; what the
    /// processor writes there is lost, as a handler that takes no writes
    /// loses it.
    pub fn set_host(&mut self, start: u32, length: u32) {
        self.host = Some((start, length));
        self.answers.clear();

        // A range outside the stretch writes are checked in: every write
        // then checked.
        let inside = |at: u32| at.wrapping_sub(GUARD_START) < GUARD_LENGTH;

        if !(inside(start) && inside(start.wrapping_add(length.saturating_sub(1)))) {
            self.guard_start = 0;
            self.guard_length = u32::MAX;
        }
    }

    /// The first megabyte's pages, by number (C0h for C0000h), whose bytes
    /// keep no write the processor makes, as a ROM's -- at linear nought,
    /// where a program's own selector based there reaches the virtual
    /// machine's first megabyte, and at WinBox's copy of it, where
    /// KERNEL's selectors for its fixed places reach it -- and the rest's
    /// writes kept. The engine's own writes land in both.
    pub fn set_rom(&mut self, pages: impl IntoIterator<Item = u32>) {
        self.rom = [0; 4];

        for page in pages {
            if page < MEGABYTE >> PAGE_BITS {
                self.rom[(page >> 6) as usize] |= 1 << (page & 63);
            }
        }
    }

    /// Whether a processor's write at `at` is checked, off the common path.
    #[inline]
    fn guarded(&self, at: u32) -> bool {
        at.wrapping_sub(self.guard_start) < self.guard_length
    }

    /// Whether `at` is in a page of the first megabyte's ROM.
    fn in_rom(&self, at: u32) -> bool {
        let offset = if at < MEGABYTE {
            at
        } else {
            at.wrapping_sub(crate::FIRST_MEGABYTE)
        };
        let page = offset >> PAGE_BITS;

        offset < MEGABYTE && self.rom[(page >> 6) as usize] & (1 << (page & 63)) != 0
    }

    /// Whether a processor's write at `at` is lost: to the host's range,
    /// which takes no writes, or to the ROM.
    #[cold]
    fn write_lost(&self, at: u32) -> bool {
        self.hosted(at) || self.in_rom(at)
    }

    fn hosted(&self, address: u32) -> bool {
        self.host
            .is_some_and(|(start, length)| address.wrapping_sub(start) < length)
    }

    /// The host's byte at an address it was asked for, kept until the
    /// answers are let go.
    pub fn answer(&mut self, address: u32, value: u8) {
        self.answers.insert(address, value);
        self.asked.set(None);
    }

    /// The answers let go, to be made again as they are next read: the
    /// host's state may have changed since.
    pub fn forget_answers(&mut self) {
        self.answers.clear();
    }

    /// The address the processor last asked the host for, not answered.
    pub fn asked(&self) -> Option<u32> {
        self.asked.get()
    }

    /// Whether the block holding `address` has been written.
    pub fn made(&self, address: u32) -> bool {
        self.blocks[(address >> BLOCK_BITS) as usize].is_some()
    }

    pub fn read8(&self, address: u32) -> u8 {
        self.byte(address).unwrap_or_else(|| garbage(address))
    }

    /// A word, little-endian; past a block's end the next block's bytes.
    /// A read wholly of memory never written is garbage of its first
    /// address, as winbox.js's is; one partly so is the bytes there are.
    pub fn read16(&self, address: u32) -> u16 {
        if !self.made(address) {
            return u16::from_le_bytes([garbage(address); 2]);
        }

        u16::from_le_bytes([self.read8(address), self.read8(address.wrapping_add(1))])
    }

    pub fn read32(&self, address: u32) -> u32 {
        if !self.made(address) {
            return u32::from_le_bytes([garbage(address); 4]);
        }

        u32::from_le_bytes([
            self.read8(address),
            self.read8(address.wrapping_add(1)),
            self.read8(address.wrapping_add(2)),
            self.read8(address.wrapping_add(3)),
        ])
    }

    pub fn write8(&mut self, address: u32, value: u8) {
        self.block_mut(address)[(address & BLOCK_MASK) as usize] = value;
    }

    pub fn write16(&mut self, address: u32, value: u16) {
        let [low, high] = value.to_le_bytes();

        self.write8(address, low);
        self.write8(address.wrapping_add(1), high);
    }

    pub fn write32(&mut self, address: u32, value: u32) {
        for (at, byte) in value.to_le_bytes().into_iter().enumerate() {
            self.write8(address.wrapping_add(at as u32), byte);
        }
    }

    /// `bytes` written from `address`, a block at a time.
    pub fn write(&mut self, mut address: u32, mut bytes: &[u8]) {
        while !bytes.is_empty() {
            let at = (address & BLOCK_MASK) as usize;
            let length = bytes.len().min(BLOCK_SIZE - at);

            self.block_mut(address)[at..at + length].copy_from_slice(&bytes[..length]);
            address = address.wrapping_add(length as u32);
            bytes = &bytes[length..];
        }
    }

    /// `length` noughts written from `address`.
    pub fn zero(&mut self, mut address: u32, mut length: usize) {
        while length > 0 {
            let at = (address & BLOCK_MASK) as usize;
            let run = length.min(BLOCK_SIZE - at);

            self.block_mut(address)[at..at + run].fill(0);
            address = address.wrapping_add(run as u32);
            length -= run;
        }
    }

    /// `length` bytes from `address`, a block never written read as its
    /// garbage.
    pub fn read(&self, mut address: u32, length: usize) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(length);

        while bytes.len() < length {
            let at = (address & BLOCK_MASK) as usize;
            let run = (length - bytes.len()).min(BLOCK_SIZE - at);

            match &self.blocks[(address >> BLOCK_BITS) as usize] {
                Some(block) => bytes.extend_from_slice(&block[at..at + run]),
                None => bytes.extend(std::iter::repeat_n(garbage(address), run)),
            }

            address = address.wrapping_add(run as u32);
        }

        bytes
    }
}

/// The processor reaches memory through this: every byte is the machine's,
/// so nothing is left to a host.
impl Bus for Memory {
    fn read8(&self, at: u32) -> Option<u8> {
        #[cfg(feature = "audit")]
        if self.audit_stops(at, false) {
            return None;
        }

        if self.hosted(at) {
            let answer = self.answers.get(&at).copied();

            if answer.is_none() {
                self.asked.set(Some(at));
            }

            return answer;
        }

        Some(Memory::read8(self, at))
    }

    fn write8(&mut self, at: u32, value: u8) -> Option<()> {
        #[cfg(feature = "audit")]
        if self.audit_stops(at, true) {
            return None;
        }

        if !(self.guarded(at) && self.write_lost(at)) {
            Memory::write8(self, at, value);
        }

        Some(())
    }

    fn read16(&self, at: u32) -> Option<u16> {
        #[cfg(feature = "audit")]
        if self.audit_stops(at, false) || self.audit_stops(at.wrapping_add(1), false) {
            return None;
        }

        if self.hosted(at) || self.hosted(at.wrapping_add(1)) {
            let low = Bus::read8(self, at)?;
            let high = Bus::read8(self, at.wrapping_add(1))?;

            return Some(u16::from(low) | u16::from(high) << 8);
        }

        Some(Memory::read16(self, at))
    }

    fn write16(&mut self, at: u32, value: u16) -> Option<()> {
        #[cfg(feature = "audit")]
        if self.audit_stops(at, true) || self.audit_stops(at.wrapping_add(1), true) {
            return None;
        }

        if self.guarded(at) || self.guarded(at.wrapping_add(1)) {
            Bus::write8(self, at, value as u8)?;
            return Bus::write8(self, at.wrapping_add(1), (value >> 8) as u8);
        }

        Memory::write16(self, at, value);
        Some(())
    }

    fn reached(&self, base: u32, length: u64) -> u64 {
        self.pages.reached(base, length)
    }

    fn reach(&self, at: u32, size: u32, _write: bool) -> bool {
        self.pages.reach(at, size)
    }

    fn epoch(&self) -> u64 {
        self.pages.epoch()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_garbage_where_nothing_was_written() {
        let memory = Memory::new();

        // 1234h % 100h = 34h; 1234h % 0FFFFh = 1234h.
        assert_eq!(memory.read8(0x100), 0x34);
        assert_eq!(memory.read16(0x100), 0x3434);
        assert_eq!(memory.read8(0x10000), 0x34);
        assert_eq!(memory.read8(0x3), (0x1234u32 % 3) as u8);
        assert_eq!(memory.read8(0), 0);
    }

    #[test]
    fn writes_and_reads_across_blocks() {
        let mut memory = Memory::new();

        memory.write(0x000f_fffe, &[1, 2, 3, 4]);
        assert_eq!(memory.read32(0x000f_fffe), 0x0403_0201);
        assert_eq!(memory.read(0x000f_fffd, 6), vec![0, 1, 2, 3, 4, 0]);
    }

    #[test]
    fn rom_keeps_no_write_by_the_processor() {
        let mut memory = Memory::new();
        let copy = crate::FIRST_MEGABYTE;

        memory.set_rom((0xc0..0xc8).chain([0xf0]));

        for at in [
            0xc_0000,
            0xc_7fff,
            0xf_0ff0,
            copy + 0xc_0000,
            copy + 0xf_0ff0,
        ] {
            memory.write8(at, 0x12);
            Bus::write8(&mut memory, at, 0x34).unwrap();
            assert_eq!(memory.read8(at), 0x12, "{at:08x}, the engine's write kept");
        }

        // A word across the ROM's end: its second byte kept.
        Bus::write16(&mut memory, 0xc_7fff, 0x5678).unwrap();
        assert_eq!(memory.read16(0xc_7fff), 0x5612);

        // Pages that are not ROM, and the tables past the copy.
        for at in [
            0xc_8000,
            0xf_1ff0,
            copy + 0xc_8000,
            copy + 0x10_0000,
            0x10_0000,
        ] {
            Bus::write8(&mut memory, at, 0x34).unwrap();
            assert_eq!(memory.read8(at), 0x34, "{at:08x}");
        }
    }

    #[test]
    fn a_host_range_outside_the_guard_still_takes_no_writes() {
        let mut memory = Memory::new();

        memory.set_host(0x20_0000, 0x10);
        memory.write8(0x20_0004, 0x12);
        Bus::write8(&mut memory, 0x20_0004, 0x34).unwrap();
        assert_eq!(memory.read8(0x20_0004), 0x12);
    }
}
