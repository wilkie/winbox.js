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
    /// As many selectors loaded as [`Cpu::loads`] keeps, after the
    /// instruction that filled it.
    Loads,
}

/// How many selectors [`Cpu::loads`] keeps; a run stops when it is all but
/// full, an instruction loading two at most.
pub const LOADS: usize = 32;

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
const TF: u16 = 0x0100;
const DF: u16 = 0x0400;
const OF: u16 = 0x0800;

/// The bits of FLAGS the JavaScript core keeps, as it reads them back: the
/// arithmetic flags, TF, IF, DF, OF, IOPL and NT; bit 1 reads as one.
const FLAGS_KEPT: u16 = 0x7fd5;

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
// Each prefix state is its own yes or no, as the instruction gives it.
#[allow(clippy::struct_excessive_bools)]
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
    /// The selectors loaded into any segment register since this was last
    /// emptied, each once, the first [`Self::load_count`] of them: the host
    /// reads each one's descriptor afresh, as its own loads do, which a
    /// selector loaded and then replaced in the same run would otherwise
    /// miss.
    pub loads: [u16; LOADS],
    pub load_count: usize,
    pub bus: B,
    /// The segment a prefix names for this instruction's memory operand.
    prefix: Option<usize>,
    /// Whether the operand-size prefix makes this instruction's operands
    /// 32-bit.
    wide: bool,
    /// Whether the address-size prefix makes this instruction's addresses
    /// 32-bit.
    address32: bool,
    /// The repeat prefixes on this instruction: [`REPNE`], [`REPE`] or both.
    repeat: u8,
    /// Whether the instruction that stopped the run keeps what it did -- a
    /// repeated string instruction part of the way through.
    partial: bool,
}

/// The one-byte opcodes the operand-size prefix does not change, as the
/// JavaScript core lists them: byte operands, AL, short jumps, the flags,
/// and the loops, which the address size governs. Under the prefix they run
/// as without it.
const SIZELESS: [u8; 91] = [
    0x00, 0x02, 0x04, 0x08, 0x0a, 0x0c, 0x10, 0x12, 0x14, 0x18, 0x1a, 0x1c, 0x20, 0x22, 0x24, 0x27,
    0x28, 0x2a, 0x2c, 0x2f, 0x30, 0x32, 0x34, 0x37, 0x38, 0x3a, 0x3c, 0x3f, 0x63, 0x70, 0x71, 0x72,
    0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x7b, 0x7c, 0x7d, 0x7e, 0x7f, 0x80, 0x82, 0x84,
    0x86, 0x88, 0x8a, 0x9b, 0x9e, 0x9f, 0xa0, 0xa2, 0xa8, 0xb0, 0xb1, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6,
    0xb7, 0xc0, 0xc6, 0xd0, 0xd2, 0xd4, 0xd5, 0xd6, 0xd7, 0xe0, 0xe1, 0xe2, 0xe3, 0xe4, 0xe6, 0xeb,
    0xec, 0xee, 0xf5, 0xf6, 0xf8, 0xf9, 0xfa, 0xfb, 0xfc, 0xfd, 0xfe,
];

