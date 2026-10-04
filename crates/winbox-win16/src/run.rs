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
    Stop(Stop),
}

impl System {
    /// Runs until an event, or the instructions reach `end`.
    pub(crate) fn run_until_event(&mut self, end: u64) -> Event {
        while self.instructions < end {
            let (ran, exit) = self.cpu.run(SLICE.min(end - self.instructions));

            self.instructions += ran;

            match exit {
                Exit::Budget => {}
                Exit::Unimplemented(0xcd) => {
                    let at = self.cpu.segments[CS].base + u32::from(self.cpu.ip);

                    match self.cpu.bus.read8(at + 1) {
                        0x80 => match self.api_call() {
                            Ok(None) => {}
                            Ok(Some(pending)) => return Event::Call(pending),
                            Err(stop) => return Event::Stop(stop),
                        },
                        0x81 if self.depth > 0 => return Event::Returned,
                        0x21 => {
                            if let Err(stop) = self.dos_interrupt() {
                                return Event::Stop(stop);
                            }
                        }
                        vector => return Event::Stop(Stop::Interrupt(vector)),
                    }
                }
                other => return Event::Stop(Stop::Processor(other)),
            }
        }

        Event::Stop(Stop::Processor(Exit::Budget))
    }
}
