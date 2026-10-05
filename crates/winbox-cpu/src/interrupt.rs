//! Faults and interrupts, and the instructions that raise and return from
//! them, as the JavaScript core has them (`I286.raiseInterrupt`).
//!
//! In real mode, where the host lets this core take them
//! ([`Cpu::interrupt_table`]), an interrupt is dispatched as the part
//! dispatches it: FLAGS, CS and the return IP pushed, IF and TF cleared, and
//! CS:IP from the table's four-byte entry -- a fault returning to its
//! instruction's start, a trap (`INT`, `INT 3`, `INTO`) to the instruction
//! after. Otherwise a fault stops the run, the instruction undone
//! ([`Exit::Fault`]), and an interrupt the run as its opcode
//! ([`Exit::Unimplemented`]), for the host, which in protected mode takes
//! every one of them.

use crate::{BP, Bus, CS, Cpu, Exit, FLAGS_KEPT, IF, Place, SP, SS, TF};

impl<B: Bus> Cpu<B> {
    /// Whether this core takes interrupts itself: in real mode, given the
    /// table.
    pub(crate) fn takes_interrupts(&self) -> bool {
        self.interrupt_table.is_some() && !self.protected
    }

    /// FLAGS as it is pushed and read: the bits the JavaScript core keeps,
    /// bit 1 set.
    pub(crate) fn flags_word(&self) -> u16 {
        (self.flags & FLAGS_KEPT) | 0x0002
    }

    /// FLAGS loaded from a word popped, as `loadFlags` loads it at privilege
    /// nought: every flag in protected mode; IOPL, NT and bit 15 cleared in
    /// real mode, as the 80286 vectors have it. The trap flag is a flag like
    /// any other: the JavaScript core does not single-step.
    pub(crate) fn load_flags(&mut self, value: u16) {
        let value = if self.protected {
            value
        } else {
            value & 0x0fff
        };

        self.flags = (value & FLAGS_KEPT) | 0x0002;
    }

    /// A fault the instruction raises, by vector: dispatched from the
    /// instruction's start, with what it has done to the flags -- a divide
    /// error's -- where this core takes interrupts; else the run stops.
    pub(crate) fn fault(&mut self, vector: u8) -> Result<(), Exit> {
        if self.takes_interrupts() {
            self.dispatch(vector, self.start)
        } else {
            Err(Exit::Fault(vector))
        }
    }

    /// The interrupt of `INT`, `INT 3` or `INTO`, a trap: dispatched to
    /// return after the instruction, or the run stopped as `opcode`.
    fn trap(&mut self, vector: u8, opcode: u8) -> Result<(), Exit> {
        if self.takes_interrupts() {
            self.dispatch(vector, self.ip)
        } else {
            Err(Exit::Unimplemented(opcode))
        }
    }

    /// An interrupt dispatched through the real-mode table, returning to
    /// `to` in the present CS. Nothing is written unless every push can be:
    /// a push that cannot is the fault the run stops with.
    pub(crate) fn dispatch(&mut self, vector: u8, to: u16) -> Result<(), Exit> {
        let table = self.interrupt_table.ok_or(Exit::Fault(vector))?;
        let entry = table.wrapping_add(u32::from(vector) * 4);
        let offset = self.bus.read16(entry).ok_or(Exit::Host)?;
        let selector = self.bus.read16(entry.wrapping_add(2)).ok_or(Exit::Host)?;
        let words = [self.flags_word(), self.segments[CS].selector, to];
        let sp = self.regs[SP];

        for at in 1..=3u16 {
            let place = self.linear(SS, u32::from(sp.wrapping_sub(2 * at)), 2)?;

            self.writable(place, 2)?;
        }

        for (at, word) in (1..=3u16).zip(words) {
            self.write16(SS, u32::from(sp.wrapping_sub(2 * at)), word)?;
        }

        self.regs[SP] = sp.wrapping_sub(6);
        self.flags &= !(IF | TF);
        self.ip = offset;
        self.load_segment(CS, selector)
    }

    /// `INT 3`.
    pub(crate) fn breakpoint(&mut self) -> Result<(), Exit> {
        self.trap(3, 0xcc)
    }

    /// `INT n`: a call to a thunk this core answers (`quick.rs`) at `INT
    /// 80h`, or the interrupt.
    pub(crate) fn interrupt(&mut self, start: u16) -> Result<(), Exit> {
        let vector = self.fetch8()?;

        if vector == 0x80 && self.quick.enabled {
            return self.quick_call(u32::from(start), self.retired);
        }

        self.trap(vector, 0xcd)
    }

    /// `INTO`: interrupt 4 if OF is set.
    pub(crate) fn interrupt_on_overflow(&mut self) -> Result<(), Exit> {
        if self.flags & crate::OF != 0 {
            return self.trap(4, 0xce);
        }

        Ok(())
    }

