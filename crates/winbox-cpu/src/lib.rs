//! The x86 execution core, in Rust: a spike.
//!
//! winbox.js's core is JavaScript (`src/emulator/core`), held to hardware
//! test vectors. This is the start of one in Rust, compiled to WebAssembly,
//! to run beside it on the same machine state. For now it interprets only
//! the instructions of the JavaScript core's benchmark (`bench/cpu.ts`) --
//! register arithmetic, loads and stores, pushes and pops, jumps and `LOOP`
//! -- so the two can be timed on the same work. It decodes every instruction
//! each time it runs and computes the flags eagerly, as the JavaScript core
//! does: interpreter against interpreter.
//!
//! Anything else stops the run with [`Exit::Unimplemented`], so a caller
//! can hand that instruction to the JavaScript core.

/// Why a run stopped.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Exit {
    /// The budget of instructions ran out.
    Budget,
    /// `HLT`.
    Halt,
    /// An opcode this core does not interpret yet, at the instruction's start.
    Unimplemented(u8),
    /// A fault, by vector: 13 for an access past a segment's limit.
    Fault(u8),
    /// Memory only the host can answer for: a block never written, or a
    /// segment whose bytes a host handler makes. The host runs the
    /// instruction.
    Host,
}

/// The machine's memory as the core reaches it, by linear address. `None`
/// is memory only the host can answer for ([`Exit::Host`]).
pub trait Bus {
    fn read8(&self, at: u32) -> Option<u8>;
    fn write8(&mut self, at: u32, value: u8) -> Option<()>;

    fn read16(&self, at: u32) -> Option<u16> {
        Some(u16::from(self.read8(at)?) | (u16::from(self.read8(at.wrapping_add(1))?) << 8))
    }

    fn write16(&mut self, at: u32, value: u16) -> Option<()> {
        self.write8(at, value as u8)?;
        self.write8(at.wrapping_add(1), (value >> 8) as u8)
    }
}

/// Memory of a fixed size in a `Vec`, for tests and for running natively.
#[derive(Debug)]
pub struct VecBus(pub Vec<u8>);

impl Bus for VecBus {
    fn read8(&self, at: u32) -> Option<u8> {
        self.0.get(at as usize).copied()
    }

    fn write8(&mut self, at: u32, value: u8) -> Option<()> {
        *self.0.get_mut(at as usize)? = value;
        Some(())
    }
}

/// A segment register as the part caches it: the selector loaded, and the
/// base and limit its descriptor gave.
#[derive(Debug, Clone, Copy, Default)]
pub struct Segment {
    pub selector: u16,
    pub base: u32,
    /// One past the last offset that may be reached.
    pub past_limit: u32,
}

pub const ES: usize = 0;
pub const CS: usize = 1;
pub const SS: usize = 2;
pub const DS: usize = 3;
pub const FS: usize = 4;
pub const GS: usize = 5;

pub const AX: usize = 0;
pub const CX: usize = 1;
pub const DX: usize = 2;
pub const BX: usize = 3;
pub const SP: usize = 4;
pub const BP: usize = 5;
pub const SI: usize = 6;
pub const DI: usize = 7;

const CF: u16 = 0x0001;
const PF: u16 = 0x0004;
const AF: u16 = 0x0010;
const ZF: u16 = 0x0040;
const SF: u16 = 0x0080;
const OF: u16 = 0x0800;

/// The eight ALU operations of opcodes 00h to 3Fh, by their `reg` field.
#[derive(Debug, Clone, Copy)]
enum Alu {
    Add,
    Or,
    Adc,
    Sbb,
    And,
    Sub,
    Xor,
    Cmp,
}

impl Alu {
    fn from(code: u8) -> Self {
        match code & 7 {
            0 => Self::Add,
            1 => Self::Or,
            2 => Self::Adc,
            3 => Self::Sbb,
            4 => Self::And,
            5 => Self::Sub,
            6 => Self::Xor,
            _ => Self::Cmp,
        }
    }
}

/// Where a ModR/M operand is: a register, or memory through a segment.
#[derive(Debug, Clone, Copy)]
enum Place {
    Register(usize),
    Memory(usize, u32),
}

