//! The engine: the system, and the program on it run as a future, so that
//! a call can be answered in its time -- calling back into the program,
//! or waiting for a message while time passes -- on one thread, in the
//! browser as natively.

use std::cell::{Cell, RefCell, RefMut};
use std::future::Future;
use std::pin::{Pin, pin};
use std::rc::Rc;
use std::task::{Context, Poll, Waker};

use winbox_cpu::{AX, CS, DX, SP, SS, Segment};
use winbox_machine::segment_selector;

use crate::call::Stop;
use crate::run::Event;
use crate::system::System;

/// How deep the frame a procedure is called with goes below the caller's
/// stack, as Windows makes room there.
const CALL_FRAME: u16 = 0x60;

/// The processor's state, as a call into the program leaves it to be put
/// back.
#[derive(Debug, Clone, Copy)]
struct Saved {
    regs: [u16; 8],
    high: [u16; 8],
    ip: u16,
    flags: u16,
    segments: [Segment; 6],
}

/// A register a called procedure is to find set.
#[derive(Debug, Clone, Copy)]
pub enum Register {
    Word(usize, u16),
    Segment(usize, u16),
}

/// How the engine waits for the host's time to pass, as a sound plays out
/// or the host's own clock comes to its next timer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Pace {
    /// The thread sleeps, as a native front end's may.
    #[default]
    Blocking,
    /// The wait is never slept: what waits stays pending until the host's
    /// time comes, and the run goes back to its caller in the meantime, as
    /// a browser's must, whose page cannot be held.
    Yielding,
}

/// The engine.
#[derive(Debug)]
pub struct Engine {
    system: RefCell<System>,
    /// Where the run's instructions end.
    end: Cell<u64>,
    /// When the run's time ends, in the clock's milliseconds.
    until: Cell<f64>,
    /// How it waits for the host's time.
    pace: Cell<Pace>,
    /// The earliest host's time a wait is pending on (`until_host`), in
    /// the host's milliseconds.
    host_wake: Cell<Option<f64>>,
    /// When, in the host's time, the run gives its caller the thread back
    /// (`EngineRun::step`); infinity for a run that keeps it.
    deadline: Cell<f64>,
    /// Whether the task with the processor has given the thread back at
    /// the deadline.
    yielded: Cell<bool>,
}

impl Engine {
    pub fn new(system: System) -> Self {
        Self {
            system: RefCell::new(system),
            end: Cell::new(0),
            until: Cell::new(f64::INFINITY),
            pace: Cell::new(Pace::Blocking),
            host_wake: Cell::new(None),
            deadline: Cell::new(f64::INFINITY),
            yielded: Cell::new(false),
        }
    }

    pub fn pace(&self) -> Pace {
        self.pace.get()
    }

    pub fn set_pace(&self, pace: Pace) {
        self.pace.set(pace);
    }

