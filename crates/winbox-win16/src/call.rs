//! A program's call into a module winbox.js keeps, answered here: taken at
//! its stub's `INT 80h`, its arguments read off the stack, the function
//! that answers it run, its answer put in AX and DX, and the program let
//! go on to the stub's `RETF`, which pops the arguments.

use std::future::Future;
use std::pin::Pin;

use winbox_cpu::{AX, CS, DX, SP, SS};
use winbox_machine::{CALL_INSTRUCTIONS, index_for};

use crate::engine::Engine;
use crate::system::{STEP, System};
use crate::{kernel, user};

/// What a function answers in AX, and DX.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Answer {
    /// AX and DX left as they were.
    Nothing,
    Word(u16),
    Dword(u32),
}

impl Answer {
    /// As a call log shows it.
    pub fn value(self) -> Option<u32> {
        match self {
            Self::Nothing => None,
            Self::Word(word) => Some(u32::from(word)),
            Self::Dword(dword) => Some(dword),
        }
    }
}

/// Why the machine stopped running a program.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Stop {
    /// Its task ended.
    Ended,
    /// The processor stopped: an instruction it does not interpret, a
    /// fault, a halt.
    Processor(winbox_cpu::Exit),
    /// A call to a function not answered here yet.
    Missing {
        module: &'static str,
        name: &'static str,
    },
    /// An interrupt not answered here yet.
    Interrupt(u8),
    /// A DOS function not answered here yet, by AX.
    Dos(u16),
    /// Something the engine does not do yet.
    Unsupported(&'static str),
}

/// A function's arguments, read in the order it declares them: pushed
/// first to last, the first deepest, under the far return address.
#[derive(Debug, Clone, Copy)]
pub struct Args {
    stack: u32,
    at: u32,
    /// Where the arguments start, above the return address.
    top: u32,
}

impl Args {
    /// A doubleword `offset` bytes above the return address: a C function's
    /// arguments, the first nearest.
    pub fn above(&self, system: &System, offset: u32) -> u32 {
        let at = |step: u32| {
            system
                .cpu
                .bus
                .read16(self.stack + ((self.top + offset + step) & 0xffff))
        };

        u32::from(at(2)) << 16 | u32::from(at(0))
    }

    /// Where `offset` bytes above the return address is, as a far pointer.
    pub fn address_above(&self, system: &System, offset: u32) -> u32 {
        u32::from(system.cpu.segments[SS].selector) << 16 | ((self.top + offset) & 0xffff)
    }

    pub fn word(&mut self, system: &System) -> u16 {
        self.at = self.at.wrapping_sub(2);
        system.cpu.bus.read16(self.stack + (self.at & 0xffff))
    }

    pub fn signed(&mut self, system: &System) -> i16 {
        self.word(system) as i16
    }

    /// A doubleword, or a far pointer: pushed high word -- the segment --
    /// first, so read first here, going down.
    pub fn dword(&mut self, system: &System) -> u32 {
        let high = self.word(system);
        let low = self.word(system);

        u32::from(high) << 16 | u32::from(low)
    }
}

/// A function that answers a call at once.
pub type Sync = fn(&mut System, &mut Args) -> Result<Answer, Stop>;

/// What an answer that takes its time is: a future, run on the engine --
/// one that calls into the program, or waits.
pub type Later<'a> = Pin<Box<dyn Future<Output = Result<Answer, Stop>> + 'a>>;

/// A function that answers a call in its time.
pub type Async = for<'a> fn(&'a Engine, Args) -> Later<'a>;

/// A function that answers a call.
#[derive(Debug, Clone, Copy)]
pub enum Implementation {
    Sync(Sync),
    Async(Async),
}

/// A call made, its answer to come.
pub(crate) struct Pending {
    pub(crate) implementation: Async,
    pub(crate) args: Args,
    pub(crate) call: Call,
}

/// A call as the log is told it.
#[derive(Debug, Clone)]
pub struct Call {
    pub module: &'static str,
    pub name: &'static str,
    pub ordinal: u16,
    /// Where the program called from: the far call's own address.
    pub caller: (u16, u16),
    pub result: Option<u32>,
}

impl System {
    /// The call at an `INT 80h` of a kept module's stubs: answered, where
    /// its function answers at once; else made ready to be.
    pub(crate) fn api_call(&mut self) -> Result<Option<Pending>, Stop> {
        // A call takes the clock's time as the program's own instructions
        // do: the survey's charge.
        self.clock.charge(CALL_INSTRUCTIONS);

        let cs = self.cpu.segments[CS].selector;
        let kept = self.kept_at(index_for(cs)).ok_or(Stop::Interrupt(0x80))?;
        let module = kept.module;
        let ordinal = self.cpu.ip / STEP - 1;
        let export = module.export(ordinal).ok_or(Stop::Missing {
            module: module.name,
            name: "?",
        })?;
        let stack = self.cpu.segments[SS].base;
        let sp = u32::from(self.cpu.regs[SP]);
        let caller_ip = self.cpu.bus.read16(stack + sp);
        let caller_cs = self.cpu.bus.read16(stack + ((sp + 2) & 0xffff));
        let implementation = implementation(module.name, export.name).ok_or(Stop::Missing {
            module: module.name,
            name: export.name,
        })?;
        let mut args = Args {
            stack,
            at: sp + 4 + u32::from(export.pops),
            top: sp + 4,
        };
        let call = Call {
            module: module.name,
            name: export.name,
            ordinal,
            caller: (caller_cs, caller_ip.wrapping_sub(5)),
            result: None,
        };

        // Past the `INT 80h`, to the `RETF`.
        self.cpu.ip += 2;

        match implementation {
            Implementation::Sync(answer) => {
                let answer = answer(self, &mut args);

                self.finish_call(call, answer)?;
                Ok(None)
            }
            Implementation::Async(implementation) => Ok(Some(Pending {
                implementation,
                args,
                call,
            })),
        }
    }

    /// A call's answer told to the watcher and put in AX and DX.
    pub(crate) fn finish_call(
        &mut self,
        mut call: Call,
        answer: Result<Answer, Stop>,
    ) -> Result<(), Stop> {
        call.result = answer.as_ref().ok().and_then(|answer| answer.value());

        if let Some(watch) = self.on_call.as_mut() {
            (watch.0)(&call);
        }

        match answer? {
            Answer::Nothing => {}
            Answer::Word(word) => self.cpu.regs[AX] = word,
            Answer::Dword(dword) => {
                self.cpu.regs[AX] = dword as u16;
                self.cpu.regs[DX] = (dword >> 16) as u16;
            }
        }

        if self.ended {
            return Err(Stop::Ended);
        }

        Ok(())
    }
}

/// The function that answers a module's export, if one does here.
fn implementation(module: &str, name: &str) -> Option<Implementation> {
    match module {
        "KERNEL" => kernel::implementation(name),
        "USER" => user::implementation(name),
        _ => None,
    }
}
