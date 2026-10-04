//! A program's messages, in the order Windows gives them, as winbox.js's
//! `queue.ts` keeps them: what was posted to its queue, the mouse's and
//! the keyboard's among them, first; then the quit; then, with nothing
//! queued, `WM_PAINT` for a window due to be painted; then `WM_TIMER` for
//! a timer that has come due. Neither of the last two is ever queued --
//! each is made when it is asked for and nothing else is waiting -- which
//! is why a timer set before a message is posted still comes after it.
//!
//! One task runs here, so a window's and a timer's task is always the one
//! looking.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

use std::collections::VecDeque;

use winbox_cpu::{AX, DS, ES, SS};

use crate::call::{Answer, Args, Later, Stop};
use crate::engine::{Engine, GuestArg, Register, Wait};
use crate::handles::Object;
use crate::messages::Param;
use crate::system::System;

pub const WM_QUIT: u16 = 0x0012;
pub const WM_KEYDOWN: u16 = 0x0100;
pub const WM_KEYUP: u16 = 0x0101;
pub const WM_SYSKEYDOWN: u16 = 0x0104;
pub const WM_SYSKEYUP: u16 = 0x0105;
pub const WM_TIMER: u16 = 0x0113;
pub const WM_SYSTIMER: u16 = 0x0118;
pub const WM_MOUSEMOVE: u16 = 0x0200;
const WM_SETCURSOR: u16 = 0x0020;

const PM_REMOVE: u16 = 0x0001;

const IDC_ARROW: u16 = 32512;
const HTCLIENT: u32 = 1;

/// A message, as `MSG` holds it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Message {
    pub hwnd: u16,
    pub message: u16,
    pub wparam: u16,
    pub lparam: u32,
    pub time: u32,
    pub pt: (i16, i16),
    /// Which input it is, to be found again; nought for one posted.
    pub serial: u64,
}

impl Message {
    /// As `MSG` lays it out: 18 bytes.
    fn bytes(&self) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(18);

        bytes.extend_from_slice(&self.hwnd.to_le_bytes());
        bytes.extend_from_slice(&self.message.to_le_bytes());
        bytes.extend_from_slice(&self.wparam.to_le_bytes());
        bytes.extend_from_slice(&self.lparam.to_le_bytes());
        bytes.extend_from_slice(&self.time.to_le_bytes());
        bytes.extend_from_slice(&self.pt.0.to_le_bytes());
        bytes.extend_from_slice(&self.pt.1.to_le_bytes());
        bytes
    }

    fn read(system: &System, far: u32) -> Self {
        let bytes = system.read_far(far, 18);
        let word = |at: usize| u16::from_le_bytes([bytes[at], bytes[at + 1]]);
        let long = |at: usize| u32::from(word(at)) | u32::from(word(at + 2)) << 16;

        Self {
            hwnd: word(0),
            message: word(2),
            wparam: word(4),
            lparam: long(6),
            time: long(10),
            pt: (word(14) as i16, word(16) as i16),
            serial: 0,
        }
    }
}

/// A task's message queue.
#[derive(Debug, Clone, Default)]
pub struct Queue {
    /// What was posted to it.
    pub messages: VecDeque<Message>,
    /// The mouse's and the keyboard's, kept apart: what was posted comes
    /// first.
    pub input: VecDeque<Message>,
    /// `PostQuitMessage`'s exit code, until the quit is taken.
    pub quit_code: Option<u16>,
    /// The kinds of message that came since a message was last taken, for
    /// `GetQueueStatus`.
    pub changes: u16,
    /// The time and the cursor's place of the message last taken.
    pub last_taken: Option<(u32, i16, i16)>,
}

impl Queue {
    /// A message pushed: one posted, or with `input`, the mouse's or the
    /// keyboard's.
    pub fn push(&mut self, message: Message, input: bool) {
        self.changes |= queue_kind(message.message, input);

        if input {
            self.input.push_back(message);
        } else {
            self.messages.push_back(message);
        }
    }

    fn peek(&self) -> Option<Message> {
        self.messages.front().or(self.input.front()).copied()
    }