    /// The system, for as long as this is held: not across an `await`.
    pub fn system(&self) -> RefMut<'_, System> {
        self.system.borrow_mut()
    }

    pub fn into_system(self) -> System {
        self.system.into_inner()
    }

    /// The task run until it ends, something is met that is not answered
    /// yet, `budget` instructions have run, or `seconds` have passed on
    /// the clock.
    pub fn run(&self, budget: u64, seconds: f64) -> Stop {
        self.limit(budget, seconds);

        let mut tasks = Tasks::new(Box::pin(self.run_until_returned()));

        loop {
            match self.round(&mut tasks, &self) {
                Round::Again | Round::Yielded => {}
                // Nothing left to wait for, with no caller to launch another.
                Round::Idle(wake) if wake.is_infinite() => return Stop::Ended,
                // Yielding, what waits for the host's time is waited for
                // here, where there is no caller to go back to.
                Round::Idle(wake) => {
                    let wait = wake - self.system().clock.host_ms();

                    if wait > 0.0 {
                        std::thread::sleep(std::time::Duration::from_secs_f64(wait / 1000.0));
                    }
                }
                Round::Stopped(stop) => return stop,
            }
        }
    }

    /// The run, made to be stepped (`EngineRun::step`) rather than run to
    /// its end at once, as a browser's frames step it: until it ends,
    /// something is met that is not answered yet, `budget` instructions
    /// have run, or `seconds` have passed on the clock. A run stepped does
    /// what one run at once does, to the instruction.
    pub fn begin(self: &Rc<Self>, budget: u64, seconds: f64) -> EngineRun {
        self.limit(budget, seconds);

        let (end, until) = (self.end.get(), self.until.get());
        let engine = Rc::clone(self);

        EngineRun {
            kept: Kept(Rc::clone(self)),
            tasks: Tasks::new(Box::pin(async move { engine.run_until_returned().await })),
            end,
            until,
            stopped: None,
        }
    }

    /// Where a run of `budget` instructions and `seconds` on the clock,
    /// from now, ends.
    fn limit(&self, budget: u64, seconds: f64) {
        let (instructions, now) = {
            let system = self.system();

            (system.instructions, system.clock.now(system.instructions))
        };

        self.end.set(instructions + budget);
        self.until.set(now + seconds * 1000.0);
    }

    /// A round of every task's run, each a future of its own, polled in
    /// turn: the one with the processor goes on until it gives it up, and
    /// when none can go on, time passes to what wakes one. A task started
    /// is taken up as it is; one that ends is let go, and the run goes on
    /// while any task is left, until Windows is exited or the time given is
    /// up. A round that gives the thread back -- at the deadline, or to
    /// wait for the host's time -- goes on from where it was when it is
    /// come back to, as though it had never stopped.
    fn round<'a>(&self, tasks: &mut Tasks<'a>, spawn: &impl Spawn<'a>) -> Round {
        let mut context = Context::from_waker(Waker::noop());

        if tasks.passing.is_none() {
            let (mut at, before) = if let Some(within) = tasks.within.take() {
                within
            } else {
                let started = std::mem::take(&mut self.system().scheduler.started);

                for slot in started {
                    tasks.runs.push(spawn.task(slot));
                }

                let system = self.system();

                (0, (system.instructions, system.scheduler.current))
            };

            while at < tasks.runs.len() {
                match tasks.runs[at].as_mut().poll(&mut context) {
                    Poll::Pending => {
                        // The thread given back: this run is polled first
                        // when it is come back to.
                        if self.yielded.take() {
                            tasks.within = Some((at, before));
                            return Round::Yielded;
                        }

                        if let Some(wake) = self.host_wake.take() {
                            tasks.within = Some((at, before));
                            return Round::Idle(wake);
                        }

                        at += 1;
                    }
                    Poll::Ready(Err(Stop::Ended))
                        if !self.system().ended
                            && (self.system().task_count() > 0 || self.system().stays_up) =>
                    {
                        drop(tasks.runs.remove(at));
                    }
                    Poll::Ready(Err(stop)) => return Round::Stopped(stop),
                    Poll::Ready(Ok(())) => {
                        drop(tasks.runs.remove(at));
                    }
                }
            }

            // Every task ended: the run is over, unless Windows stays up,
            // where it waits for the next launched, for as long as that
            // takes.
            if tasks.runs.is_empty() {
                if self.system().stays_up && !self.system().ended {
                    return Round::Idle(f64::INFINITY);
                }

                return Round::Stopped(Stop::Ended);
            }

            // A task holds the processor and went on, or one was started:
            // round again before time is let pass.
            let (moved, started) = {
                let system = self.system();

                (
                    system.scheduler.current.is_some()
                        && (system.instructions, system.scheduler.current) != before,
                    !system.scheduler.started.is_empty(),
                )
            };

            if moved || started {
                return Round::Again;
            }

            tasks.passing = Some(spawn.pass());
        }

        let passing = tasks.passing.as_mut().expect("time passing");

        match passing.as_mut().poll(&mut context) {
            Poll::Pending => Round::Idle(
                self.host_wake
                    .take()
                    .expect("time waits only for the host's time"),
            ),
            Poll::Ready(going) => {
                tasks.passing = None;

                if going {
                    Round::Again
                } else {
                    Round::Stopped(self.time_stop())
                }
            }
        }
    }

    /// A task started, run once it is granted the processor.
    async fn task_run(&self, slot: usize) -> Result<(), Stop> {
        Held(self, slot).await;
        self.run_until_returned().await
    }

    /// A procedure of the program's called from the host, as `call_guest`
    /// calls one, and run to its return.
    pub fn call(&self, procedure: u32, words: &[u16], registers: &[Register]) -> Result<u32, Stop> {
        self.end.set(self.system().instructions + 100_000_000);
        self.block_on(self.call_guest(procedure, words, registers))
    }

    /// The program run, calls answered, until a procedure called returns.
    async fn run_until_returned(&self) -> Result<(), Stop> {
        loop {
            let event = self.system().run_until_event(
                self.end.get(),
                self.until.get(),
                self.deadline.get(),
            );

            match event {
                Event::Returned => return Ok(()),
                Event::Interrupt(interrupt) => self.deliver_interrupt(interrupt).await?,
                Event::Fault(vector) => self.application_fault(vector).await?,
                Event::Yield => GiveBack(self, false).await,
                Event::Stop(stop) => return Err(stop),
                Event::Call(pending) => {
                    let answer = (pending.implementation)(self, pending.args).await;

                    self.system().finish_call(pending.logged, answer)?;
                }
            }
        }
    }

    /// A procedure of the program's called with words, as `call_with`
    /// calls one: its answer, DX:AX.
    pub async fn call_guest(
        &self,
        procedure: u32,
        words: &[u16],
        registers: &[Register],
    ) -> Result<u32, Stop> {
        let args: Vec<GuestArg> = words.iter().map(|&word| GuestArg::Word(word)).collect();

        Ok(self.call_with(procedure, &args, registers).await?.0)
    }

    /// A procedure of the program's called, as USER and KERNEL call one
    /// (`Scheduler.call`): each structure laid out below the stack, from
    /// where the stack is down, and given as a far pointer to it; a frame
    /// made below the stack; the arguments pushed in turn, a long's high
    /// word first; `registers` set; and the far call made from USER's
    /// callback thunk, whose `INT 81h` it returns to. Its answer, DX:AX,
    /// and each structure as the procedure left it; the processor then as
    /// it was.
    pub async fn call_with(
        &self,
        procedure: u32,
        args: &[GuestArg],
        registers: &[Register],
    ) -> Result<(u32, Vec<Vec<u8>>), Stop> {
        let (saved, placed) = {
            let mut system = self.system();
            let user = system.kept_named("USER").ok_or(Stop::Unsupported("USER"))?;
            let thunk = system.stubs(user);
            let cpu = &mut system.cpu;
            let saved = Saved {
                regs: cpu.regs,
                high: cpu.high,
                ip: cpu.ip,
                flags: cpu.flags,
                segments: cpu.segments,
            };
            let at = (thunk as u32) << 16;
            let stack = cpu.segments[SS].base;
            let stack_selector = cpu.segments[SS].selector;
            let mut offset = cpu.regs[SP];
            let entry = placed_entry(offset, args);
            let mut placed = Vec::new();
            let mut values = Vec::with_capacity(args.len());

            for arg in args {
                values.push(match arg {
                    GuestArg::Word(word) => GuestArg::Word(*word),
                    GuestArg::Long(long) => GuestArg::Long(*long),
                    GuestArg::Struct(bytes) => {
                        offset = offset.wrapping_sub(bytes.len() as u16);
                        cpu.bus.write(stack + u32::from(offset), bytes);
                        placed.push((offset, bytes.len()));
                        GuestArg::Long(u32::from(stack_selector) << 16 | u32::from(offset))
                    }
                    GuestArg::Placed(bytes, from_entry) => {
                        let offset = entry.unwrap_or(0).wrapping_add(*from_entry);

                        for (step, byte) in bytes.iter().enumerate() {
                            let at = offset.wrapping_add(step as u16);

                            cpu.bus.write8(stack + u32::from(at), *byte);
                        }

                        placed.push((offset, bytes.len()));
                        GuestArg::Long(u32::from(stack_selector) << 16 | u32::from(offset))
                    }
                });
            }

            cpu.bus.write16(at + 1, procedure as u16);
            cpu.bus.write16(at + 3, (procedure >> 16) as u16);
            cpu.regs[SP] = match entry {
                // The frame deep enough for the structures placed in it,
                // the arguments and the return address.
                Some(entry) => entry.wrapping_add(4 + arguments_size(args)),
                None => cpu.regs[SP].wrapping_sub(CALL_FRAME),
            };

            let push = |cpu: &mut winbox_cpu::Cpu<winbox_machine::Memory>, word: u16| {
                cpu.regs[SP] = cpu.regs[SP].wrapping_sub(2);
                cpu.bus.write16(stack + u32::from(cpu.regs[SP]), word);
            };

            for value in values {
                match value {
                    GuestArg::Word(word) => push(cpu, word),
                    GuestArg::Long(long) => {
                        push(cpu, (long >> 16) as u16);
                        push(cpu, long as u16);
                    }
                    GuestArg::Struct(_) | GuestArg::Placed(..) => {
                        unreachable!("a structure is given as its far pointer")
                    }
                }
            }

            for register in registers {
                match *register {
                    Register::Word(index, value) => cpu.regs[index] = value,
                    Register::Segment(index, selector) => {
                        cpu.load_segment(index, selector).map_err(Stop::Processor)?;
                    }
                }
            }

            cpu.load_segment(CS, segment_selector(thunk))
                .map_err(Stop::Processor)?;
            cpu.ip = 0;
            system.depth += 1;
            (
                saved,
                placed
                    .into_iter()
                    .map(|(offset, length)| (stack + u32::from(offset), length))
                    .collect::<Vec<_>>(),
            )
        };

        // Stopped inside, the processor is left where it stopped.
        Box::pin(self.run_until_returned()).await?;

        let mut system = self.system();
        let cpu = &mut system.cpu;
        let answer = u32::from(cpu.regs[DX]) << 16 | u32::from(cpu.regs[AX]);
        let structures = placed
            .iter()
            .map(|&(at, length)| cpu.bus.read(at, length))
            .collect();

        cpu.regs = saved.regs;
        cpu.high = saved.high;
        cpu.ip = saved.ip;
        cpu.flags = saved.flags;
        cpu.segments = saved.segments;
        system.depth -= 1;
        Ok((answer, structures))
    }
}

