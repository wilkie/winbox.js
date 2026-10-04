//! MMSYSTEM's timer services. **Recorded** by `mmtime`:
//!
//! * `timeGetDevCaps` gives periods from 1 to 65535, and answers
//!   `TIMERR_NOCANDO`, 97, writing nothing, for a structure too small.
//! * `timeBeginPeriod` and `timeEndPeriod` answer nought for a period of 1,
//!   and 97 for nought; `timeBeginPeriod` answers 97 for 65535 as well.
//! * `timeGetTime` counts milliseconds from where `GetTickCount` counts
//!   them, a millisecond at a time.
//! * `timeGetSystemTime` answers nought and gives milliseconds, whatever
//!   type it was asked for.
//! * `timeSetEvent` answers an event's id, or nought for a delay of nought.
//!   The procedure is called at interrupt time with the id, nought, the
//!   caller's `DWORD` and two noughts: once for `TIME_ONESHOT`, after which
//!   the event is gone, and every period for `TIME_PERIODIC` until
//!   `timeKillEvent`, which answers nought, or 97 for an event there is not.
//!
//! Not recorded: the ids themselves (here counted from 1), the resolution,
//! which changes nothing here, and what becomes of a task's events when it
//! ends -- here they stop.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

use winbox_machine::TimerId;

use crate::call::{Answer, Args, Stop};
use crate::engine::GuestArg;
use crate::interrupts::Interrupt;
use crate::system::System;

const TIMERR_NOCANDO: u16 = 97;
const TIME_PERIODIC: u16 = 1;
const TIME_MS: u16 = 1;

/// An event set: when it is next due, in the clock's milliseconds, and
/// what it calls.
#[derive(Debug, Clone)]
struct Event {
    id: u16,
    /// Never the same for two events, whose interrupts it names.
    serial: u64,
    due: f64,
    delay: f64,
    periodic: bool,
    proc: u32,
    user: u32,
    /// The clock's timer for its next time, which wakes a task that waits.
    timer: Option<TimerId>,
    /// The task that set it, woken to call it.
    task: u16,
}

/// The events set, in the order they were set, and how many have been.
#[derive(Debug, Default)]
pub struct TimeEvents {
    events: Vec<Event>,
    count: u64,
}

impl System {
    /// Calls what has come due, at interrupt time (`interrupts.rs`): looked
    /// at between slices of a task's instructions, as a program running on
    /// sees the time pass, and as time passes while it waits, which an
    /// event's own timer on the clock makes it do. A program that calls the
    /// API over and over without waiting is looked at after each call.
    pub(crate) fn poll_time_events(&mut self) {
        if self.mmsystem.time.events.is_empty() {
            return;
        }

        let now = self.clock.now(self.instructions);
        let serials: Vec<u64> = self
            .mmsystem
            .time
            .events
            .iter()
            .map(|event| event.serial)
            .collect();

        for serial in serials {
            let Some(at) = self.event_at(serial) else {
                continue;
            };
            let event = self.mmsystem.time.events[at].clone();

            if event.due > now {
                continue;
            }

            if self.ended {
                self.stop_event(at);
                continue;
            }

            if event.periodic {
                self.mmsystem.time.events[at].due = (event.due + event.delay).max(now);
                self.arm_event(at);
            } else {
                self.stop_event(at);
            }

            self.at_interrupt(
                Interrupt {
                    proc: event.proc,
                    args: vec![
                        GuestArg::Word(event.id),
                        GuestArg::Word(0),
                        GuestArg::Long(event.user),
                        GuestArg::Long(0),
                        GuestArg::Long(0),
                    ],
                    key: Some(event.serial),
                },
                Some(event.task),
            );
        }
    }

    fn event_at(&self, serial: u64) -> Option<usize> {
        self.mmsystem
            .time
            .events
            .iter()
            .position(|event| event.serial == serial)
    }

