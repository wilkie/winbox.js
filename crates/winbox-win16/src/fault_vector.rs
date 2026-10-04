//! Which fault the TypeScript engine's processor raises for an instruction
//! the Rust core left to its host.
//!
//! The Rust core runs what it can check by a segment's upper limit alone:
//! an access through the null selector, a segment not present or one that
//! expands down is given no room, and stops the run as `Fault(13)`; a
//! segment load the part checks, or one past the end of its table, stops it
//! as `Host`. In the TypeScript engine the JavaScript core then runs the
//! instruction itself, and raises the fault the part raises (`i386.ts`
//! `raiseSegmentFault`, `loadSegmentRegister`, `retrieveDescriptor`):
//!
//! * An access through the null selector, `#GP` (13); through a segment not
//!   present, `#NP` (11); past the limit of one that is, through the stack
//!   `#SS` (12), otherwise `#GP`. Whether it was through the stack the
//!   core tells by the selector, not the register (`through_stack`).
//! * A selector past the end of its table, loaded in any way, `#GP`.
//! * `MOV` into a segment register checks what it loads: the null selector
//!   into SS, a system descriptor, code that cannot be read, or for SS
//!   anything but writable data, `#GP`; a segment not present, `#NP`, and
//!   for SS `#SS`. `POP`, `LES` and the rest load without those checks.
//!
//! The Rust engine has no second core to run the instruction, so it reads
//! the instruction here -- its prefixes, its operands' addresses, what it
//! pushes and pops -- to find the access that ran outside its segment, or
//! the selector it loads, and names the fault the JavaScript core would
//! raise. Where that cannot be told -- a segment that expands down, which
//! the JavaScript core checks the other way and may not fault on at all,
//! two accesses that would raise different faults, or a stop for another
//! reason -- the answer is `None`, and the run stops as it did.

use winbox_cpu::{AX, BP, BX, CS, CX, DI, DS, ES, Exit, GS, SI, SP, SS};

use crate::system::System;

/// One reach into memory an instruction makes: through which segment
/// register, at what offset, and how many bytes.
#[derive(Debug, Clone, Copy)]
struct Access {
    segment: usize,
    offset: u32,
    size: u32,
}

/// What a ModR/M byte names: a register, or memory.
#[derive(Debug, Clone, Copy)]
enum Place {
    Register(usize),
    Memory(usize, u32),
}

/// An instruction as far as it is read here.
#[derive(Debug, Clone, Copy)]
struct Decoded {
    /// The segment a prefix names for the memory operand.
    prefix: Option<usize>,
    operand32: bool,
    address32: bool,
    repeat: bool,
    /// The offset from the instruction's start of the byte after its
    /// opcode, or after the second byte of a two-byte one.
    at: u16,
    opcode: u8,
    second: Option<u8>,
}

impl System {
    /// The fault the TypeScript engine's processor raises for the
    /// instruction at CS:IP, where the Rust core stopped with `exit`.
    pub(crate) fn fault_vector(&self, exit: Exit) -> Option<u8> {
        if !self.cpu.protected {
            return None;
        }

        let decoded = self.decode()?;

        match exit {
            Exit::Fault(_) => self.access_fault(&decoded),
            Exit::Host => self.load_fault(&decoded),
            _ => None,
        }
    }

    /// Whether the instruction at CS:IP addresses in 32 bits: its code
    /// segment's D bit, turned over by an address-size prefix. KERNEL's
    /// reading of its bytes goes through the JavaScript core's
    /// `translateAddress`, which wraps an offset in 64 KiB unless it is.
    pub(crate) fn addresses_in_32_bits(&self) -> bool {
        self.decode()
            .map_or(self.cpu.segments[CS].big, |decoded| decoded.address32)
    }

    /// A byte of the instruction, by its offset from the start; `None`
    /// past the code segment's limit. The offset wraps in 64 KiB in 16-bit
    /// code, as the JavaScript core's fetch wraps it.
    fn code(&self, at: u16) -> Option<u8> {
        let segment = self.cpu.segments[CS];
        let offset = u32::from(self.cpu.ip) + u32::from(at);
        let offset = if segment.big { offset } else { offset & 0xffff };

        (offset < segment.past_limit).then(|| {
            winbox_machine::Memory::read8(&self.cpu.bus, segment.base.wrapping_add(offset))
        })
    }

    fn code16(&self, at: u16) -> Option<u16> {
        Some(u16::from(self.code(at)?) | u16::from(self.code(at + 1)?) << 8)
    }