    /// The oldest message that matches, posted before input, taken if
    /// asked.
    fn find(&mut self, matches: impl Fn(&Message) -> bool, remove: bool) -> Option<Message> {
        for queue in [&mut self.messages, &mut self.input] {
            if let Some(at) = queue.iter().position(&matches) {
                return if remove {
                    queue.remove(at)
                } else {
                    Some(queue[at])
                };
            }
        }

        None
    }

    fn pull(&mut self) -> Option<Message> {
        if self.messages.is_empty() {
            self.input.pop_front()
        } else {
            self.messages.pop_front()
        }
    }
}

/// The `QS_` kind a message is, for `GetQueueStatus`: a key's 1, a mouse
/// move's 2, a button's 4, one posted 8.
fn queue_kind(message: u16, input: bool) -> u16 {
    if !input {
        0x08
    } else if (0x100..=0x108).contains(&message) {
        0x01
    } else if message == 0x200 || message == 0xa0 {
        0x02
    } else {
        0x04
    }
}

/// A timer: for a window, or for a procedure.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Timer {
    pub hwnd: u16,
    pub id: u16,
    pub interval: f64,
    pub due: f64,
    /// The procedure it was set with, a far address; nought for none.
    pub proc: u32,
}

/// The filter `GetMessage` and `PeekMessage` take (`getmsg`): a window,
/// which takes its children's messages too, and a range of messages, both
/// ends in it, nought to nought for all -- or, first past last, the
/// messages outside it, both ends out.
#[derive(Debug, Clone, Copy)]
struct Filter {
    hwnd: u16,
    first: u16,
    last: u16,
}

impl Filter {
    fn filtered(self) -> bool {
        self.hwnd != 0 || self.first != 0 || self.last != 0
    }

    fn in_range(self, message: u16) -> bool {
        let Self { first, last, .. } = self;

        if first == 0 && last == 0 {
            true
        } else if first <= last {
            (first..=last).contains(&message)
        } else {
            message > first || message < last
        }
    }

    fn matches(self, system: &System, hwnd: u16, message: u16) -> bool {
        !self.filtered()
            || ((self.hwnd == 0 || hwnd == self.hwnd || system.is_child_of(self.hwnd, hwnd))
                && self.in_range(message))
    }
}

impl System {
    /// Milliseconds since the machine started, as a message's time.
    fn clock_now(&self) -> f64 {
        self.clock.now(self.instructions)
    }

    /// A message made now, at the cursor.
    pub(crate) fn message_now(
        &mut self,
        hwnd: u16,
        message: u16,
        wparam: u16,
        lparam: u32,
    ) -> Message {
        self.raster();

        Message {
            hwnd,
            message,
            wparam,
            lparam,
            time: self.clock_now() as u32,
            pt: self.cursor_of(),
            serial: 0,
        }
    }

    /// Whether a window is a child, at any depth, of another.
    pub fn is_child_of(&self, parent: u16, hwnd: u16) -> bool {
        let index = |hwnd: u16| match self.handles.resolve(hwnd) {
            Some(Object::Window(index)) if self.windows[index].is_some() => Some(index),
            _ => None,
        };
        let (Some(index), Some(parent)) = (index(hwnd), index(parent)) else {
            return false;
        };
        let mut at = self.windows[index]
            .as_ref()
            .and_then(|window| window.parent);

        while let Some(above) = at {
            if above == parent {
                return true;
            }

            at = self.windows[above]
                .as_ref()
                .and_then(|window| window.parent);
        }

        false
    }

    /// A message posted to the queue of the task that made a window, or of
    /// the running one: here, the one. Whether there was a task to take it.
    pub fn post_message(&mut self, hwnd: u16, message: u16, wparam: u16, lparam: u32) -> bool {
        let made = self.message_now(hwnd, message, wparam, lparam);
        let Some(task) = self.task.as_mut() else {
            return false;
        };

        task.queue.push(made, false);
        self.signal();
        true
    }

