//! The descriptor tables and the selectors given out of them, as winbox.js's
//! `GlobalAllocator` keeps them.
//!
//! A task's segments are in the local descriptor table, which is where
//! Windows puts them -- the table bit is part of every selector a program
//! sees (`handles`). Memory is mapped one to one: the segment a descriptor
//! index names is the 64 KiB from the index times 64 KiB.

use crate::Memory;

/// Where the local descriptor table is: above anything a program
/// addresses, since the table is the engine's.
pub const LDT_BASE: u32 = 0xffff_0000;

/// How many descriptors it has room for, the architecture's.
pub const SELECTORS: usize = 8192;

/// Where the global descriptor table is, just below the local one: a few
/// descriptors Windows keeps there for every program.
pub const GDT_BASE: u32 = 0xfffe_f000;
pub const GDT_ENTRIES: u32 = 32;

/// Selector 40h: the BIOS's data area, at 400h, as Windows gives it to
/// programs and exports it as `__0040H`.
pub const BIOS_DATA_SELECTOR: u16 = 0x40;

/// The descriptors given out, by index.
#[derive(Debug, Clone)]
pub struct Descriptors {
    used: Vec<bool>,
}

impl Default for Descriptors {
    fn default() -> Self {
        Self::new()
    }
}

/// A program's code segment, as `LAR` reads Windows': present, privilege
/// 3, code, readable, accessed.
pub const CODE: u8 = 0xfb;

/// A program's data segment: present, privilege 3, data, writable,
/// accessed.
pub const DATA: u8 = 0xf3;

fn entry(index: usize) -> u32 {
    LDT_BASE + 8 * index as u32
}

impl Descriptors {
    pub fn new() -> Self {
        let mut used = vec![false; SELECTORS];

        // Index nought is never given.
        used[0] = true;
        Self { used }
    }

    /// The tables made empty, but for the BIOS's data area: 64 KiB of data
    /// from 400h, writable at a program's privilege.
    pub fn reset(&mut self, memory: &mut Memory) {
        memory.zero(LDT_BASE, 8 * SELECTORS);
        memory.zero(GDT_BASE, 8 * GDT_ENTRIES as usize);

        let bios = GDT_BASE + u32::from(BIOS_DATA_SELECTOR & 0xfff8);

        memory.write(bios, &[0xff, 0xff, 0x00, 0x04, 0x00, DATA, 0x00, 0x00]);
    }

    /// The local table's base and the offset of its last byte.
    pub fn ldt() -> (u32, u32) {
        (LDT_BASE, 8 * SELECTORS as u32 - 1)
    }

    /// The global table's base and the offset of its last byte.
    pub fn gdt() -> (u32, u32) {
        (GDT_BASE, 8 * GDT_ENTRIES - 1)
    }

    /// Whether an index is given out.
    pub fn used(&self, index: usize) -> bool {
        self.used.get(index).copied().unwrap_or(true)
    }

    /// The first index from `start` with `count` free after it, or `None`.
    pub fn find(&self, start: usize, count: usize) -> Option<usize> {
        (start..SELECTORS).find(|&index| {
            (0..count).all(|step| index + step < SELECTORS && !self.used[index + step])
        })
    }

    /// A segment mapped: its descriptor a program's -- code or data, the
    /// whole 64 KiB, at the index times 64 KiB -- and `bytes` written from
    /// its start.
    pub fn map(&mut self, memory: &mut Memory, index: usize, bytes: &[u8], code: bool) {
        self.used[index] = true;

        let base = (index as u32) << 16;
        let [b0, b1, b2, b3] = base.to_le_bytes();

        memory.write(
            entry(index),
            &[
                0xff,
                0xff,
                b0,
                b1,
                b2,
                if code { CODE } else { DATA },
                0,
                b3,
            ],
        );
        memory.write(base, bytes);
    }

    /// A segment's limit, its last offset: up to twenty bits, so that the
    /// first selector of a block past 64 KiB reaches all of it, as `LSL`
    /// shows on Windows.
    pub fn set_limit(&mut self, memory: &mut Memory, index: usize, limit: u32) {
        let limit = limit.min(0xfffff);
        let at = entry(index);

        memory.write16(at, limit as u16);
        memory.write8(
            at + 6,
            (memory.read8(at + 6) & 0xf0) | ((limit >> 16) & 0x0f) as u8,
        );
    }

    /// A freed segment's descriptor emptied: `LAR`, `LSL`, `VERR` and `VERW`
    /// refuse its selector, as they do on Windows, and any use of it
    /// faults. The index stays given until `release`.
    pub fn unmap(&mut self, memory: &mut Memory, index: usize) {
        memory.zero(entry(index), 8);
    }

    /// A descriptor emptied and free to be given again.
    pub fn release(&mut self, memory: &mut Memory, index: usize) {
        self.unmap(memory, index);
        self.used[index] = false;
    }

    /// A second descriptor for a segment's memory, code or data as asked:
    /// its index, or `None` with none free.
    pub fn alias(&mut self, memory: &mut Memory, index: usize, code: bool) -> Option<usize> {
        let to = self.find(1, 1)?;

        self.used[to] = true;
        Self::copy(memory, index, to);
        memory.write8(entry(to) + 5, if code { CODE } else { DATA });
        Some(to)
    }

    /// One descriptor made a copy of another with its type swapped between
    /// code and data, as `PrestoChangoSelector` does.
    pub fn copy_swapped(&mut self, memory: &mut Memory, from: usize, to: usize) {
        Self::copy(memory, from, to);

        let access = memory.read8(entry(from) + 5);

        memory.write8(entry(to) + 5, if access & 0x08 != 0 { DATA } else { CODE });
    }

    /// A descriptor for nothing yet, from `start`: data, at nought, not yet
    /// accessed. Its index, or `None`.
    pub fn blank(&mut self, memory: &mut Memory, start: usize) -> Option<usize> {
        let index = self.find(start, 1)?;

        self.used[index] = true;
        memory.zero(entry(index), 8);
        memory.write8(entry(index) + 5, 0xf2);
        Some(index)
    }

    fn copy(memory: &mut Memory, from: usize, to: usize) {
        let bytes = memory.read(entry(from), 8);

        memory.write(entry(to), &bytes);
    }
}

/// A descriptor index's selector as a program is given it: the local
/// table's, at privilege 3.
pub fn segment_selector(index: usize) -> u16 {
    ((index << 3) | 0x4 | 0x3) as u16
}

/// A descriptor index's handle as Windows gives one: privilege 2.
pub fn handle_for(index: usize) -> u16 {
    ((index << 3) | 0x4 | 0x2) as u16
}

/// The descriptor index a selector or handle names.
pub fn index_for(selector: u16) -> usize {
    usize::from(selector >> 3)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_a_segment_as_windows_describes_a_programs() {
        let mut memory = Memory::new();
        let mut descriptors = Descriptors::new();

        descriptors.reset(&mut memory);
        descriptors.map(&mut memory, 100, b"hello", true);
        descriptors.set_limit(&mut memory, 100, 0x1f);

        assert_eq!(
            memory.read(entry(100), 8),
            vec![0x1f, 0x00, 0x00, 0x00, 0x64, CODE, 0x00, 0x00]
        );
        assert_eq!(memory.read(100 << 16, 5), b"hello");
        assert_eq!(descriptors.find(100, 1), Some(101));
        assert_eq!(segment_selector(100), 0x327);
        assert_eq!(handle_for(100), 0x326);
    }
}
