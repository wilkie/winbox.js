//! A program's own `IN` and `OUT`: the I/O ports the machine answers.
//!
//! The FM chip's are answered (`fm.rs`): 388h to 38Bh, the Ad Lib's,
//! and 228h and 229h, the Sound Blaster 2.0's way to the same chip, as the
//! oracle's DOSBox decodes them. So a program, or a driver of its own, that
//! writes the chip is heard, and one that looks for the card by its timers
//! finds it. And the CMOS's (`cmos.rs`): a register chosen at 70h, read and
//! written at 71h. DMA channel 0's address and count, the game port and the
//! VGA's input status (3DAh) are read as DOSBox answers them. A write to
//! any other port is passed over, as the processor passed every `OUT` over
//! before; a read of any other stops the run, as every `IN` did.
//!
//! At a program's privilege: in standard mode DOSX enters protected mode
//! with IOPL 3 (`DOSX.EXE` file offset 111Bh: `pushf`, `or ah,30h`, the
//! `iret` to ring 3), so each `IN` and `OUT` reaches the machine's own
//! devices; in 386 enhanced mode a program runs at IOPL 0 and WIN386 takes
//! each through the TSS's permission bitmap, passing to the machine those
//! it does not virtualise. **Recorded** by `ioports`: IOPL 3 and 0, no `IN`
//! or `OUT` faulting in either mode, each port's byte alike in both
//! (`kb/topics/io-ports.md`).
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

/// DMA channel 0's address and count registers, on the first controller.
const DMA_CHANNEL_0_ADDRESS: u16 = 0x00;
const DMA_CHANNEL_0_COUNT: u16 = 0x01;

/// The 8253 timer's counter 2 and its control port (`pit.rs`).
const COUNTER_2: u16 = 0x42;
const TIMER_CONTROL: u16 = 0x43;

/// The game port.
const GAME_PORT: u16 = 0x201;

/// The VGA's input status register 1, in its colour place.
const VGA_STATUS: u16 = 0x3da;

/// The VGA's timing in mode 12h, which `VGA.DRV` sets with `INT 10h` (seg4
/// `00d0`), as the oracle's DOSBox (`machine=svga_s3`) works it out
/// (`hardware/vga_draw.cpp` 1000-1180, `VGA_SetupDrawing`) from the CRTC
/// registers its BIOS writes for the mode (`ints/int10_modes.cpp` 54, the
/// mode's 100 characters by 525 lines, 80 by 480 shown; 768-866): a
/// character clock of 25.175 MHz over 8 (`vga_s3.cpp` 498-509, the misc
/// output's clock 0); the horizontal blank from character 80 to 98; the
/// vertical retrace lines 490 to 492; the display ending at line 480.
const VGA_CHARACTER_CLOCK: f64 = 25_175_000.0 / 8.0;
const VGA_LINE_CHARACTERS: f64 = 100.0;
const VGA_FRAME_LINES: f64 = 525.0;
const VGA_HBLANK: (f64, f64) = (80.0, 98.0);
const VGA_VRETRACE: (f64, f64) = (490.0, 492.0);
const VGA_DISPLAY_LINES: f64 = 480.0;

/// Input status 1 at the machine's millisecond `ms`, as DOSBox's
/// `vga_read_p3da` answers it (`hardware/vga_misc.cpp` 33-57): bit 3 in the
/// vertical retrace; bit 0 in the vertical blank below the display or in a
/// line's horizontal blank. The frames are counted from the clock's start.
/// **Recorded** by `ioports`, both modes: bits 3 and 0 each seen set and
/// clear, no other.
fn vga_status(ms: f64) -> u8 {
    let line = 1000.0 * VGA_LINE_CHARACTERS / VGA_CHARACTER_CLOCK;
    let character = 1000.0 / VGA_CHARACTER_CLOCK;
    let in_frame = ms.rem_euclid(line * VGA_FRAME_LINES);
    let in_line = in_frame.rem_euclid(line);
    let mut status = 0;

    if in_frame >= VGA_VRETRACE.0 * line && in_frame <= VGA_VRETRACE.1 * line {
        status |= 0x08;
    }

    if in_frame >= VGA_DISPLAY_LINES * line
        || (in_line >= VGA_HBLANK.0 * character && in_line <= VGA_HBLANK.1 * character)
    {
        status |= 0x01;
    }

    status
}

/// The system control port: the speaker's gate and data, and bits that
/// turn over as it is read. `DOVOICE.DLL` drives the speaker through it
/// (`hardware_interrupts.rs`).
const SYSTEM_CONTROL: u16 = 0x61;

/// The master interrupt controller's command port, where a program ends
/// the timer's interrupt (`hardware_interrupts.rs`).
const PIC_COMMAND: u16 = 0x20;

