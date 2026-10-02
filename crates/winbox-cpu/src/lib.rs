//! The x86 execution core, in Rust.
//!
//! winbox.js's core is JavaScript (`src/emulator/core`), held to hardware
//! test vectors. This one, compiled to WebAssembly, runs beside it on the
//! same machine state (`src/emulator/wasm-core.ts`), taking the 16-bit
//! instructions it interprets and leaving the rest. It interprets them as
//! the JavaScript core does, flags and all, so that the conformance suites
//! read the same through either (`WINBOX_CORE=wasm`). It decodes every
//! instruction each time it runs and computes the flags eagerly:
//! interpreter against interpreter.
//!
//! Anything else stops the run before the instruction, with nothing
//! changed, for the JavaScript core to run it: an opcode not interpreted
//! here ([`Exit::Unimplemented`]), a fault ([`Exit::Fault`]), or memory or a
//! segment load only the host can answer for ([`Exit::Host`]).

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
    /// Memory only the host can answer for -- a block never written, or a
    /// segment whose bytes a host handler makes -- or a segment load it
    /// must check or fault. The host runs the instruction.
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
const DF: u16 = 0x0400;
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
    /// The general registers' low words; `high` holds their high words, for
    /// the 386's 32-bit operations.
    pub regs: [u16; 8],
    pub high: [u16; 8],
    pub ip: u16,
    pub flags: u16,
    pub segments: [Segment; 6],
    /// Whether segment loads read descriptors (CR0's PE bit).
    pub protected: bool,
    /// Where the descriptor tables are, for protected mode, and the offset
    /// of each one's last byte.
    pub gdt_base: u32,
    pub gdt_limit: u32,
    pub ldt_base: u32,
    pub ldt_limit: u32,
    /// The segment registers loaded since this was last cleared, a bit each
    /// by index: the host refreshes its own copies of those.
    pub loaded: u8,
    pub bus: B,
    /// The segment a prefix names for this instruction's memory operand.
    prefix: Option<usize>,
    /// Whether the operand-size prefix makes this instruction's operands
    /// 32-bit.
    wide: bool,
}

impl<B: Bus> Cpu<B> {
    /// A machine on `bus`, in real mode.
    pub fn new(bus: B) -> Self {
        Self {
            regs: [0; 8],
            high: [0; 8],
            ip: 0,
            flags: 0x0002,
            segments: [Segment::default(); 6],
            protected: false,
            gdt_base: 0,
            gdt_limit: 0xffff,
            ldt_base: 0,
            ldt_limit: 0,
            loaded: 0,
            bus,
            prefix: None,
            wide: false,
        }
    }

    /// A segment register loaded, as the JavaScript core loads one with no
    /// checks -- `POP`, `LES` and `LDS`, the far transfers: in real mode,
    /// the selector times sixteen; in protected mode, its descriptor's base
    /// and limit.
    pub fn load_segment(&mut self, index: usize, selector: u16) -> Result<(), Exit> {
        let segment = self.descriptor(index, selector, false)?;

        self.set_segment(index, segment);
        Ok(())
    }

    /// A segment register given what [`Self::descriptor`] read.
    fn set_segment(&mut self, index: usize, segment: Segment) {
        self.segments[index] = segment;
        self.loaded |= 1 << index;
    }

    /// The segment a selector names, for the register `index`.
    ///
    /// In protected mode, read from its table as the JavaScript core reads
    /// it. A segment this core cannot check accesses to by an upper limit
    /// alone -- the null selector, one not present, one that expands down
    /// -- is given no room, so that any access stops the run and the host
    /// faults. Where the host would fault at the load itself, past a table's
    /// end or, `checked`, a descriptor unfit for the register, the load is
    /// the host's ([`Exit::Host`]); so is a code or stack segment of 32-bit
    /// default size, which this core does not run.
    fn descriptor(&self, index: usize, selector: u16, checked: bool) -> Result<Segment, Exit> {
        if !self.protected {
            return Ok(Segment {
                selector,
                base: u32::from(selector) << 4,
                past_limit: 0x10000,
            });
        }

        let stack = index == SS;

        if selector & 0xfffc == 0 {
            if checked && stack {
                return Err(Exit::Host);
            }

            return Ok(Segment {
                selector,
                base: 0,
                past_limit: 0,
            });
        }

        let (table, table_limit) = if selector & 4 != 0 {
            (self.ldt_base, self.ldt_limit)
        } else {
            (self.gdt_base, self.gdt_limit)
        };
        let entry = u32::from(selector >> 3) * 8;

        if entry + 7 > table_limit {
            return Err(Exit::Host);
        }

        let at = table.wrapping_add(entry);
        let byte = |offset: u32| {
            self.bus
                .read8(at.wrapping_add(offset))
                .map(u32::from)
                .ok_or(Exit::Host)
        };
        let access = byte(5)?;
        let granularity = byte(6)?;
        let mut limit = byte(0)? | (byte(1)? << 8) | ((granularity & 0x0f) << 16);
        let base = byte(2)? | (byte(3)? << 8) | (byte(4)? << 16) | (byte(7)? << 24);

        if granularity & 0x80 != 0 {
            limit = (limit << 12) | 0xfff;
        }

        let present = access & 0x80 != 0;
        let data_or_code = access & 0x10 != 0;
        let executable = access & 0x08 != 0;
        let read_write = access & 0x02 != 0;

        if checked {
            let unfit = if stack {
                !data_or_code || executable || !read_write
            } else {
                !data_or_code || (executable && !read_write)
            };

            if unfit || !present {
                return Err(Exit::Host);
            }
        }

        if (index == CS || stack) && granularity & 0x40 != 0 {
            return Err(Exit::Host);
        }

        let grows_down = access & 0x1c == 0x14;

        Ok(Segment {
            selector,
            base,
            past_limit: if present && !grows_down {
                limit.wrapping_add(1)
            } else {
                0
            },
        })
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

        self.writable(at, 2)?;
        self.bus.write16(at, value).ok_or(Exit::Host)
    }

