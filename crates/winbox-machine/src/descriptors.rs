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

/// Selector 40h: the BIOS's data area, at 400h of the first megabyte, as
/// DOS's extender gives it to programs in the global table. KERNEL exports
/// another for it, `__0040H` (`FIRST_MEGABYTE_SELECTORS`).
pub const BIOS_DATA_SELECTOR: u16 = 0x40;

/// Where the machine's first megabyte is, as the selectors for its fixed
/// places reach it: not at nought, where a program's segments are, one to
/// a 64 KiB from index 1 -- 0A0000h is index 0Ah's -- but above anything
/// a program is given, just below the global table. What a program reads
/// there is the machine's, as the selectors' bases are; how far each is
/// from the first is Windows' (`kconst`).
pub const FIRST_MEGABYTE: u32 = 0xffe0_0000;

/// The selectors KERNEL makes for the first megabyte's fixed places as it
/// starts and exports as constants -- `__E000H`, `__D000H`, `__C000H`,
/// `__B800H`, `__B000H`, `__A000H`, `__F000H` (and `__ROMBIOS`),
/// `__0040H` and `__0000H` -- each with the paragraph its entry in
/// `KRNL386.EXE`'s file holds, in the order KERNEL gives them, one after
/// another in the local table. **Recorded** by `kconst`: 227h up to 267h,
/// each a data segment of 64 KiB from its paragraph, not yet accessed
/// (`F2h`). Here they are the nine indices below the interrupt
/// descriptor table's, 0FFDh, where no block reaches: not the table's
/// last, which stay empty, as the selectors past the end of Windows'
/// smaller table are, which a program may count on faulting (`fault`,
/// `badptr`, `badarg` load 0FFF7h).
pub const FIRST_MEGABYTE_SELECTORS: [(u16, usize); 9] = [
    (0xe000, 0xff4),
    (0xd000, 0xff5),
    (0xc000, 0xff6),
    (0xb800, 0xff7),
    (0xb000, 0xff8),
    (0xa000, 0xff9),
    (0xf000, 0xffa),
    (0x0040, 0xffb),
    (0x0000, 0xffc),
];

/// Where the descriptors of programs' module databases are found from:
/// above any block, program or module winbox.js keeps (`load_program`).
pub const MODULE_DATABASES: usize = 0x1e00;

/// The selector for a paragraph of the first megabyte KERNEL exports one
/// for, as a program is given it.
pub fn first_megabyte_selector(paragraph: u16) -> Option<u16> {
    FIRST_MEGABYTE_SELECTORS
        .iter()
        .find(|(each, _)| *each == paragraph)
        .map(|&(_, index)| segment_selector(index))
}

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

        // Index nought is never given, nor the first megabyte's.
        used[0] = true;

        for (_, index) in FIRST_MEGABYTE_SELECTORS {
            used[index] = true;
        }

        Self { used }
    }

    /// The tables made empty, but for the BIOS's data area -- 64 KiB of
    /// data from 400h of the first megabyte, writable at a program's
    /// privilege -- and the first megabyte's selectors.
    pub fn reset(&mut self, memory: &mut Memory) {
        memory.zero(LDT_BASE, 8 * SELECTORS);
        memory.zero(GDT_BASE, 8 * GDT_ENTRIES as usize);

        let describe = |memory: &mut Memory, at: u32, base: u32, access: u8| {
            let [b0, b1, b2, b3] = base.to_le_bytes();

            memory.write(at, &[0xff, 0xff, b0, b1, b2, access, 0x00, b3]);
        };

        describe(
            memory,
            GDT_BASE + u32::from(BIOS_DATA_SELECTOR & 0xfff8),
            FIRST_MEGABYTE + 0x400,
            DATA,
        );

        for (paragraph, index) in FIRST_MEGABYTE_SELECTORS {
            describe(
                memory,
                entry(index),
                FIRST_MEGABYTE + (u32::from(paragraph) << 4),
                0xf2,
            );
        }
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

    /// A descriptor's base changed, its limit and rights kept, as
    /// `SetSelectorBase` writes one.
    pub fn set_base(memory: &mut Memory, index: usize, base: u32) {
        let at = entry(index);
        let [b0, b1, b2, b3] = base.to_le_bytes();

        memory.write(at + 2, &[b0, b1, b2]);
        memory.write8(at + 7, b3);
    }

    /// A descriptor's access byte (5) and its byte 6, its limit's top and
    /// its flags, as a word.
    pub fn rights_of(memory: &Memory, index: usize) -> u16 {
        let at = entry(index);

        u16::from(memory.read8(at + 5)) | u16::from(memory.read8(at + 6)) << 8
    }

    /// A descriptor's access byte and byte 6 set from a word.
    pub fn set_rights(memory: &mut Memory, index: usize, rights: u16) {
        let [access, flags] = rights.to_le_bytes();

        memory.write(entry(index) + 5, &[access, flags]);
    }

    /// `count` descriptors one after another, each data at nought with no
    /// limit, its access byte `F3h`: what `AllocSelectorArray` makes. The
    /// first's index, or `None`.
    pub fn blank_run(&mut self, memory: &mut Memory, count: usize) -> Option<usize> {
        let index = self.find(1, count)?;

        for at in index..index + count {
            self.used[at] = true;
            memory.zero(entry(at), 8);
            memory.write8(entry(at) + 5, DATA);
        }

        Some(index)
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
