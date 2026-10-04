//! Procedures called as at interrupt time, as winbox.js's scheduler calls
//! them (`Scheduler.atInterrupt`): MMSYSTEM's timer events. On Windows the
//! timer's interrupt calls such a procedure between any two of the task's
//! instructions, on a stack of its own; here it comes between two slices of
//! the task's instructions, or, as the task waits for a message, as soon as
//! it wakes, which a procedure come due wakes it to. One at a time, each
//! run to its end, the processor then as it was.
//!
//! Never while the task is stopped inside some other call of the API that
//! has not yet called the program: that call may be about to, and two calls
//! made at once would return out of turn.
//!
//! Not recorded: the registers and the stack Windows calls it with; here
//! AX, DS and ES are the stack's segment, as for a hook, and the stack is
//! the task's.

use std::collections::VecDeque;

use winbox_cpu::{AX, CS, DS, ES, SS};
use winbox_machine::index_for;

use crate::call::Stop;
use crate::engine::{Engine, GuestArg, Register};
use crate::system::System;

/// A procedure waiting to be called, and what it was asked for by -- the
/// timer event's serial -- so that the asking can take it back.
#[derive(Debug, Clone)]
pub struct Interrupt {
    pub proc: u32,
    pub args: Vec<GuestArg>,
    pub key: Option<u64>,
}

/// The procedures waiting, in turn, and whether one is being called.
#[derive(Debug, Default)]
pub struct Interrupts {
    waiting: VecDeque<Interrupt>,
    inside: bool,
}

impl System {
    /// A procedure to be called as at interrupt time; the task waiting for a
    /// message woken to it where `wake`.
    pub fn at_interrupt(&mut self, interrupt: Interrupt, wake: bool) {
        self.interrupts.waiting.push_back(interrupt);

        if wake && self.task.is_some() {
            self.signal();
        }
    }

    /// The calls waiting that were asked for by this key, taken back.
    pub fn cancel_interrupts(&mut self, key: u64) {
        self.interrupts
            .waiting
            .retain(|waiting| waiting.key != Some(key));
    }

    /// From the run loop, between two slices of the task's instructions:
    /// what has come due, and the next procedure waiting, if one may be
    /// called now. Not where a call into the program is begun and not yet
    /// made -- at the far call that opens a kept module's stub segment,
    /// whose target another call would write over; the rest of the stubs,
    /// where each call of the API returns to the program, are as good as
    /// the program's own code.
    pub(crate) fn interrupt_due(&mut self) -> Option<Interrupt> {
        self.poll_time_events();

        if self.interrupts.inside || self.interrupts.waiting.is_empty() {
            return None;
        }

        if self.task.is_none() || self.ended {
            return None;
        }

        if self.cpu.ip < 5
            && self
                .kept_at(index_for(self.cpu.segments[CS].selector))
                .is_some()
        {
            return None;
        }

        self.interrupts.waiting.pop_front()
    }
}

impl Engine {
    /// A procedure called as at interrupt time, the task running on after
    /// it.
    pub(crate) async fn deliver_interrupt(&self, interrupt: Interrupt) -> Result<(), Stop> {
        let registers = {
            let mut system = self.system();
            let stack = system.cpu.segments[SS].selector;

            system.interrupts.inside = true;
            [
                Register::Word(AX, stack),
                Register::Segment(DS, stack),
                Register::Segment(ES, stack),
            ]
        };
        let called = Box::pin(self.call_with(interrupt.proc, &interrupt.args, &registers)).await;

        self.system().interrupts.inside = false;
        called.map(|_| ())
    }

    /// From inside the API, where the task waited and nothing else is under
    /// way: each procedure waiting called, in turn.
    pub async fn take_interrupts(&self) -> Result<(), Stop> {
        loop {
            let next = {
                let mut system = self.system();

                if system.interrupts.inside || system.task.is_none() || system.ended {
                    return Ok(());
                }

                match system.interrupts.waiting.pop_front() {
                    Some(next) => next,
                    None => return Ok(()),
                }
            };

            self.deliver_interrupt(next).await?;
        }
    }
}
