//! A program run: its instructions on the processor, and what stops it --
//! a call, an interrupt -- answered here where it can be at once, until
//! something is met that the engine must answer in its time, its task
//! ends, or something is met that is not answered yet.

use winbox_cpu::{CS, Exit};

use crate::call::{Pending, Stop};
use crate::system::System;

/// How many instructions the processor runs between looks at the clock.
const SLICE: u64 = 500;

/// INT 2Fh 1600h's AX in 386 enhanced mode: AL 3, AH 0Ah, Windows 3.10
/// (`dpmiver`).
const WINDOWS_VERSION: u16 = 0x0a03;
/// INT 2Fh 1683h's BX in 386 enhanced mode: the system virtual machine's
/// number (`enhmode`).
const SYSTEM_VIRTUAL_MACHINE: u16 = 1;
/// What stopped a run.
pub(crate) enum Event {
    /// A call whose answer takes its time.
    Call(Pending),
    /// A procedure the engine called returned, at the callback thunk's
    /// `INT 81h`.
    Returned,
    /// A procedure to be called as at interrupt time (`interrupts.rs`).
    Interrupt(crate::interrupts::Interrupt),
    /// A fault KERNEL takes the program through its boxes for
    /// (`fault.rs`).
    Fault(u8),
    /// An exception WIN87EM's emulator reports, its code for `INT 3Eh`'s
    /// procedure (`win87em.rs`).
    Floating(u16),
    /// The run's deadline in the host's time come, for its caller to be
    /// given the thread back (`EngineRun::step`).
    Yield,
    Stop(Stop),
}

impl System {
    /// Runs until an event, the instructions reach `end`, the clock
    /// `until`, or the host's time `deadline`.
    #[allow(clippy::too_many_lines)]
    pub(crate) fn run_until_event(&mut self, end: u64, until: f64, deadline: f64) -> Event {
        while self.instructions < end {
            // The run's caller given the thread back as the host's time
            // reaches its deadline: only here, between two slices, and
            // never for a count of instructions, so the slices, and what
            // comes between them, are as in a run that never yields.
            if deadline.is_finite() && self.clock.host_ms() >= deadline {
                return Event::Yield;
            }

            if self.clock.now(self.instructions) >= until {
                return Event::Stop(Stop::Time);
            }

            // The host shown the screen and given the input, as often as
            // a frame of its time passes, however long the program runs.
            if !self.host_frame() {
                return Event::Stop(Stop::Closed);
            }

            // A procedure due at interrupt time comes between two slices
            // of the task's own instructions.
            if let Some(interrupt) = self.interrupt_due() {
                return Event::Interrupt(interrupt);
            }

            // A key pressed, or a screen kept, at the instruction another
            // run did (`call_marks.rs`): the slice stops there.
            let mut slice = SLICE.min(end - self.instructions);

            if let Some(left) = self.until_mark() {
                if left == 0 {
                    self.take_call_marks();
                    continue;
                }

                slice = slice.min(left);
            }

            let (ran, exit) = self.cpu.run(slice);

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
                // run, counted once what it does is done.
                Exit::Unimplemented(0xcd) => {
                    let at = self.cpu.segments[CS].base + self.cpu.ip;
                    let vector = self.cpu.bus.read8(at + 1);

                    // A program's own handler for the vector, set through
                    // the DPMI host (`dpmi.rs`), called before WinBox's.
                    if self.dpmi.claims(vector) {
                        self.cpu.ip += 2;

                        if self.dpmi_vector(vector) {
                            self.instructions += 1;
                            continue;
                        }

                        self.cpu.ip -= 2;
                    }

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
                        // From the DPMI host's own code, a real-mode INT 21h a
                        // program asked for through INT 31h 0300h: DOS alone,
                        // without KERNEL in front of it, as on Windows.
                        0x21 if self.at_real_call() => {
                            let done = self.dos_interrupt();

                            self.instructions += 1;

                            if let Err(stop) = done {
                                return Event::Stop(stop);
                            }
                        }
                        0x21 => {
                            if let Some(event) = self.dos_event() {
                                return event;
                            }
                        }
                        0x31 => {
                            self.cpu.ip += 2;
                            self.instructions += 1;

                            if let Some(event) = self.dpmi_interrupt() {
                                return event;
                            }
                        }
                        0x1a => {
                            self.clock_interrupt();
                            self.cpu.ip += 2;
                            self.instructions += 1;
                        }

                        // WIN87EM's: with a coprocessor, the instruction
                        // written back to run on it; without, carried out
                        // by the emulator, which may report it
                        // (`win87em.rs`).
                        0x34..=0x3c if self.coprocessor => {
                            crate::win87em::put_back(self, vector);
                            self.instructions += 1;
                        }
                        0x34..=0x3c => {
                            let start = self.cpu.ip;

                            self.instructions += 1;

                            match crate::win87em::emulate(self, vector) {
                                Ok(None) => {}
                                Ok(Some(code)) => return Event::Floating(code),
                                Err(exit) => {
                                    self.cpu.ip = start;

                                    if !self.dpmi_fault(exit) {
                                        return self.processor_stop(exit);
                                    }
                                }
                            }
                        }
                        // The multiplex interrupt: MSCDEX's calls, as
                        // DOSBox's own answers them (`multiplex_interrupt`).
                        0x2f => {
                            self.multiplex_interrupt();
                            self.cpu.ip += 2;
                            self.instructions += 1;
                        }
                        // A lone `FWAIT`, made `INT 3Dh` by its OS fixup:
                        // it returns.
                        0x3d => {
                            self.cpu.ip += 2;
                            self.instructions += 1;
                        }
                        0x25 | 0x26 => {
                            self.absolute_disk();
                            self.instructions += 1;
                        }
                        0x12 => self.memory_size_interrupt(),
                        vector => return Event::Stop(Stop::Interrupt(vector)),
                    }
                }
                // A program's own `IN` or `OUT`, run here, counted once run.
                Exit::Unimplemented(opcode @ (0xe4..=0xe7 | 0xec..=0xef)) => {
                    if !self.port_instruction(opcode) {
                        return self.processor_stop(exit);
                    }

                    self.instructions += 1;
                }
                // A byte of GDI's segment, made as the program reads it; the
                // instruction then runs again.
                Exit::Host => match (self.cpu.bus.asked(), self.gdi_data) {
                    (Some(at), Some(start)) if at.wrapping_sub(start) < 0x10000 => {
                        let byte = self.gdi_heap_read(at - start);

                        self.cpu.bus.answer(at, byte);
                    }
                    _ if self.dpmi_fault(Exit::Host) => {}
                    _ => return self.processor_stop(Exit::Host),
                },
                other if self.dpmi_fault(other) => {}
                other => return self.processor_stop(other),
            }
        }

        Event::Stop(Stop::Processor(Exit::Budget))
    }
}

