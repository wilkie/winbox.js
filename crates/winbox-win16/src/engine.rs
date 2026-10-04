//! The engine: the system, and the program on it run as a future, so that
//! a call can be answered in its time -- calling back into the program,
//! or, later, waiting while another task runs -- on one thread, in the
//! browser as natively.

use std::cell::{RefCell, RefMut};
use std::future::Future;
use std::pin::pin;
use std::task::{Context, Poll, Waker};

use winbox_cpu::{AX, CS, DX, Exit, SP, SS, Segment};
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
    end: std::cell::Cell<u64>,
}

impl Engine {
    pub fn new(system: System) -> Self {
        Self {
            system: RefCell::new(system),
            end: std::cell::Cell::new(0),
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
    /// yet, or `budget` instructions have run.
    pub fn run(&self, budget: u64) -> Stop {
        let end = self.system().instructions + budget;

        self.end.set(end);
        block_on(self.run_until_returned())
            .err()
            .unwrap_or(Stop::Processor(Exit::Budget))
    }

    /// A procedure of the program's called from the host, as `call_guest`
    /// calls one, and run to its return.
    pub fn call(&self, procedure: u32, words: &[u16], registers: &[Register]) -> Result<u32, Stop> {
        self.end.set(self.system().instructions + 100_000_000);
        block_on(self.call_guest(procedure, words, registers))
    }

    /// The program run, calls answered, until a procedure called returns.
    async fn run_until_returned(&self) -> Result<(), Stop> {
        loop {
            let event = self.system().run_until_event(self.end.get());

            match event {
                Event::Returned => return Ok(()),
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
                });
            }

            cpu.bus.write16(at + 1, procedure as u16);
            cpu.bus.write16(at + 3, (procedure >> 16) as u16);
            cpu.regs[SP] = cpu.regs[SP].wrapping_sub(CALL_FRAME);

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
                    GuestArg::Struct(_) => unreachable!("a structure is given as its far pointer"),
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
}

/// A future run to its end on this thread. Nothing here waits on anything
/// outside the engine yet, so a future that is not ready is one that
/// waits forever.
fn block_on<T>(future: impl Future<Output = Result<T, Stop>>) -> Result<T, Stop> {
    let mut future = pin!(future);
    let mut context = Context::from_waker(Waker::noop());

    match future.as_mut().poll(&mut context) {
        Poll::Ready(result) => result,
        Poll::Pending => Err(Stop::Unsupported("a wait")),
    }
}