    /// What wakes the task where it waits for a message.
    pub fn signal(&mut self) {
        if self.wait == Wait::Waiting {
            self.wait = Wait::Woken;
        }
    }

    /// Sets a timer, or resets one, for a window or for a procedure: its
    /// identifier, or 1 for a procedure's of nought. Windows' own clock
    /// ticks about every 55 milliseconds; no timer is quicker.
    pub fn set_timer(&mut self, hwnd: u16, id: u16, interval: u16, proc: u32) -> u16 {
        let every = f64::from(interval.max(55));
        let timer = Timer {
            hwnd,
            id,
            interval: every,
            due: self.clock_now() + every,
            proc,
        };

        // Set again, a timer keeps its place among the others.
        match self
            .timers
            .iter_mut()
            .find(|each| each.hwnd == hwnd && each.id == id)
        {
            Some(each) => *each = timer,
            None => self.timers.push(timer),
        }

        if id == 0 { 1 } else { id }
    }

    /// Stops a timer; whether there was one.
    pub fn kill_timer(&mut self, hwnd: u16, id: u16) -> bool {
        let before = self.timers.len();

        self.timers
            .retain(|each| !(each.hwnd == hwnd && each.id == id));
        self.timers.len() != before
    }

    /// Stops every timer a window has, as destroying it does.
    pub fn kill_timers_of(&mut self, hwnd: u16) {
        self.timers.retain(|each| each.hwnd != hwnd);
    }

    /// The timer that is due first, if one is due now -- the first set of
    /// those due together; `remove` sets it going again.
    fn due_timer(&mut self, remove: bool, filter: Filter) -> Option<Timer> {
        let now = self.clock_now();
        let mut earliest: Option<usize> = None;

        for (at, timer) in self.timers.iter().enumerate() {
            if !filter.matches(self, timer.hwnd, WM_TIMER) {
                continue;
            }

            if earliest.is_none_or(|first| timer.due < self.timers[first].due) {
                earliest = Some(at);
            }
        }

        let at = earliest?;

        if self.timers[at].due > now {
            return None;
        }

        if remove {
            self.timers[at].due = now + self.timers[at].interval;
        }

        Some(self.timers[at])
    }

    /// Whether any window is due a paint: then a look is left to
    /// `next_message`, as asking which is due makes it ready to paint.
    fn any_unpainted(&self) -> bool {
        self.windows
            .iter()
            .flatten()
            .any(|window| window.needs_paint)
    }

    /// Whether a look that does not wait would find nothing, known without
    /// changing anything: nothing queued that the filter takes, no quit,
    /// nothing to paint, no timer due.
    fn no_message_now(&mut self, filter: Filter) -> bool {
        let Some(task) = self.task.as_ref() else {
            return true;
        };
        let queued = if filter.filtered() {
            task.queue
                .messages
                .iter()
                .chain(&task.queue.input)
                .any(|one| filter.matches(self, one.hwnd, one.message))
        } else {
            task.queue.peek().is_some()
        };

        if queued || task.queue.quit_code.is_some() || self.any_unpainted() {
            return false;
        }

        self.due_timer(false, filter).is_none()
    }

    /// The keys' state moved with a key's message taken: down, its toggle
    /// turned where it was up; up, let go (`noteKey`).
    fn note_key(&mut self, message: &Message) {
        let table = &mut self.user_state.key_states;
        let key = usize::from(message.wparam as u8);

        match message.message {
            WM_KEYDOWN | WM_SYSKEYDOWN => {
                if table[key] & 0x80 == 0 {
                    table[key] ^= 0x01;
                }

                table[key] |= 0x80;
            }
            WM_KEYUP | WM_SYSKEYUP => table[key] &= !0x80,
            _ => {}
        }
    }

    /// What `GetMessage` and `PeekMessage` note of the message taken.
    fn note_taken(&mut self, message: &Message) {
        if let Some(task) = self.task.as_mut() {
            task.queue.last_taken = Some((message.time, message.pt.0, message.pt.1));
            task.queue.changes = 0;
        }
    }
}