/// The machine: its registers, its segments, and its memory.
#[derive(Debug)]
pub struct Cpu<B: Bus> {
    pub regs: [u16; 8],
    pub ip: u16,
    pub flags: u16,
    pub segments: [Segment; 6],
    /// Whether segment loads read descriptors (CR0's PE bit).
    pub protected: bool,
    /// Where the descriptor table is, for protected mode.
    pub gdt_base: u32,
    pub bus: B,
}

impl<B: Bus> Cpu<B> {
    /// A machine on `bus`, in real mode.
    pub fn new(bus: B) -> Self {
        Self {
            regs: [0; 8],
            ip: 0,
            flags: 0x0002,
            segments: [Segment::default(); 6],
            protected: false,
            gdt_base: 0,
            bus,
        }
    }

    /// A segment register loaded: in real mode, the selector times sixteen;
    /// in protected mode, its descriptor's base and limit.
    pub fn load_segment(&mut self, index: usize, selector: u16) -> Result<(), Exit> {
        self.segments[index] = if self.protected {
            let at = self.gdt_base + u32::from(selector >> 3) * 8;
            let byte = |offset: u32| self.bus.read8(at + offset).map(u32::from).ok_or(Exit::Host);
            let limit = byte(0)? | (byte(1)? << 8) | ((byte(6)? & 0x0f) << 16);
            let base = byte(2)? | (byte(3)? << 8) | (byte(4)? << 16) | (byte(7)? << 24);

            Segment {
                selector,
                base,
                past_limit: limit + 1,
            }
        } else {
            Segment {
                selector,
                base: u32::from(selector) << 4,
                past_limit: 0x10000,
            }
        };

        Ok(())
    }

    fn linear(&self, segment: usize, offset: u32, size: u32) -> Result<u32, Exit> {
        let cached = self.segments[segment];

        if offset + size > cached.past_limit {
            return Err(Exit::Fault(13));
        }

        Ok(cached.base.wrapping_add(offset))
    }

    fn read8(&self, segment: usize, offset: u32) -> Result<u8, Exit> {
        self.bus
            .read8(self.linear(segment, offset, 1)?)
            .ok_or(Exit::Host)
    }

    fn read16(&self, segment: usize, offset: u32) -> Result<u16, Exit> {
        self.bus
            .read16(self.linear(segment, offset, 2)?)
            .ok_or(Exit::Host)
    }

    fn write8(&mut self, segment: usize, offset: u32, value: u8) -> Result<(), Exit> {
        let at = self.linear(segment, offset, 1)?;

        self.bus.write8(at, value).ok_or(Exit::Host)
    }

    fn write16(&mut self, segment: usize, offset: u32, value: u16) -> Result<(), Exit> {
        let at = self.linear(segment, offset, 2)?;

        self.bus.write16(at, value).ok_or(Exit::Host)
    }

    fn fetch8(&mut self) -> Result<u8, Exit> {
        let value = self.read8(CS, u32::from(self.ip))?;

        self.ip = self.ip.wrapping_add(1);
        Ok(value)
    }

    fn fetch16(&mut self) -> Result<u16, Exit> {
        let value = self.read16(CS, u32::from(self.ip))?;

        self.ip = self.ip.wrapping_add(2);
        Ok(value)
    }

    fn reg8(&self, index: usize) -> u8 {
        let word = self.regs[index & 3];

        if index < 4 {
            word as u8
        } else {
            (word >> 8) as u8
        }
    }

    fn set_reg8(&mut self, index: usize, value: u8) {
        let word = &mut self.regs[index & 3];

        *word = if index < 4 {
            (*word & 0xff00) | u16::from(value)
        } else {
            (*word & 0x00ff) | (u16::from(value) << 8)
        };
    }

    /// The ModR/M byte's `reg` field and its operand, with 16-bit
    /// addressing: BP-based forms through SS, the rest through DS.
    fn modrm(&mut self) -> Result<(usize, Place), Exit> {
        let byte = self.fetch8()?;
        let mode = byte >> 6;
        let reg = usize::from((byte >> 3) & 7);
        let rm = usize::from(byte & 7);

        if mode == 3 {
            return Ok((reg, Place::Register(rm)));
        }

        let r = &self.regs;
        let (base, segment) = match rm {
            0 => (r[BX].wrapping_add(r[SI]), DS),
            1 => (r[BX].wrapping_add(r[DI]), DS),
            2 => (r[BP].wrapping_add(r[SI]), SS),
            3 => (r[BP].wrapping_add(r[DI]), SS),
            4 => (r[SI], DS),
            5 => (r[DI], DS),
            6 if mode == 0 => {
                let offset = self.fetch16()?;
                return Ok((reg, Place::Memory(DS, u32::from(offset))));
            }
            6 => (r[BP], SS),
            _ => (r[BX], DS),
        };
        let displacement = match mode {
            1 => i16::from(self.fetch8()? as i8) as u16,
            2 => self.fetch16()?,
            _ => 0,
        };

        Ok((
            reg,
            Place::Memory(segment, u32::from(base.wrapping_add(displacement))),
        ))
    }