/// An argument a procedure of the program's is called with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GuestArg {
    Word(u16),
    Long(u32),
    /// A structure, laid out below the stack and given as a far pointer.
    Struct(Vec<u8>),
    /// A structure given its place, as GDI's font enumeration lays them out
    /// (`enumregs`): this many bytes up from the stack pointer as the
    /// procedure is entered. The frame is made deep enough to hold it.
    Placed(Vec<u8>, u16),
}

/// The bytes an argument takes on the stack.
fn arguments_size(args: &[GuestArg]) -> u16 {
    args.iter()
        .map(|arg| match arg {
            GuestArg::Word(_) => 2,
            _ => 4,
        })
        .sum()
}

/// Where the stack pointer is as a procedure is entered, when any of its
/// structures is given its place: as deep as the furthest placed reaches,
/// and at least the frame Windows makes, the arguments and the return
/// address below it, an even number of bytes below `sp`. `None` where none
/// is placed.
pub fn placed_entry(sp: u16, args: &[GuestArg]) -> Option<u16> {
    let need = args
        .iter()
        .filter_map(|arg| match arg {
            GuestArg::Placed(bytes, at) => Some(usize::from(*at) + bytes.len()),
            _ => None,
        })
        .max()?;
    let least = usize::from(CALL_FRAME + arguments_size(args) + 4);
    let frame = (need.max(least) + 1) & !1;

    Some(sp.wrapping_sub(frame as u16))
}