    fn read32(&self, segment: usize, offset: u32) -> Result<u32, Exit> {
        let at = self.linear(segment, offset, 4)?;
        let low = self.bus.read16(at).ok_or(Exit::Host)?;
        let high = self.bus.read16(at.wrapping_add(2)).ok_or(Exit::Host)?;

        Ok(u32::from(low) | (u32::from(high) << 16))
    }

    fn write32(&mut self, segment: usize, offset: u32, value: u32) -> Result<(), Exit> {
        let at = self.linear(segment, offset, 4)?;

        self.writable(at, 4)?;
        self.bus.write16(at, value as u16).ok_or(Exit::Host)?;
        self.bus
            .write16(at.wrapping_add(2), (value >> 16) as u16)
            .ok_or(Exit::Host)
    }

    /// Whether every byte of a write is the core's to make, asked before any
    /// is made: a write split across memory the host answers for would
    /// otherwise be half made when the host takes the instruction, and an
    /// instruction that reads what it writes would read its own half.
    fn writable(&self, at: u32, size: u32) -> Result<(), Exit> {
        let last = at.wrapping_add(size - 1);

        if (at ^ last) & !0xffff != 0 && self.bus.read8(last).is_none() {
            return Err(Exit::Host);
        }

        Ok(())
    }

    fn fetch32(&mut self) -> Result<u32, Exit> {
        let low = self.fetch16()?;
        let high = self.fetch16()?;

        Ok(u32::from(low) | (u32::from(high) << 16))
    }

    fn reg32(&self, index: usize) -> u32 {
        u32::from(self.regs[index]) | (u32::from(self.high[index]) << 16)
    }

    fn set_reg32(&mut self, index: usize, value: u32) {
        self.regs[index] = value as u16;
        self.high[index] = (value >> 16) as u16;
    }

    fn get32(&self, place: Place) -> Result<u32, Exit> {
        match place {
            Place::Register(index) => Ok(self.reg32(index)),
            Place::Memory(segment, offset) => self.read32(segment, offset),
        }
    }

    fn set32(&mut self, place: Place, value: u32) -> Result<(), Exit> {
        match place {
            Place::Register(index) => {
                self.set_reg32(index, value);
                Ok(())
            }
            Place::Memory(segment, offset) => self.write32(segment, offset, value),
        }
    }

    /// A double word pushed on the 16-bit stack: SP alone moves, wrapping.
    fn push32(&mut self, value: u32) -> Result<(), Exit> {
        let sp = self.regs[SP].wrapping_sub(4);

        self.write32(SS, u32::from(sp), value)?;
        self.regs[SP] = sp;
        Ok(())
    }