    fn code32(&self, at: u16) -> Option<u32> {
        Some(u32::from(self.code16(at)?) | u32::from(self.code16(at + 2)?) << 16)
    }

    /// A word of memory through a segment register, as an access within
    /// its limit reads it; `None` past the limit.
    fn word_at(&self, segment: usize, offset: u32) -> Option<u16> {
        let cached = self.cpu.segments[segment];

        (u64::from(offset) + 2 <= u64::from(cached.past_limit)).then(|| {
            let at = cached.base.wrapping_add(offset);

            u16::from(winbox_machine::Memory::read8(&self.cpu.bus, at))
                | u16::from(winbox_machine::Memory::read8(
                    &self.cpu.bus,
                    at.wrapping_add(1),
                )) << 8
        })
    }

    fn reg32(&self, index: usize) -> u32 {
        u32::from(self.cpu.high[index]) << 16 | u32::from(self.cpu.regs[index])
    }

    /// The instruction's prefixes and opcode.
    fn decode(&self) -> Option<Decoded> {
        let big = self.cpu.segments[CS].big;
        let (mut operand, mut address) = (false, false);
        let mut prefix = None;
        let mut repeat = false;
        let mut at = 0;

        let opcode = loop {
            let byte = self.code(at)?;

            at += 1;

            match byte {
                0x26 | 0x2e | 0x36 | 0x3e => prefix = Some(usize::from((byte >> 3) & 3)),
                0x64 => prefix = Some(4),
                0x65 => prefix = Some(GS),
                0x66 => operand = true,
                0x67 => address = true,
                0xf2 | 0xf3 => repeat = true,
                0xf0 => {}
                _ => break byte,
            }

            if at > 14 {
                return None;
            }
        };
        let second = if opcode == 0x0f {
            at += 1;
            Some(self.code(at - 1)?)
        } else {
            None
        };

        Some(Decoded {
            prefix,
            operand32: big != operand,
            address32: big != address,
            repeat,
            at,
            opcode,
            second,
        })
    }

    /// The ModR/M byte at `at`: its register field, what it names, and the
    /// offset past it and its displacement.
    fn modrm(&self, decoded: &Decoded, at: u16) -> Option<(usize, Place, u16)> {
        let byte = self.code(at)?;
        let mode = byte >> 6;
        let reg = usize::from((byte >> 3) & 7);
        let rm = usize::from(byte & 7);
        let mut next = at + 1;

        if mode == 3 {
            return Some((reg, Place::Register(rm), next));
        }

        let (segment, offset) = if decoded.address32 {
            let (base, index) = if rm == 4 {
                let sib = self.code(next)?;

                next += 1;

                let index = usize::from((sib >> 3) & 7);
                let scaled = if index == 4 {
                    0
                } else {
                    self.reg32(index) << (sib >> 6)
                };

                (usize::from(sib & 7), Some(scaled))
            } else {
                (rm, None)
            };
            let displacement = match mode {
                1 => {
                    next += 1;
                    i32::from(self.code(next - 1)? as i8) as u32
                }
                2 => {
                    next += 4;
                    self.code32(next - 4)?
                }
                _ if base == 5 => {
                    next += 4;
                    self.code32(next - 4)?
                }
                _ => 0,
            };
            let from_base = if mode == 0 && base == 5 {
                0
            } else {
                self.reg32(base)
            };
            let stack = base == SP || (base == BP && !(mode == 0 && base == 5));

            (
                if stack { SS } else { DS },
                from_base
                    .wrapping_add(index.unwrap_or(0))
                    .wrapping_add(displacement),
            )
        } else {
            let regs = &self.cpu.regs;
            let (sum, stack) = match rm {
                0 => (regs[BX].wrapping_add(regs[SI]), false),
                1 => (regs[BX].wrapping_add(regs[DI]), false),
                2 => (regs[BP].wrapping_add(regs[SI]), true),
                3 => (regs[BP].wrapping_add(regs[DI]), true),
                4 => (regs[SI], false),
                5 => (regs[DI], false),
                6 if mode == 0 => (0, false),
                6 => (regs[BP], true),
                _ => (regs[BX], false),
            };
            let displacement = match (mode, rm) {
                (1, _) => {
                    next += 1;
                    i16::from(self.code(next - 1)? as i8) as u16
                }
                (2, _) | (0, 6) => {
                    next += 2;
                    self.code16(next - 2)?
                }
                _ => 0,
            };

            (
                if stack { SS } else { DS },
                u32::from(sum.wrapping_add(displacement)),
            )
        };

        Some((
            reg,
            Place::Memory(decoded.prefix.unwrap_or(segment), offset),
            next,
        ))
    }

