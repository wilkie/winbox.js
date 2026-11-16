//! The timer's hardware interrupt, IRQ 0, given to a program's own handler
//! of vector 08h (`kb/topics/hardware-interrupts.md`).
//!
//! A program sets the vector through INT 21h 25h, which KERNEL passes on
//! to the DPMI host, or through DPMI 0205h (`dos.rs`, `dpmi.rs`). Windows'
//! own handler is first in the chain until then: TIMER.DRV's in standard
//! mode, SYSTEM.DRV's in enhanced mode, which go on to the host's, which
//! goes on to the BIOS's in real mode; the BIOS's ends the interrupt at the
//! controller. SYSTEM.DRV counts Windows' milliseconds in its handler, so
//! `GetTickCount` moves only as the chain reaches it. **Recorded** by
//! `irqtick` in both modes: 20 ticks over 1,099 ms by `GetTickCount`; a
//! handler that goes on to nothing and ends nothing sees one tick, and
//! `GetTickCount` stands still; an end of interrupt written to port 20h
//! and the ticks come again.
//!
//! Here the timer ticks on the machine's clock, every 65,536 of the
//! 8253's 1,193,180 Hz, as `GetTickCount`'s ticks are. A tick is raised
//! while a program's handler is set: between two slices of the program's
//! instructions where its interrupt flag is set and the last tick has been
//! ended (`System::raise_timer`), or, where the task waits in the API, as a
//! procedure called at interrupt time (`System::raise_timer_waiting`).
//! Ticks that come while one is in service or the flag is clear are one
//! request, as the controller holds one. The chain reaching Windows' own
//! handler -- the host's stub, which TIMER's and SYSTEM's places jump on to
//! -- is Windows' tick: the interrupt ended and `GetTickCount` moved; each
//! tick that never reaches it leaves `GetTickCount` a tick behind.

use winbox_cpu::CS;
use winbox_machine::{TimerId, index_for};

use crate::dpmi::TIMER_VECTOR;
use crate::engine::GuestArg;
use crate::interrupts::Interrupt;
use crate::system::System;

/// The timer's tick, in milliseconds: 65,536 of the 8253's 1,193,180 Hz.
const TICK: f64 = 65536.0 * 1000.0 / 1_193_180.0;

/// The processor's interrupt flag.
const INTERRUPT_FLAG: u16 = 0x0200;

/// What a tick raised while the task waits is known by among the
/// procedures called at interrupt time.
pub(crate) const TIMER_KEY: u64 = 0x4952_5130_0000;

/// The controller's ends of interrupt a program writes to port 20h: the
/// one in service (20h), or IRQ 0's by its number (60h).
const END_OF_INTERRUPT: u8 = 0x20;
const END_OF_IRQ_0: u8 = 0x60;

/// The timer's interrupt as the machine keeps it.
#[derive(Debug, Default)]
pub struct Timer {
    /// The clock's last tick accounted for.
    seen: Option<i64>,
    /// The last tick raised to the program's handler, while one is set.
    raised: Option<i64>,
    /// Whether a tick raised has not been ended.
    in_service: bool,
    /// Ticks Windows' own handler has not counted.
    behind: i64,
    /// The clock's timer for the next tick, and the tick it is for.
    wake: Option<(TimerId, i64)>,
}

impl System {
    /// The program's handler of the timer's interrupt, where one is set.
    fn timer_handler(&self) -> Option<(u16, u16)> {
        self.dpmi.vector(TIMER_VECTOR)
    }

    fn clock_tick(&self) -> i64 {
        (self.clock.now(self.instructions) / TICK).floor() as i64
    }

