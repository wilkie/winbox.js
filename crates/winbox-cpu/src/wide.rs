//! The instructions under the operand-size prefix -- or without it, in a
//! 32-bit code segment -- as the JavaScript core runs them: `I386.execute`'s
//! table for the double-word forms, and before it `executeWide` and the
//! forms it reads first (`RETD`, `LEAVE`, `POP` to memory, `BOUND`).
//!
//! On a 16-bit stack, the only one this core runs: SP alone moves, and
//! wraps within 64 KiB.

use crate::{AX, Alu, BP, Bus, CF, CS, Cpu, DS, DX, ES, Exit, FS, GS, Place, SP, SS};

impl<B: Bus> Cpu<B> {
    /// An instruction under the operand-size prefix. An opcode the
    /// JavaScript core has no double-word form of stops the run, as there it
    /// is an invalid instruction.
    #[allow(clippy::too_many_lines)]
    pub(crate) fn step_wide(&mut self, opcode: u8) -> Result<(), Exit> {
        let stop = Err(Exit::Unimplemented(0x66));

        match opcode {
            // The ALU group's double-word forms: Ev,Gv / Gv,Ev / EAX,Id.
            0x00..=0x3f if matches!(opcode & 7, 1 | 3 | 5) => {
                let op = Alu::from(opcode >> 3);

                match opcode & 7 {
                    1 => {
                        let (reg, place) = self.modrm()?;
                        let r = self.alu(op, self.get32(place)?, self.reg32(reg), 32);

                        if !matches!(op, Alu::Cmp) {
                            self.set32(place, r)?;
                        }
                    }
                    3 => {
                        let (reg, place) = self.modrm()?;
                        let r = self.alu(op, self.reg32(reg), self.get32(place)?, 32);

                        if !matches!(op, Alu::Cmp) {
                            self.set_reg32(reg, r);
                        }
                    }
                    _ => {
                        let immediate = self.fetch32()?;
                        let r = self.alu(op, self.reg32(AX), immediate, 32);

                        if !matches!(op, Alu::Cmp) {
                            self.set_reg32(AX, r);
                        }
                    }
                }
            }
            0x40..=0x4f => {
                let index = usize::from(opcode & 7);
                let r = self.inc_dec(self.reg32(index), opcode < 0x48, 32);

                self.set_reg32(index, r);
            }
            0x50..=0x57 => {
                let value = self.reg32(usize::from(opcode & 7));

                self.push32(value)?;
            }
            0x58..=0x5f => {
                let value = self.pop32()?;

                self.set_reg32(usize::from(opcode & 7), value);
            }
            // PUSHAD: ESP as it was among them.
            0x60 => {
                let esp = self.reg32(SP);

                for index in 0..8 {
                    let value = if index == SP { esp } else { self.reg32(index) };

                    self.push32(value)?;
                }
            }
            // POPAD: ESP's slot passed over, but for its high word, which
            // the part takes on a 16-bit stack, where SP alone moves.
            0x61 => {
                for index in (0..8).rev() {
                    let value = self.pop32()?;

                    if index == SP {
                        self.high[SP] = (value >> 16) as u16;
                    } else {
                        self.set_reg32(index, value);
                    }
                }
            }
            0x62 => self.bound()?,
            0x68 => {
                let value = self.fetch32()?;

                self.push32(value)?;
            }
            0x6a => {
                let value = i32::from(self.fetch8()? as i8) as u32;

                self.push32(value)?;
            }
            0x69 | 0x6b => {
                let (reg, place) = self.modrm()?;
                let value = self.get32(place)?;
                let immediate = if opcode == 0x69 {
                    self.fetch32()?
                } else {
                    i32::from(self.fetch8()? as i8) as u32
                };
                let r = self.multiply_double(value, immediate);

                self.set_reg32(reg, r);
            }
            0x81 | 0x83 => {
                let (reg, place) = self.modrm()?;
                let op = Alu::from(reg as u8);
                let value = self.get32(place)?;
                let immediate = if opcode == 0x81 {
                    self.fetch32()?
                } else {
                    i32::from(self.fetch8()? as i8) as u32
                };
                let r = self.alu(op, value, immediate, 32);

                if !matches!(op, Alu::Cmp) {
                    self.set32(place, r)?;
                }
            }
            0x85 => {
                let (reg, place) = self.modrm()?;

                self.alu(Alu::And, self.get32(place)?, self.reg32(reg), 32);
            }
            // TEST EAX, Id: the flags only. Bubble Girl tests the mouse's
            // buttons so.
            0xa9 => {
                let immediate = self.fetch32()?;

                self.alu(Alu::And, self.reg32(AX), immediate, 32);
            }
            0x87 => {
                let (reg, place) = self.modrm()?;
                let value = self.get32(place)?;

                self.set32(place, self.reg32(reg))?;
                self.set_reg32(reg, value);
            }
            0x89 => {
                let (reg, place) = self.modrm()?;

                self.set32(place, self.reg32(reg))?;
            }
            0x8b => {
                let (reg, place) = self.modrm()?;
                let value = self.get32(place)?;

                self.set_reg32(reg, value);
            }
            // MOV Ev, Sreg: to a register the selector zero-extended to its
            // double word, to memory a word; past GS an undefined opcode.
            0x8c => {
                let (reg, place) = self.modrm()?;

                if reg > GS {
                    return self.fault(6);
                }

                let selector = self.segments[reg].selector;

                match place {
                    Place::Register(index) => self.set_reg32(index, u32::from(selector)),
                    Place::Memory(..) => self.set16(place, selector)?,
                }
            }
            // LEA: the offset, zero-extended; a register operand is an
            // undefined opcode.
            0x8d => match self.modrm()? {
                (reg, Place::Memory(_, offset)) => self.set_reg32(reg, offset),
                (_, Place::Register(_)) => return self.fault(6),
            },
            0x8f => self.pop_to_memory(4)?,
            0x98 => {
                self.high[AX] = if self.regs[AX] & 0x8000 != 0 {
                    0xffff
                } else {
                    0
                }
            }
            0x99 => {
                let sign = if self.high[AX] & 0x8000 != 0 {
                    0xffff_ffff
                } else {
                    0
                };

                self.set_reg32(DX, sign);
            }
            // CALL far with a double word's offset: CS and IP pushed as
            // double words, and the offset taken to IP's 16 bits.
            0x9a => {
                let offset = self.fetch32()?;
                let selector = self.fetch16()?;
                let segment = self.descriptor(CS, selector, false)?;

                self.push32(u32::from(self.segments[CS].selector))?;
                self.push32(u32::from(self.ip))?;
                self.ip = offset as u16;
                self.set_segment(CS, segment);
            }
            // PUSHFD and POPFD: FLAGS' word, in a double word.
            0x9c => self.push32(u32::from(self.flags_word()))?,
            0x9d => {
                let value = self.pop32()?;

                self.load_flags(value as u16);
            }
            0xa1 => {
                let offset = self.moffs()?;
                let value = self.read32(self.data(), offset)?;

                self.set_reg32(AX, value);
            }
            0xa3 => {
                let offset = self.moffs()?;

                self.write32(self.data(), offset, self.reg32(AX))?;
            }
            // A segment register pushed as a double word, the selector
            // zero-extended; popped, its word read and the stack moved by
            // the double word, loaded unchecked.
            0x06 | 0x0e | 0x16 | 0x1e => {
                self.push32(u32::from(self.segments[usize::from(opcode >> 3)].selector))?;
            }
            0x07 | 0x17 | 0x1f => self.pop_selector32(usize::from(opcode >> 3))?,
            // XCHG of EAX with a double-word register; with itself, a NOP.
            0x90..=0x97 => {
                let other = usize::from(opcode & 7);
                let eax = self.reg32(AX);

                self.set_reg32(AX, self.reg32(other));
                self.set_reg32(other, eax);
            }
            0xb8..=0xbf => {
                let value = self.fetch32()?;

                self.set_reg32(usize::from(opcode & 7), value);
            }
            0xc1 | 0xd1 | 0xd3 => {
                let (kind, place) = self.modrm()?;
                let count = match opcode {
                    0xc1 => self.fetch8()?,
                    0xd1 => 1,
                    _ => self.reg8(1),
                };
                let value = self.get32(place)?;
                let result = self.shift(kind, value, count, 32);

                self.set32(place, result)?;
            }
            // RETD and RETFD: what they return to read first, an EIP past
            // the segment's 64 KiB a general protection fault with the stack
            // as it was. The count released is the low word of the double
            // word the JavaScript core's decode reads for it.
            0xc2 | 0xc3 | 0xca | 0xcb => {
                let release = if matches!(opcode, 0xc2 | 0xca) {
                    self.fetch32()? as u16
                } else {
                    0
                };
                let far = opcode >= 0xca;
                let top = self.regs[SP];
                let eip = self.read32(SS, u32::from(top))?;
                let selector = if far {
                    self.read32(SS, u32::from(top.wrapping_add(4)))? as u16
                } else {
                    0
                };

                if eip > 0xffff {
                    return self.fault(13);
                }

                let segment = if far {
                    Some(self.descriptor(CS, selector, false)?)
                } else {
                    None
                };

                self.regs[SP] = top
                    .wrapping_add(if far { 8 } else { 4 })
                    .wrapping_add(release);
                self.ip = eip as u16;

                if let Some(segment) = segment {
                    self.set_segment(CS, segment);
                }
            }
            // LES and LDS of a double word's offset: the selector after it,
            // loaded unchecked.
            0xc4 | 0xc5 => {
                let (reg, place) = self.modrm()?;
                let Place::Memory(through, offset) = place else {
                    return self.fault(6);
                };
                let value = self.read32(through, offset)?;
                let selector = self.read16(through, offset.wrapping_add(4))?;

                self.load_segment(if opcode == 0xc4 { ES } else { DS }, selector)?;
                self.set_reg32(reg, value);
            }
            0xc7 => {
                let (reg, place) = self.modrm()?;

                if reg != 0 {
                    return self.fault(6);
                }

                let value = self.fetch32()?;

                self.set32(place, value)?;
            }
            0xc8 => self.enter(4)?,
            // LEAVE: EBP's double word from the frame, read before the stack
            // moves.
            0xc9 => {
                let frame = self.regs[BP];
                let saved = self.read32(SS, u32::from(frame))?;

                self.regs[SP] = frame.wrapping_add(4);
                self.set_reg32(BP, saved);
            }
            0xcf => self.iret(true)?,
            // CALL and JMP near with a double word's displacement, IP
            // wrapping in its 16 bits; CALL pushes a double word.
            0xe8 => {
                let displacement = self.fetch32()?;

                self.push32(u32::from(self.ip))?;
                self.ip = self.ip.wrapping_add(displacement as u16);
            }
            0xe9 => {
                let displacement = self.fetch32()?;

                self.ip = self.ip.wrapping_add(displacement as u16);
            }
            0xea => {
                let offset = self.fetch32()?;
                let selector = self.fetch16()?;
                let segment = self.descriptor(CS, selector, false)?;

                self.ip = offset as u16;
                self.set_segment(CS, segment);
            }
            0xf7 => {
                let (reg, place) = self.modrm()?;
                let value = self.get32(place)?;

                match reg {
                    // TEST, and its alias /1.
                    0 | 1 => {
                        let immediate = self.fetch32()?;

                        self.alu(Alu::And, value, immediate, 32);
                    }
                    2 => self.set32(place, !value)?,
                    3 => {
                        let r = self.alu(Alu::Sub, 0, value, 32);

                        self.flags = (self.flags & !CF) | if value != 0 { CF } else { 0 };
                        self.set32(place, r)?;
                    }
                    4 => {
                        let product = u64::from(self.reg32(AX)) * u64::from(value);

                        self.carry_overflow(product >> 32 != 0);
                        self.set_reg32(AX, product as u32);
                        self.set_reg32(DX, (product >> 32) as u32);
                    }
                    5 => {
                        let product = i64::from(self.reg32(AX) as i32) * i64::from(value as i32);

                        self.carry_overflow(i64::from(product as i32) != product);
                        self.set_reg32(AX, product as u32);
                        self.set_reg32(DX, ((product as u64) >> 32) as u32);
                    }
                    // DIV and IDIV of EDX:EAX leave the flags alone; a
                    // divisor of nought, or a quotient that does not fit, is
                    // a divide error with the registers as they were.
                    _ => {
                        let pair = (u64::from(self.reg32(DX)) << 32) | u64::from(self.reg32(AX));
                        let (dividend, divisor) = if reg == 7 {
                            (i128::from(pair as i64), i128::from(value as i32))
                        } else {
                            (i128::from(pair), i128::from(value))
                        };

                        if divisor == 0 {
                            return self.fault(0);
                        }

                        let quotient = dividend / divisor;
                        let fits = if reg == 7 {
                            i128::from(quotient as i32) == quotient
                        } else {
                            quotient <= 0xffff_ffff
                        };

                        if !fits {
                            return self.fault(0);
                        }

                        self.set_reg32(AX, quotient as u32);
                        self.set_reg32(DX, (dividend % divisor) as u32);
                    }
                }
            }
            0xff => {
                let (reg, place) = self.modrm()?;

                match reg {
                    0 | 1 => {
                        let r = self.inc_dec(self.get32(place)?, reg == 0, 32);

                        self.set32(place, r)?;
                    }
                    // CALL near: the return pushed as a double word.
                    2 => {
                        let target = self.get32(place)?;

                        self.push32(u32::from(self.ip))?;
                        self.ip = target as u16;
                    }
                    // CALL far through memory: CS and IP pushed as double
                    // words, the selector after the double word's offset. A
                    // register operand the JavaScript core has no form of.
                    3 => {
                        let Place::Memory(through, at) = place else {
                            return Err(Exit::Unimplemented(0xff));
                        };
                        let offset = self.read32(through, at)?;
                        let selector = self.read16(through, at.wrapping_add(4))?;
                        let segment = self.descriptor(CS, selector, false)?;

                        self.push32(u32::from(self.segments[CS].selector))?;
                        self.push32(u32::from(self.ip))?;
                        self.ip = offset as u16;
                        self.set_segment(CS, segment);
                    }
                    4 => self.ip = self.get32(place)? as u16,
                    // JMP far through memory: as the JavaScript core has it,
                    // not through a register, nor through a segment register
                    // holding the null selector.
                    5 => {
                        let Place::Memory(through, at) = place else {
                            return Err(Exit::Unimplemented(0xff));
                        };

                        if self.segments[through].selector == 0 {
                            return Err(Exit::Unimplemented(0xff));
                        }

                        let offset = self.read32(through, at)?;
                        let selector = self.read16(through, at.wrapping_add(4))?;
                        let segment = self.descriptor(CS, selector, false)?;

                        self.ip = offset as u16;
                        self.set_segment(CS, segment);
                    }
                    6 => {
                        let value = self.get32(place)?;

                        self.push32(value)?;
                    }
                    _ => return stop,
                }
            }
            0x0f => self.two_byte_wide()?,
            _ => return stop,
        }

        Ok(())
    }

