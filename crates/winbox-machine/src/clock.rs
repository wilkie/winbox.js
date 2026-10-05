//! The machine's time, as winbox.js's `Clock` keeps it: what
//! `GetTickCount`, a message's time, a timer and DOS's clock all read.
//!
//! Virtual, it is the program's instructions run at a fixed rate, with the
//! instructions charged for calls the program's processor did not run, and
//! the milliseconds skipped when nothing ran; waiting is a timer the clock
//! names as due when time passes it, for the engine to answer. A run on a
//! virtual clock does the same whatever the host's speed. Real, it is the
//! host's milliseconds since the machine started.
//!
//! The host's time is read from a source the clock is given, which a
//! virtual clock's own time never reads: natively the standard library's
//! `Instant`, and in a browser what the page gives it, where there is no
//! `Instant` to read.

use std::sync::OnceLock;
use std::time::Instant;

/// The survey's rate: 3,000 instructions a millisecond, about a 386's.
pub const INSTRUCTIONS_PER_MS: f64 = 3000.0;

/// What a call is charged on the survey's clock: 15 instructions, five
/// microseconds at its rate (`speed`).
pub const CALL_INSTRUCTIONS: f64 = 15.0;

/// The faithful clock's rate: the recorder's DOSBox at a fixed 80,000
/// cycles a millisecond, the rate the calls' costs were recorded at.
pub const FAITHFUL_INSTRUCTIONS_PER_MS: f64 = 80000.0;

/// The host's time in milliseconds, from a start of the host's own: only
/// how far apart two readings are means anything.
pub type HostTime = fn() -> f64;

/// The host's time as the standard library keeps it, from when it was
/// first read.
pub fn instant_ms() -> f64 {
    static START: OnceLock<Instant> = OnceLock::new();

    START.get_or_init(Instant::now).elapsed().as_secs_f64() * 1000.0
}

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
    /// Where the host's time is read from.
    host: HostTime,
    /// The host's time as the machine started, for the host's own clock;
    /// nought for a virtual one, which never reads it.
    start: f64,
}

impl Clock {
    /// A virtual clock at `rate` instructions a millisecond.
    pub fn virtual_at(rate: f64) -> Self {
        Self::virtual_with(rate, instant_ms)
    }

    /// A virtual clock at `rate` instructions a millisecond, on a host
    /// whose time is read from `host`: the clock's own time never reads
    /// it, only what is paced by the host's time does (`host_ms`).
    pub fn virtual_with(rate: f64, host: HostTime) -> Self {
        Self {
            rate: Some(rate),
            measured_calls: false,
            charged: 0.0,
            skipped: 0.0,
            pending: Vec::new(),
            next_id: 1,
            host,
            start: 0.0,
        }
    }

    /// The host's own time.
    pub fn real() -> Self {
        Self::real_with(instant_ms)
    }

    /// The host's own time, read from `host`.
    pub fn real_with(host: HostTime) -> Self {
        Self {
            rate: None,
            start: host(),
            ..Self::virtual_with(INSTRUCTIONS_PER_MS, host)
        }
    }

    /// The host's time read from `host` from now on; the host's own clock
    /// goes on from the time it had.
    pub fn set_host(&mut self, host: HostTime) {
        if self.rate.is_none() {
            let elapsed = self.host_ms() - self.start;

            self.start = host() - elapsed;
        }

        self.host = host;
    }

    /// The host's time now, in its own milliseconds, whatever the clock
    /// keeps: for what is paced by the host's time, as its frames are.
    pub fn host_ms(&self) -> f64 {
        (self.host)()
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
            None => (self.host_ms() - self.start).floor(),
        }
    }

    /// Milliseconds since the machine started, as [`Clock::now`] reads
    /// them but with their fraction: for a device timed finer than a
    /// millisecond, as the Ad Lib's timers are (80 microseconds a count).
    pub fn precise(&self, instructions: u64) -> f64 {
        match self.rate {
            #[allow(clippy::cast_precision_loss)]
            Some(rate) => (instructions as f64 + self.charged) / rate + self.skipped,
            None => self.host_ms() - self.start,
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
        if self.pending.is_empty() {
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
    /// due, or `None` where nothing was waiting. The host's own clock skips
    /// nothing: what has come due by now, its time having been waited out.
    pub fn idle(&mut self, instructions: u64) -> Option<Vec<TimerId>> {
        if self.rate.is_none() {
            return Some(self.tick(instructions));
        }

        if self.pending.is_empty() {
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

    /// A virtual clock keeps its time, its timers and its idling without
    /// ever reading the host's.
    #[test]
    fn a_virtual_clock_never_reads_the_hosts_time() {
        fn never() -> f64 {
            panic!("a virtual clock read the host's time")
        }

        let mut clock = Clock::virtual_with(3000.0, never);
        let timer = clock.after(0, 500.0);

        clock.charge(15.0);
        assert_eq!(clock.now(3000), 1.0);
        assert!(clock.tick(3000).is_empty());
        assert_eq!(clock.idle(3000), Some(vec![timer]));
        assert!(clock.advance(3000, 10.0).is_empty());
        assert_eq!(clock.now(3000), 510.0);
        assert_eq!(clock.clone().next_due(), f64::INFINITY);
    }

    /// The host's own clock reads the time it is given.
    #[test]
    fn the_hosts_clock_reads_its_source() {
        thread_local! {
            static NOW: std::cell::Cell<f64> = const { std::cell::Cell::new(1000.0) };
        }

        fn now() -> f64 {
            NOW.with(std::cell::Cell::get)
        }

        let clock = Clock::real_with(now);

        assert_eq!(clock.now(0), 0.0);
        NOW.with(|cell| cell.set(1250.75));
        assert_eq!(clock.now(0), 250.0);
        assert_eq!(clock.host_ms(), 1250.75);
    }

    #[test]
    fn the_hosts_clock_keeps_its_timers_until_their_time() {
        let mut clock = Clock::real();
        let soon = clock.after(0, 0.0);
        let later = clock.after(0, 60_000.0);

        assert_eq!(clock.idle(0), Some(vec![soon]));
        assert_eq!(clock.idle(0), Some(vec![]));
        assert!(clock.next_due() > 0.0);
        clock.cancel(later);
        assert_eq!(clock.idle(0), Some(vec![]));
    }
}