impl Engine {
    /// A future run to its end, as a call from the host is, with the
    /// instructions a procedure of the program's it calls may take.
    #[cfg(test)]
    pub(crate) fn run_now<T>(
        &self,
        future: impl Future<Output = Result<T, Stop>>,
    ) -> Result<T, Stop> {
        self.end.set(self.system().instructions + 100_000_000);
        self.block_on(future)
    }

    /// A future run to its end on this thread. Where it is not ready, the
    /// task waits for a message: time passes to what wakes it.
    fn block_on<T>(&self, future: impl Future<Output = Result<T, Stop>>) -> Result<T, Stop> {
        let mut future = pin!(future);
        let mut context = Context::from_waker(Waker::noop());

        loop {
            if let Poll::Ready(result) = future.as_mut().poll(&mut context) {
                return result;
            }

            // Waiting for the host's time, where the engine yields, or
            // the thread given back at a deadline: asked again, nothing
            // else passing meanwhile, for a call from the host has no run
            // to go back to.
            if self.yielded.take() || self.host_wake.take().is_some() {
                continue;
            }

            if !self.pass_time() {
                return Err(self.time_stop());
            }
        }
    }

    /// `pass_time_async`, done here and now. Where the engine yields, the
    /// host's time is waited for by asking it again and again: for a call
    /// from the host, which has no run to go back to.
    pub(crate) fn pass_time(&self) -> bool {
        let mut future = pin!(self.pass_time_async());
        let mut context = Context::from_waker(Waker::noop());

        loop {
            if let Poll::Ready(going) = future.as_mut().poll(&mut context) {
                self.host_wake.set(None);
                return going;
            }
        }
    }

