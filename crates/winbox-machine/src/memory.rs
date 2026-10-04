//! The machine's memory: four GiB of linear addresses, made a mebibyte at a
//! time as each is first written, as winbox.js's `Memory` makes them.
//!
//! A block never written reads as winbox.js's garbage: every byte of a read
//! the low byte of 1234h modulo the read's first address -- nought at
//! address nought -- so a program that reads memory it never wrote finds
//! what it found there.

use winbox_cpu::Bus;

/// A block is a mebibyte.
const BLOCK_BITS: u32 = 20;
const BLOCK_SIZE: usize = 1 << BLOCK_BITS;
const BLOCK_MASK: u32 = (1 << BLOCK_BITS) - 1;
const BLOCKS: usize = 1 << (32 - BLOCK_BITS);

/// The machine's memory.
pub struct Memory {
    blocks: Vec<Option<Box<[u8]>>>,
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
        }
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
        Some(Memory::read8(self, at))
    }

    fn write8(&mut self, at: u32, value: u8) -> Option<()> {
        Memory::write8(self, at, value);
        Some(())
    }

    fn read16(&self, at: u32) -> Option<u16> {
        Some(Memory::read16(self, at))
    }

    fn write16(&mut self, at: u32, value: u16) -> Option<()> {
        Memory::write16(self, at, value);
        Some(())
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
}