    /// The clock's timer for an event's next time, to wake a task that
    /// waits.
    fn arm_event(&mut self, at: usize) {
        if let Some(timer) = self.mmsystem.time.events[at].timer.take() {
            self.clock.cancel(timer);
        }

        let wait = self.mmsystem.time.events[at].due - self.clock.now(self.instructions);

        self.mmsystem.time.events[at].timer = Some(self.clock.after(self.instructions, wait));
    }

    fn stop_event(&mut self, at: usize) {
        let event = self.mmsystem.time.events.remove(at);

        if let Some(timer) = event.timer {
            self.clock.cancel(timer);
        }
    }

    /// Milliseconds since Windows started, as `GetTickCount` counts them:
    /// wrapping at 2^32, as winbox.js's `>>> 0` makes them.
    pub(crate) fn milliseconds(&self) -> u32 {
        super::uint32(self.clock.now(self.instructions))
    }
}

/// Milliseconds since Windows started, as `GetTickCount` counts them.
pub fn time_get_time(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    Ok(Answer::Dword(system.milliseconds()))
}

/// What the timer can do: periods from 1 to 65535.
pub fn time_get_dev_caps(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);
    let size = args.word(system);

    if far == 0 || size < 4 {
        return Ok(Answer::Word(TIMERR_NOCANDO));
    }

    system.write_far(far, &[1, 0, 0xff, 0xff]);
    Ok(Answer::Word(0))
}

/// Asks for a period, which changes nothing here.
pub fn time_begin_period(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let period = args.word(system);

    Ok(Answer::Word(if period == 0 || period == 0xffff {
        TIMERR_NOCANDO
    } else {
        0
    }))
}

/// Lets a period go.
pub fn time_end_period(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let period = args.word(system);

    Ok(Answer::Word(if period == 0 { TIMERR_NOCANDO } else { 0 }))
}

/// The time as an `MMTIME`, in milliseconds whatever was asked.
pub fn time_get_system_time(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);
    let _size = args.word(system);
    let ms = system.milliseconds();
    let mut bytes = TIME_MS.to_le_bytes().to_vec();

    bytes.extend_from_slice(&(ms as u16).to_le_bytes());
    bytes.extend_from_slice(&((ms >> 16) as u16).to_le_bytes());
    system.write_far(far, &bytes);
    Ok(Answer::Word(0))
}

/// Calls a procedure after a delay, or every period: the event's id, or
/// nought for no delay or no procedure.
pub fn time_set_event(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let delay = args.word(system);
    let _resolution = args.word(system);
    let proc = args.dword(system);
    let user = args.dword(system);
    let flags = args.word(system);

    if delay == 0 || proc == 0 {
        return Ok(Answer::Word(0));
    }

    let time = &mut system.mmsystem.time;

    time.count += 1;

    let id = time.count as u16;
    let serial = time.count;
    let event = Event {
        id,
        serial,
        due: system.clock.now(system.instructions) + f64::from(delay),
        delay: f64::from(delay),
        periodic: flags & TIME_PERIODIC != 0,
        proc,
        user,
        timer: None,
        task: system.task_handle,
    };

    // Under an id in use -- the count come round -- the new event takes the
    // old one's place, as winbox.js's map of them has it, the old one's
    // timer left on the clock.
    let events = &mut system.mmsystem.time.events;
    let at = if let Some(at) = events.iter().position(|each| each.id == id) {
        events[at] = event;
        at
    } else {
        events.push(event);
        events.len() - 1
    };

    system.arm_event(at);
    Ok(Answer::Word(id))
}

/// Stops an event: nought, or 97 for an event there is not. Nothing more is
/// called, not even a call due and not yet made: on Windows it would have
/// been made already.
pub fn time_kill_event(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let id = args.word(system);
    let Some(at) = system
        .mmsystem
        .time
        .events
        .iter()
        .position(|each| each.id == id)
    else {
        return Ok(Answer::Word(TIMERR_NOCANDO));
    };
    let serial = system.mmsystem.time.events[at].serial;

    system.stop_event(at);
    system.cancel_interrupts(serial);
    Ok(Answer::Word(0))
}