/// What a look finds past the queue.
enum Further {
    Found(Message),
    Nothing,
    /// To wait, as long as this or for anything.
    Wait(Option<f64>),
}

impl System {
    /// Past what was queued: the quit, once, after everything posted and
    /// before a paint or a timer, which passes every filter (`quitord`,
    /// `getmsg`); a window to paint; a timer due; or nothing, and how long
    /// to wait for this task's next timer to be due.
    fn look_further(&mut self, remove: bool, wait: bool, filter: Filter) -> Result<Further, Stop> {
        let task = self.task.as_mut().expect("a task");

        if let Some(code) = task.queue.quit_code {
            if remove {
                task.queue.quit_code = None;
            }

            return Ok(Further::Found(self.message_now(0, WM_QUIT, code, 0)));
        }

        // A window due to be painted: `WM_PAINT`, or `WM_PAINTICON` for an
        // icon, made when it is asked for and nothing else is waiting.
        let unpainted = self.unpainted_where(|system, index| {
            let hwnd = system.windows[index]
                .as_ref()
                .map_or(0, |window| window.hwnd);

            filter.matches(system, hwnd, system.paint_message(index).0)
        });

        if let Some(index) = unpainted {
            let hwnd = self.windows[index].as_ref().map_or(0, |window| window.hwnd);
            let (message, wparam) = self.paint_message(index);

            return Ok(Further::Found(self.message_now(hwnd, message, wparam, 0)));
        }

        if let Some(timer) = self.due_timer(remove, filter) {
            return Ok(Further::Found(
                self.message_now(timer.hwnd, WM_TIMER, timer.id, timer.proc),
            ));
        }

        if !wait {
            return Ok(Further::Nothing);
        }

        let due = self
            .timers
            .iter()
            .map(|timer| timer.due)
            .fold(f64::INFINITY, f64::min);

        Ok(Further::Wait(
            due.is_finite().then(|| due - self.clock_now()),
        ))
    }
}

impl Engine {
    /// The next message, as `GetMessage` takes it (`wait`) or `PeekMessage`
    /// looks at it (`remove` or not): `None` when there is none and not
    /// waiting.
    async fn next_message(
        &self,
        remove: bool,
        wait: bool,
        filter: Filter,
    ) -> Result<Option<Message>, Stop> {
        loop {
            let taken = {
                let mut system = self.system();
                let system = &mut *system;

                if system.task.is_none() {
                    return Ok(None);
                }

                if filter.filtered() {
                    let mut queue = std::mem::take(&mut system.task.as_mut().unwrap().queue);
                    let found =
                        queue.find(|one| filter.matches(system, one.hwnd, one.message), remove);

                    system.task.as_mut().unwrap().queue = queue;
                    found
                } else {
                    let queue = &mut system.task.as_mut().unwrap().queue;

                    if remove { queue.pull() } else { queue.peek() }
                }
            };

            if let Some(message) = taken {
                if remove {
                    self.system().note_key(&message);
                    self.ask_for_cursor(&message).await?;
                }

                return Ok(Some(message));
            }

            let timeout = match self.system().look_further(remove, wait, filter)? {
                Further::Found(message) => return Ok(Some(message)),
                Further::Nothing => return Ok(None),
                Further::Wait(timeout) => timeout,
            };

            self.wait_for_wake(timeout).await;
        }
    }

    /// Before a mouse message taken is handed over: the window asked for
    /// the cursor, or the arrow shown for the desktop.
    async fn ask_for_cursor(&self, message: &Message) -> Result<(), Stop> {
        let kind = message.message;
        let client = (0x200..=0x209).contains(&kind);
        let nonclient = (0xa0..=0xa9).contains(&kind);

        if !client && !nonclient {
            return Ok(());
        }

        {
            let mut system = self.system();
            let desktop = system.handles.lookup(Object::Desktop);

            if message.hwnd == 0 || Some(message.hwnd) == desktop {
                let arrow = crate::icons::standard_cursor_handle(&mut system, IDC_ARROW);

                system.cursor = Some(arrow);
                return Ok(());
            }
        }

        let hit = if client {
            HTCLIENT
        } else {
            u32::from(message.wparam)
        };
        let mouse = u32::from(if client { kind } else { kind - 0xa0 + 0x200 });

        self.send_message(
            message.hwnd,
            WM_SETCURSOR,
            message.hwnd,
            &mut Param::Value(mouse << 16 | hit),
        )
        .await?;
        Ok(())
    }