    fn get16(&self, place: Place) -> Result<u16, Exit> {
        match place {
            Place::Register(index) => Ok(self.regs[index]),
            Place::Memory(segment, offset) => self.read16(segment, offset),
        }
    }

    fn set16(&mut self, place: Place, value: u16) -> Result<(), Exit> {
        match place {
            Place::Register(index) => {
                self.regs[index] = value;
                Ok(())
            }
            Place::Memory(segment, offset) => self.write16(segment, offset, value),
        }
    }

    fn get8(&self, place: Place) -> Result<u8, Exit> {
        match place {
            Place::Register(index) => Ok(self.reg8(index)),
            Place::Memory(segment, offset) => self.read8(segment, offset),
        }
    }

    fn set8(&mut self, place: Place, value: u8) -> Result<(), Exit> {
        match place {
            Place::Register(index) => {
                self.set_reg8(index, value);
                Ok(())
            }
            Place::Memory(segment, offset) => self.write8(segment, offset, value),
        }
    }

    /// Sign, zero and parity of a result of `bits` bits.
    fn szp(&mut self, result: u32, bits: u32) {
        let mask = (1u32 << bits) - 1;
        let value = result & mask;

        self.flags &= !(SF | ZF | PF);

        if value == 0 {
            self.flags |= ZF;
        }

        if value & (1 << (bits - 1)) != 0 {
            self.flags |= SF;
        }

        if (value as u8).count_ones().is_multiple_of(2) {
            self.flags |= PF;
        }
    }

    /// An ALU operation of `bits` bits, its flags set; the result, which
    /// `CMP` does not keep.
    fn alu(&mut self, op: Alu, a: u32, b: u32, bits: u32) -> u32 {
        let mask = (1u32 << bits) - 1;
        let sign = 1u32 << (bits - 1);
        let carry_in = u32::from(self.flags & CF != 0);

        let (result, carry, overflow) = match op {
            Alu::Add | Alu::Adc => {
                let c = if matches!(op, Alu::Adc) { carry_in } else { 0 };
                let full = a + b + c;
                let r = full & mask;

                (r, full > mask, (a ^ r) & (b ^ r) & sign != 0)
            }
            Alu::Sub | Alu::Sbb | Alu::Cmp => {
                let c = if matches!(op, Alu::Sbb) { carry_in } else { 0 };
                let r = a.wrapping_sub(b).wrapping_sub(c) & mask;

                (r, a < b + c, (a ^ b) & (a ^ r) & sign != 0)
            }
            Alu::Or => ((a | b) & mask, false, false),
            Alu::And => (a & b & mask, false, false),
            Alu::Xor => ((a ^ b) & mask, false, false),
        };

        self.flags &= !(CF | OF | AF);

        if carry {
            self.flags |= CF;
        }

        if overflow {
            self.flags |= OF;
        }

        if matches!(op, Alu::Add | Alu::Adc | Alu::Sub | Alu::Sbb | Alu::Cmp)
            && (a ^ b ^ result) & 0x10 != 0
        {
            self.flags |= AF;
        }

        self.szp(result, bits);
        result
    }

    /// `INC` or `DEC` of a word: the ALU's flags, but carry left as it was.
    fn step_word(&mut self, value: u16, up: bool) -> u16 {
        let carry = self.flags & CF;
        let result = self.alu(
            if up { Alu::Add } else { Alu::Sub },
            u32::from(value),
            1,
            16,
        ) as u16;

        self.flags = (self.flags & !CF) | carry;
        result
    }

    fn push(&mut self, value: u16) -> Result<(), Exit> {
        let sp = self.regs[SP].wrapping_sub(2);

        self.write16(SS, u32::from(sp), value)?;
        self.regs[SP] = sp;
        Ok(())
    }