    fn pop32(&mut self) -> Result<u32, Exit> {
        let sp = self.regs[SP];
        let value = self.read32(SS, u32::from(sp))?;

        self.regs[SP] = sp.wrapping_add(4);
        Ok(value)
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
                return Ok((reg, Place::Memory(self.data(), u32::from(offset))));
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
            Place::Memory(
                self.prefix.unwrap_or(segment),
                u32::from(base.wrapping_add(displacement)),
            ),
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
        let mask = ((1u64 << bits) - 1) as u32;
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
    /// `CMP` does not keep. Worked in 64 bits, for a 32-bit carry.
    fn alu(&mut self, op: Alu, a: u32, b: u32, bits: u32) -> u32 {
        let mask = (1u64 << bits) - 1;
        let sign = 1u64 << (bits - 1);
        let (a, b) = (u64::from(a), u64::from(b));
        let carry_in = u64::from(self.flags & CF != 0);

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

        self.szp(result as u32, bits);
        result as u32
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

    /// `INC` or `DEC` of `bits` bits: the ALU's flags, but carry left as
    /// it was.
    fn inc_dec(&mut self, value: u32, up: bool, bits: u32) -> u32 {
        let carry = self.flags & CF;
        let result = self.alu(if up { Alu::Add } else { Alu::Sub }, value, 1, bits);

        self.flags = (self.flags & !CF) | carry;
        result
    }

    /// The segment data is read through: DS, or the one a prefix names.
    fn data(&self) -> usize {
        self.prefix.unwrap_or(DS)
    }

    /// Whether the condition of a `Jcc`, by its low four bits, holds.
    fn condition(&self, code: u8) -> bool {
        let set = |flag: u16| self.flags & flag != 0;
        let holds = match code >> 1 {
            0 => set(OF),
            1 => set(CF),
            2 => set(ZF),
            3 => set(CF) || set(ZF),
            4 => set(SF),
            5 => set(PF),
            6 => set(SF) != set(OF),
            _ => set(ZF) || set(SF) != set(OF),
        };

        holds != (code & 1 != 0)
    }

    /// SI or DI moved past an element of `size` bytes, as DF says.
    fn advance(&mut self, index: usize, size: u16) {
        self.regs[index] = if self.flags & DF == 0 {
            self.regs[index].wrapping_add(size)
        } else {
            self.regs[index].wrapping_sub(size)
        };
    }

    /// A far call: CS and IP pushed, and the target taken. The target's
    /// descriptor is read first, so that a call this core leaves to the host
    /// has written nothing.
    fn call_far(&mut self, selector: u16, offset: u16) -> Result<(), Exit> {
        let segment = self.descriptor(CS, selector, false)?;

        self.push(self.segments[CS].selector)?;
        self.push(self.ip)?;
        self.ip = offset;
        self.set_segment(CS, segment);
        Ok(())
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

        // As the hardware vectors have them, and the JavaScript core: a count
        // past the width shifts everything out; AF follows the result's bit 4
        // for SHL and is set for SHR and SAR; OF is the sign against CF for
        // SHL, the old sign for a single SHR, and clear for SAR.
        let wide = u32::from(value);
        let (result, carry, overflow, auxiliary) = match kind {
            4 => {
                let result = if count < 16 {
                    (wide << count) & 0xffff
                } else {
                    0
                };
                let carry = count <= 16 && (wide >> (16 - count)) & 1 != 0;

                (
                    result,
                    carry,
                    (result & 0x8000 != 0) != carry,
                    result & 0x10 != 0,
                )
            }
            5 => (
                if count < 16 { wide >> count } else { 0 },
                count <= 16 && (wide >> (count - 1)) & 1 != 0,
                count == 1 && wide & 0x8000 != 0,
                true,
            ),
            7 => {
                let signed = i32::from(value as i16);

                (
                    (signed >> count.min(15)) as u32 & 0xffff,
                    (signed >> (count - 1).min(15)) & 1 != 0,
                    false,
                    true,
                )
            }
            _ => return None,
        };

        self.flags &= !(CF | OF | AF);

        for (set, flag) in [(carry, CF), (overflow, OF), (auxiliary, AF)] {
            if set {
                self.flags |= flag;
            }
        }

        self.szp(result, 16);
        Some(result as u16)
    }

    /// `F6`'s byte forms: TEST, NOT, NEG, MUL and IMUL into AX. MUL and
    /// IMUL leave SF, ZF and PF from the high half and AF set, as the
    /// hardware does.
    fn group3_byte(&mut self, reg: usize, place: Place) -> Result<(), Exit> {
        let value = self.get8(place)?;

        match reg {
            0 => {
                let immediate = self.fetch8()?;

                self.alu(Alu::And, u32::from(value), u32::from(immediate), 8);
            }
            2 => self.set8(place, !value)?,
            3 => {
                let r = self.alu(Alu::Sub, 0, u32::from(value), 8);

                self.flags = (self.flags & !CF) | if value != 0 { CF } else { 0 };
                self.set8(place, r as u8)?;
            }
            4 => {
                let product = u16::from(self.reg8(0)) * u16::from(value);

                self.wide_flags(product >> 8 != 0, u32::from(product >> 8), 8);
                self.regs[AX] = product;
            }
            5 => {
                let product = i16::from(self.reg8(0) as i8) * i16::from(value as i8);

                self.wide_flags(
                    i16::from(product as i8) != product,
                    u32::from(product as u16 >> 8),
                    8,
                );
                self.regs[AX] = product as u16;
            }
            _ => return Err(Exit::Unimplemented(0xf6)),
        }

        Ok(())
    }

    /// `F7`'s word forms, as [`Self::group3_byte`], into DX:AX.
    fn group3_word(&mut self, reg: usize, place: Place) -> Result<(), Exit> {
        let value = self.get16(place)?;

        match reg {
            0 => {
                let immediate = self.fetch16()?;

                self.alu(Alu::And, u32::from(value), u32::from(immediate), 16);
            }
            2 => self.set16(place, !value)?,
            3 => {
                let r = self.alu(Alu::Sub, 0, u32::from(value), 16);

                self.flags = (self.flags & !CF) | if value != 0 { CF } else { 0 };
                self.set16(place, r as u16)?;
            }
            4 => {
                let product = u32::from(self.regs[AX]) * u32::from(value);

                self.wide_flags(product >> 16 != 0, product >> 16, 16);
                self.regs[AX] = product as u16;
                self.regs[DX] = (product >> 16) as u16;
            }
            5 => {
                let product = i32::from(self.regs[AX] as i16) * i32::from(value as i16);

                self.regs[AX] = self.multiply_word(value, i32::from(self.regs[AX] as i16));
                self.regs[DX] = ((product as u32) >> 16) as u16;
            }
            _ => return Err(Exit::Unimplemented(0xf7)),
        }

        Ok(())
    }

    /// A signed word times a signed value, its flags set as `IMUL`'s: the
    /// low word of the product.
    fn multiply_word(&mut self, value: u16, by: i32) -> u16 {
        let product = i32::from(value as i16) * by;

        self.wide_flags(
            i32::from(product as i16) != product,
            (product as u32) >> 16,
            16,
        );
        product as u16
    }

    /// The two-byte opcodes, `0F` and one more: the near `Jcc`, `SETcc`, and
    /// `MOVZX` and `MOVSX` to a word; the rest stop the run.
    fn two_byte(&mut self) -> Result<(), Exit> {
        let opcode = self.fetch8()?;

        match opcode {
            0x80..=0x8f => {
                let displacement = self.fetch16()?;

                if self.condition(opcode & 0x0f) {
                    self.ip = self.ip.wrapping_add(displacement);
                }
            }
            0x90..=0x9f => {
                let (_, place) = self.modrm()?;

                self.set8(place, u8::from(self.condition(opcode & 0x0f)))?;
            }
            0xb6 | 0xbe => {
                let (reg, place) = self.modrm()?;
                let value = self.get8(place)?;

                self.regs[reg] = if opcode == 0xb6 {
                    u16::from(value)
                } else {
                    i16::from(value as i8) as u16
                };
            }
            // A word to a word register is a move.
            0xb7 | 0xbf => {
                let (reg, place) = self.modrm()?;

                self.regs[reg] = self.get16(place)?;
            }
            _ => return Err(Exit::Unimplemented(0x0f)),
        }

        Ok(())
    }

    /// A multiply's flags: CF and OF where the product is past the low half;
    /// SF, ZF and PF from the high half; AF set.
    fn wide_flags(&mut self, past: bool, high: u32, bits: u32) {
        self.flags &= !(CF | OF);

        if past {
            self.flags |= CF | OF;
        }

        self.szp(high, bits);
        self.flags |= AF;
    }

    /// `SHL`, `SHR` or `SAR` of a double word, as [`Self::shift`] of a word.
    fn shift32(&mut self, kind: usize, value: u32, count: u8) -> Option<u32> {
        let count = u32::from(count & 0x1f);

        if count == 0 {
            return Some(value);
        }

        let wide = u64::from(value);
        let (result, carry, overflow, auxiliary) = match kind {
            4 => {
                let result = (wide << count) & 0xffff_ffff;
                let carry = (wide >> (32 - count)) & 1 != 0;

                (
                    result,
                    carry,
                    (result & 0x8000_0000 != 0) != carry,
                    result & 0x10 != 0,
                )
            }
            5 => (
                wide >> count,
                (wide >> (count - 1)) & 1 != 0,
                count == 1 && wide & 0x8000_0000 != 0,
                true,
            ),
            7 => {
                let signed = i64::from(value as i32);

                (
                    (signed >> count) as u64 & 0xffff_ffff,
                    (signed >> (count - 1)) & 1 != 0,
                    false,
                    true,
                )
            }
            _ => return None,
        };

        self.flags &= !(CF | OF | AF);

        for (set, flag) in [(carry, CF), (overflow, OF), (auxiliary, AF)] {
            if set {
                self.flags |= flag;
            }
        }

        self.szp(result as u32, 32);
        Some(result as u32)
    }

    /// A 32-bit multiply's flags: CF and OF where the product is past the
    /// low half, and the rest left as they were.
    fn carry_overflow(&mut self, past: bool) {
        self.flags &= !(CF | OF);

        if past {
            self.flags |= CF | OF;
        }
    }

    /// A signed double word times another, as `IMUL` of two or three
    /// operands: the low double word, CF and OF where the product is past it.
    fn multiply_double(&mut self, value: u32, by: u32) -> u32 {
        let product = i64::from(value as i32) * i64::from(by as i32);

        self.carry_overflow(i64::from(product as i32) != product);
        product as u32
    }

    /// An instruction under the operand-size prefix: its double-word forms,
    /// as the JavaScript core runs them. Anything else stops the run.
    #[allow(clippy::too_many_lines)]
    fn step_wide(&mut self, opcode: u8) -> Result<(), Exit> {
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
            // LEA: the 16-bit offset, zero-extended.
            0x8d => match self.modrm()? {
                (reg, Place::Memory(_, offset)) => self.set_reg32(reg, offset),
                (_, Place::Register(_)) => return stop,
            },
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
            0xa1 => {
                let offset = self.fetch16()?;
                let value = self.read32(self.data(), u32::from(offset))?;

                self.set_reg32(AX, value);
            }
            0xa3 => {
                let offset = self.fetch16()?;

                self.write32(self.data(), u32::from(offset), self.reg32(AX))?;
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
                let Some(result) = self.shift32(kind, value, count) else {
                    return stop;
                };

                self.set32(place, result)?;
            }
            0xc7 => {
                let (reg, place) = self.modrm()?;

                if reg != 0 {
                    return stop;
                }

                let value = self.fetch32()?;

                self.set32(place, value)?;
            }
            0xf7 => {
                let (reg, place) = self.modrm()?;
                let value = self.get32(place)?;

                match reg {
                    0 => {
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
                    _ => return stop,
                }
            }
            0xff => {
                let (reg, place) = self.modrm()?;

                match reg {
                    0 | 1 => {
                        let r = self.inc_dec(self.get32(place)?, reg == 0, 32);

                        self.set32(place, r)?;
                    }
                    6 => {
                        let value = self.get32(place)?;

                        self.push32(value)?;
                    }
                    _ => return stop,
                }
            }
            0x0f => {
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
                    _ => return stop,
                }
            }
            _ => return stop,
        }

        Ok(())
    }

    /// Runs up to `budget` instructions: how many ran, and why it stopped.
    ///
    /// An instruction that stops the run is not counted and leaves nothing
    /// changed -- registers, flags and segments as they were, IP at its
    /// start -- so
    /// the host can run it whole. Memory it leaves as the host would find
    /// it: an instruction here writes memory last, and where it writes
    /// twice -- a far call's two pushes -- a second write that stops it
    /// leaves only the first, which the host writes again, the same.
    pub fn run(&mut self, budget: u64) -> (u64, Exit) {
        let mut ran = 0;

        while ran < budget {
            let (ip, regs, high, flags) = (self.ip, self.regs, self.high, self.flags);
            let (segments, loaded) = (self.segments, self.loaded);

            match self.step() {
                Ok(()) => ran += 1,
                Err(exit) => {
                    self.ip = ip;
                    self.regs = regs;
                    self.high = high;
                    self.flags = flags;
                    self.segments = segments;
                    self.loaded = loaded;
                    return (ran, exit);
                }
            }
        }

        (ran, Exit::Budget)
    }

    #[allow(clippy::too_many_lines)]
    fn step(&mut self) -> Result<(), Exit> {
        self.prefix = None;
        self.wide = false;

        let mut opcode = self.fetch8()?;

        // Segment and operand-size prefixes; any other stops the run.
        loop {
            match opcode {
                0x26 | 0x2e | 0x36 | 0x3e => self.prefix = Some(usize::from((opcode >> 3) & 3)),
                0x66 => self.wide = true,
                _ => break,
            }

            opcode = self.fetch8()?;
        }

        if self.wide {
            return self.step_wide(opcode);
        }

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
            0xc1 | 0xd1 | 0xd3 => {
                let (kind, place) = self.modrm()?;
                let count = match opcode {
                    0xc1 => self.fetch8()?,
                    0xd1 => 1,
                    _ => self.reg8(1),
                };
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
            0xea => {
                let offset = self.fetch16()?;
                let selector = self.fetch16()?;
                let segment = self.descriptor(CS, selector, false)?;

                self.ip = offset;
                self.set_segment(CS, segment);
            }
            0xeb => {
                let displacement = self.fetch8()? as i8;

                self.ip = self.ip.wrapping_add(i16::from(displacement) as u16);
            }
            // POP ES, SS and DS.
            0x07 | 0x17 | 0x1f => {
                let index = usize::from(opcode >> 3);
                let selector = self.read16(SS, u32::from(self.regs[SP]))?;
                let segment = self.descriptor(index, selector, false)?;

                self.regs[SP] = self.regs[SP].wrapping_add(2);
                self.set_segment(index, segment);
            }
            0x06 | 0x0e | 0x16 | 0x1e => {
                self.push(self.segments[usize::from(opcode >> 3)].selector)?;
            }
            0x0f => self.two_byte()?,
            0x68 => {
                let value = self.fetch16()?;

                self.push(value)?;
            }
            0x6a => {
                let value = i16::from(self.fetch8()? as i8) as u16;

                self.push(value)?;
            }
            // IMUL Gv, Ev, Iv and Ib: the low word kept, flags as F7 /5's.
            0x69 | 0x6b => {
                let (reg, place) = self.modrm()?;
                let value = self.get16(place)?;
                let immediate = if opcode == 0x69 {
                    i32::from(self.fetch16()? as i16)
                } else {
                    i32::from(self.fetch8()? as i8)
                };

                self.regs[reg] = self.multiply_word(value, immediate);
            }
            0x70..=0x7f => {
                let displacement = self.fetch8()? as i8;

                if self.condition(opcode & 0x0f) {
                    self.ip = self.ip.wrapping_add(i16::from(displacement) as u16);
                }
            }
            // The immediate group: Eb,Ib / Ev,Iv / Ev,Ib sign-extended.
            0x80 | 0x81 | 0x83 => {
                let (reg, place) = self.modrm()?;
                let op = Alu::from(reg as u8);

                if opcode == 0x80 {
                    let immediate = self.fetch8()?;
                    let r = self.alu(op, u32::from(self.get8(place)?), u32::from(immediate), 8);

                    if !matches!(op, Alu::Cmp) {
                        self.set8(place, r as u8)?;
                    }
                } else {
                    let immediate = if opcode == 0x81 {
                        self.fetch16()?
                    } else {
                        i16::from(self.fetch8()? as i8) as u16
                    };
                    let r = self.alu(op, u32::from(self.get16(place)?), u32::from(immediate), 16);

                    if !matches!(op, Alu::Cmp) {
                        self.set16(place, r as u16)?;
                    }
                }
            }
            0x84 => {
                let (reg, place) = self.modrm()?;

                self.alu(
                    Alu::And,
                    u32::from(self.get8(place)?),
                    u32::from(self.reg8(reg)),
                    8,
                );
            }
            0x85 => {
                let (reg, place) = self.modrm()?;

                self.alu(
                    Alu::And,
                    u32::from(self.get16(place)?),
                    u32::from(self.regs[reg]),
                    16,
                );
            }
            0x86 => {
                let (reg, place) = self.modrm()?;
                let value = self.get8(place)?;

                self.set8(place, self.reg8(reg))?;
                self.set_reg8(reg, value);
            }
            0x87 => {
                let (reg, place) = self.modrm()?;
                let value = self.get16(place)?;

                self.set16(place, self.regs[reg])?;
                self.regs[reg] = value;
            }
            // MOV Ev, Sreg: ES, CS, SS and DS; FS and GS the 286 does not have.
            0x8c => {
                let (reg, place) = self.modrm()?;

                if reg > DS {
                    return Err(Exit::Unimplemented(opcode));
                }

                self.set16(place, self.segments[reg].selector)?;
            }
            // LEA: the offset alone; a register operand is undefined.
            0x8d => match self.modrm()? {
                (reg, Place::Memory(_, offset)) => self.regs[reg] = offset as u16,
                (_, Place::Register(_)) => return Err(Exit::Unimplemented(opcode)),
            },
            // MOV Sreg, Ev: checked as the part checks it; CS, and registers
            // past GS, are not loaded so.
            0x8e => {
                let (reg, place) = self.modrm()?;

                if reg == CS || reg > GS {
                    return Err(Exit::Unimplemented(opcode));
                }

                let selector = self.get16(place)?;
                let segment = self.descriptor(reg, selector, true)?;

                self.set_segment(reg, segment);
            }
            0x91..=0x97 => {
                let index = usize::from(opcode & 7);

                self.regs.swap(AX, index);
            }
            0x98 => self.regs[AX] = i16::from(self.regs[AX] as u8 as i8) as u16,
            0x99 => {
                self.regs[DX] = if self.regs[AX] & 0x8000 != 0 {
                    0xffff
                } else {
                    0
                }
            }
            0x9a => {
                let offset = self.fetch16()?;
                let selector = self.fetch16()?;

                self.call_far(selector, offset)?;
            }
            0xa0 => {
                let offset = self.fetch16()?;
                let value = self.read8(self.data(), u32::from(offset))?;

                self.set_reg8(0, value);
            }
            0xa1 => {
                let offset = self.fetch16()?;

                self.regs[AX] = self.read16(self.data(), u32::from(offset))?;
            }
            0xa2 => {
                let offset = self.fetch16()?;

                self.write8(self.data(), u32::from(offset), self.reg8(0))?;
            }
            0xa3 => {
                let offset = self.fetch16()?;

                self.write16(self.data(), u32::from(offset), self.regs[AX])?;
            }
            // MOVS, STOS and LODS, once each; REP stops the run.
            0xa4 => {
                let value = self.read8(self.data(), u32::from(self.regs[SI]))?;

                self.write8(ES, u32::from(self.regs[DI]), value)?;
                self.advance(SI, 1);
                self.advance(DI, 1);
            }
            0xa5 => {
                let value = self.read16(self.data(), u32::from(self.regs[SI]))?;

                self.write16(ES, u32::from(self.regs[DI]), value)?;
                self.advance(SI, 2);
                self.advance(DI, 2);
            }
            0xa8 => {
                let immediate = self.fetch8()?;

                self.alu(Alu::And, u32::from(self.reg8(0)), u32::from(immediate), 8);
            }
            0xa9 => {
                let immediate = self.fetch16()?;

                self.alu(Alu::And, u32::from(self.regs[AX]), u32::from(immediate), 16);
            }
            0xaa => {
                self.write8(ES, u32::from(self.regs[DI]), self.reg8(0))?;
                self.advance(DI, 1);
            }
            0xab => {
                self.write16(ES, u32::from(self.regs[DI]), self.regs[AX])?;
                self.advance(DI, 2);
            }
            0xac => {
                let value = self.read8(self.data(), u32::from(self.regs[SI]))?;

                self.set_reg8(0, value);
                self.advance(SI, 1);
            }
            0xad => {
                self.regs[AX] = self.read16(self.data(), u32::from(self.regs[SI]))?;
                self.advance(SI, 2);
            }
            0xb0..=0xb7 => {
                let value = self.fetch8()?;

                self.set_reg8(usize::from(opcode & 7), value);
            }
            0xc2 | 0xc3 => {
                let release = if opcode == 0xc2 { self.fetch16()? } else { 0 };

                self.ip = self.pop()?;
                self.regs[SP] = self.regs[SP].wrapping_add(release);
            }
            // LES and LDS: a far pointer, from memory only.
            0xc4 | 0xc5 => {
                let (reg, place) = self.modrm()?;
                let Place::Memory(through, offset) = place else {
                    return Err(Exit::Unimplemented(opcode));
                };
                let index = if opcode == 0xc4 { ES } else { DS };
                let value = self.read16(through, offset)?;
                let selector = self.read16(through, (offset + 2) & 0xffff)?;
                let segment = self.descriptor(index, selector, false)?;

                self.regs[reg] = value;
                self.set_segment(index, segment);
            }
            0xc6 | 0xc7 => {
                let (reg, place) = self.modrm()?;

                if reg != 0 {
                    return Err(Exit::Unimplemented(opcode));
                }

                if opcode == 0xc6 {
                    let value = self.fetch8()?;

                    self.set8(place, value)?;
                } else {
                    let value = self.fetch16()?;

                    self.set16(place, value)?;
                }
            }
            0xc9 => {
                let frame = self.regs[BP];
                let value = self.read16(SS, u32::from(frame))?;

                self.regs[SP] = frame.wrapping_add(2);
                self.regs[BP] = value;
            }
            // RET far, and RET far releasing a count of bytes.
            0xca | 0xcb => {
                let release = if opcode == 0xca { self.fetch16()? } else { 0 };
                let sp = self.regs[SP];
                let offset = self.read16(SS, u32::from(sp))?;
                let selector = self.read16(SS, u32::from(sp.wrapping_add(2)))?;
                let segment = self.descriptor(CS, selector, false)?;

                self.regs[SP] = sp.wrapping_add(4).wrapping_add(release);
                self.ip = offset;
                self.set_segment(CS, segment);
            }
            0xe3 => {
                let displacement = self.fetch8()? as i8;

                if self.regs[CX] == 0 {
                    self.ip = self.ip.wrapping_add(i16::from(displacement) as u16);
                }
            }
            0xe8 => {
                let displacement = self.fetch16()?;

                self.push(self.ip)?;
                self.ip = self.ip.wrapping_add(displacement);
            }
            0xf5 => self.flags ^= CF,
            // TEST, NOT, NEG, MUL and IMUL; DIV and IDIV stop the run.
            0xf6 | 0xf7 => {
                let (reg, place) = self.modrm()?;

                if opcode == 0xf6 {
                    self.group3_byte(reg, place)?;
                } else {
                    self.group3_word(reg, place)?;
                }
            }
            0xf4 => return Err(Exit::Halt),
            0xf8 => self.flags &= !CF,
            0xf9 => self.flags |= CF,
            0xfc => self.flags &= !DF,
            0xfd => self.flags |= DF,
            0xfe => {
                let (reg, place) = self.modrm()?;

                if reg > 1 {
                    return Err(Exit::Unimplemented(opcode));
                }

                let r = self.inc_dec(u32::from(self.get8(place)?), reg == 0, 8);

                self.set8(place, r as u8)?;
            }
            // INC, DEC, near CALL and JMP, and PUSH; the far forms stop the run.
            0xff => {
                let (reg, place) = self.modrm()?;

                match reg {
                    0 | 1 => {
                        let r = self.inc_dec(u32::from(self.get16(place)?), reg == 0, 16);

                        self.set16(place, r as u16)?;
                    }
                    2 => {
                        let target = self.get16(place)?;

                        self.push(self.ip)?;
                        self.ip = target;
                    }
                    // CALL and JMP far, through a pointer in memory.
                    3 | 5 => {
                        let Place::Memory(through, at) = place else {
                            return Err(Exit::Unimplemented(opcode));
                        };
                        let offset = self.read16(through, at)?;
                        let selector = self.read16(through, (at + 2) & 0xffff)?;

                        if reg == 3 {
                            self.call_far(selector, offset)?;
                        } else {
                            let segment = self.descriptor(CS, selector, false)?;

                            self.ip = offset;
                            self.set_segment(CS, segment);
                        }
                    }
                    4 => self.ip = self.get16(place)?,
                    6 => {
                        let value = self.get16(place)?;

                        self.push(value)?;
                    }
                    _ => return Err(Exit::Unimplemented(opcode)),
                }
            }
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
        cpu.loaded = 0;
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
        assert_eq!(cpu.run(100), (0, Exit::Host));

        // mov ax, [bx] the same way, through ModR/M.
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

    #[test]
    fn calls_and_returns_far() {
        // call 1000h:0010h; hlt; ... at 0010h: retf
        let mut code = vec![0x9a, 0x10, 0x00, 0x00, 0x10, 0xf4];

        code.resize(0x10, 0x90);
        code.push(0xcb);

        let mut cpu = machine(&code);

        assert_eq!(cpu.run(100), (2, Exit::Halt));
        assert_eq!((cpu.segments[CS].selector, cpu.ip), (0x1000, 5));
        assert_eq!(cpu.regs[SP], 0xfffe);
        assert_eq!(cpu.loaded, 1 << CS);
    }

    #[test]
    fn loads_segments_from_the_local_table() {
        // les bx, [0]; mov ax, es:[bx]; hlt
        let mut cpu = machine(&[0xc4, 0x1e, 0x00, 0x00, 0x26, 0x8b, 0x07, 0xf4]);

        // A pointer to 000Fh:0004h through the LDT, its descriptor at 8:
        // base 21000h, limit FFh.
        cpu.bus.0[0x20000..0x20004].copy_from_slice(&[0x04, 0x00, 0x0f, 0x00]);
        cpu.bus.0[0x30008..0x30010].copy_from_slice(&[0xff, 0, 0x00, 0x10, 0x02, 0xf2, 0, 0]);
        cpu.bus.0[0x21004..0x21006].copy_from_slice(&[0x34, 0x12]);
        cpu.load_segment(DS, 0x2000).unwrap();
        cpu.protected = true;
        cpu.ldt_base = 0x30000;
        cpu.ldt_limit = 0x0f;
        // DS as real mode loaded it: base 20000h, as a descriptor would give.

        assert_eq!(cpu.run(100), (2, Exit::Halt));
        assert_eq!(cpu.segments[ES].base, 0x21000);
        assert_eq!(cpu.regs[AX], 0x1234);
    }

    #[test]
    fn leaves_unfit_loads_to_the_host() {
        // mov ss, ax with the null selector, in protected mode: #GP, the host's.
        let mut cpu = machine(&[0x8e, 0xd0, 0xf4]);

        cpu.protected = true;
        assert_eq!(cpu.run(100), (0, Exit::Host));
        assert_eq!(cpu.segments[SS].selector, 0x3000);

        // A selector past the table's end, by pop ds.
        let mut cpu = machine(&[0x1f, 0xf4]);

        cpu.protected = true;
        cpu.gdt_limit = 0x0f;
        cpu.regs[SP] = 0xfffc;
        cpu.bus.0[0x3fffc] = 0x18;
        assert_eq!(cpu.run(100), (0, Exit::Host));
        assert_eq!(cpu.regs[SP], 0xfffc);
    }

    #[test]
    fn adds_double_words_with_a_carry_out() {
        // mov eax, FFFFFFFFh; add eax, 1; hlt
        let mut cpu = machine(&[
            0x66, 0xb8, 0xff, 0xff, 0xff, 0xff, 0x66, 0x83, 0xc0, 0x01, 0xf4,
        ]);

        assert_eq!(cpu.run(100), (2, Exit::Halt));
        assert_eq!(cpu.reg32(AX), 0);
        assert_eq!(cpu.flags & (CF | ZF), CF | ZF);
    }

    #[test]
    fn pushes_and_pops_double_words() {
        // mov ebx, 12345678h; push ebx; pop ecx; movzx edx, bl; hlt
        let mut cpu = machine(&[
            0x66, 0xbb, 0x78, 0x56, 0x34, 0x12, 0x66, 0x53, 0x66, 0x59, 0x66, 0x0f, 0xb6, 0xd3,
            0xf4,
        ]);

        assert_eq!(cpu.run(100), (4, Exit::Halt));
        assert_eq!(cpu.reg32(CX), 0x1234_5678);
        assert_eq!(cpu.reg32(DX), 0x78);
        assert_eq!(cpu.regs[SP], 0xfffe);
    }
}
