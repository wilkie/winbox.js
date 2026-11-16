//! The instructions after the 386's, as the oracle's processor runs them
//! ([`crate::Model::Mixed`]): DOSBox 0.74-3 at `cputype=auto`, its
//! architecture `CPU_ARCHTYPE_MIXED` (`cpu/cpu.cpp` 2352-2355), which lets
//! through every check of a 486's or a Pentium's (`core_normal/prefix_0f.h`
//! and `prefix_66_0f.h`, `if (CPU_ArchitectureType<...) goto
//! illegal_opcode`). The recorder's DOSBox translates protected-mode code
//! with its dynamic core, `core_dynrec`, which translates none of these and
//! gives each to the normal core (`core_dynrec/decoder.h` 172-250,
//! `core_dynrec.cpp` 273-279): the normal core's are the oracle's.
//! **Recorded** by `cpu486`, in standard and in 386 enhanced mode alike, at
//! a program's privilege, 3; where DOSBox's answer is a quirk of its own
//! and not the processor's -- the flags after `XADD` and `CMPXCHG` --
//! WinBox follows the 80486's manual.
//!
//! - `BSWAP` of a double word reverses its bytes; of a word, it clears it
//!   (`prefix_0f.h` 591-614, `prefix_66_0f.h` 442-465; `BSWAPW`,
//!   `cpu/instructions.h` 959-960), the word above kept.
//! - `XADD` writes the sum to the destination and the destination as it
//!   was to the source, and sets the flags as `ADD` does; `CMPXCHG`
//!   compares AL, AX or EAX with the destination and sets the flags as
//!   `CMP` does: equal, it writes the source to the destination; unequal,
//!   it loads the accumulator from the destination, and writes the
//!   destination back to memory as it was. Those flags are the 80486's
//!   (**documented**, its manual), not the oracle's: DOSBox's normal core
//!   sets none after `XADD` (`prefix_0f.h` 575-590, `prefix_66_0f.h`
//!   434-440) and ZF alone after `CMPXCHG` (`prefix_0f.h` 359-411,
//!   `prefix_66_0f.h` 238-263), an emulator's quirk, which WinBox does not
//!   follow (the owner's rule: the hardware over DOSBox's quirks, as for
//!   the segment checks of 2026-11-09). `cpu486`'s records of their flags
//!   are known gaps (`kb/topics/the-processor.md`).
//! - `INVD`, `WBINVD` and `INVLPG` are a general protection fault, error
//!   code nought, at any privilege but 0 in protected mode, and else do
//!   nothing the core keeps (`prefix_0f.h` 145-149, 91-94). `INVLPG` of a
//!   register is an undefined opcode (`prefix_0f.h` 110-112). At a
//!   program's privilege the recorder's DOSBox cannot be asked: its
//!   dynamic core stops the emulator as it translates either form
//!   (`core_dynrec/decoder_opcodes.h` 990-994, 1021), which the normal
//!   core's fault stands in for.
//! - `CPUID` answers as a 486DX (`CPU_CPUID`, `cpu/cpu.cpp` 2010-2044).
//! - `RDTSC` reads DOSBox's time in milliseconds times its cycles a
//!   millisecond (`prefix_0f.h` 228-234): the host's counter
//!   ([`crate::Cpu::time_stamp`]), on by one an instruction.

use crate::{AC_HIGH, AX, Alu, BX, Bus, CS, CX, Cpu, DX, Exit, ID_HIGH, Model, Place};

/// What `CPUID` answers with EAX nought: the highest leaf, 1, and
/// `GenuineIntel` in EBX, EDX and ECX.
const VENDOR: [u32; 4] = [
    1,
    u32::from_le_bytes(*b"Genu"),
    u32::from_le_bytes(*b"ntel"),
    u32::from_le_bytes(*b"ineI"),
];

/// What `CPUID` answers with EAX 1: family 4, model 0, stepping 2 -- "intel
/// 486dx", as DOSBox's comment has it -- and of the features, the
/// coprocessor alone (EDX bit 0).
const SIGNATURE: [u32; 4] = [0x0402, 0, 0, 0x0000_0001];

impl<B: Bus> Cpu<B> {
    /// EFLAGS' high word loaded from a double word popped: AC and ID under
    /// [`Model::Mixed`], whose `CPU_SetFlags` lets the ID bit through
    /// (`CPU_flag_id_toggle`, `cpu/cpu.cpp` 172-176, 2390); none on the 386.
    pub(crate) fn load_flags_high(&mut self, value: u32) {
        if self.model == Model::Mixed {
            self.flags_high = (value >> 16) as u16 & (AC_HIGH | ID_HIGH);
        }
    }