    fn pop(&mut self) -> Result<u16, Exit> {
        let sp = self.regs[SP];
        let value = self.read16(SS, u32::from(sp))?;

        self.regs[SP] = sp.wrapping_add(2);
        Ok(value)
    }

    /// `SHL`, `SHR` or `SAR` of a word by a count, flags as for a count of
    /// one where that is the count; other rotations and shifts stop the run.
    fn shift(&mut self, kind: usize, value: u16, count: u8) -> Option<u16> {
        let count = u32::from(count & 0x1f);

        if count == 0 {
            return Some(value);
        }

        let wide = u32::from(value);
        let (result, carry) = match kind {
            4 => (
                (wide << count) & 0xffff,
                (wide << (count - 1)) & 0x8000 != 0,
            ),
            5 => (wide >> count, (wide >> (count - 1)) & 1 != 0),
            7 => {
                let signed = i32::from(value as i16);

                (
                    (signed >> count) as u32 & 0xffff,
                    (signed >> (count - 1)) & 1 != 0,
                )
            }
            _ => return None,
        };

        self.flags &= !(CF | OF);

        if carry {
            self.flags |= CF;
        }

        let overflow = match kind {
            4 => (result & 0x8000 != 0) != carry,
            5 => value & 0x8000 != 0,
            _ => false,
        };

        if overflow {
            self.flags |= OF;
        }

        self.szp(result, 16);
        Some(result as u16)
    }

    /// Runs up to `budget` instructions: how many ran, and why it stopped.
    ///
    /// An instruction that stops the run is not counted and leaves nothing
    /// changed -- its registers and flags as they were, IP at its start -- so
    /// the host can run it whole. Memory it does not change either: every
    /// instruction here writes memory last, and once.
    pub fn run(&mut self, budget: u64) -> (u64, Exit) {
        let mut ran = 0;

        while ran < budget {
            let (ip, regs, flags) = (self.ip, self.regs, self.flags);

            match self.step() {
                Ok(()) => ran += 1,
                Err(exit) => {
                    self.ip = ip;
                    self.regs = regs;
                    self.flags = flags;
                    return (ran, exit);
                }
            }
        }

        (ran, Exit::Budget)
    }