    /// The two-byte opcodes under the operand-size prefix.
    #[allow(clippy::too_many_lines)]
    fn two_byte_wide(&mut self) -> Result<(), Exit> {
        let second = self.fetch8()?;

        match second {
            0xaf => {
                let (reg, place) = self.modrm()?;
                let value = self.get32(place)?;
                let r = self.multiply_double(self.reg32(reg), value);

                self.set_reg32(reg, r);
            }
            0xb6 | 0xbe => {
                let (reg, place) = self.modrm()?;
                let value = self.get8(place)?;

                self.set_reg32(
                    reg,
                    if second == 0xb6 {
                        u32::from(value)
                    } else {
                        i32::from(value as i8) as u32
                    },
                );
            }
            0xb7 | 0xbf => {
                let (reg, place) = self.modrm()?;
                let value = self.get16(place)?;

                self.set_reg32(
                    reg,
                    if second == 0xb7 {
                        u32::from(value)
                    } else {
                        i32::from(value as i16) as u32
                    },
                );
            }
            0xa3 | 0xab | 0xb3 | 0xbb | 0xba | 0xbc | 0xbd => self.bits(second)?,
            0xa4 | 0xa5 | 0xac | 0xad => self.double_shift(second)?,
            // The near Jcc with a double word's displacement: past the
            // segment's 64 KiB the jump is a general protection fault, as the
            // JavaScript core's executeConditional raises it. SimTower jumps
            // so.
            0x80..=0x8f => {
                let displacement = self.fetch32()?;

                if self.condition(second & 0x0f) {
                    let target = u32::from(self.ip).wrapping_add(displacement);

                    if target > 0xffff {
                        return self.fault(13);
                    }

                    self.ip = target as u16;
                }
            }
            // SETcc sets a byte whatever the operand size.
            0x90..=0x9f => {
                let (_, place) = self.modrm()?;

                self.set8(place, u8::from(self.condition(second & 0x0f)))?;
            }
            // PUSH and POP FS and GS as double words.
            0xa0 | 0xa8 => {
                let index = if second == 0xa0 { FS } else { GS };

                self.push32(u32::from(self.segments[index].selector))?;
            }
            0xa1 | 0xa9 => self.pop_selector32(if second == 0xa1 { FS } else { GS })?,
            // LSS, LFS and LGS of a double word's offset, from memory only.
            0xb2 | 0xb4 | 0xb5 => {
                let (reg, place) = self.modrm()?;
                let Place::Memory(through, offset) = place else {
                    return self.fault(6);
                };
                let value = self.read32(through, offset)?;
                let selector = self.read16(through, offset.wrapping_add(4))?;
                let index = match second {
                    0xb2 => SS,
                    0xb4 => FS,
                    _ => GS,
                };

                self.load_segment(index, selector)?;
                self.set_reg32(reg, value);
            }
            // `0F 01` under the prefix: LGDT and LIDT of a 32-bit base are
            // the host's, its tables being; SGDT, SIDT and the rest the
            // JavaScript core's 32-bit table passes over, doing nothing.
            0x01 => {
                let (reg, _) = self.modrm()?;

                if matches!(reg, 2 | 3) {
                    return Err(Exit::Unimplemented(0x0f));
                }
            }
            _ => return Err(Exit::Unimplemented(0x66)),
        }

        Ok(())
    }

    /// A segment register popped under the operand-size prefix: its word
    /// read, the stack moved by the double word, loaded unchecked.
    fn pop_selector32(&mut self, index: usize) -> Result<(), Exit> {
        let selector = self.read16(SS, u32::from(self.regs[SP]))?;
        let segment = self.descriptor(index, selector, false)?;

        self.regs[SP] = self.regs[SP].wrapping_add(4);
        self.set_segment(index, segment);
        Ok(())
    }
}