    /// Whether the instruction runs at a privilege but 0 in protected mode.
    fn unprivileged(&self) -> bool {
        self.protected && self.segments[CS].selector & 3 != 0
    }

    /// `INVLPG` (`0F 01 /7`): of a register, an undefined opcode; at a
    /// program's privilege, a general protection fault; else nothing kept
    /// changes.
    #[cold]
    #[inline(never)]
    pub(crate) fn invalidate_page(&mut self, place: Place) -> Result<(), Exit> {
        if matches!(place, Place::Register(_)) {
            return self.fault(6);
        }

        if self.unprivileged() {
            return self.fault(13);
        }

        Ok(())
    }

    /// The two-byte opcodes the 486 and the Pentium added, of words or,
    /// under the operand-size prefix, double words. Off the common path.
    #[cold]
    #[inline(never)]
    pub(crate) fn later(&mut self, opcode: u8) -> Result<(), Exit> {
        match opcode {
            // INVD and WBINVD.
            0x08 | 0x09 => {
                if self.unprivileged() {
                    return self.fault(13);
                }
            }
            0x31 => {
                let Some(start) = self.time_stamp else {
                    return Err(Exit::Unimplemented(0x0f));
                };
                let count = start.wrapping_add(self.retired);

                self.set_reg32(AX, count as u32);
                self.set_reg32(DX, (count >> 32) as u32);
            }
            0xa2 => {
                let answer = match self.reg32(AX) {
                    0 => VENDOR,
                    1 => SIGNATURE,
                    _ => [0; 4],
                };

                self.set_reg32(AX, answer[0]);
                self.set_reg32(BX, answer[1]);
                self.set_reg32(CX, answer[2]);
                self.set_reg32(DX, answer[3]);
            }
            // CMPXCHG: the accumulator compared with the destination, the
            // flags as `CMP` sets them.
            0xb0 => {
                let (reg, place) = self.modrm()?;
                let value = self.get8(place)?;
                let accumulator = self.reg8(AX);

                self.alu(Alu::Cmp, u32::from(accumulator), u32::from(value), 8);

                if accumulator == value {
                    self.set8(place, self.reg8(reg))?;
                } else {
                    self.set8(place, value)?;
                    self.set_reg8(AX, value);
                }
            }
            0xb1 if self.wide => {
                let (reg, place) = self.modrm()?;
                let value = self.get32(place)?;
                let accumulator = self.reg32(AX);

                self.alu(Alu::Cmp, accumulator, value, 32);

                if accumulator == value {
                    self.set32(place, self.reg32(reg))?;
                } else {
                    self.set32(place, value)?;
                    self.set_reg32(AX, value);
                }
            }
            0xb1 => {
                let (reg, place) = self.modrm()?;
                let value = self.get16(place)?;
                let accumulator = self.regs[AX];

                self.alu(Alu::Cmp, u32::from(accumulator), u32::from(value), 16);

                if accumulator == value {
                    self.set16(place, self.regs[reg])?;
                } else {
                    self.set16(place, value)?;
                    self.regs[AX] = value;
                }
            }
            // XADD: the sum to the destination, the flags as `ADD` sets them.
            0xc0 => {
                let (reg, place) = self.modrm()?;
                let source = self.reg8(reg);
                let value = self.get8(place)?;
                let sum = self.alu(Alu::Add, u32::from(value), u32::from(source), 8) as u8;

                self.set_reg8(reg, value);
                self.set8(place, sum)?;
            }
            0xc1 if self.wide => {
                let (reg, place) = self.modrm()?;
                let source = self.reg32(reg);
                let value = self.get32(place)?;
                let sum = self.alu(Alu::Add, value, source, 32);

                self.set_reg32(reg, value);
                self.set32(place, sum)?;
            }
            0xc1 => {
                let (reg, place) = self.modrm()?;
                let source = self.regs[reg];
                let value = self.get16(place)?;
                let sum = self.alu(Alu::Add, u32::from(value), u32::from(source), 16) as u16;

                self.regs[reg] = value;
                self.set16(place, sum)?;
            }
            // BSWAP, the register in the opcode's low three bits.
            _ if self.wide => {
                let reg = usize::from(opcode & 7);

                self.set_reg32(reg, self.reg32(reg).swap_bytes());
            }
            _ => self.regs[usize::from(opcode & 7)] = 0,
        }

        Ok(())
    }
}