    /// The ticks come since last looked at: Windows' own handler counts
    /// each while no program's handler is set, and is behind by each while
    /// one is, until the chain reaches it. The clock is asked to stop at
    /// the next tick while one is set, so that a task that waits is given
    /// it.
    fn account_ticks(&mut self) {
        let tick = self.clock_tick();
        let seen = *self.timer.seen.get_or_insert(tick);
        let hooked = self.timer_handler().is_some();

        if tick > seen {
            if hooked {
                self.timer.behind += tick - seen;
            }

            self.timer.seen = Some(tick);
        }

        if !hooked {
            self.timer.raised = None;

            if let Some((timer, _)) = self.timer.wake.take() {
                self.clock.cancel(timer);
            }

            return;
        }

        if self.timer.raised.is_none() {
            self.timer.raised = Some(tick);
        }

        if self.timer.wake.is_none_or(|(_, at)| at != tick + 1) {
            if let Some((timer, _)) = self.timer.wake.take() {
                self.clock.cancel(timer);
            }

            let now = self.clock.now(self.instructions);
            let next = ((now / TICK).floor() + 1.0) * TICK - now;
            let timer = self.clock.after(self.instructions, next.max(0.0));

            self.timer.wake = Some((timer, tick + 1));
        }
    }

    /// A tick due to the program's handler, and whether one may be raised
    /// now: the last ended, no task ending.
    fn timer_due(&mut self) -> Option<(u16, u16)> {
        self.account_ticks();

        let handler = self.timer_handler()?;
        let tick = self.clock_tick();

        if self.timer.raised.is_some_and(|raised| raised >= tick)
            || self.timer.in_service
            || self.task.is_none()
            || self.ended
        {
            return None;
        }

        Some(handler)
    }

    /// From the run loop, between two slices of the program's
    /// instructions: a tick due raised to its handler, where its interrupt
    /// flag is set. Never in the host's own code, nor at the far call that
    /// opens a kept module's stubs, as `interrupt_due`.
    pub(crate) fn raise_timer(&mut self) {
        let Some(handler) = self.timer_due() else {
            return;
        };

        if self.cpu.flags & INTERRUPT_FLAG == 0
            || Self::is_host_code(self.cpu.segments[CS].selector)
            || (self.cpu.ip < 5
                && self
                    .kept_at(index_for(self.cpu.segments[CS].selector))
                    .is_some())
        {
            return;
        }

        self.timer.raised = Some(self.clock_tick());
        self.timer.in_service = true;
        self.dpmi_hardware_interrupt(handler);
    }

    /// As time passes with every task waiting: a tick due raised to the
    /// program's handler as a procedure called at interrupt time, the
    /// frame's flags the waiting task's, its interrupt flag set.
    pub(crate) fn raise_timer_waiting(&mut self) {
        if self.interrupts.inside() {
            return;
        }

        let Some((cs, ip)) = self.timer_due() else {
            return;
        };

        self.timer.raised = Some(self.clock_tick());
        self.timer.in_service = true;

        let wake = Some(self.task_handle).filter(|&task| task != 0);

        self.at_interrupt(
            Interrupt {
                proc: u32::from(cs) << 16 | u32::from(ip),
                args: vec![GuestArg::Word(self.cpu.flags | INTERRUPT_FLAG)],
                key: Some(TIMER_KEY),
            },
            wake,
        );
    }

    /// The chain come to Windows' own handler, the host's stub: the tick
    /// counted, and the interrupt ended, as the BIOS's handler ends it.
    pub(crate) fn timer_reached_windows(&mut self) {
        self.account_ticks();
        self.timer.behind = (self.timer.behind - 1).max(0);
        self.timer.in_service = false;
    }

    /// A program's own write to the controller's port 20h: an end of
    /// interrupt ends the tick in service.
    pub(crate) fn interrupt_controller_write(&mut self, value: u8) {
        if value == END_OF_INTERRUPT || value == END_OF_IRQ_0 {
            self.timer.in_service = false;
        }
    }

    /// The ticks Windows' own handler has not counted, for `GetTickCount`:
    /// those behind, and those come since last looked at while a program's
    /// handler is set.
    pub(crate) fn ticks_behind(&self) -> u32 {
        let come = match (self.timer_handler(), self.timer.seen) {
            (Some(_), Some(seen)) => (self.clock_tick() - seen).max(0),
            _ => 0,
        };

        u32::try_from(self.timer.behind + come).unwrap_or(u32::MAX)
    }
}