    /// A timer's procedure called, as `DispatchMessage` calls one (seg1
    /// `277c`): AX, DS and ES the stack's segment.
    async fn call_timer_proc(&self, message: &Message) -> Result<u32, Stop> {
        let (proc, stack) = {
            let system = self.system();
            let timer = system
                .timers
                .iter()
                .find(|each| each.hwnd == message.hwnd && each.id == message.wparam);

            (
                timer.map_or(message.lparam, |timer| timer.proc),
                system.cpu.segments[SS].selector,
            )
        };

        if proc == 0 {
            return Ok(0);
        }

        let args = [
            GuestArg::Word(message.hwnd),
            GuestArg::Word(WM_TIMER),
            GuestArg::Word(message.wparam),
            GuestArg::Long(message.time),
        ];
        let registers = [
            Register::Word(AX, stack),
            Register::Segment(DS, stack),
            Register::Segment(ES, stack),
        ];

        Ok(self.call_with(proc, &args, &registers).await?.0)
    }
}

/// The next message, waiting for one, from the window and the range asked
/// for: FALSE for the quit.
pub fn get_message(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (far, filter) = {
            let system = engine.system();
            let far = args.dword(&system);
            let hwnd = args.word(&system);
            let first = args.word(&system);
            let last = args.word(&system);

            (far, Filter { hwnd, first, last })
        };

        // What is pending on the raster desktop is looked at first.
        engine.system().raster();

        let message = engine
            .next_message(true, true, filter)
            .await?
            .ok_or(Stop::Unsupported("a message never come"))?;
        let mut system = engine.system();

        system.write_far(far, &message.bytes());
        system.note_taken(&message);
        Ok(Answer::Word(u16::from(message.message != WM_QUIT)))
    })
}

/// The next message, if there is one; it never waits. With nothing, the
/// other tasks run, unless `PM_NOYIELD` asks not -- here there are none
/// -- and it looks again.
pub fn peek_message(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (far, filter, remove) = {
            let mut system = engine.system();
            let far = args.dword(&system);
            let hwnd = args.word(&system);
            let first = args.word(&system);
            let last = args.word(&system);
            let remove = args.word(&system);
            let filter = Filter { hwnd, first, last };

            // What is pending on the raster desktop is looked at first.
            system.raster();

            if system.no_message_now(filter) {
                return Ok(Answer::Word(0));
            }

            (far, filter, remove)
        };
        let Some(message) = engine
            .next_message(remove & PM_REMOVE != 0, false, filter)
            .await?
        else {
            return Ok(Answer::Word(0));
        };
        let mut system = engine.system();

        system.write_far(far, &message.bytes());
        system.note_taken(&message);
        Ok(Answer::Word(1))
    })
}

/// A message posted to a window's task's queue.
pub fn post_message(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);
    let message = args.word(system);
    let wparam = args.word(system);
    let lparam = args.dword(system);

    Ok(Answer::Word(u16::from(
        system.post_message(hwnd, message, wparam, lparam),
    )))
}

/// Not a message in the queue but a flag on it, with the exit code, as
/// USER keeps it. **Recorded** by `quitord`: `WM_QUIT` comes after every
/// message posted -- one posted after the quit as well as one before --
/// and before the paint and the timer that were also waiting, and once.
pub fn post_quit_message(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let code = args.word(system);

    if let Some(task) = system.task.as_mut() {
        task.queue.quit_code = Some(code);
    }

    Ok(Answer::Nothing)
}

