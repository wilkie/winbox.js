//! A module's relocations applied, as winbox.js's `Linker` applies them:
//! its calls into the modules winbox.js keeps linked to their stubs, its
//! references to its own segments to where they were put, KERNEL's
//! constants written in, and its floating-point instructions fixed up.

use winbox_machine::segment_selector;
use winbox_ne::{Relocation, Target};

use crate::system::{STEP, System};

/// How many sites one chain of fixups can link, so a chain that loops ends:
/// each is a distinct word of a segment of at most 64K. `HANOI.EXE` of the
/// corpus calls into its own first segment from 1152 of them.
const CHAIN_LIMIT: u32 = 0x8000;

/// A 16-bit selector.
const SELECTOR: u8 = 2;
/// A far pointer: offset, then selector.
const FAR: u8 = 3;
/// A 16-bit offset.
const OFFSET: u8 = 5;

/// What KERNEL adds to a site of each OS fixup's type as it loads a segment
/// (`KRNL386.EXE` seg1 `7536`, tables at `74f3`): the word at the site and
/// the word a byte after, without a coprocessor and with one. Without one,
/// types 1 to 5 make the instruction `INT 34h` to `3Ch`, the emulator's;
/// with one, the `FWAIT` becomes `NOP`. Type 6, a lone `FWAIT`, becomes
/// `INT 3Dh` either way.
fn os_fixup(kind: u16, coprocessor: bool) -> Option<(u16, u16)> {
    let (without, with) = match kind {
        1 => ((0xfe32, 0x4000), (0xfff5, 0)),
        2 => ((0x0632, 0x8000), (0xfff5, 0)),
        3 => ((0x0e32, 0xc000), (0xfff5, 0)),
        4 => ((0x1632, 0), (0xfff5, 0)),
        5 => ((0x5c32, 0), (0xfff5, 0)),
        6 => ((0xa23d, 0), (0xa23d, 0)),
        _ => return None,
    };

    Some(if coprocessor { with } else { without })
}

/// KERNEL's exports that are numbers rather than functions, which a
/// program reads where its relocation puts them: in protected mode a huge
/// pointer's selector steps by 8, a shift of 3 (`__AHSHIFT`, `__AHINCR`);
/// `__WINFLAGS` is what `GetWinFlags` answers; `__0040H` the BIOS data
/// area's selector.
fn kernel_constant(ordinal: u16, coprocessor: bool) -> Option<u16> {
    match ordinal {
        113 => Some(3),
        114 => Some(8),
        // WF_PMODE, WF_STANDARD, WF_CPU486, and WF_80x87 with a coprocessor.
        178 => Some(0x0001 | 0x0010 | 0x0008 | if coprocessor { 0x0400 } else { 0 }),
        193 => Some(0x40),
        _ => None,
    }
}

/// What a relocation writes: a selector and an offset, or a number.
enum Value {
    Place(usize, u16),
    Number(u16),
}

impl System {
    /// A module's relocations applied, segment by segment, each segment's
    /// in the order of their offsets.
    pub fn link(&mut self, module: usize) {
        for number in 0..self.modules[module].executable.segments.len() {
            let at = self.modules[module].segments[number];
            let mut relocations = self.modules[module].executable.segments[number]
                .relocations
                .clone();

            relocations.sort_by_key(|relocation| relocation.offset);

            for relocation in &relocations {
                self.apply(module, at, relocation);
            }
        }
    }

    fn apply(&mut self, module: usize, at: usize, relocation: &Relocation) {
        let module = &self.modules[module];
        let value = match &relocation.target {
            Target::OsFixup(kind) => {
                if let Some((low, high)) = os_fixup(*kind, self.coprocessor) {
                    let site = ((at as u32) << 16) + u32::from(relocation.offset);
                    let memory = &mut self.cpu.bus;

                    memory.write16(site, memory.read16(site).wrapping_add(low));
                    memory.write16(site + 1, memory.read16(site + 1).wrapping_add(high));
                }

                return;
            }
            Target::ImportOrdinal { module: from, .. }
            | Target::ImportName { module: from, .. } => {
                let Some(value) = self.imported(&from.clone(), &relocation.target) else {
                    return;
                };

                value
            }
            Target::Internal { segment, offset } => {
                // The executable numbers its segments from one; where each
                // was put is the loader's to say.
                let segment = module
                    .translate(u16::from(*segment))
                    .unwrap_or(usize::from(*segment));

                Value::Place(segment, *offset)
            }
            Target::Ordinal(ordinal) => {
                let Some((segment, offset)) = module.lookup(*ordinal) else {
                    return;
                };

                Value::Place(segment, offset)
            }
        };

        match value {
            Value::Number(number) => self.write16(at, relocation, number),
            Value::Place(segment, offset) => match relocation.address_type {
                SELECTOR => self.write16(at, relocation, segment_selector(segment)),
                FAR => self.write32(at, relocation, segment_selector(segment), offset),
                OFFSET => self.write16(at, relocation, offset),
                _ => {}
            },
        }
    }

    /// What an import links to: a library's entry point, a kept module's
    /// stub, or KERNEL's number. `None` for a module not there.
    fn imported(&mut self, from: &str, target: &Target) -> Option<Value> {
        if let Some(library) = self.module_named(from) {
            let library = &self.modules[library];
            let ordinal = match target {
                Target::ImportOrdinal { ordinal, .. } => *ordinal,
                Target::ImportName { procedure, .. } => library.executable.ordinal_of(procedure),
                _ => 0,
            };
            let (segment, offset) = library.lookup(ordinal)?;

            return Some(Value::Place(segment, offset));
        }

        let kept = self.kept_named(from)?;
        let module = self.kept[kept].module;
        let ordinal = match target {
            Target::ImportOrdinal { ordinal, .. } => *ordinal,
            Target::ImportName { procedure, .. } => module.ordinal_of(procedure),
            _ => 0,
        };

        if module.name.eq_ignore_ascii_case("KERNEL")
            && let Some(number) = kernel_constant(ordinal, self.coprocessor)
        {
            return Some(Value::Number(number));
        }

        let stubs = self.stubs(kept);

        (ordinal != 0).then(|| Value::Place(stubs, STEP * (ordinal + 1)))
    }

    /// A word written down a relocation's chain, or added where it is.
    fn write16(&mut self, at: usize, relocation: &Relocation, value: u16) {
        let base = (at as u32) << 16;
        let memory = &mut self.cpu.bus;

        if relocation.additive {
            let site = base + u32::from(relocation.offset);

            memory.write16(site, memory.read16(site).wrapping_add(value));
            return;
        }

        let mut next = relocation.offset;

        for _ in 0..CHAIN_LIMIT {
            if next == 0xffff {
                break;
            }

            let site = base + u32::from(next);

            next = memory.read16(site);
            memory.write16(site, value);
        }
    }

    /// A far pointer written down a relocation's chain, or added where it is.
    fn write32(&mut self, at: usize, relocation: &Relocation, selector: u16, offset: u16) {
        let base = (at as u32) << 16;
        let memory = &mut self.cpu.bus;

        if relocation.additive {
            let site = base + u32::from(relocation.offset);

            memory.write16(site, memory.read16(site).wrapping_add(offset));
            memory.write16(site + 2, memory.read16(site + 2).wrapping_add(selector));
            return;
        }

        let mut next = relocation.offset;

        for _ in 0..CHAIN_LIMIT {
            if next == 0xffff {
                break;
            }

            let site = base + u32::from(next);

            next = memory.read16(site);
            memory.write16(site, offset);
            memory.write16(site + 2, selector);
        }
    }
}
