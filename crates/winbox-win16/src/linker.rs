//! A module's relocations applied, as winbox.js's `Linker` applies them:
//! its calls into the modules winbox.js keeps linked to their stubs, its
//! references to its own segments to where they were put, KERNEL's
//! constants written in, and its floating-point instructions fixed up.

use winbox_machine::{first_megabyte_selector, segment_selector};
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
/// The low byte of a word, added to the byte there.
const LOW_BYTE: u8 = 0;
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

/// KERNEL's exports that are numbers rather than functions, entries of
/// segment `FEh` in its file, which a program reads where its relocation
/// puts them: in protected mode a huge pointer's selector steps by 8, a
/// shift of 3 (`__AHSHIFT`, `__AHINCR`); `__WINFLAGS` is what `GetWinFlags`
/// answers; and the selectors KERNEL makes for the first megabyte's fixed
/// places, the file's paragraphs (`kconst`; `first_megabyte_selector`).
/// As `kernel/constants.ts`'s.
pub(crate) fn kernel_constant(ordinal: u16, win_flags: u16) -> Option<u16> {
    let paragraph = match ordinal {
        113 => return Some(3),
        114 => return Some(8),
        // `GetWinFlags`' answer (`System::win_flags`).
        178 => return Some(win_flags),
        173 | 194 => 0xf000,
        174 => 0xa000,
        179 => 0xd000,
        181 => 0xb000,
        182 => 0xb800,
        183 => 0x0000,
        190 => 0xe000,
        193 => 0x0040,
        195 => 0xc000,
        _ => return None,
    };

    first_megabyte_selector(paragraph)
}

/// What KERNEL answers for a constant, as for any entry of its: the number
/// in AX and `FFFFh` in DX (`KRNL386.EXE` seg1 `502c`-`502f`), which
/// `GetProcAddress` answers and the loader writes (`kconst`).
pub(crate) const CONSTANT_SEGMENT: u16 = 0xffff;