impl System {
    /// The BIOS's conventional memory, in KB, `INT 12h`: 640, as DOSBox's
    /// `INT12_Handler` answers the word it set (`ints/bios.cpp` 413-414,
    /// 873), **recorded** by `biosmem` through Windows.
    fn memory_size_interrupt(&mut self) {
        self.cpu.regs[winbox_cpu::AX] = 640;
        self.cpu.ip += 2;
        self.instructions += 1;
    }

    /// Each task waiting with a timeout -- in `GetMessage`, for its timer
    /// -- whose time has come, woken, the earliest first, between two
    /// slices, as the task running gives up the processor.
    /// `Engine::time_passed` wakes them so once time passes with every
    /// task waiting.
    pub(crate) fn wake_due_waits(&mut self) {
        let instructions = self.instructions;
        let mut due: Vec<(usize, u64)> = self
            .scheduler
            .slots
            .iter()
            .enumerate()
            .filter_map(|(slot, state)| state.wait_timer.map(|timer| (slot, timer)))
            .filter(|&(_, timer)| self.clock.is_due(instructions, timer))
            .collect();

        due.sort_by_key(|&(_, timer)| timer);

        for (slot, timer) in due {
            self.clock.cancel(timer);
            self.scheduler.slots[slot].wait_timer = None;
            self.signal_slot(slot);
        }
    }