    /// Nothing runs and nothing will until a time comes, so the clock goes
    /// straight to the next timer waiting on it, or on by a frame when none
    /// is, as winbox.js's runs do (`runFor`); a timer come due wakes the
    /// task. Whether the run's time is still going.
    pub(crate) async fn pass_time_async(&self) -> bool {
        let wait = {
            let system = self.system();
            let now = system.clock.now(system.instructions);

            if now >= self.until.get() {
                return false;
            }

            // The host's own clock: its time waited out.
            (!system.clock.is_virtual()).then(|| {
                let next = system.clock.next_due().min(now + FRAME);

                (next - now).max(0.0)
            })
        };

        if let Some(wait) = wait {
            self.wait_host(wait).await;
        }

        self.time_passed()
    }

    /// The rest of `pass_time_async`, its wait done: whether the run's time
    /// is still going.
    fn time_passed(&self) -> bool {
        let mut system = self.system();
        let instructions = system.instructions;

        // The host given the machine while every task waits, too.
        if !system.host_frame() {
            return false;
        }

        // A key pressed, or a screen kept, where another run did while its
        // program waited (`call_marks.rs`): what comes of it runs before
        // time passes on.
        if !system.call_marks.marks.is_empty() && system.take_call_marks() {
            return true;
        }

        let due = match system.clock.idle(instructions) {
            Some(due) => due,
            None if self.until.get().is_infinite() => return false,
            None => system.clock.advance(instructions, FRAME),
        };

        for timer in due {
            let waiting = system
                .scheduler
                .slots
                .iter()
                .position(|slot| slot.wait_timer == Some(timer));

            if let Some(slot) = waiting {
                system.scheduler.slots[slot].wait_timer = None;
                system.signal_slot(slot);
            }
        }

        // MMSYSTEM's timer events come due, which wake the task; the serial
        // ports' transmitters; and the sound card's interrupts.
        system.poll_time_events();
        system.poll_comm();
        system.poll_sound();

        // Gone past the time given, nothing runs again: the TypeScript
        // engine's run looks at its time after it skips ahead.
        system.clock.now(instructions) < self.until.get()
    }

    /// Waits until the host's time, as the clock reads it
    /// (`Clock::host_ms`), reaches `ms`: slept, or pending until then.
    pub async fn until_host(&self, ms: f64) {
        match self.pace.get() {
            Pace::Blocking => {
                let wait = ms - self.system().clock.host_ms();

                if wait > 0.0 {
                    std::thread::sleep(std::time::Duration::from_secs_f64(wait / 1000.0));
                }
            }
            Pace::Yielding => UntilHost(self, ms).await,
        }
    }

    /// Waits `ms` of the host's time, not less than nought: slept for
    /// exactly that, or pending until the host's time has passed it.
    pub(crate) async fn wait_host(&self, ms: f64) {
        match self.pace.get() {
            Pace::Blocking => std::thread::sleep(std::time::Duration::from_secs_f64(ms / 1000.0)),
            Pace::Yielding => {
                let at = self.system().clock.host_ms() + ms;

                UntilHost(self, at).await;
            }
        }
    }

    /// Why time stopped passing: the host closed the machine, or the run's
    /// time is up.
    pub(crate) fn time_stop(&self) -> Stop {
        if self.system().host_closed() {
            Stop::Closed
        } else {
            Stop::Time
        }
    }