    #[allow(clippy::too_many_lines)]
    fn step(&mut self) -> Result<(), Exit> {
        let opcode = self.fetch8()?;

        match opcode {
            // The ALU group: Eb,Gb / Ev,Gv / Gb,Eb / Gv,Ev / AL,Ib / AX,Iv.
            0x00..=0x3f if opcode & 7 < 6 => {
                let op = Alu::from(opcode >> 3);

                match opcode & 7 {
                    0 => {
                        let (reg, place) = self.modrm()?;
                        let r = self.alu(
                            op,
                            u32::from(self.get8(place)?),
                            u32::from(self.reg8(reg)),
                            8,
                        );

                        if !matches!(op, Alu::Cmp) {
                            self.set8(place, r as u8)?;
                        }
                    }
                    1 => {
                        let (reg, place) = self.modrm()?;
                        let r = self.alu(
                            op,
                            u32::from(self.get16(place)?),
                            u32::from(self.regs[reg]),
                            16,
                        );

                        if !matches!(op, Alu::Cmp) {
                            self.set16(place, r as u16)?;
                        }
                    }
                    2 => {
                        let (reg, place) = self.modrm()?;
                        let r = self.alu(
                            op,
                            u32::from(self.reg8(reg)),
                            u32::from(self.get8(place)?),
                            8,
                        );

                        if !matches!(op, Alu::Cmp) {
                            self.set_reg8(reg, r as u8);
                        }
                    }
                    3 => {
                        let (reg, place) = self.modrm()?;
                        let r = self.alu(
                            op,
                            u32::from(self.regs[reg]),
                            u32::from(self.get16(place)?),
                            16,
                        );

                        if !matches!(op, Alu::Cmp) {
                            self.regs[reg] = r as u16;
                        }
                    }
                    4 => {
                        let immediate = self.fetch8()?;
                        let r = self.alu(op, u32::from(self.reg8(0)), u32::from(immediate), 8);

                        if !matches!(op, Alu::Cmp) {
                            self.set_reg8(0, r as u8);
                        }
                    }
                    _ => {
                        let immediate = self.fetch16()?;
                        let r = self.alu(op, u32::from(self.regs[AX]), u32::from(immediate), 16);

                        if !matches!(op, Alu::Cmp) {
                            self.regs[AX] = r as u16;
                        }
                    }
                }
            }
            0x40..=0x47 => {
                let index = usize::from(opcode & 7);

                self.regs[index] = self.step_word(self.regs[index], true);
            }
            0x48..=0x4f => {
                let index = usize::from(opcode & 7);

                self.regs[index] = self.step_word(self.regs[index], false);
            }
            0x50..=0x57 => {
                let index = usize::from(opcode & 7);
                // PUSH SP pushes SP as it was before the push, on a 286 and on.
                let value = self.regs[index];

                self.push(value)?;
            }
            0x58..=0x5f => {
                let value = self.pop()?;

                self.regs[usize::from(opcode & 7)] = value;
            }
            0x88 => {
                let (reg, place) = self.modrm()?;

                self.set8(place, self.reg8(reg))?;
            }
            0x89 => {
                let (reg, place) = self.modrm()?;

                self.set16(place, self.regs[reg])?;
            }
            0x8a => {
                let (reg, place) = self.modrm()?;
                let value = self.get8(place)?;

                self.set_reg8(reg, value);
            }
            0x8b => {
                let (reg, place) = self.modrm()?;

                self.regs[reg] = self.get16(place)?;
            }
            0x90 => {}
            0xb8..=0xbf => {
                self.regs[usize::from(opcode & 7)] = self.fetch16()?;
            }
            0xd1 | 0xd3 => {
                let (kind, place) = self.modrm()?;
                let count = if opcode == 0xd1 { 1 } else { self.reg8(1) };
                let value = self.get16(place)?;
                let result = self
                    .shift(kind, value, count)
                    .ok_or(Exit::Unimplemented(opcode))?;

                self.set16(place, result)?;
            }
            0xe2 => {
                let displacement = self.fetch8()? as i8;
                let cx = self.regs[CX].wrapping_sub(1);

                self.regs[CX] = cx;

                if cx != 0 {
                    self.ip = self.ip.wrapping_add(i16::from(displacement) as u16);
                }
            }
            0xe9 => {
                let displacement = self.fetch16()?;

                self.ip = self.ip.wrapping_add(displacement);
            }
            0xeb => {
                let displacement = self.fetch8()? as i8;

                self.ip = self.ip.wrapping_add(i16::from(displacement) as u16);
            }
            0xf4 => return Err(Exit::Halt),
            _ => return Err(Exit::Unimplemented(opcode)),
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A real-mode machine with `code` at 1000h:0000, its stack at
    /// 3000h:FFFE and its data at 2000h.
    fn machine(code: &[u8]) -> Cpu<VecBus> {
        let mut cpu = Cpu::new(VecBus(vec![0; 0x40000]));

        for (segment, selector) in [(CS, 0x1000), (DS, 0x2000), (ES, 0x2000), (SS, 0x3000)] {
            cpu.load_segment(segment, selector).unwrap();
        }

        cpu.regs[SP] = 0xfffe;
        cpu.bus.0[0x10000..0x10000 + code.len()].copy_from_slice(code);
        cpu
    }

    #[test]
    fn adds_and_sets_carry_and_zero() {
        // mov ax, FFFFh; mov bx, 1; add ax, bx; hlt
        let mut cpu = machine(&[0xb8, 0xff, 0xff, 0xbb, 0x01, 0x00, 0x01, 0xd8, 0xf4]);

        assert_eq!(cpu.run(100), (3, Exit::Halt));
        assert_eq!(cpu.regs[AX], 0);
        assert_eq!(cpu.flags & (CF | ZF | AF | PF), CF | ZF | AF | PF);
    }

    #[test]
    fn subtracts_with_overflow() {
        // mov ax, 8000h; mov cx, 1; sub ax, cx; hlt
        let mut cpu = machine(&[0xb8, 0x00, 0x80, 0xb9, 0x01, 0x00, 0x29, 0xc8, 0xf4]);

        cpu.run(100);
        assert_eq!(cpu.regs[AX], 0x7fff);
        assert_eq!(cpu.flags & (OF | SF | CF), OF);
    }

    #[test]
    fn increments_keep_carry() {
        // mov ax, FFFFh; mov bx, 1; add ax, bx (CF set); inc ax; hlt
        let mut cpu = machine(&[0xb8, 0xff, 0xff, 0xbb, 0x01, 0x00, 0x01, 0xd8, 0x40, 0xf4]);

        cpu.run(100);
        assert_eq!(cpu.regs[AX], 1);
        assert_eq!(cpu.flags & CF, CF);
    }

    #[test]
    fn moves_through_memory() {
        // mov bx, 10h; mov ax, 1234h; mov [bx+20h], ax; mov dx, [bx+20h];
        // mov al, [bx+21h]; hlt
        let mut cpu = machine(&[
            0xbb, 0x10, 0x00, 0xb8, 0x34, 0x12, 0x89, 0x47, 0x20, 0x8b, 0x57, 0x20, 0x8a, 0x47,
            0x21, 0xf4,
        ]);

        cpu.run(100);
        assert_eq!(cpu.bus.0[0x20030..0x20032], [0x34, 0x12]);
        assert_eq!(cpu.regs[DX], 0x1234);
        assert_eq!(cpu.regs[AX], 0x1212);
    }

    #[test]
    fn pushes_and_pops() {
        // mov ax, 1111h; mov bx, 2222h; push ax; push bx; pop ax; pop bx; hlt
        let mut cpu = machine(&[
            0xb8, 0x11, 0x11, 0xbb, 0x22, 0x22, 0x50, 0x53, 0x58, 0x5b, 0xf4,
        ]);

        cpu.run(100);
        assert_eq!(
            (cpu.regs[AX], cpu.regs[BX], cpu.regs[SP]),
            (0x2222, 0x1111, 0xfffe)
        );
    }

    #[test]
    fn loops_cx_times() {
        // mov cx, 5; mov ax, 0; inc ax; loop -3; hlt
        let mut cpu = machine(&[0xb9, 0x05, 0x00, 0xb8, 0x00, 0x00, 0x40, 0xe2, 0xfd, 0xf4]);

        cpu.run(100);
        assert_eq!((cpu.regs[AX], cpu.regs[CX]), (5, 0));
    }

    #[test]
    fn faults_past_a_limit_in_protected_mode() {
        let mut cpu = machine(&[0x8b, 0x07, 0xf4]);

        // A data descriptor at 8, base 20000h, limit Fh.
        cpu.gdt_base = 0x30000;
        cpu.bus.0[0x30008..0x30010].copy_from_slice(&[0x0f, 0, 0x00, 0x00, 0x02, 0x92, 0, 0]);
        cpu.protected = true;
        cpu.load_segment(DS, 0x08).unwrap();
        cpu.regs[BX] = 0x0f;

        assert_eq!(cpu.run(100), (0, Exit::Fault(13)));
        assert_eq!(cpu.ip, 0);
    }

    #[test]
    fn leaves_memory_it_cannot_reach_to_the_host() {
        // mov ax, [0FFF0h] through DS at 30000h, past the end of the bus.
        let mut cpu = machine(&[0xa1, 0xf0, 0xff, 0xf4]);

        cpu.load_segment(DS, 0x3fff).unwrap();
        assert_eq!(cpu.run(100), (0, Exit::Unimplemented(0xa1)));

        // mov ax, [bx] the same way: through ModR/M, which this core reads.
        let mut cpu = machine(&[0x8b, 0x07, 0xf4]);

        cpu.load_segment(DS, 0x3fff).unwrap();
        cpu.regs[BX] = 0x0100;
        assert_eq!(cpu.run(100), (0, Exit::Host));
    }

    #[test]
    fn leaves_a_stopped_instruction_unchanged() {
        // xor ax, ax (ZF set); add [bx], ax through a segment the bus has no
        // room for: the add stops, and its flags must not stay.
        let mut cpu = machine(&[0x31, 0xc0, 0x01, 0x07, 0xf4]);

        cpu.load_segment(DS, 0x3fff).unwrap();
        cpu.regs[BX] = 0x0100;
        assert_eq!(cpu.run(100), (1, Exit::Host));
        assert_eq!((cpu.ip, cpu.flags & ZF), (2, ZF));
    }

    #[test]
    fn stops_at_an_unimplemented_opcode() {
        let mut cpu = machine(&[0x90, 0xcc]);

        assert_eq!(cpu.run(100), (1, Exit::Unimplemented(0xcc)));
        assert_eq!(cpu.ip, 1);
    }
}