impl System {
    /// A port's byte, where the machine answers it.
    fn port_read(&mut self, port: u16) -> Option<u8> {
        if Fm::decodes(port, true) {
            Some(self.fm_read(port))
        } else if port == CMOS_DATA {
            let moment = crate::cmos::Moment {
                equipment: self.equipment(),
                floppies: self.files.floppy_disks(),
                date: self.date(),
                ms: self.clock.precise(self.instructions),
            };

            self.cmos.read(&moment)
        } else if port == DMA_CHANNEL_0_ADDRESS || port == DMA_CHANNEL_0_COUNT {
            // Channel 0's address and count, nought as DOSBox makes them
            // (`hardware/dma.cpp` 266-269) and nothing programs them: each
            // of the two bytes the controller's flip-flop gives (221-241)
            // is nought. **Recorded** by `ioports`, both modes.
            Some(0)
        } else if port == COUNTER_2 {
            Some(self.counter2.read(self.clock.precise(self.instructions)))
        } else if port == GAME_PORT {
            // No joystick: DOSBox's `read_p201` with neither stick enabled
            // answers every bit set (`hardware/joystick.cpp` 54-87).
            // **Recorded** by `ioports`, both modes.
            Some(0xff)
        } else if port == VGA_STATUS && self.display.driver_file == "VGA.DRV" {
            Some(vga_status(self.clock.precise(self.instructions)))
        } else if port == SYSTEM_CONTROL {
            // DOSBox's read turns the refresh bit (4) and the timer's
            // second output (5) over each time, and answers the byte last
            // written with them (`hardware/keyboard.cpp` 175-179).
            self.system_control ^= 0x30;
            Some(self.system_control)
        } else {
            None
        }
    }

    /// The `IN` or `OUT` at CS:IP run, `opcode` its own byte; false where
    /// it reads a port the machine does not answer, nothing done.
    pub(crate) fn port_instruction(&mut self, opcode: u8) -> bool {
        let segment = self.cpu.segments[CS];
        let byte = |system: &Self, at: u16| {
            let offset = system.cpu.ip_ahead(u32::from(at));

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
                } else if each == CMOS_DATA {
                    self.cmos.write((value >> (8 * at)) as u8);
                } else if each == SYSTEM_CONTROL {
                    // Kept as DOSBox keeps it (`keyboard.cpp` 182-188), its
                    // bit 0 counter 2's gate; the speaker it gates is not
                    // sounded.
                    let byte = (value >> (8 * at)) as u8;
                    let now = self.clock.precise(self.instructions);

                    self.counter2.set_gate(byte & 1 != 0, now);
                    self.system_control = byte;
                } else if each == COUNTER_2 {
                    let now = self.clock.precise(self.instructions);

                    self.counter2.write((value >> (8 * at)) as u8, now);
                } else if each == TIMER_CONTROL {
                    let byte = (value >> (8 * at)) as u8;
                    let now = self.clock.precise(self.instructions);

                    // Counter 2's control word, or the read-back command
                    // where it names counter 2, whose status is latched
                    // only where it names neither counter before it;
                    // counters 0 and 1 are passed over (`timer.cpp`
                    // 291-361).
                    match byte >> 6 {
                        2 => self.counter2.control(byte, now),
                        3 if byte & 0x08 != 0 => {
                            let earlier = if byte & 0x06 != 0 { 0x10 } else { 0 };

                            self.counter2.read_back(byte | earlier, now);
                        }
                        _ => {}
                    }
                } else if each == PIC_COMMAND {
                    self.interrupt_controller_write((value >> (8 * at)) as u8);
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

        self.cpu.ip = self.cpu.ip_ahead(u32::from(length));
        true
    }
}

#[cfg(test)]
mod tests {
    use super::vga_status;

    #[test]
    fn the_vgas_status_follows_mode_12hs_frame() {
        // A line is 100 characters of 25.175 MHz over 8: 31.78 us.
        let line = 100.0 * 8.0 / 25_175.0;
        let frame = 525.0 * line;

        // In a line's display: neither bit.
        assert_eq!(vga_status(0.5 * line), 0x00);
        // A line's horizontal blank, characters 80 to 98.
        assert_eq!(vga_status(10.9 * line), 0x01);
        // The vertical blank below the display, before the retrace.
        assert_eq!(vga_status(485.5 * line), 0x01);
        // The retrace, lines 490 to 492, in the blank.
        assert_eq!(vga_status(491.0 * line), 0x09);
        // The next frame's first line again.
        assert_eq!(vga_status(frame + 0.5 * line), 0x00);

        // Read each microsecond over a frame and more: each bit seen set
        // and clear, no other, as `ioports` recorded.
        let reads: Vec<u8> = (0..20_000)
            .map(|at| vga_status(f64::from(at) * 0.001))
            .collect();

        assert!(reads.iter().any(|&status| status & 0x08 != 0));
        assert!(reads.iter().any(|&status| status & 0x08 == 0));
        assert!(reads.iter().any(|&status| status & 0x01 != 0));
        assert!(reads.iter().all(|&status| status & 0xf6 == 0));
    }
}