    /// The fault an access past a segment's limit raises: from each reach
    /// the instruction makes that runs outside its segment, the same one,
    /// or `None`.
    fn access_fault(&self, decoded: &Decoded) -> Option<u8> {
        let (accesses, named) = self.accesses(decoded)?;
        let mut vector = None;

        for access in accesses {
            let cached = self.cpu.segments[access.segment];

            if u64::from(access.offset) + u64::from(access.size) <= u64::from(cached.past_limit) {
                continue;
            }

            let raised = self.segment_fault(access.segment, named)?;

            if vector.is_some_and(|before| before != raised) {
                return None;
            }

            vector = Some(raised);
        }

        vector
    }

    /// The fault an access outside a segment register's segment raises, by
    /// what the register holds; `None` for a segment that expands down.
    /// `named` is the register the instruction names for its memory
    /// operand, by a prefix or by its ModR/M byte's default.
    fn segment_fault(&self, segment: usize, named: Option<usize>) -> Option<u8> {
        let selector = self.cpu.segments[segment].selector;

        if selector & 0xfffc == 0 {
            return Some(13);
        }

        let (access, _) = self.table_entry(selector)?;

        if access & 0x80 == 0 {
            Some(11)
        } else if access & 0x1c == 0x14 {
            None
        } else if self.through_stack(segment, named) {
            Some(12)
        } else {
            Some(13)
        }
    }

    /// Whether an access went through the stack, as the JavaScript core
    /// tells (`i386.ts` `throughStack`): it is given the selector, not the
    /// register. Where the instruction names a register for its memory
    /// operand and that register holds the selector, by whether that
    /// register is SS; otherwise -- a push or a pop, a string, a `moffs`
    /// operand without a prefix -- by whether SS holds the selector. So in
    /// a program whose DS is its SS, `LODSB` past DS's limit is a stack
    /// fault, and a push past SS's under `push word [bx]` is not.
    fn through_stack(&self, segment: usize, named: Option<usize>) -> bool {
        let selector = |register: usize| self.cpu.segments[register].selector;

        match named {
            Some(named) if selector(named) == selector(segment) => named == SS,
            _ => selector(segment) == selector(SS),
        }
    }

    /// A selector's descriptor's access byte and its granularity byte, as
    /// its table holds them; `None` past the table's end.
    fn table_entry(&self, selector: u16) -> Option<(u8, u8)> {
        let (table, limit) = if selector & 4 != 0 {
            (self.cpu.ldt_base, self.cpu.ldt_limit)
        } else {
            (self.cpu.gdt_base, self.cpu.gdt_limit)
        };
        let entry = u32::from(selector >> 3) * 8;

        if entry + 7 > limit {
            return None;
        }

        let at = table.wrapping_add(entry);

        Some((
            winbox_machine::Memory::read8(&self.cpu.bus, at + 5),
            winbox_machine::Memory::read8(&self.cpu.bus, at + 6),
        ))
    }