    /// `IRET`, and under the operand-size prefix `IRETD`: IP, CS and FLAGS
    /// popped, each read before any is taken, CS loaded unchecked and FLAGS
    /// as `loadFlags` loads them. `IRETD` reads double words, of which CS
    /// and FLAGS are their low words, and an EIP past 64 KiB is a general
    /// protection fault with the stack as it was.
    pub(crate) fn iret(&mut self, wide: bool) -> Result<(), Exit> {
        let top = self.regs[SP];
        let step: u16 = if wide { 4 } else { 2 };
        let read = |cpu: &Self, at: u16| -> Result<u32, Exit> {
            let offset = u32::from(top.wrapping_add(at * step));

            if wide {
                cpu.read32(SS, offset)
            } else {
                cpu.read16(SS, offset).map(u32::from)
            }
        };
        let ip = read(self, 0)?;
        let selector = read(self, 1)? as u16;
        let flags = read(self, 2)? as u16;

        if ip > 0xffff {
            return self.fault(13);
        }

        let segment = self.descriptor(CS, selector, false)?;

        self.regs[SP] = top.wrapping_add(3 * step);
        self.ip = ip as u16;
        self.set_segment(CS, segment);
        self.load_flags(flags);
        Ok(())
    }

    /// `BOUND`: a signed index against a pair of bounds in memory, words or,
    /// under the operand-size prefix, double words; outside them, the bound
    /// range exception, 5. A register for the bounds is an undefined opcode.
    pub(crate) fn bound(&mut self) -> Result<(), Exit> {
        let (reg, place) = self.modrm()?;
        let Place::Memory(segment, offset) = place else {
            return self.fault(6);
        };
        let (index, lower, upper) = if self.wide {
            (
                self.reg32(reg) as i32,
                self.read32(segment, offset)? as i32,
                self.read32(segment, offset.wrapping_add(4))? as i32,
            )
        } else {
            (
                i32::from(self.regs[reg] as i16),
                i32::from(self.read16(segment, offset)? as i16),
                i32::from(self.read16(segment, offset.wrapping_add(2))? as i16),
            )
        };

        if index < lower || index > upper {
            return self.fault(5);
        }

        Ok(())
    }

    /// `ENTER`, of words or, under the operand-size prefix, double words, as
    /// the JavaScript core's `executeEnter` has it: the frame pointer pushed
    /// -- the whole of EBP for double words -- the enclosing frames'
    /// pointers copied, every one read before anything is pushed, the new
    /// frame's pointer, and room for the locals.
    pub(crate) fn enter(&mut self, size: u16) -> Result<(), Exit> {
        let locals = self.fetch16()?;
        let level = self.fetch8()? & 0x1f;
        let base = self.regs[BP];
        let mut displays = [0u32; 32];

        for display in 1..level {
            let at = u32::from(base.wrapping_sub(u16::from(display) * size));

            displays[usize::from(display)] = if size == 4 {
                self.read32(SS, at)?
            } else {
                u32::from(self.read16(SS, at)?)
            };
        }

        let mut top = self.regs[SP];
        let saved = if size == 4 {
            self.reg32(BP)
        } else {
            u32::from(self.regs[BP])
        };

        self.push_below(&mut top, size, saved)?;

        let frame = top;

        for display in 1..level {
            self.push_below(&mut top, size, displays[usize::from(display)])?;
        }

        if level > 0 {
            self.push_below(&mut top, size, u32::from(frame))?;
        }

        if size == 4 {
            self.set_reg32(BP, u32::from(frame));
        } else {
            self.regs[BP] = frame;
        }

        self.regs[SP] = top.wrapping_sub(locals);
        Ok(())
    }

    /// A word or double word pushed below `top`, which moves; SP does not.
    fn push_below(&mut self, top: &mut u16, size: u16, value: u32) -> Result<(), Exit> {
        *top = top.wrapping_sub(size);

        if size == 4 {
            self.write32(SS, u32::from(*top), value)
        } else {
            self.write16(SS, u32::from(*top), value as u16)
        }
    }

    /// `POP` to memory or a register, a word or a double word: an undefined
    /// opcode for any `reg` field but nought. The value is read, and the
    /// stack moved first to a register -- `POP SP` takes the value -- and
    /// last to memory, so a destination that faults leaves it as it was; an
    /// address on ESP is ESP's after the pop, as the part computes it.
    pub(crate) fn pop_to_memory(&mut self, size: u16) -> Result<(), Exit> {
        let (reg, place) = self.modrm()?;

        if reg != 0 {
            return self.fault(6);
        }

        let sp = self.regs[SP];
        let value = if size == 4 {
            self.read32(SS, u32::from(sp))?
        } else {
            u32::from(self.read16(SS, u32::from(sp))?)
        };
        let after = sp.wrapping_add(size);
        let place = match place {
            Place::Memory(segment, offset) if self.esp_based => {
                Place::Memory(segment, offset.wrapping_add(u32::from(size)))
            }
            other => other,
        };
        let write = |cpu: &mut Self| {
            if size == 4 {
                cpu.set32(place, value)
            } else {
                cpu.set16(place, value as u16)
            }
        };

        if let Place::Register(_) = place {
            self.regs[SP] = after;
            write(self)
        } else {
            write(self)?;
            self.regs[SP] = after;
            Ok(())
        }
    }
}