/// `F2`, the repeat prefix that stops a compare on equal.
const REPNE: u8 = 1;
/// `F3`, the repeat prefix that stops a compare on unequal.
const REPE: u8 = 2;

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
            loads: [0; LOADS],
            load_count: 0,
            bus,
            prefix: None,
            wide: false,
            address32: false,
            repeat: 0,
            partial: false,
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

        let loads = &self.loads[..self.load_count];

        if !loads.contains(&segment.selector) && self.load_count < LOADS {
            self.loads[self.load_count] = segment.selector;
            self.load_count += 1;
        }
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

        if u64::from(offset) + u64::from(size) > u64::from(cached.past_limit) {
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

    /// The next byte of the instruction. An instruction reaching the last
    /// byte of the offset space is the host's: what the part does past it,
    /// a fault or IP wrapping round, the JavaScript core decides.
    fn fetch8(&mut self) -> Result<u8, Exit> {
        if self.ip == 0xffff {
            return Err(Exit::Host);
        }

        let value = self.read8(CS, u32::from(self.ip))?;

        self.ip += 1;
        Ok(value)
    }

    /// The next word of the instruction, as [`Self::fetch8`].
    fn fetch16(&mut self) -> Result<u16, Exit> {
        if self.ip >= 0xfffe {
            return Err(Exit::Host);
        }

        let value = self.read16(CS, u32::from(self.ip))?;

        self.ip += 2;
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
    /// addressing: BP-based forms through SS, the rest through DS. Under the
    /// address-size prefix, [`Self::modrm32`]'s.
    fn modrm(&mut self) -> Result<(usize, Place), Exit> {
        let byte = self.fetch8()?;

        if self.address32 {
            return self.modrm32(byte);
        }

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

    /// A ModR/M byte with 32-bit addressing, as the JavaScript core reads
    /// it: a SIB byte for an r/m of 100b, whose base of 101b with a mode of
    /// nought is a displacement alone, and whose index of 100b scales the
    /// base instead (the 80386 suite's tests); EBP- and ESP-based forms
    /// through SS; the offset wrapping at 4 GiB.
    fn modrm32(&mut self, byte: u8) -> Result<(usize, Place), Exit> {
        let mode = byte >> 6;
        let reg = usize::from((byte >> 3) & 7);
        let rm = usize::from(byte & 7);

        if mode == 3 {
            return Ok((reg, Place::Register(rm)));
        }

        let (address, segment) = if rm == 4 {
            let sib = self.fetch8()?;
            let scale = u32::from(sib >> 6);
            let index = usize::from((sib >> 3) & 7);
            let base = usize::from(sib & 7);
            let (from, alone, segment) = if mode == 0 && base == 5 {
                (0, self.fetch32()?, DS)
            } else {
                let stack = base == SP || base == BP;

                (self.reg32(base), 0, if stack { SS } else { DS })
            };
            let scaled = if index == 4 {
                from << scale
            } else {
                (self.reg32(index) << scale).wrapping_add(from)
            };

            (scaled.wrapping_add(alone), segment)
        } else if mode == 0 && rm == 5 {
            let offset = self.fetch32()?;

            return Ok((reg, Place::Memory(self.data(), offset)));
        } else {
            (self.reg32(rm), if rm == BP { SS } else { DS })
        };
        let displacement = match mode {
            1 => i32::from(self.fetch8()? as i8) as u32,
            2 => self.fetch32()?,
            _ => 0,
        };

        Ok((
            reg,
            Place::Memory(
                self.prefix.unwrap_or(segment),
                address.wrapping_add(displacement),
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

    /// MOVS, CMPS, STOS, LODS and SCAS, of bytes, words or, under the
    /// operand-size prefix, double words, through SI and DI, or ESI and EDI
    /// under the address-size prefix. Repeated, CX or ECX counts them down
    /// to nought, and REPE and REPNE end a compare early.
    /// A repeat stopped part of the way keeps the elements done before, as
    /// the host's own does at a fault, and the host goes on from there.
    fn string(&mut self, opcode: u8) -> Result<(), Exit> {
        let size: u16 = if opcode & 1 == 0 {
            1
        } else if self.wide {
            4
        } else {
            2
        };
        let compares = matches!(opcode, 0xa6 | 0xa7 | 0xae | 0xaf);
        let mut first = true;

        while self.repeat == 0 || self.counter() != 0 {
            if let Err(exit) = self.element(opcode, size) {
                self.partial = !first;
                return Err(exit);
            }

            if self.repeat == 0 {
                break;
            }

            first = false;
            self.count_down();

            if compares && (self.flags & ZF != 0) == (self.repeat == REPNE) {
                break;
            }
        }

        Ok(())
    }

    /// One element of a string instruction, of `size` bytes: everything it
    /// reads read before it writes or moves SI and DI.
    fn element(&mut self, opcode: u8, size: u16) -> Result<(), Exit> {
        let (si, di) = (self.index(SI), self.index(DI));
        let bits = u32::from(size) * 8;

        match opcode {
            0xa4 | 0xa5 => {
                let value = self.load(self.data(), si, size)?;

                self.store(di, size, value)?;
                self.advance(SI, size);
            }
            0xa6 | 0xa7 => {
                let value = self.load(self.data(), si, size)?;
                let other = self.load(ES, di, size)?;

                self.alu(Alu::Cmp, value, other, bits);
                self.advance(SI, size);
            }
            0xaa | 0xab => self.store(di, size, self.accumulator(size))?,
            0xac | 0xad => {
                let value = self.load(self.data(), si, size)?;

                match size {
                    1 => self.set_reg8(0, value as u8),
                    2 => self.regs[AX] = value as u16,
                    _ => self.set_reg32(AX, value),
                }

                self.advance(SI, size);
                return Ok(());
            }
            _ => {
                let other = self.load(ES, di, size)?;

                self.alu(Alu::Cmp, self.accumulator(size), other, bits);
            }
        }

        self.advance(DI, size);
        Ok(())
    }

    /// AL, AX or EAX, by an element's size.
    fn accumulator(&self, size: u16) -> u32 {
        match size {
            1 => u32::from(self.reg8(0)),
            2 => u32::from(self.regs[AX]),
            _ => self.reg32(AX),
        }
    }

    /// An element read, by its size.
    fn load(&self, segment: usize, offset: u32, size: u16) -> Result<u32, Exit> {
        Ok(match size {
            1 => u32::from(self.read8(segment, offset)?),
            2 => u32::from(self.read16(segment, offset)?),
            _ => self.read32(segment, offset)?,
        })
    }

    /// An element written at ES:`offset`, by its size.
    fn store(&mut self, offset: u32, size: u16, value: u32) -> Result<(), Exit> {
        match size {
            1 => self.write8(ES, offset, value as u8),
            2 => self.write16(ES, offset, value as u16),
            _ => self.write32(ES, offset, value),
        }
    }

    /// SI or DI moved past an element of `size` bytes, as DF says: ESI or
    /// EDI under the address-size prefix.
    fn advance(&mut self, index: usize, size: u16) {
        let step = u32::from(size);

        if self.address32 {
            let value = self.reg32(index);

            self.set_reg32(
                index,
                if self.flags & DF == 0 {
                    value.wrapping_add(step)
                } else {
                    value.wrapping_sub(step)
                },
            );
        } else {
            self.regs[index] = if self.flags & DF == 0 {
                self.regs[index].wrapping_add(size)
            } else {
                self.regs[index].wrapping_sub(size)
            };
        }
    }

    /// An index register as an address: the whole of it under the
    /// address-size prefix, else its low word.
    fn index(&self, index: usize) -> u32 {
        if self.address32 {
            self.reg32(index)
        } else {
            u32::from(self.regs[index])
        }
    }

    /// The count a string or a loop runs on: ECX under the address-size
    /// prefix, else CX.
    fn counter(&self) -> u32 {
        self.index(CX)
    }

    /// [`Self::counter`] less one.
    fn count_down(&mut self) {
        if self.address32 {
            self.set_reg32(CX, self.reg32(CX).wrapping_sub(1));
        } else {
            self.regs[CX] = self.regs[CX].wrapping_sub(1);
        }
    }

    /// A moffs: 32 bits of offset under the address-size prefix, else 16.
    fn moffs(&mut self) -> Result<u32, Exit> {
        if self.address32 {
            self.fetch32()
        } else {
            Ok(u32::from(self.fetch16()?))
        }
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

    /// A rotate or shift of a value of `bits` bits by a count, by its kind
    /// as a `ModRM` reg field gives it -- `ROL`, `ROR`, `RCL`, `RCR`, `SHL`,
    /// `SHR`, `SHL` again and `SAR` -- with the flags the JavaScript core
    /// leaves, which are the hardware vectors'. A count of nought, after its
    /// mask to five bits, leaves the flags alone.
    fn shift(&mut self, kind: usize, value: u32, count: u8, bits: u32) -> u32 {
        let count = u32::from(count & 0x1f);

        if count == 0 {
            return value;
        }

        let mask = ((1u64 << bits) - 1) as u32;
        let top = 1u32 << (bits - 1);
        let value = value & mask;

        if kind < 4 {
            return self.rotate(kind, value, count, bits);
        }

        // A count past the width shifts everything out; a byte's carry then
        // comes from where a count a multiple of eight leaves it. AF follows
        // the result's bit 4 for SHL and is set for SHR and SAR; OF is the
        // sign against CF for SHL, the old sign for a single SHR, and clear
        // for SAR.
        let wide = u64::from(value);
        let (result, carry, overflow, auxiliary) = match kind {
            4 | 6 => {
                let result = if count < bits {
                    (value << count) & mask
                } else {
                    0
                };
                let carry = if count <= bits {
                    (wide >> (bits - count)) & 1 != 0
                } else {
                    bits == 8 && count % 8 == 0 && value & 1 != 0
                };

                (
                    result,
                    carry,
                    (result & top != 0) != carry,
                    result & 0x10 != 0,
                )
            }
            5 => {
                let carry = if count <= bits {
                    (wide >> (count - 1)) & 1 != 0
                } else {
                    bits == 8 && count % 8 == 0 && value & 0x80 != 0
                };

                (
                    if count < bits { value >> count } else { 0 },
                    carry,
                    count == 1 && value & top != 0,
                    true,
                )
            }
            _ => {
                let signed = i64::from(((value << (32 - bits)) as i32) >> (32 - bits));

                (
                    (signed >> count.min(bits - 1)) as u32 & mask,
                    (signed >> (count - 1).min(bits - 1)) & 1 != 0,
                    false,
                    true,
                )
            }
        };

        self.flags &= !(CF | OF | AF);

        for (set, flag) in [(carry, CF), (overflow, OF), (auxiliary, AF)] {
            if set {
                self.flags |= flag;
            }
        }

        self.szp(result, bits);
        result
    }

    /// `ROL`, `ROR`, `RCL` or `RCR`, for [`Self::shift`]: they write CF and
    /// OF alone, OF the top bit against CF leftwards and the top two bits
    /// against each other rightwards.
    fn rotate(&mut self, kind: usize, value: u32, count: u32, bits: u32) -> u32 {
        let mask = ((1u64 << bits) - 1) as u32;
        let top = 1u32 << (bits - 1);
        let mut carry = self.flags & CF != 0;
        let result = match kind {
            0 | 1 => {
                let amount = count % bits;
                let result = if amount == 0 {
                    value
                } else if kind == 0 {
                    ((value << amount) | (value >> (bits - amount))) & mask
                } else {
                    ((value >> amount) | (value << (bits - amount))) & mask
                };

                carry = if kind == 0 {
                    result & 1 != 0
                } else {
                    result & top != 0
                };
                result
            }
            _ => {
                let mut result = value;

                for _ in 0..count % (bits + 1) {
                    if kind == 2 {
                        let out = result & top != 0;

                        result = ((result << 1) & mask) | u32::from(carry);
                        carry = out;
                    } else {
                        let out = result & 1 != 0;

                        result = (result >> 1) | if carry { top } else { 0 };
                        carry = out;
                    }
                }

                result
            }
        };
        let overflow = if kind & 1 == 0 {
            (result & top != 0) != carry
        } else {
            (result & top != 0) != (result & (top >> 1) != 0)
        };

        self.flags &= !(CF | OF);

        for (set, flag) in [(carry, CF), (overflow, OF)] {
            if set {
                self.flags |= flag;
            }
        }

        result
    }

    /// `F6`'s byte forms: TEST, NOT, NEG, MUL and IMUL into AX, and DIV and
    /// IDIV of AX. MUL and IMUL leave SF, ZF and PF from the high half and AF
    /// set, as the hardware does; DIV and IDIV leave them from the remainder,
    /// with CF and OF from the compare their microcode ends on. A divide
    /// error stops the run.
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
            6 => {
                let (dividend, divisor) = (u32::from(self.regs[AX]), u32::from(value));

                // A divide error, nought or a quotient past a byte, is JS's.
                if dividend >= divisor << 8 {
                    return Err(Exit::Unimplemented(0xf6));
                }

                let remainder = dividend % divisor;
                let result = (remainder << 8) | ((dividend / divisor) & 0xff);
                // CF and OF are what the microcode's undo-and-compare leaves.
                let compared = if result & 1 != 0 {
                    (((result & !1) + (divisor << 8)) & 0xffff) >> 8
                } else {
                    remainder
                };

                self.wide_flags(compared < divisor, remainder, 8);
                self.regs[AX] = result as u16;
            }
            7 => {
                let ax = self.regs[AX];
                let magnitude = if value & 0x80 != 0 {
                    value.wrapping_neg()
                } else {
                    value
                };
                let ones = if ax & 0x8000 != 0 { !ax } else { ax };

                // The long way, with its -128 quirk and its errors, is JS's.
                if u32::from(ones) >= u32::from(magnitude) << 7 {
                    return Err(Exit::Unimplemented(0xf6));
                }

                let (dividend, divisor) = (i32::from(ax as i16), i32::from(value as i8));
                let remainder = (dividend % divisor) as u8;

                self.wide_flags(
                    i32::from(remainder as i8) < divisor,
                    u32::from(remainder),
                    8,
                );
                self.regs[AX] = (u16::from(remainder) << 8) | u16::from((dividend / divisor) as u8);
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
            6 => {
                let dividend = (u32::from(self.regs[DX]) << 16) | u32::from(self.regs[AX]);
                let divisor = u32::from(value);

                if u64::from(dividend) >= u64::from(divisor) << 16 {
                    return Err(Exit::Unimplemented(0xf7));
                }

                let quotient = (dividend / divisor) & 0xffff;
                let remainder = dividend % divisor;
                // As DIV of a byte, over DX:AX.
                let compared = if quotient & 1 != 0 {
                    ((quotient & !1) | (remainder << 16)).wrapping_add(divisor << 16) >> 16
                } else {
                    remainder
                };

                self.wide_flags(compared < divisor, remainder, 16);
                self.regs[AX] = quotient as u16;
                self.regs[DX] = remainder as u16;
            }
            7 => {
                let dxax = (u32::from(self.regs[DX]) << 16) | u32::from(self.regs[AX]);
                let magnitude = if value & 0x8000 != 0 {
                    value.wrapping_neg()
                } else {
                    value
                };
                let ones = if dxax & 0x8000_0000 != 0 { !dxax } else { dxax };

                if u64::from(ones) >= u64::from(magnitude) << 15 {
                    return Err(Exit::Unimplemented(0xf7));
                }

                let (dividend, divisor) = (i64::from(dxax as i32), i64::from(value as i16));
                let remainder = (dividend % divisor) as u16;

                self.wide_flags(
                    i64::from(remainder as i16) < divisor,
                    u32::from(remainder),
                    16,
                );
                self.regs[AX] = (dividend / divisor) as u16;
                self.regs[DX] = remainder;
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
            0xa3 | 0xab | 0xb3 | 0xbb | 0xba | 0xbc | 0xbd => self.bits(opcode)?,
            0xa4 | 0xa5 | 0xac | 0xad => self.double_shift(opcode)?,
            // LSS, LFS and LGS: a far pointer, from memory only, the segment
            // loaded as the JavaScript core loads one, unchecked.
            0xb2 | 0xb4 | 0xb5 => {
                let (reg, place) = self.modrm()?;
                let Place::Memory(through, offset) = place else {
                    return Err(Exit::Unimplemented(0x0f));
                };
                let value = self.read16(through, offset)?;
                let selector = self.read16(through, offset.wrapping_add(2))?;
                let index = match opcode {
                    0xb2 => SS,
                    0xb4 => FS,
                    _ => GS,
                };

                self.load_segment(index, selector)?;
                self.regs[reg] = value;
            }
            _ => return Err(Exit::Unimplemented(0x0f)),
        }

        Ok(())
    }

    /// The bit instructions, of a word or, under the operand-size prefix, a
    /// double word, as the JavaScript core runs them: BT, BTS, BTR and BTC
    /// test a bit into CF and leave it, set it, clear it or turn it over;
    /// BSF and BSR find the lowest or highest bit set, ZF set when there is
    /// none and the register then left. A bit number in a register reaches
    /// past a memory operand, signed, whole operands at a time; one given in
    /// the instruction is taken modulo the size. `BA`'s /0 to /3 are the
    /// host's.
    fn bits(&mut self, opcode: u8) -> Result<(), Exit> {
        let size: u32 = if self.wide { 32 } else { 16 };
        let (reg, mut place) = self.modrm()?;

        if matches!(opcode, 0xbc | 0xbd) {
            let value = self.get_sized(place, size)?;

            self.flags &= !ZF;

            if value == 0 {
                self.flags |= ZF;
            } else {
                let index = if opcode == 0xbc {
                    value.trailing_zeros()
                } else {
                    value.ilog2()
                };

                self.set_reg_sized(reg, index, size);
            }

            return Ok(());
        }

        let (kind, bit) = if opcode == 0xba {
            let immediate = self.fetch8()?;

            if reg < 4 {
                return Err(Exit::Unimplemented(0x0f));
            }

            (reg - 4, u32::from(immediate) & (size - 1))
        } else {
            let number = if size == 32 {
                self.reg32(reg) as i32
            } else {
                i32::from(self.regs[reg] as i16)
            };

            if let Place::Memory(segment, offset) = place {
                let step = number.div_euclid(size as i32) * (size as i32 / 8);
                let mask = if self.address32 { u32::MAX } else { 0xffff };

                place = Place::Memory(segment, offset.wrapping_add(step as u32) & mask);
            }

            let kind = match opcode {
                0xa3 => 0,
                0xab => 1,
                0xb3 => 2,
                _ => 3,
            };

            (kind, number as u32 & (size - 1))
        };
        let value = self.get_sized(place, size)?;
        let mask = 1u32 << bit;

        self.flags = (self.flags & !CF) | if value & mask != 0 { CF } else { 0 };

        let result = match kind {
            0 => return Ok(()),
            1 => value | mask,
            2 => value & !mask,
            _ => value ^ mask,
        };

        if size == 32 {
            self.set32(place, result)
        } else {
            self.set16(place, result as u16)
        }
    }

    /// SHLD and SHRD, of a word or, under the operand-size prefix, a double
    /// word, as the JavaScript core runs them: the destination and the source
    /// twice over shifted as one, so that a word's count past 16 goes on into
    /// the source again; a count of nought reads the operand and changes
    /// nothing. CF the last bit out, OF where the sign changed, AF left.
    fn double_shift(&mut self, opcode: u8) -> Result<(), Exit> {
        let size: u32 = if self.wide { 32 } else { 16 };
        let (reg, place) = self.modrm()?;
        let count = u32::from(if opcode & 1 == 0 {
            self.fetch8()?
        } else {
            self.reg8(1)
        }) & 0x1f;
        let destination = self.get_sized(place, size)?;

        if count == 0 {
            return Ok(());
        }

        let source = if size == 32 {
            self.reg32(reg)
        } else {
            u32::from(self.regs[reg])
        };
        let mask = (1u128 << size) - 1;
        let (destination, source) = (u128::from(destination), u128::from(source));
        let (result, carry) = if opcode <= 0xa5 {
            let triple = (destination << (size * 2)) | (source << size) | source;

            (
                ((triple << count) >> (size * 2)) & mask,
                (triple >> (size * 3 - count)) & 1 != 0,
            )
        } else {
            let triple = (source << (size * 2)) | (source << size) | destination;

            ((triple >> count) & mask, (triple >> (count - 1)) & 1 != 0)
        };
        let result = result as u32;
        let sign = 1u32 << (size - 1);

        if size == 32 {
            self.set32(place, result)?;
        } else {
            self.set16(place, result as u16)?;
        }

        self.flags &= !(CF | OF);

        if carry {
            self.flags |= CF;
        }

        if (result ^ destination as u32) & sign != 0 {
            self.flags |= OF;
        }

        self.szp(result, size);
        Ok(())
    }

    /// A word or double word operand, by its size in bits.
    fn get_sized(&self, place: Place, size: u32) -> Result<u32, Exit> {
        if size == 32 {
            self.get32(place)
        } else {
            self.get16(place).map(u32::from)
        }
    }

    /// A word or double word register written, by its size in bits.
    fn set_reg_sized(&mut self, reg: usize, value: u32, size: u32) {
        if size == 32 {
            self.set_reg32(reg, value);
        } else {
            self.regs[reg] = value as u16;
        }
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
                let offset = self.moffs()?;
                let value = self.read32(self.data(), offset)?;

                self.set_reg32(AX, value);
            }
            0xa3 => {
                let offset = self.moffs()?;

                self.write32(self.data(), offset, self.reg32(AX))?;
            }
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
                    // DIV and IDIV of EDX:EAX leave the flags alone; a divide
                    // error is JS's.
                    6 | 7 => {
                        let pair = (u64::from(self.reg32(DX)) << 32) | u64::from(self.reg32(AX));
                        let (dividend, divisor) = if reg == 7 {
                            (i128::from(pair as i64), i128::from(value as i32))
                        } else {
                            (i128::from(pair), i128::from(value))
                        };

                        if divisor == 0 {
                            return stop;
                        }

                        let quotient = dividend / divisor;
                        let fits = if reg == 7 {
                            i128::from(quotient as i32) == quotient
                        } else {
                            quotient <= 0xffff_ffff
                        };

                        if !fits {
                            return stop;
                        }

                        self.set_reg32(AX, quotient as u32);
                        self.set_reg32(DX, (dividend % divisor) as u32);
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
                    0xa3 | 0xab | 0xb3 | 0xbb | 0xba | 0xbc | 0xbd => self.bits(second)?,
                    0xa4 | 0xa5 | 0xac | 0xad => self.double_shift(second)?,
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
    /// start -- so the host can run it whole; but a repeated string
    /// instruction keeps the elements it got through, IP at its start, for
    /// the host to go on from. Memory it leaves as the host would find
    /// it: an instruction here writes memory last, and where it writes
    /// twice -- a far call's two pushes -- a second write that stops it
    /// leaves only the first, which the host writes again, the same.
    pub fn run(&mut self, budget: u64) -> (u64, Exit) {
        let mut ran = 0;

        while ran < budget {
            let (ip, regs, high, flags) = (self.ip, self.regs, self.high, self.flags);
            let (segments, loaded, load_count) = (self.segments, self.loaded, self.load_count);

            match self.step() {
                Ok(()) if self.load_count > LOADS - 2 => return (ran + 1, Exit::Loads),
                Ok(()) => ran += 1,
                Err(exit) if self.partial => {
                    self.partial = false;
                    self.ip = ip;
                    return (ran, exit);
                }
                Err(exit) => {
                    self.ip = ip;
                    self.regs = regs;
                    self.high = high;
                    self.flags = flags;
                    self.segments = segments;
                    self.loaded = loaded;
                    self.load_count = load_count;
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
        self.address32 = false;
        self.repeat = 0;

        let mut opcode = self.fetch8()?;

        // Segment, size and repeat prefixes; any other stops the run. A size
        // prefix given again changes nothing.
        loop {
            match opcode {
                0x26 | 0x2e | 0x36 | 0x3e => self.prefix = Some(usize::from((opcode >> 3) & 3)),
                0x64 => self.prefix = Some(FS),
                0x65 => self.prefix = Some(GS),
                0x66 => self.wide = true,
                0x67 => self.address32 = true,
                0xf2 => self.repeat |= REPNE,
                0xf3 => self.repeat |= REPE,
                _ => break,
            }

            opcode = self.fetch8()?;
        }

        // Under the address-size prefix, the far pointers read from memory
        // are the host's.
        if self.address32 && matches!(opcode, 0xc4 | 0xc5) {
            return Err(Exit::Unimplemented(0x67));
        }

        if self.wide && SIZELESS.contains(&opcode) {
            self.wide = false;
        }

        // The string instructions are the ones a repeat prefix belongs to;
        // both prefixes at once, the host's.
        if matches!(opcode, 0xa4..=0xa7 | 0xaa..=0xaf) && self.repeat != REPNE | REPE {
            return self.string(opcode);
        }

        if self.repeat != 0 {
            return Err(Exit::Unimplemented(opcode));
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
            0xc0 | 0xd0 | 0xd2 => {
                let (kind, place) = self.modrm()?;
                let count = match opcode {
                    0xc0 => self.fetch8()?,
                    0xd0 => 1,
                    _ => self.reg8(1),
                };
                let value = self.get8(place)?;
                let result = self.shift(kind, u32::from(value), count, 8);

                self.set8(place, result as u8)?;
            }
            0xc1 | 0xd1 | 0xd3 => {
                let (kind, place) = self.modrm()?;
                let count = match opcode {
                    0xc1 => self.fetch8()?,
                    0xd1 => 1,
                    _ => self.reg8(1),
                };
                let value = self.get16(place)?;
                let result = self.shift(kind, u32::from(value), count, 16);

                self.set16(place, result as u16)?;
            }
            // LOOPNE, LOOPE and LOOP, on CX or ECX by the address size.
            0xe0..=0xe2 => {
                let displacement = self.fetch8()? as i8;

                self.count_down();

                let zero = self.flags & ZF != 0;
                let more = self.counter() != 0
                    && match opcode {
                        0xe0 => !zero,
                        0xe1 => zero,
                        _ => true,
                    };

                if more {
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
                let offset = self.moffs()?;
                let value = self.read8(self.data(), offset)?;

                self.set_reg8(0, value);
            }
            0xa1 => {
                let offset = self.moffs()?;

                self.regs[AX] = self.read16(self.data(), offset)?;
            }
            0xa2 => {
                let offset = self.moffs()?;

                self.write8(self.data(), offset, self.reg8(0))?;
            }
            0xa3 => {
                let offset = self.moffs()?;

                self.write16(self.data(), offset, self.regs[AX])?;
            }
            // XLAT: AL from BX plus AL, or EBX plus AL under the address-size
            // prefix.
            0xd7 => {
                let offset = if self.address32 {
                    self.reg32(BX).wrapping_add(u32::from(self.reg8(0)))
                } else {
                    u32::from(self.regs[BX].wrapping_add(u16::from(self.reg8(0))))
                };
                let value = self.read8(self.data(), offset)?;

                self.set_reg8(0, value);
            }
            0xa8 => {
                let immediate = self.fetch8()?;

                self.alu(Alu::And, u32::from(self.reg8(0)), u32::from(immediate), 8);
            }
            0xa9 => {
                let immediate = self.fetch16()?;

                self.alu(Alu::And, u32::from(self.regs[AX]), u32::from(immediate), 16);
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
            // ENTER: the frame pointer pushed, the enclosing frames' pointers
            // copied -- all read before anything is pushed -- the new frame's
            // pointer, and room for the locals.
            0xc8 => {
                let locals = self.fetch16()?;
                let level = self.fetch8()? & 0x1f;
                let base = self.regs[BP];
                let mut displays = [0u16; 32];

                for display in 1..level {
                    let at = base.wrapping_sub(u16::from(display) * 2);

                    displays[usize::from(display)] = self.read16(SS, u32::from(at))?;
                }

                let mut top = self.regs[SP].wrapping_sub(2);

                self.write16(SS, u32::from(top), base)?;

                let frame = top;

                for display in 1..level {
                    top = top.wrapping_sub(2);
                    self.write16(SS, u32::from(top), displays[usize::from(display)])?;
                }

                if level > 0 {
                    top = top.wrapping_sub(2);
                    self.write16(SS, u32::from(top), frame)?;
                }

                self.regs[BP] = frame;
                self.regs[SP] = top.wrapping_sub(locals);
            }
            0x9c => self.push((self.flags & FLAGS_KEPT) | 0x0002)?,
            // POPF, as the JavaScript core's 386 loads FLAGS at privilege
            // nought: every flag in protected mode, and IOPL, NT and bit 15
            // cleared in real mode. One that sets or clears the trap flag is
            // the host's, which single-steps.
            0x9d => {
                let mut value = self.read16(SS, u32::from(self.regs[SP]))?;

                if !self.protected {
                    value &= 0x0fff;
                }

                if (value ^ self.flags) & TF != 0 {
                    return Err(Exit::Unimplemented(opcode));
                }

                self.regs[SP] = self.regs[SP].wrapping_add(2);
                self.flags = (value & FLAGS_KEPT) | 0x0002;
            }
            // POP to memory or a register: the value read, and the stack
            // moved first to a register -- POP SP takes the value -- and last
            // to memory, so a destination that faults leaves it as it was.
            0x8f => {
                let (reg, place) = self.modrm()?;

                if reg != 0 || self.address32 {
                    return Err(Exit::Unimplemented(opcode));
                }

                let sp = self.regs[SP];
                let value = self.read16(SS, u32::from(sp))?;

                if let Place::Register(_) = place {
                    self.regs[SP] = sp.wrapping_add(2);
                    self.set16(place, value)?;
                } else {
                    self.set16(place, value)?;
                    self.regs[SP] = sp.wrapping_add(2);
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

                if self.counter() == 0 {
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

                        if self.address32 {
                            return Err(Exit::Unimplemented(0x67));
                        }

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
        cpu.load_count = 0;
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
    fn divides_with_the_flags_the_microcode_leaves() {
        // mov ax, 1000; mov bl, 7; div bl; mov ax, -100; idiv bl; hlt
        let mut cpu = machine(&[
            0xb8, 0xe8, 0x03, 0xb3, 0x07, 0xf6, 0xf3, 0xf4, 0xb8, 0x9c, 0xff, 0xf6, 0xfb, 0xf4,
        ]);

        assert_eq!(cpu.run(100), (3, Exit::Halt));
        assert_eq!(cpu.regs[AX], 0x068e);
        assert_eq!(cpu.flags & (CF | OF | ZF | SF | AF), CF | OF | AF);

        cpu.ip += 1;
        assert_eq!(cpu.run(100), (2, Exit::Halt));
        assert_eq!(cpu.regs[AX], 0xfef2);
        assert_eq!(cpu.flags & (CF | SF | ZF | PF | AF), CF | SF | AF);
    }

    #[test]
    fn divides_double_words_without_flags() {
        // mov edx, 1; xor eax, eax; mov ecx, 3; div ecx;
        // mov edx, -1; mov eax, -100; mov ecx, 7; idiv ecx; hlt
        let mut cpu = machine(&[
            0x66, 0xba, 0x01, 0, 0, 0, 0x66, 0x31, 0xc0, 0x66, 0xb9, 0x03, 0, 0, 0, 0x66, 0xf7,
            0xf1, 0x66, 0xba, 0xff, 0xff, 0xff, 0xff, 0x66, 0xb8, 0x9c, 0xff, 0xff, 0xff, 0x66,
            0xb9, 0x07, 0, 0, 0, 0x66, 0xf7, 0xf9, 0xf4,
        ]);

        cpu.run(4);
        assert_eq!((cpu.reg32(AX), cpu.reg32(DX)), (0x5555_5555, 1));
        assert_eq!(cpu.flags & (ZF | PF), ZF | PF);

        assert_eq!(cpu.run(100), (4, Exit::Halt));
        assert_eq!((cpu.reg32(AX), cpu.reg32(DX)), (0xffff_fff2, 0xffff_fffe));
    }

    #[test]
    fn leaves_a_divide_error_to_the_host() {
        // mov ax, 1000; mov bl, 3; div bl
        let mut cpu = machine(&[0xb8, 0xe8, 0x03, 0xb3, 0x03, 0xf6, 0xf3]);

        assert_eq!(cpu.run(100), (2, Exit::Unimplemented(0xf6)));
        assert_eq!((cpu.ip, cpu.regs[AX]), (5, 1000));
    }

    #[test]
    fn repeats_string_moves_and_compares() {
        // mov cx, 4; mov di, 100h; xor si, si; rep movsb; hlt
        let mut cpu = machine(&[
            0xb9, 0x04, 0x00, 0xbf, 0x00, 0x01, 0x31, 0xf6, 0xf3, 0xa4, 0xf4,
        ]);

        cpu.bus.0[0x20000..0x20004].copy_from_slice(&[1, 2, 3, 4]);
        assert_eq!(cpu.run(100), (4, Exit::Halt));
        assert_eq!(&cpu.bus.0[0x20100..0x20104], &[1, 2, 3, 4]);
        assert_eq!((cpu.regs[CX], cpu.regs[SI], cpu.regs[DI]), (0, 4, 0x104));

        // The same with repe cmpsb, against 1, 2, 9, 4: unequal at the third.
        cpu.bus.0[0x20102] = 9;
        cpu.bus.0[0x10009] = 0xa6;
        cpu.ip = 0;
        assert_eq!(cpu.run(100), (4, Exit::Halt));
        assert_eq!((cpu.regs[CX], cpu.regs[SI], cpu.regs[DI]), (1, 3, 0x103));
        assert_eq!(cpu.flags & (CF | ZF), CF);
    }

    #[test]
    fn repeats_a_scan_until_it_finds() {
        // mov al, 3; mov cx, 4; xor di, di; repne scasb; hlt
        let mut cpu = machine(&[0xb0, 0x03, 0xb9, 0x04, 0x00, 0x31, 0xff, 0xf2, 0xae, 0xf4]);

        cpu.bus.0[0x20000..0x20004].copy_from_slice(&[1, 2, 3, 4]);
        assert_eq!(cpu.run(100), (4, Exit::Halt));
        assert_eq!((cpu.regs[CX], cpu.regs[DI], cpu.flags & ZF), (1, 3, ZF));
    }

    #[test]
    fn repeats_double_word_stores() {
        // mov eax, 11223344h; mov cx, 2; xor di, di; rep stosd; hlt
        let mut cpu = machine(&[
            0x66, 0xb8, 0x44, 0x33, 0x22, 0x11, 0xb9, 0x02, 0x00, 0x31, 0xff, 0xf3, 0x66, 0xab,
            0xf4,
        ]);

        assert_eq!(cpu.run(100), (4, Exit::Halt));
        assert_eq!(
            &cpu.bus.0[0x20000..0x20008],
            &[0x44, 0x33, 0x22, 0x11, 0x44, 0x33, 0x22, 0x11]
        );
        assert_eq!((cpu.regs[CX], cpu.regs[DI]), (0, 8));
    }

    #[test]
    fn keeps_what_a_repeat_did_before_it_stopped() {
        // mov cx, 4; xor di, di; mov al, 7; rep stosb -- past ES's limit at 2
        let mut cpu = machine(&[0xb9, 0x04, 0x00, 0x31, 0xff, 0xb0, 0x07, 0xf3, 0xaa]);

        cpu.segments[ES].past_limit = 2;
        assert_eq!(cpu.run(100), (3, Exit::Fault(13)));
        assert_eq!(&cpu.bus.0[0x20000..0x20003], &[7, 7, 0]);
        assert_eq!((cpu.ip, cpu.regs[CX], cpu.regs[DI]), (7, 2, 2));
    }

    #[test]
    fn rotates_and_shifts_bytes() {
        // mov al, 81h; rol al, 1; stc; mov bl, 1; rcr bl, 1;
        // mov cl, 16; mov dl, 1; shl dl, cl; hlt
        let mut cpu = machine(&[
            0xb0, 0x81, 0xd0, 0xc0, 0xf9, 0xb3, 0x01, 0xd0, 0xdb, 0xb1, 0x10, 0xb2, 0x01, 0xd2,
            0xe2, 0xf4,
        ]);

        cpu.run(2);
        assert_eq!((cpu.reg8(0), cpu.flags & (CF | OF)), (0x03, CF | OF));

        cpu.run(3);
        assert_eq!((cpu.reg8(3), cpu.flags & (CF | OF)), (0x80, CF | OF));

        // Sixteen places out of a byte: CF is bit 0, where a multiple of
        // eight leaves it.
        assert_eq!(cpu.run(100), (3, Exit::Halt));
        assert_eq!((cpu.reg8(2), cpu.flags & (CF | OF | ZF)), (0, CF | OF | ZF));
    }

    #[test]
    fn addresses_through_32_bit_registers() {
        // mov ecx, 2; mov ax, [ecx*4+100h]; mov bx, 10h; mov dx, [ebx*2]
        // (index 100b: the base scaled); mov bp, 8; mov si, [ebp+4]; hlt
        let mut cpu = machine(&[
            0x66, 0xb9, 0x02, 0, 0, 0, 0x67, 0x8b, 0x04, 0x8d, 0x00, 0x01, 0, 0, 0xbb, 0x10, 0x00,
            0x67, 0x8b, 0x14, 0x63, 0xbd, 0x08, 0x00, 0x67, 0x8b, 0x75, 0x04, 0xf4,
        ]);

        cpu.bus.0[0x20108..0x2010a].copy_from_slice(&[0x34, 0x12]);
        cpu.bus.0[0x20020..0x20022].copy_from_slice(&[0x78, 0x56]);
        cpu.bus.0[0x3000c..0x3000e].copy_from_slice(&[0xbc, 0x9a]);
        assert_eq!(cpu.run(100), (6, Exit::Halt));
        assert_eq!(
            (cpu.regs[AX], cpu.regs[DX], cpu.regs[SI]),
            (0x1234, 0x5678, 0x9abc)
        );
    }

    #[test]
    fn wraps_a_32_bit_address_past_the_limit() {
        // mov ax, [eax-1]: offset FFFFFFFFh, past DS's limit
        let mut cpu = machine(&[0x67, 0x8b, 0x40, 0xff]);

        assert_eq!(cpu.run(100), (0, Exit::Fault(13)));
        assert_eq!(cpu.ip, 0);
    }

    #[test]
    fn keeps_every_selector_loaded() {
        // mov ax, 1234h; mov es, ax; mov ax, 2345h; mov es, ax; mov ds, ax; hlt
        let mut cpu = machine(&[
            0xb8, 0x34, 0x12, 0x8e, 0xc0, 0xb8, 0x45, 0x23, 0x8e, 0xc0, 0x8e, 0xd8, 0xf4,
        ]);

        assert_eq!(cpu.run(100), (5, Exit::Halt));
        assert_eq!(&cpu.loads[..cpu.load_count], &[0x1234, 0x2345]);
        assert_eq!(cpu.loaded, (1 << ES) | (1 << DS));
    }

    #[test]
    fn takes_a_size_prefix_given_again_as_once() {
        // mov eax, 12345678h with 66h twice; hlt
        let mut cpu = machine(&[0x66, 0x66, 0xb8, 0x78, 0x56, 0x34, 0x12, 0xf4]);

        assert_eq!(cpu.run(100), (1, Exit::Halt));
        assert_eq!(cpu.reg32(AX), 0x1234_5678);
    }

    #[test]
    fn repeats_through_32_bit_registers() {
        // mov ecx, 3; mov esi, 0; mov edi, 100h; rep movsb (67h); hlt
        let mut cpu = machine(&[
            0x66, 0xb9, 0x03, 0, 0, 0, 0x66, 0x31, 0xf6, 0x66, 0xbf, 0x00, 0x01, 0, 0, 0xf3, 0x67,
            0xa4, 0xf4,
        ]);

        cpu.bus.0[0x20000..0x20003].copy_from_slice(&[7, 8, 9]);
        assert_eq!(cpu.run(100), (4, Exit::Halt));
        assert_eq!(&cpu.bus.0[0x20100..0x20103], &[7, 8, 9]);
        assert_eq!((cpu.reg32(CX), cpu.reg32(SI), cpu.reg32(DI)), (0, 3, 0x103));
    }

    #[test]
    fn translates_and_loops() {
        // mov bx, 10h; mov al, 2; xlat; mov ecx, 10002h; loop $ (67h);
        // hlt -- ECX counted down whole, not CX
        let mut cpu = machine(&[
            0xbb, 0x10, 0x00, 0xb0, 0x02, 0xd7, 0x66, 0xb9, 0x02, 0x00, 0x01, 0x00, 0x67, 0xe2,
            0xfd, 0xf4,
        ]);

        cpu.bus.0[0x20012] = 0x5a;
        cpu.run(3);
        assert_eq!(cpu.reg8(0), 0x5a);

        assert_eq!(cpu.run(0x20000), (0x10003, Exit::Halt));
        assert_eq!(cpu.reg32(CX), 0);
    }

    #[test]
    fn tests_and_finds_bits() {
        // mov ax, 8; bts ax, 1; bsf dx, ax; bt ax, 4; nop (66h); hlt
        let mut cpu = machine(&[
            0xb8, 0x08, 0x00, 0x0f, 0xba, 0xe8, 0x01, 0x0f, 0xbc, 0xd0, 0x0f, 0xba, 0xe0, 0x04,
            0x66, 0x90, 0xf4,
        ]);

        assert_eq!(cpu.run(100), (5, Exit::Halt));
        assert_eq!((cpu.regs[AX], cpu.regs[DX]), (0x0a, 1));
        assert_eq!(cpu.flags & (CF | ZF), 0);
    }

    #[test]
    fn reaches_through_fs_and_gs() {
        // mov al, 1; xlat through GS; hlt
        let mut cpu = machine(&[0xb0, 0x01, 0x65, 0xd7, 0xf4]);

        cpu.load_segment(GS, 0x3000).unwrap();
        cpu.bus.0[0x30001] = 0x77;
        assert_eq!(cpu.run(100), (2, Exit::Halt));
        assert_eq!(cpu.reg8(0), 0x77);
    }

    #[test]
    fn pushes_and_pops_flags() {
        // stc; pushf; clc; popf; hlt
        let mut cpu = machine(&[0xf9, 0x9c, 0xf8, 0x9d, 0xf4]);

        assert_eq!(cpu.run(100), (4, Exit::Halt));
        assert_eq!(cpu.flags & CF, CF);
        assert_eq!(cpu.regs[SP], 0xfffe);

        // mov ax, 100h; push ax; popf -- the trap flag set: the host's
        let mut cpu = machine(&[0xb8, 0x00, 0x01, 0x50, 0x9d]);

        assert_eq!(cpu.run(100), (2, Exit::Unimplemented(0x9d)));
    }

    #[test]
    fn enters_a_nested_frame() {
        // mov bp, 1234h; enter 8, 2; hlt
        let mut cpu = machine(&[0xbd, 0x34, 0x12, 0xc8, 0x08, 0x00, 0x02, 0xf4]);

        cpu.bus.0[0x31232..0x31234].copy_from_slice(&[0xcd, 0xab]);
        assert_eq!(cpu.run(100), (2, Exit::Halt));
        // BP pushed at FFFC, the enclosing frame's FFFA, the new frame's FFF8.
        assert_eq!(&cpu.bus.0[0x3fffa..0x3fffe], &[0xcd, 0xab, 0x34, 0x12]);
        assert_eq!(&cpu.bus.0[0x3fff8..0x3fffa], &[0xfc, 0xff]);
        assert_eq!((cpu.regs[BP], cpu.regs[SP]), (0xfffc, 0xfff0));
    }

    #[test]
    fn pops_to_memory_and_loads_far_pointers() {
        // mov ax, 5678h; push ax; pop word [10h]; lfs bx, [20h]; hlt
        let mut cpu = machine(&[
            0xb8, 0x78, 0x56, 0x50, 0x8f, 0x06, 0x10, 0x00, 0x0f, 0xb4, 0x1e, 0x20, 0x00, 0xf4,
        ]);

        cpu.bus.0[0x20020..0x20024].copy_from_slice(&[0x11, 0x22, 0x00, 0x30]);
        assert_eq!(cpu.run(100), (4, Exit::Halt));
        assert_eq!(&cpu.bus.0[0x20010..0x20012], &[0x78, 0x56]);
        assert_eq!(cpu.regs[SP], 0xfffe);
        assert_eq!((cpu.regs[BX], cpu.segments[FS].base), (0x2211, 0x30000));
    }

    #[test]
    fn shifts_double() {
        // mov ax, 1234h; mov dx, 0ABCDh; shld ax, dx, 4; shrd ax, dx, 4; hlt
        let mut cpu = machine(&[
            0xb8, 0x34, 0x12, 0xba, 0xcd, 0xab, 0x0f, 0xa4, 0xd0, 0x04, 0x0f, 0xac, 0xd0, 0x04,
            0xf4,
        ]);

        cpu.run(3);
        assert_eq!(cpu.regs[AX], 0x234a);
        assert_eq!(cpu.run(100), (1, Exit::Halt));
        assert_eq!(cpu.regs[AX], 0xd234);
        // The last bit out, bit 3 of 234Ah, set; the sign changed.
        assert_eq!(cpu.flags & (CF | SF | OF), CF | SF | OF);
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