    /// Every reach into memory the instruction makes, in its order: its
    /// fetch, its memory operand, what it pushes or pops, its strings; and
    /// the register it names for its memory operand, by a prefix or by its
    /// ModR/M byte's default. `None` for an instruction not read here.
    #[allow(clippy::too_many_lines)]
    fn accesses(&self, decoded: &Decoded) -> Option<(Vec<Access>, Option<usize>)> {
        let named = std::cell::Cell::new(decoded.prefix);
        let word: u32 = if decoded.operand32 { 4 } else { 2 };
        let sp = self.cpu.regs[SP];
        let pushes = |count: u32, size: u32| -> Vec<Access> {
            (1..=count)
                .map(|step| Access {
                    segment: SS,
                    offset: u32::from(sp.wrapping_sub((step * size) as u16)),
                    size,
                })
                .collect()
        };
        let pops = |count: u32, size: u32| -> Vec<Access> {
            (0..count)
                .map(|step| Access {
                    segment: SS,
                    offset: u32::from(sp.wrapping_add((step * size) as u16)),
                    size,
                })
                .collect()
        };
        let source = decoded.prefix.unwrap_or(DS);
        let (si, di) = if decoded.address32 {
            (self.reg32(SI), self.reg32(DI))
        } else {
            (u32::from(self.cpu.regs[SI]), u32::from(self.cpu.regs[DI]))
        };
        let count = if decoded.address32 {
            self.reg32(CX)
        } else {
            u32::from(self.cpu.regs[CX])
        };
        let strings = |size: u32, from: bool, to: bool| -> Vec<Access> {
            if decoded.repeat && count == 0 {
                return Vec::new();
            }

            let mut made = Vec::new();

            if from {
                made.push(Access {
                    segment: source,
                    offset: si,
                    size,
                });
            }

            if to {
                made.push(Access {
                    segment: ES,
                    offset: di,
                    size,
                });
            }

            made
        };
        let opcode = decoded.opcode;
        let mut accesses = vec![Access {
            segment: CS,
            offset: u32::from(self.cpu.ip),
            size: u32::from(decoded.at),
        }];

        // The memory operand of an instruction with a ModR/M byte, and
        // what it pushes or pops besides.
        let operand = |size: u32| -> Option<(usize, Vec<Access>)> {
            let (reg, place, _) = self.modrm(decoded, decoded.at)?;

            Some((
                reg,
                match place {
                    Place::Memory(segment, offset) => {
                        named.set(Some(segment));

                        vec![Access {
                            segment,
                            offset,
                            size,
                        }]
                    }
                    Place::Register(_) => Vec::new(),
                },
            ))
        };

        if let Some(second) = decoded.second {
            let size = match second {
                0x90..=0x9f | 0xb6 | 0xbe => 1,
                0x00..=0x03 | 0xb7 | 0xbf => 2,
                0xb2 | 0xb4 | 0xb5 => word + 2,
                _ => word,
            };

            match second {
                0xa0 | 0xa8 => accesses.extend(pushes(1, word)),
                0xa1 | 0xa9 => accesses.extend(pops(1, word)),
                0x80..=0x8f | 0x06 | 0x08 | 0x09 | 0xa2 => {}
                0x00..=0x03
                | 0x20..=0x23
                | 0x90..=0x9f
                | 0xa3..=0xa5
                | 0xab..=0xad
                | 0xaf
                | 0xb2..=0xb7
                | 0xba..=0xbf => accesses.extend(operand(size)?.1),
                _ => return None,
            }

            return Some((accesses, named.get()));
        }

        let byte_form = matches!(
            opcode,
            0x84 | 0x86 | 0x88 | 0x8a | 0x80 | 0x82 | 0xc0 | 0xc6 | 0xd0 | 0xd2 | 0xf6 | 0xfe
        ) || (opcode < 0x40 && opcode & 7 < 4 && opcode & 1 == 0);
        let size = if byte_form { 1 } else { word };

        match opcode {
            // The arithmetic rows' ModR/M forms.
            _ if opcode < 0x40 && opcode & 7 < 4 => accesses.extend(operand(size)?.1),
            0x06 | 0x0e | 0x16 | 0x1e | 0x50..=0x57 | 0x68 | 0x6a | 0x9c | 0xc8 | 0xe8 => {
                accesses.extend(pushes(1, word));
            }
            0x07 | 0x17 | 0x1f | 0x58..=0x5f | 0x9d | 0xc2 | 0xc3 => {
                accesses.extend(pops(1, word));
            }
            0x60 => accesses.extend(pushes(8, word)),
            0x61 => accesses.extend(pops(8, word)),
            0x9a => accesses.extend(pushes(2, word)),
            0xca | 0xcb => accesses.extend(pops(2, word)),
            0xcf => accesses.extend(pops(3, word)),
            0xc9 => accesses.push(Access {
                segment: SS,
                offset: u32::from(self.cpu.regs[BP]),
                size: word,
            }),
            0x8f => {
                accesses.extend(pops(1, word));
                accesses.extend(operand(word)?.1);
            }
            0xff => {
                let (reg, memory) = operand(match self.code(decoded.at)? >> 3 & 7 {
                    3 | 5 => word + 2,
                    _ => word,
                })?;

                accesses.extend(memory);

                match reg {
                    2 | 6 => accesses.extend(pushes(1, word)),
                    3 => accesses.extend(pushes(2, word)),
                    0 | 1 | 4 | 5 => {}
                    _ => return None,
                }
            }
            // BOUND reads two words; ARPL, like a segment register's MOV,
            // one of 16 bits whatever the operand size.
            0x62 => accesses.extend(operand(2 * word)?.1),
            0xc4 | 0xc5 => accesses.extend(operand(word + 2)?.1),
            0x63 | 0x8c | 0x8e => accesses.extend(operand(2)?.1),
            // LEA reaches nothing, but names its operand's register.
            0x8d => {
                operand(0)?;
            }
            0x69 | 0x6b | 0x80..=0x8b | 0xc0 | 0xc1 | 0xc6 | 0xc7 | 0xd0..=0xd3 => {
                accesses.extend(operand(size)?.1);
            }
            0xd8..=0xdf | 0xf6 | 0xf7 | 0xfe => accesses.extend(operand(size)?.1),
            0xa0..=0xa3 => {
                let offset = if decoded.address32 {
                    self.code32(decoded.at)?
                } else {
                    u32::from(self.code16(decoded.at)?)
                };

                accesses.push(Access {
                    segment: source,
                    offset,
                    size: if opcode & 1 == 0 { 1 } else { word },
                });
            }
            0xd7 => accesses.push(Access {
                segment: source,
                offset: u32::from(self.cpu.regs[BX].wrapping_add(self.cpu.regs[AX] & 0xff)),
                size: 1,
            }),
            0xa4..=0xaf | 0x6c..=0x6f => {
                let size = if opcode & 1 == 0 { 1 } else { word };
                let (from, to) = match opcode {
                    0xa4..=0xa7 => (true, true),
                    0xaa | 0xab | 0xae | 0xaf | 0x6c | 0x6d => (false, true),
                    _ => (true, false),
                };

                accesses.extend(strings(size, from, to));
            }
            _ => return None,
        }

        Some((accesses, named.get()))
    }

