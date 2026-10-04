//! The engine: the system, and the program on it run as a future, so that
//! a call can be answered in its time -- calling back into the program,
//! or waiting for a message while time passes -- on one thread, in the
//! browser as natively.

use std::cell::{Cell, RefCell, RefMut};
use std::future::Future;
use std::pin::{Pin, pin};
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

/// The engine.
#[derive(Debug)]
pub struct Engine {
    system: RefCell<System>,
    /// Where the run's instructions end.
    end: Cell<u64>,
    /// When the run's time ends, in the clock's milliseconds.
    until: Cell<f64>,
}

impl Engine {
    pub fn new(system: System) -> Self {
        Self {
            system: RefCell::new(system),
            end: Cell::new(0),
            until: Cell::new(f64::INFINITY),
        }
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
        let (instructions, now) = {
            let system = self.system();

            (system.instructions, system.clock.now(system.instructions))
        };

        self.end.set(instructions + budget);
        self.until.set(now + seconds * 1000.0);
        self.run_tasks()
    }

    /// Every task's run, each a future of its own, polled in turn: the one
    /// with the processor goes on until it gives it up, and when none can
    /// go on, time passes to what wakes one. A task started is taken up as
    /// it is; one that ends is let go, and the run goes on while any task
    /// is left, until Windows is exited or the time given is up.
    fn run_tasks(&self) -> Stop {
        type Run<'a> = Pin<Box<dyn Future<Output = Result<(), Stop>> + 'a>>;

        let mut runs: Vec<Run<'_>> = vec![Box::pin(self.run_until_returned())];
        let mut context = Context::from_waker(Waker::noop());

        loop {
            let started = std::mem::take(&mut self.system().scheduler.started);

            for slot in started {
                runs.push(Box::pin(self.task_run(slot)));
            }

            let before = {
                let system = self.system();

                (system.instructions, system.scheduler.current)
            };
            let mut at = 0;

            while at < runs.len() {
                match runs[at].as_mut().poll(&mut context) {
                    Poll::Pending => at += 1,
                    Poll::Ready(Err(Stop::Ended))
                        if !self.system().ended && self.system().task_count() > 0 =>
                    {
                        drop(runs.remove(at));
                    }
                    Poll::Ready(Err(stop)) => return stop,
                    Poll::Ready(Ok(())) => {
                        drop(runs.remove(at));
                    }
                }
            }

            if runs.is_empty() {
                return Stop::Ended;
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
                continue;
            }

            if !self.pass_time() {
                return self.time_stop();
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
            let event = self
                .system()
                .run_until_event(self.end.get(), self.until.get());

            match event {
                Event::Returned => return Ok(()),
                Event::Interrupt(interrupt) => self.deliver_interrupt(interrupt).await?,
                Event::Fault(vector) => self.application_fault(vector)?,
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
    /// A future run to its end on this thread. Where it is not ready, the
    /// task waits for a message: time passes to what wakes it.
    fn block_on<T>(&self, future: impl Future<Output = Result<T, Stop>>) -> Result<T, Stop> {
        let mut future = pin!(future);
        let mut context = Context::from_waker(Waker::noop());

        loop {
            if let Poll::Ready(result) = future.as_mut().poll(&mut context) {
                return result;
            }

            if !self.pass_time() {
                return Err(self.time_stop());
            }
        }
    }

    /// Nothing runs and nothing will until a time comes, so the clock goes
    /// straight to the next timer waiting on it, or on by a frame when none
    /// is, as winbox.js's runs do (`runFor`); a timer come due wakes the
    /// task. Whether the run's time is still going.
    pub(crate) fn pass_time(&self) -> bool {
        let mut system = self.system();
        let instructions = system.instructions;
        let now = system.clock.now(instructions);

        if now >= self.until.get() {
            return false;
        }

        // The host's own clock: its time waited out.
        if !system.clock.is_virtual() {
            let next = system.clock.next_due().min(now + FRAME);

            std::thread::sleep(std::time::Duration::from_secs_f64(
                (next - now).max(0.0) / 1000.0,
            ));
        }

        // The host given the machine while every task waits, too.
        if !system.host_frame() {
            return false;
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

        // MMSYSTEM's timer events come due, which wake the task; and the
        // serial ports' transmitters.
        system.poll_time_events();
        system.poll_comm();

        // Gone past the time given, nothing runs again: the TypeScript
        // engine's run looks at its time after it skips ahead.
        system.clock.now(instructions) < self.until.get()
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
