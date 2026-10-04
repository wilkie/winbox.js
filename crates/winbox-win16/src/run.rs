//! A program run: its instructions on the processor, and what stops it --
//! a call, an interrupt -- answered here, until its task ends or something
//! is met that is not answered yet.

use winbox_cpu::{CS, Exit};

use crate::call::Stop;
use crate::system::System;

/// How many instructions the processor runs between looks at the clock.
const SLICE: u64 = 500;

impl System {
    /// Runs until the task ends, something is met that is not answered
    /// here, or `budget` instructions have run.
    pub fn run(&mut self, budget: u64) -> Stop {
        let end = self.instructions + budget;

        while self.instructions < end {
            let (ran, exit) = self.cpu.run(SLICE.min(end - self.instructions));

            self.instructions += ran;

            let stopped = match exit {
                Exit::Budget => Ok(()),
                Exit::Unimplemented(0xcd) => self.interrupt(),
                other => Err(Stop::Processor(other)),
            };

            if let Err(stop) = stopped {
                return stop;
            }
        }

        Stop::Processor(Exit::Budget)
    }

    /// The `INT` at CS:IP, answered.
    fn interrupt(&mut self) -> Result<(), Stop> {
        let at = self.cpu.segments[CS].base + u32::from(self.cpu.ip);
        let vector = self.cpu.bus.read8(at + 1);

        match vector {
            0x80 => self.api_call(),
            0x21 => self.dos_call(),
            _ => Err(Stop::Interrupt(vector)),
        }
    }
}