/// KERNEL's ordinal for `UndefDynlink`, where an import nothing exports
/// is bound.
const UNDEF_DYNLINK: u16 = 120;

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
                self.imported(&from.clone(), &relocation.target)
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
            // As KERNEL's loader writes a constant's FFFFh:number
            // (`KRNL386.EXE` seg1 `748d`-`74ef`): the number at an
            // offset, FFFFh at a selector, both for a far pointer, and the
            // number's low byte added at a byte, always where it is (seg1
            // `74b9`).
            Value::Number(number) => match relocation.address_type {
                OFFSET => self.write16(at, relocation, number),
                SELECTOR => self.write16(at, relocation, CONSTANT_SEGMENT),
                FAR => self.write32(at, relocation, CONSTANT_SEGMENT, number),
                LOW_BYTE => {
                    let site = ((at as u32) << 16) + u32::from(relocation.offset);
                    let memory = &mut self.cpu.bus;

                    memory.write8(site, memory.read8(site).wrapping_add(number as u8));
                }
                _ => {}
            },
            Value::Place(segment, offset) => match relocation.address_type {
                SELECTOR => self.write16(at, relocation, segment_selector(segment)),
                FAR => self.write32(at, relocation, segment_selector(segment), offset),
                OFFSET => self.write16(at, relocation, offset),
                _ => {}
            },
        }
    }

    /// What an import links to: a library's entry point, a kept module's
    /// stub, or KERNEL's number; else KERNEL's `UndefDynlink`, as KERNEL's
    /// loader binds an import whose module, name or ordinal it cannot find
    /// (`KRNL386.EXE` seg1 `73b9`-`73f8`): the program runs, and is ended
    /// only if it makes the call (`undefdl`). As `linker.ts`.
    fn imported(&mut self, from: &str, target: &Target) -> Value {
        match self.bound(from, target) {
            Some(value) => value,
            None => self.undef_dynlink(),
        }
    }

    /// Where a module exports an import: `None` for a module not there,
    /// or a name or ordinal it does not export (a kept module's ordinal
    /// with no entry in its table, as `GetProcAddress` finds).
    fn bound(&mut self, from: &str, target: &Target) -> Option<Value> {
        if let Some(index) = self.module_named(from) {
            let library = &self.modules[index];
            let ordinal = match target {
                Target::ImportOrdinal { ordinal, .. } => *ordinal,
                Target::ImportName { procedure, .. } => library.executable.ordinal_of(procedure),
                _ => 0,
            };

            if ordinal == 0 {
                return None;
            }

            // An export of `COMMDLG`'s, `VER`'s or `LZEXPAND`'s WinBox
            // answers: its stub, not the file's entry (`own_modules.rs`).
            if let Some((segment, offset)) = crate::own_modules::redirect(self, index, ordinal) {
                return Some(Value::Place(segment, offset));
            }

            let (segment, offset) = self.modules[index].lookup(ordinal)?;

            return Some(Value::Place(segment, offset));
        }

        let kept = self.kept_named(from)?;
        let module = self.module_of(&self.kept[kept]);
        let ordinal = match target {
            Target::ImportOrdinal { ordinal, .. } => *ordinal,
            Target::ImportName { procedure, .. } => module.ordinal_of(procedure),
            _ => 0,
        };

        if module.name.eq_ignore_ascii_case("KERNEL")
            && let Some(number) = kernel_constant(ordinal, self.win_flags())
        {
            return Some(Value::Number(number));
        }

        if ordinal == 0 || module.export(ordinal).is_none() {
            return None;
        }

        // A place in the module's data, not a function (`exported_data.rs`).
        if let Some((segment, offset)) = self.exported_data_place(kept, ordinal) {
            return Some(Value::Place(segment, offset));
        }

        let stubs = self.stubs(kept);

        Some(Value::Place(stubs, STEP * (ordinal + 1)))
    }

    /// KERNEL's `UndefDynlink`, its ordinal 120, among its stubs.
    fn undef_dynlink(&mut self) -> Value {
        let kernel = self.kept_named("KERNEL").expect("KERNEL is kept");
        let stubs = self.stubs(kernel);

        Value::Place(stubs, STEP * (UNDEF_DYNLINK + 1))
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

#[cfg(test)]
mod tests {
    use winbox_ne::{Relocation, Target};

    use crate::system::System;

    /// A relocation at `offset`, additive or a chain, of a word.
    fn relocation(offset: u16, additive: bool) -> Relocation {
        Relocation {
            address_type: super::OFFSET,
            offset,
            additive,
            target: Target::Ordinal(0),
        }
    }

    /// A block of global memory: its segment's index.
    fn segment(system: &mut System, size: u32) -> usize {
        system
            .global
            .allocate(&mut system.cpu.bus, &mut system.descriptors, size, 0x42)
            .expect("a block")
    }

    /// A chain of fixups: each site holds the offset of the next, the last
    /// `FFFFh`. The Towers from `HANOI.EXE` of the corpus links 1152 sites in
    /// one. As `test/win16/relocation_chain_test.ts`.
    #[test]
    fn a_relocation_chain_is_followed_to_its_end_however_long_it_is() {
        let mut system = System::new();
        let at = segment(&mut system, 0x2000);
        let base = (at as u32) << 16;
        let sites: u32 = 1500;

        for site in 0..sites {
            let next = if site == sites - 1 {
                0xffff
            } else {
                (site + 1) * 4
            };

            system.cpu.bus.write16(base + site * 4, next as u16);
        }

        system.write16(at, &relocation(0, false), 0x1234);

        let left: Vec<u32> = (0..sites)
            .filter(|&site| system.cpu.bus.read16(base + site * 4) != 0x1234)
            .collect();

        assert_eq!(left, Vec::<u32>::new());
    }

    /// A relocation record's ADDITIVE flag (4) adds, whatever its kind:
    /// Catz's `CATZ.WAD` imports `CATZDLL`'s variables by ordinal so (flags
    /// 5) -- `mov [es:0x2],dx`, the selector's half of a far pointer that
    /// `CATZDLL` keeps at 66h in its segment. As
    /// `test/win16/relocation_flags_test.ts`; `winbox-ne` reads the flag
    /// (`reads_a_relocations_additive_flag_whatever_its_type`).
    #[test]
    fn an_additive_relocation_adds_an_imported_variable_to_the_field_the_code_names() {
        let mut system = System::new();
        let at = segment(&mut system, 0x2000);
        let site = ((at as u32) << 16) + 0x13c5;

        system.cpu.bus.write16(site, 0x0002);
        system.write16(at, &relocation(0x13c5, true), 0x66);

        assert_eq!(system.cpu.bus.read16(site), 0x68);
    }
}