    /// A program's `INT 21h`, answered: the event the run stops at, where
    /// it stops. The task ending with files of MMSYSTEM's open, USER's
    /// `DRV_EXITAPPLICATION` lets them go first, and the interrupt is taken
    /// again; a file changed, `FileCdr`'s procedure is told of it.
    fn dos_event(&mut self) -> Option<Event> {
        if let Some(pending) = self.exit_application_pending() {
            return Some(Event::Call(pending));
        }

        // USER told the task ends, as KERNEL tells it before ending it
        // (`KRNL386.EXE` seg1 `1938`-`194d`; `app_exit.rs`).
        if let Some(pending) = self.app_exit_pending() {
            return Some(Event::Call(pending));
        }

        let done = self.dos_interrupt();

        self.instructions += 1;

        if let Err(stop) = done {
            return Some(Event::Stop(stop));
        }

        self.file_changes_pending().map(Event::Call)
    }

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
    /// INT 2Fh, the multiplex interrupt. DOSBox installs its own MSCDEX
    /// whether or not a disc is mounted (`dos_mscdex.cpp` 1312-1322), and
    /// answers (1069-1167), **recorded** through Windows by `mscdex` with no
    /// disc and `imgcd` with one:
    ///
    /// * 1100h, the network redirector's installation check: AL `FFh`.
    /// * 1500h, MSCDEX's: AL `FFh`, BX the number of CD-ROM drives -- here the
    ///   drives removable and remote -- and CX the first, 0 for A:, left as
    ///   it was where there is none.
    /// * 150Bh, whether drive CL is a CD-ROM: AX 5AD8h if so, else nought;
    ///   BX `ADADh`.
    /// * 150Ch, MSCDEX's version: BX 0217h, 2.23.
    ///
    /// And Windows' own, as the DPMI host answers them to a Windows
    /// program, **recorded** by `dpmiver` and `enhmode` in both modes:
    ///
    /// * 1600h, the enhanced-mode check: AX 0A03h, Windows 3.10, in 386
    ///   enhanced mode, which KERNEL reads as it starts (`KRNL386.EXE` seg1
    ///   `aa76`-`aa90`, AL 3); left as it was in standard mode.
    /// * 1683h, the current virtual machine: AX 1600h and BX 1, the system
    ///   virtual machine, in enhanced mode; left in standard mode.
    /// * 1686h, the processor's mode: AX nought, protected mode, in both.
    ///
    /// 1684h, a device's entry point, is left, ES:DI as it was: WinBox has
    /// none of WIN386's devices. 160Ah is not answered in either mode.
    ///
    /// Any other function changes nothing: no other resident program is
    /// here to answer.
    fn multiplex_interrupt(&mut self) {
        use winbox_cpu::{AX, BX, CX};

        let compact_discs: Vec<u16> = (0..26u8)
            .filter(|&drive| {
                let letter = char::from(b'A' + drive);

                self.files.removable(letter) && self.files.remote(letter)
            })
            .map(u16::from)
            .collect();

        match self.cpu.regs[AX] {
            0x1100 | 0x1500 => {
                if self.cpu.regs[AX] == 0x1500 {
                    self.cpu.regs[BX] = compact_discs.len() as u16;

                    if let Some(&first) = compact_discs.first() {
                        self.cpu.regs[CX] = first;
                    }
                }

                self.cpu.regs[AX] |= 0x00ff;
            }
            0x150b => {
                let drive = self.cpu.regs[CX] & 0xff;

                self.cpu.regs[AX] = if compact_discs.contains(&drive) {
                    0x5ad8
                } else {
                    0
                };
                self.cpu.regs[BX] = 0xadad;
            }
            0x150c => self.cpu.regs[BX] = 0x0217,
            0x1600 if self.mode == crate::Mode::Enhanced => self.cpu.regs[AX] = WINDOWS_VERSION,
            0x1683 if self.mode == crate::Mode::Enhanced => {
                self.cpu.regs[AX] = 0x1600;
                self.cpu.regs[BX] = SYSTEM_VIRTUAL_MACHINE;
            }
            0x1686 => self.cpu.regs[AX] = 0,
            _ => {}
        }
    }

    /// `INT 25h` and `26h`, a volume's sectors read or written by number,
    /// as File Manager reads a drive's boot sector to tell a RAM drive
    /// (`WINFILE.EXE` seg6 `09e3`). These drives are files, not sectors:
    /// each answers as a drive with no disk under it does, AX 8002h and the
    /// carry set, which File
    /// Manager takes for no RAM drive. Unlike every other interrupt, these
    /// return with the flags still on the stack, which the caller pops (DOS
    /// as documented).
    fn absolute_disk(&mut self) {
        let sp = self.cpu.regs[winbox_cpu::SP].wrapping_sub(2);
        let stack = self.cpu.segments[winbox_cpu::SS].base;

        self.cpu.regs[winbox_cpu::AX] = 0x8002;
        self.cpu.flags |= 1;
        self.cpu.bus.write16(stack + u32::from(sp), self.cpu.flags);
        self.cpu.regs[winbox_cpu::SP] = sp;
        self.cpu.ip += 2;
    }

    /// A fault given to a program's exception handler for it, set through
    /// the DPMI host (`dpmi.rs`): true where one was.
    fn dpmi_fault(&mut self, exit: Exit) -> bool {
        let found = match exit {
            Exit::Fault(vector) if vector != 12 && vector != 13 => Some((vector, 0)),
            Exit::Fault(_) | Exit::Host => self.fault_with_code(exit),
            _ => None,
        };

        match found {
            Some((vector, code)) if self.dpmi.handles_exception(vector) => {
                self.dpmi_exception(vector, code);
                true
            }
            _ => false,
        }
    }
}