    /// Waits to be woken -- by a message posted or sent, a paint or a
    /// timer, a signal -- with the processor given up, or until `timeout`
    /// passes; put in line for the processor as it is woken, and going on
    /// when granted it.
    pub async fn wait_for_wake(&self, timeout: Option<f64>) {
        let slot = {
            let mut system = self.system();
            let Some(slot) = system.current_slot() else {
                return;
            };
            let instructions = system.instructions;
            let timer = timeout.map(|ms| system.clock.after(instructions, ms));
            let state = &mut system.scheduler.slots[slot];

            state.wait = Wait::Waiting;
            state.wait_timer = timer;
            system.release();
            slot
        };

        Held(self, slot).await;

        let mut system = self.system();
        let state = &mut system.scheduler.slots[slot];

        state.wait = Wait::Running;

        if let Some(timer) = state.wait_timer.take() {
            system.clock.cancel(timer);
        }
    }
}

/// A frame of the host's: how far the clock goes on when nothing waits on
/// it, a thirtieth of a second.
const FRAME: f64 = 1000.0 / 30.0;

/// Whether the task runs, waits with the processor given up, or has been
/// woken where it waits.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Wait {
    Running,
    Waiting,
    Woken,
}

/// A task's run, as a future.
type Run<'a> = Pin<Box<dyn Future<Output = Result<(), Stop>> + 'a>>;

/// Time let pass, as a future: whether the run's time is still going.
type Passing<'a> = Pin<Box<dyn Future<Output = bool> + 'a>>;

/// Every task's run, kept from one round to the next.
struct Tasks<'a> {
    runs: Vec<Run<'a>>,
    /// A round that gave the thread back part way: the run it was at, and
    /// the processor's count and holder as the round began.
    within: Option<(usize, (u64, Option<usize>))>,
    /// Time passing, where it waits for the host's.
    passing: Option<Passing<'a>>,
}

impl<'a> Tasks<'a> {
    fn new(first: Run<'a>) -> Self {
        Self {
            runs: vec![first],
            within: None,
            passing: None,
        }
    }
}

/// What a round came to.
enum Round {
    /// Round again.
    Again,
    /// The deadline came.
    Yielded,
    /// Waiting for the host's time, in its milliseconds.
    Idle(f64),
    Stopped(Stop),
}

/// What makes a run's futures: the engine lent to it, for a run at once
/// (`Engine::run`), or kept by it, for a run stepped (`EngineRun`).
trait Spawn<'a> {
    /// A task started, run once it is granted the processor.
    fn task(&self, slot: usize) -> Run<'a>;
    /// Time let pass.
    fn pass(&self) -> Passing<'a>;
}

impl<'a> Spawn<'a> for &'a Engine {
    fn task(&self, slot: usize) -> Run<'a> {
        Box::pin(Engine::task_run(self, slot))
    }

    fn pass(&self) -> Passing<'a> {
        Box::pin(Engine::pass_time_async(self))
    }
}

/// The engine, as a run stepped keeps it.
struct Kept(Rc<Engine>);

impl Spawn<'static> for Kept {
    fn task(&self, slot: usize) -> Run<'static> {
        let engine = Rc::clone(&self.0);

        Box::pin(async move { engine.task_run(slot).await })
    }

    fn pass(&self) -> Passing<'static> {
        let engine = Rc::clone(&self.0);

        Box::pin(async move { engine.pass_time_async().await })
    }
}

/// A run stepped, a deadline at a time (`Engine::begin`): every task's
/// run kept from one step to the next.
pub struct EngineRun {
    kept: Kept,
    tasks: Tasks<'static>,
    /// Where its instructions end, and when its time does on the clock.
    end: u64,
    until: f64,
    /// Why it stopped, once it has.
    stopped: Option<Stop>,
}

impl std::fmt::Debug for EngineRun {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("EngineRun")
            .field("tasks", &self.tasks.runs.len())
            .field("stopped", &self.stopped)
            .finish_non_exhaustive()
    }
}

/// What a step of a run came to.
#[derive(Debug, Clone, PartialEq)]
pub enum Step {
    /// The deadline came with the run going on: step it again.
    Busy,
    /// Everything waits for the host's time: step it again once the host's
    /// time, as the clock reads it (`Clock::host_ms`), reaches `wake_at`.
    /// Infinite where every task has ended and Windows stays up
    /// (`System::stays_up`): step it again once another is launched.
    Idle { wake_at: f64 },
    /// The run is over, and why.
    Stopped(Stop),
}

