//! A program's own `IN` and `OUT`: the I/O ports the machine answers.
//!
//! The FM chip's are answered (`fm.rs`): 388h to 38Bh, the Ad Lib's,
//! and 228h and 229h, the Sound Blaster 2.0's way to the same chip, as the
//! oracle's DOSBox decodes them. So a program, or a driver of its own, that
//! writes the chip is heard, and one that looks for the card by its timers
//! finds it. And the CMOS's (`cmos.rs`): a register chosen at 70h and read
//! at 71h, where it is one answered. A write to any other port is passed
//! over, as the processor passed every `OUT` over before; a read of any
//! other stops the run, as every `IN` did.
//!
//! The processor stops before each `IN` and `OUT` for this (`Cpu::ports`),
//! and the instruction is run here: one byte, a word or a doubleword, to
//! or from AL, AX or EAX, at the port its byte names or DX's. A word or a
//! doubleword goes to that port and those after it, a byte each, low byte
//! first, as an 8-bit device on the bus takes it.

use winbox_cpu::{AX, CS, DX};

use crate::fm::Fm;
use crate::system::System;

/// The CMOS's ports: the register chosen, and its byte.
const CMOS_INDEX: u16 = 0x70;
const CMOS_DATA: u16 = 0x71;

impl System {
    /// A port's byte, where the machine answers it.
    fn port_read(&mut self, port: u16) -> Option<u8> {
        if Fm::decodes(port, true) {
            Some(self.fm_read(port))
        } else if port == CMOS_DATA {
            self.cmos.read()
        } else {
            None
        }
    }

    /// The `IN` or `OUT` at CS:IP run, `opcode` its own byte; false where
    /// it reads a port the machine does not answer, nothing done.
    pub(crate) fn port_instruction(&mut self, opcode: u8) -> bool {
        let segment = self.cpu.segments[CS];
        let byte = |system: &Self, at: u16| {
            let offset = u32::from(system.cpu.ip.wrapping_add(at));

            winbox_machine::Memory::read8(&system.cpu.bus, segment.base.wrapping_add(offset))
        };
        // The prefixes before the opcode: the operand size's turns a word
        // into a doubleword; the rest change nothing here.
        let mut length = 0u16;
        let mut wide = segment.big;

        loop {
            match byte(self, length) {
                0x66 => wide = !wide,
                0x26 | 0x2e | 0x36 | 0x3e | 0x64 | 0x65 | 0x67 | 0xf0 | 0xf2 | 0xf3 => {}
                _ => break,
            }

            length += 1;
        }

        let immediate = opcode & 0x08 == 0;
        let port = if immediate {
            u16::from(byte(self, length + 1))
        } else {
            self.cpu.regs[DX]
        };
        let size: u16 = match (opcode & 1, wide) {
            (0, _) => 1,
            (_, false) => 2,
            (_, true) => 4,
        };
        let out = opcode & 0x02 != 0;

        length += if immediate { 2 } else { 1 };

        if out {
            let value = u32::from(self.cpu.regs[AX]) | u32::from(self.cpu.high[AX]) << 16;

            for at in 0..size {
                let each = port.wrapping_add(at);

                if Fm::decodes(each, false) {
                    self.fm_write(each, (value >> (8 * at)) as u8);
                } else if each == CMOS_INDEX {
                    self.cmos.select((value >> (8 * at)) as u8);
                }
            }
        } else {
            let mut value = 0u32;

            for at in 0..size {
                let Some(byte) = self.port_read(port.wrapping_add(at)) else {
                    return false;
                };

                value |= u32::from(byte) << (8 * at);
            }

            match size {
                1 => self.cpu.regs[AX] = (self.cpu.regs[AX] & 0xff00) | (value & 0xff) as u16,
                2 => self.cpu.regs[AX] = value as u16,
                _ => {
                    self.cpu.regs[AX] = value as u16;
                    self.cpu.high[AX] = (value >> 16) as u16;
                }
            }
        }

        self.cpu.ip = self.cpu.ip.wrapping_add(length);
        true
    }
}