/// A message sent to a window's procedure; a handle that is no window's
/// refused, nought, as USER's validation layer does.
pub fn send_message(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (hwnd, message, wparam, lparam) = {
            let system = engine.system();
            let hwnd = args.word(&system);
            let message = args.word(&system);
            let wparam = args.word(&system);
            let lparam = args.dword(&system);

            (hwnd, message, wparam, lparam)
        };
        let answer = engine
            .send_message(hwnd, message, wparam, &mut Param::Value(lparam))
            .await?;

        Ok(Answer::Dword(answer))
    })
}

/// A message taken handed to its window's procedure -- or to its timer's,
/// where a timer was set with one.
pub fn dispatch_message(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let message = {
            let system = engine.system();
            let far = args.dword(&system);

            Message::read(&system, far)
        };

        // A timer set with a procedure calls it, not the window's.
        if message.message == WM_TIMER && message.lparam != 0 {
            return Ok(Answer::Dword(engine.call_timer_proc(&message).await?));
        }

        // A system timer, such as the caret's blink, always has one.
        if message.message == WM_SYSTIMER {
            return Err(Stop::Unsupported("a system timer"));
        }

        // The desktop, which has no class of a program's, does nothing
        // visible with what it is given; nor does a window gone.
        let answer = engine
            .send_message(
                message.hwnd,
                message.message,
                message.wparam,
                &mut Param::Value(message.lparam),
            )
            .await?;

        Ok(Answer::Dword(answer))
    })
}

/// Whether a message is a key's. A key that typed a character posts it,
/// as `WM_CHAR`, after the key; nothing is typed here, so nothing is
/// posted.
pub fn translate_message(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);
    let message = Message::read(system, far);
    let key = matches!(
        message.message,
        WM_KEYDOWN | WM_KEYUP | WM_SYSKEYDOWN | WM_SYSKEYUP
    );

    // A key's: what it typed is asked of the raster desktop's input.
    if key {
        system.raster();
    }

    Ok(Answer::Word(u16::from(key)))
}

pub fn set_timer(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);
    let id = args.word(system);
    let interval = args.word(system);
    let proc = args.dword(system);

    Ok(Answer::Word(system.set_timer(hwnd, id, interval, proc)))
}

pub fn kill_timer(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);
    let id = args.word(system);

    Ok(Answer::Word(u16::from(system.kill_timer(hwnd, id))))
}

/// The time of the message last taken.
pub fn get_message_time(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    let taken = system.task.as_ref().and_then(|task| task.queue.last_taken);

    Ok(Answer::Dword(taken.map_or(0, |(time, _, _)| time)))
}

/// Where the cursor was for the message last taken.
pub fn get_message_pos(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    let taken = system.task.as_ref().and_then(|task| task.queue.last_taken);

    Ok(Answer::Dword(taken.map_or(0, |(_, x, y)| {
        u32::from(x as u16) | u32::from(y as u16) << 16
    })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_filter_takes_its_range_or_outside_it() {
        let range = |first, last| Filter {
            hwnd: 0,
            first,
            last,
        };

        assert!(range(0, 0).in_range(0x400));
        assert!(range(0x100, 0x108).in_range(0x100));
        assert!(range(0x100, 0x108).in_range(0x108));
        assert!(!range(0x100, 0x108).in_range(0x109));
        // First past last: outside it, both ends out (`getmsg`).
        assert!(!range(0x108, 0x100).in_range(0x100));
        assert!(!range(0x108, 0x100).in_range(0x104));
        assert!(range(0x108, 0x100).in_range(0x0ff));
        assert!(range(0x108, 0x100).in_range(0x109));
    }

    #[test]
    fn posted_comes_before_input() {
        let message = |message| Message {
            hwnd: 0,
            message,
            wparam: 0,
            lparam: 0,
            time: 0,
            pt: (0, 0),
            serial: 0,
        };
        let mut queue = Queue::default();

        queue.push(message(WM_KEYDOWN), true);
        queue.push(message(0x400), false);
        assert_eq!(queue.changes, 0x09);
        assert_eq!(queue.pull().map(|one| one.message), Some(0x400));
        assert_eq!(queue.pull().map(|one| one.message), Some(WM_KEYDOWN));
        assert_eq!(queue.pull(), None);
    }
}