impl EngineRun {
    /// The engine it runs.
    pub fn engine(&self) -> &Rc<Engine> {
        &self.kept.0
    }

    /// The run, until the host's time, as the clock reads it
    /// (`Clock::host_ms`), reaches `deadline`; or until everything waits
    /// for the host's time, where the engine yields (`Pace::Yielding`);
    /// or until the run is over. The deadline is looked at between two
    /// slices of a program's instructions, so a step goes a little past
    /// it.
    pub fn step(&mut self, deadline: f64) -> Step {
        if let Some(stop) = &self.stopped {
            return Step::Stopped(stop.clone());
        }

        let engine = &self.kept.0;

        // Its own limits, whatever a call from the host made of them
        // between steps.
        engine.end.set(self.end);
        engine.until.set(self.until);
        engine.deadline.set(deadline);
        engine.yielded.set(false);
        engine.host_wake.set(None);

        // A task started by the host between steps (`System::launch`) is
        // taken up as one `WinExec` started is, at the next round; time
        // waiting to pass for the host's time is let go for it, where every
        // task waited. That wait has done nothing yet: time passes only once
        // it is over (`pass_time_async`).
        if !engine.system().scheduler.started.is_empty() {
            self.tasks.passing = None;
        }

        let step = loop {
            match engine.round(&mut self.tasks, &self.kept) {
                Round::Again => {}
                Round::Yielded => break Step::Busy,
                Round::Idle(wake_at) => break Step::Idle { wake_at },
                Round::Stopped(stop) => {
                    self.stopped = Some(stop.clone());
                    break Step::Stopped(stop);
                }
            }
        };

        engine.deadline.set(f64::INFINITY);
        step
    }
}

/// Pending once, the engine told the thread is given back; ready when
/// polled again.
struct GiveBack<'a>(&'a Engine, bool);

impl Future for GiveBack<'_> {
    type Output = ();

    fn poll(mut self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<()> {
        if self.1 {
            return Poll::Ready(());
        }

        self.1 = true;
        self.0.yielded.set(true);
        Poll::Pending
    }
}

/// Ready once the host's time reaches its time, the engine told of the
/// wait while it is pending.
struct UntilHost<'a>(&'a Engine, f64);

impl Future for UntilHost<'_> {
    type Output = ();

    fn poll(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<()> {
        if self.0.system().clock.host_ms() >= self.1 {
            return Poll::Ready(());
        }

        let wake = self
            .0
            .host_wake
            .get()
            .map_or(self.1, |wake| wake.min(self.1));

        self.0.host_wake.set(Some(wake));
        Poll::Pending
    }
}

/// Ready once the task has the processor.
pub(crate) struct Held<'a>(pub(crate) &'a Engine, pub(crate) usize);

impl Future for Held<'_> {
    type Output = ();

    fn poll(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<()> {
        if self.0.system().has_processor(self.1) {
            Poll::Ready(())
        } else {
            Poll::Pending
        }
    }
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;
    use std::future::Future;
    use std::pin::pin;
    use std::task::{Context, Poll, Waker};

    use super::{Engine, Pace};
    use crate::system::System;

    thread_local! {
        static HOST: Cell<f64> = const { Cell::new(0.0) };
    }

    fn host() -> f64 {
        HOST.with(Cell::get)
    }

    /// Yielding, a wait for the host's time is pending, the engine told
    /// when it is to wake, until the host's time comes; and it sleeps
    /// nothing.
    #[test]
    fn a_wait_for_the_hosts_time_yields() {
        let mut system = System::new();

        system.clock = winbox_machine::Clock::real_with(host);

        let engine = Engine::new(system);

        engine.set_pace(Pace::Yielding);
        HOST.with(|now| now.set(100.0));

        let mut wait = pin!(engine.wait_host(250.0));
        let mut context = Context::from_waker(Waker::noop());

        assert_eq!(wait.as_mut().poll(&mut context), Poll::Pending);
        assert_eq!(engine.host_wake.take(), Some(350.0));
        HOST.with(|now| now.set(349.0));
        assert_eq!(wait.as_mut().poll(&mut context), Poll::Pending);
        HOST.with(|now| now.set(350.0));
        assert_eq!(wait.as_mut().poll(&mut context), Poll::Ready(()));
    }
}