    /// The fault a segment load the Rust core left to its host raises:
    /// past its table's end, any load; the part's checks, `MOV` alone.
    fn load_fault(&self, decoded: &Decoded) -> Option<u8> {
        let word: u32 = if decoded.operand32 { 4 } else { 2 };
        let sp = u32::from(self.cpu.regs[SP]);
        // The selector after the offset, its address wrapping in 64 KiB
        // as the operand's does with 16-bit addresses.
        let far_selector = |place: Place| match place {
            Place::Memory(segment, offset) => {
                let after = offset.wrapping_add(word);

                self.word_at(
                    segment,
                    if decoded.address32 {
                        after
                    } else {
                        after & 0xffff
                    },
                )
            }
            Place::Register(_) => None,
        };
        let (register, selector, checked) = match (decoded.opcode, decoded.second) {
            (0x8e, None) => {
                let (reg, place, _) = self.modrm(decoded, decoded.at)?;
                let selector = match place {
                    Place::Register(index) => self.cpu.regs[index],
                    Place::Memory(segment, offset) => self.word_at(segment, offset)?,
                };

                if reg == CS || reg > GS {
                    return None;
                }

                (reg, selector, true)
            }
            (0x07 | 0x17 | 0x1f, None) => (
                usize::from(decoded.opcode >> 3),
                self.word_at(SS, sp)?,
                false,
            ),
            (0x0f, Some(0xa1)) => (4, self.word_at(SS, sp)?, false),
            (0x0f, Some(0xa9)) => (GS, self.word_at(SS, sp)?, false),
            (0xc4 | 0xc5, None) => {
                let (_, place, _) = self.modrm(decoded, decoded.at)?;
                let register = if decoded.opcode == 0xc4 { ES } else { DS };

                (register, far_selector(place)?, false)
            }
            (0x0f, Some(second @ (0xb2 | 0xb4 | 0xb5))) => {
                let (_, place, _) = self.modrm(decoded, decoded.at)?;
                let register = match second {
                    0xb2 => SS,
                    0xb4 => 4,
                    _ => GS,
                };

                (register, far_selector(place)?, false)
            }
            (0x9a | 0xea, None) => {
                let at = decoded.at + if decoded.operand32 { 4 } else { 2 };

                (CS, self.code16(at)?, false)
            }
            (0xff, None) => {
                let (reg, place, _) = self.modrm(decoded, decoded.at)?;

                if reg != 3 && reg != 5 {
                    return None;
                }

                (CS, far_selector(place)?, false)
            }
            (0xca | 0xcb | 0xcf, None) => (CS, self.word_at(SS, sp.wrapping_add(word))?, false),
            _ => return None,
        };
        let stack = register == SS;

        if selector & 0xfffc == 0 {
            return (checked && stack).then_some(13);
        }

        let Some((access, _)) = self.table_entry(selector) else {
            return Some(13);
        };

        if !checked {
            return None;
        }

        let segment = access & 0x10 != 0;
        let executable = access & 0x08 != 0;
        let read_write = access & 0x02 != 0;
        let unfit = if stack {
            !segment || executable || !read_write
        } else {
            !segment || (executable && !read_write)
        };

        if unfit {
            Some(13)
        } else if access & 0x80 == 0 {
            Some(if stack { 12 } else { 11 })
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use winbox_cpu::{BX, CS, DI, DS, ES, Exit, SI, SP, SS};
    use winbox_machine::segment_selector;

    use crate::system::System;

    const CODE: usize = 0x40;
    const DATA: usize = 0x41;
    const OTHER: usize = 0x42;

    /// A machine about to run `bytes`, with DS and ES loaded with the
    /// segments given and SS with `DATA`, each data segment 16 bytes long.
    fn machine(bytes: &[u8], ds: usize, es: usize) -> System {
        let mut system = System::new();

        system.cpu.protected = true;
        system
            .descriptors
            .map(&mut system.cpu.bus, CODE, bytes, true);

        for index in [DATA, OTHER] {
            system
                .descriptors
                .map(&mut system.cpu.bus, index, &[], false);
            system
                .descriptors
                .set_limit(&mut system.cpu.bus, index, 0x0f);
        }

        for (register, index) in [(CS, CODE), (DS, ds), (ES, es), (SS, DATA)] {
            system
                .cpu
                .load_segment(register, segment_selector(index))
                .unwrap();
        }

        system.cpu.ip = 0;
        system
    }

    fn vector(system: &System) -> Option<u8> {
        system.fault_vector(Exit::Fault(13))
    }

    #[test]
    fn a_string_past_a_ds_that_is_the_stack_is_a_stack_fault() {
        // lodsb: the JavaScript core tells the stack by the selector.
        let mut system = machine(&[0xac], DATA, DATA);

        system.cpu.regs[SI] = 0x20;
        assert_eq!(vector(&system), Some(12));

        let mut system = machine(&[0xac], OTHER, DATA);

        system.cpu.regs[SI] = 0x20;
        assert_eq!(vector(&system), Some(13));
    }

    #[test]
    fn an_operand_named_ds_is_no_stack_fault_though_ds_is_the_stack() {
        // mov al, [si]
        let mut system = machine(&[0x8a, 0x04], DATA, DATA);

        system.cpu.regs[SI] = 0x20;
        assert_eq!(vector(&system), Some(13));

        // push word [bx]: the push past SS's limit goes through the
        // selector the operand names DS by.
        let mut system = machine(&[0xff, 0x37], DATA, DATA);

        system.cpu.regs[BX] = 0;
        system.cpu.regs[SP] = 0x20;
        assert_eq!(vector(&system), Some(13));

        let mut system = machine(&[0xff, 0x37], OTHER, DATA);

        system.cpu.regs[BX] = 0;
        system.cpu.regs[SP] = 0x20;
        assert_eq!(vector(&system), Some(12));
    }

    #[test]
    fn a_string_store_past_an_es_that_is_the_stack_is_a_stack_fault() {
        // stosb
        let mut system = machine(&[0xaa], OTHER, DATA);

        system.cpu.regs[DI] = 0x20;
        assert_eq!(vector(&system), Some(12));
    }

    #[test]
    fn lar_reads_16_bits_whatever_the_operand_size() {
        // lar eax, [000e]: two bytes at 0Eh are within a 16-byte segment,
        // so nothing ran outside it.
        let system = machine(&[0x66, 0x0f, 0x02, 0x06, 0x0e, 0x00], OTHER, OTHER);

        assert_eq!(vector(&system), None);
    }

    #[test]
    fn a_far_pointer_s_selector_wraps_in_64_kib() {
        // les ax, [fffe]: the selector is read from offset 0 and names a
        // descriptor past the global table's end.
        let mut system = machine(&[0xc4, 0x06, 0xfe, 0xff], OTHER, OTHER);

        system
            .descriptors
            .set_limit(&mut system.cpu.bus, OTHER, 0xffff);
        system
            .cpu
            .load_segment(DS, segment_selector(OTHER))
            .unwrap();
        winbox_machine::Memory::write16(&mut system.cpu.bus, (OTHER as u32) << 16, 0x0103);
        assert_eq!(system.fault_vector(Exit::Host), Some(13));
    }
}
