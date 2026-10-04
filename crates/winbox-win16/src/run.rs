//! A program run: its instructions on the processor, and what stops it --
//! a call, an interrupt -- answered here where it can be at once, until
//! something is met that the engine must answer in its time, its task
//! ends, or something is met that is not answered yet.

use winbox_cpu::{CS, Exit};

use crate::call::{Pending, Stop};
use crate::system::System;

/// How many instructions the processor runs between looks at the clock.
const SLICE: u64 = 500;

/// What stopped a run.
pub(crate) enum Event {
    /// A call whose answer takes its time.
    Call(Pending),
    /// A procedure the engine called returned, at the callback thunk's
    /// `INT 81h`.
    Returned,
    /// A procedure to be called as at interrupt time (`interrupts.rs`).
    Interrupt(crate::interrupts::Interrupt),
    Stop(Stop),
}

impl System {
    /// Runs until an event, the instructions reach `end`, or the clock
    /// `until`.
    pub(crate) fn run_until_event(&mut self, end: u64, until: f64) -> Event {
        while self.instructions < end {
            if self.clock.now(self.instructions) >= until {
                return Event::Stop(Stop::Time);
            }

            // A procedure due at interrupt time comes between two slices
            // of the task's own instructions.
            if let Some(interrupt) = self.interrupt_due() {
                return Event::Interrupt(interrupt);
            }

            let (ran, exit) = self.cpu.run(SLICE.min(end - self.instructions));

            self.instructions += ran;

            match exit {
                Exit::Budget => {}
                // The selectors loaded, for a host that keeps copies of
                // their descriptors: here there are none to refresh.
                Exit::Loads => {
                    self.cpu.load_count = 0;
                    self.cpu.loaded = 0;
                }
                // An interrupt the host answers. The `INT` is an instruction
                // run, as the TypeScript engine's processor counts it --
                // once what it does is done, which is when it counts it.
                Exit::Unimplemented(0xcd) => {
                    let at = self.cpu.segments[CS].base + u32::from(self.cpu.ip);
                    let vector = self.cpu.bus.read8(at + 1);

                    match vector {
                        0x80 => {
                            self.instructions += 1;

                            match self.api_call() {
                                Ok(None) => {}
                                Ok(Some(pending)) => return Event::Call(pending),
                                Err(stop) => return Event::Stop(stop),
                            }
                        }
                        0x84 => {
                            self.instructions += 1;
                            return Event::Call(self.user_procedure_call());
                        }
                        0x81 if self.depth > 0 => {
                            self.instructions += 1;
                            return Event::Returned;
                        }
                        0x21 => {
                            let done = self.dos_interrupt();

                            self.instructions += 1;

                            if let Err(stop) = done {
                                return Event::Stop(stop);
                            }

                            // `FileCdr`'s procedure told of what it changed.
                            if let Some(pending) = self.file_changes_pending() {
                                return Event::Call(pending);
                            }
                        }
                        0x31 => {
                            self.dpmi_interrupt();
                            self.cpu.ip += 2;
                            self.instructions += 1;
                        }
                        0x1a => {
                            self.clock_interrupt();
                            self.cpu.ip += 2;
                            self.instructions += 1;
                        }

                        // The emulator's: there is a coprocessor.
                        0x34..=0x3c => {
                            return Event::Stop(Stop::Unsupported("the floating-point emulator"));
                        }
                        // The multiplex interrupt: no resident program is
                        // here to answer it, so the registers stay as they
                        // were -- "not installed". And a lone `FWAIT`, made
                        // `INT 3Dh` by its OS fixup: it returns.
                        0x2f | 0x3d => {
                            self.cpu.ip += 2;
                            self.instructions += 1;
                        }
                        vector => return Event::Stop(Stop::Interrupt(vector)),
                    }
                }
                // A byte of GDI's segment, made as the program reads it; the
                // instruction then runs again.
                Exit::Host => match (self.cpu.bus.asked(), self.gdi_data) {
                    (Some(at), Some(start)) if at.wrapping_sub(start) < 0x10000 => {
                        let byte = self.gdi_heap_read(at - start);

                        self.cpu.bus.answer(at, byte);
                    }
                    _ => return Event::Stop(Stop::Processor(Exit::Host)),
                },
                other => return Event::Stop(Stop::Processor(other)),
            }
        }

        Event::Stop(Stop::Processor(Exit::Budget))
    }
}

impl System {
    /// The BIOS's time of day, `INT 1Ah` AH 0: CX:DX the ticks since
    /// midnight, 1,573,040 to a day, and AL whether midnight has passed
    /// since it was last asked.
    fn clock_interrupt(&mut self) {
        if self.cpu.regs[winbox_cpu::AX] >> 8 != 0 {
            return;
        }

        let ms = self.epoch_ms + self.now_ms();
        let day = ms.div_euclid(86_400_000);
        let ticks = (ms.rem_euclid(86_400_000) * 1_573_040 / 86_400_000) as u32;
        let passed = self.clock_day.is_some_and(|before| before != day);

        self.cpu.regs[winbox_cpu::CX] = (ticks >> 16) as u16;
        self.cpu.regs[winbox_cpu::DX] = ticks as u16;
        self.cpu.regs[winbox_cpu::AX] =
            (self.cpu.regs[winbox_cpu::AX] & 0xff00) | u16::from(passed);
        self.clock_day = Some(day);
    }
}

impl System {
    /// INT 31h, DPMI, as far as winbox.js answers it: 000Bh copies a
    /// descriptor of the local table, the selector in BX, to the eight bytes
    /// at ES:EDI, and 000Ch copies them back into it -- each with the carry
    /// clear, whatever the selector, as `dpmidesc` records of one no table
    /// holds. A descriptor set takes effect at once for a segment register
    /// that holds its selector, as the TypeScript engine's processor forgets
    /// what it kept of it. Any other function changes nothing.
    fn dpmi_interrupt(&mut self) {
        let function = self.cpu.regs[winbox_cpu::AX];

        if function != 0x000b && function != 0x000c {
            return;
        }

        let selector = self.cpu.regs[winbox_cpu::BX];
        let offset = u32::from(self.cpu.high[winbox_cpu::DI]) << 16
            | u32::from(self.cpu.regs[winbox_cpu::DI]);
        let address = self.cpu.segments[winbox_cpu::ES].base.wrapping_add(offset);
        let entry = self.cpu.ldt_base + u32::from(selector >> 3) * 8;

        if function == 0x000b {
            let bytes = self.cpu.bus.read(entry, 8);

            self.cpu.bus.write(address, &bytes);
        } else {
            let bytes = self.cpu.bus.read(address, 8);

            self.cpu.bus.write(entry, &bytes);

            for index in 0..6 {
                let held = self.cpu.segments[index].selector;

                if held & !7 == selector & !7 && held & 4 != 0 {
                    let _ = self.cpu.load_segment(index, held);
                }
            }
        }

        self.cpu.flags &= !1;
    }
}
