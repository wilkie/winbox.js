//! The machine's time, as winbox.js's `Clock` keeps it: what
//! `GetTickCount`, a message's time, a timer and DOS's clock all read.
//!
//! Virtual, it is the program's instructions run at a fixed rate, with the
//! instructions charged for calls the program's processor did not run, and
//! the milliseconds skipped when nothing ran; waiting is a timer the clock
//! names as due when time passes it, for the engine to answer. A run on a
//! virtual clock does the same whatever the host's speed. Real, it is the
//! host's milliseconds since the machine started.

use std::time::Instant;

/// The survey's rate: 3,000 instructions a millisecond, about a 386's.
pub const INSTRUCTIONS_PER_MS: f64 = 3000.0;

/// What a call is charged on the survey's clock: 15 instructions, five
/// microseconds at its rate (`speed`).
pub const CALL_INSTRUCTIONS: f64 = 15.0;

/// The faithful clock's rate: the recorder's DOSBox at a fixed 80,000
/// cycles a millisecond, the rate the calls' costs were recorded at.
pub const FAITHFUL_INSTRUCTIONS_PER_MS: f64 = 80000.0;

/// A timer waiting on the clock, as the engine names it.
pub type TimerId = u64;

#[derive(Debug, Clone, Copy)]
struct Pending {
    due: f64,
    id: TimerId,
}

/// The machine's clock.
#[derive(Debug, Clone)]
pub struct Clock {
    /// Virtual, and its rate; `None` for the host's own time.
    rate: Option<f64>,
    /// Whether calls are charged the instructions recorded for them.
    pub measured_calls: bool,
    charged: f64,
    skipped: f64,
    pending: Vec<Pending>,
    next_id: TimerId,
    start: Instant,
}

impl Clock {
    /// A virtual clock at `rate` instructions a millisecond.
    pub fn virtual_at(rate: f64) -> Self {
        Self {
            rate: Some(rate),
            measured_calls: false,
            charged: 0.0,
            skipped: 0.0,
            pending: Vec::new(),
            next_id: 1,
            start: Instant::now(),
        }
    }

    /// The host's own time.
    pub fn real() -> Self {
        Self {
            rate: None,
            ..Self::virtual_at(INSTRUCTIONS_PER_MS)
        }
    }

    pub fn is_virtual(&self) -> bool {
        self.rate.is_some()
    }

    pub fn rate(&self) -> Option<f64> {
        self.rate
    }

    pub fn charged(&self) -> f64 {
        self.charged
    }

    pub fn skipped(&self) -> f64 {
        self.skipped
    }

    /// Milliseconds since the machine started, the program's processor
    /// having run `instructions`. In the same order of arithmetic as
    /// winbox.js's, so the two read alike to the millisecond.
    pub fn now(&self, instructions: u64) -> f64 {
        match self.rate {
            // A machine's count is far under 2^53, which a double holds.
            #[allow(clippy::cast_precision_loss)]
            Some(rate) => ((instructions as f64 + self.charged) / rate).floor() + self.skipped,
            None => (self.start.elapsed().as_secs_f64() * 1000.0).floor(),
        }
    }

    /// Instructions run that the processor did not count, as a call's.
    pub fn charge(&mut self, instructions: f64) {
        if self.rate.is_some() {
            self.charged += instructions;
        }
    }

    /// A timer due `ms` from now: its name.
    pub fn after(&mut self, instructions: u64, ms: f64) -> TimerId {
        let id = self.next_id;

        self.next_id += 1;
        self.pending.push(Pending {
            due: self.now(instructions) + ms.max(0.0),
            id,
        });
        id
    }

    pub fn cancel(&mut self, id: TimerId) {
        self.pending.retain(|pending| pending.id != id);
    }

    /// When the next timer is due; infinity for none.
    pub fn next_due(&self) -> f64 {
        self.pending
            .iter()
            .map(|pending| pending.due)
            .fold(f64::INFINITY, f64::min)
    }

    /// The timers come due, earliest first, taken off the clock.
    pub fn tick(&mut self, instructions: u64) -> Vec<TimerId> {
        if self.rate.is_none() || self.pending.is_empty() {
            return Vec::new();
        }

        let now = self.now(instructions);
        let mut due: Vec<Pending> = self
            .pending
            .iter()
            .copied()
            .filter(|p| p.due <= now)
            .collect();

        self.pending.retain(|pending| pending.due > now);
        due.sort_by(|a, b| a.due.total_cmp(&b.due));
        due.into_iter().map(|pending| pending.id).collect()
    }

    /// Nothing is running, so time moves to the next timer: those come
    /// due, or `None` where nothing was waiting.
    pub fn idle(&mut self, instructions: u64) -> Option<Vec<TimerId>> {
        if self.rate.is_none() || self.pending.is_empty() {
            return None;
        }

        let next = self.next_due();
        let now = self.now(instructions);

        if next > now {
            self.skipped += next - now;
        }

        Some(self.tick(instructions))
    }

    /// Time moved on by `ms`, as when nothing ran for a while: the timers
    /// come due.
    pub fn advance(&mut self, instructions: u64, ms: f64) -> Vec<TimerId> {
        if self.rate.is_none() {
            return Vec::new();
        }

        self.skipped += ms.ceil();
        self.tick(instructions)
    }
}

#[cfg(test)]
#[allow(clippy::float_cmp)]
mod tests {
    use super::*;

    #[test]
    fn keeps_time_by_instructions_and_charges() {
        let mut clock = Clock::virtual_at(3000.0);

        assert_eq!(clock.now(2999), 0.0);
        clock.charge(15.0);
        assert_eq!(clock.now(2999), 1.0);

        let timer = clock.after(3000, 10.0);

        assert!(clock.tick(30000).is_empty());
        assert_eq!(clock.tick(33000), vec![timer]);
    }

    #[test]
    fn skips_to_the_next_timer_when_idle() {
        let mut clock = Clock::virtual_at(3000.0);
        let timer = clock.after(0, 500.0);

        assert_eq!(clock.idle(0), Some(vec![timer]));
        assert_eq!(clock.now(0), 500.0);
        assert_eq!(clock.idle(0), None);
    }
}
