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
use crate::{gdi, kernel, user, win87em};

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
    /// The run's time passed.
    Time,
    /// The host the machine runs in closed it (`host.rs`).
    Closed,
}

/// A function's arguments, read in the order it declares them: pushed
/// first to last, the first deepest, under the far return address.
#[derive(Debug, Clone, Copy)]
pub struct Args {
    stack: u32,
    at: u32,
    /// Where the arguments start, above the return address.
    top: u32,
    /// A word given rather than read.
    given: Option<u16>,
    /// A first word given, the rest read: a metafile's record played, its
    /// device context given and its arguments in the record.
    first: Option<u16>,
}

impl Args {
    /// Arguments of one word, as a function reads them, for one function
    /// to call another with.
    pub(crate) fn repeat(word: u16) -> Self {
        Self {
            stack: 0,
            at: 0,
            top: 0,
            given: Some(word),
            first: None,
        }
    }

    /// Arguments whose first word is given and the rest read down from
    /// `at` in a segment whose base is `base`, as a function reads them from
    /// the stack: a call made again from a metafile's record.
    pub(crate) fn after_first(first: u16, base: u32, at: u32) -> Self {
        Self {
            stack: base,
            at,
            top: at,
            given: None,
            first: Some(first),
        }
    }

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
        if let Some(word) = self.given {
            return word;
        }

        if let Some(word) = self.first.take() {
            return word;
        }

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

impl System {
    /// A procedure of USER's own called at the address a program was handed
    /// for it, `MOV AX, n; INT 84h; RETF 10` (`proc_token`): made ready to
    /// be called with the window procedure's arguments on the stack. Neither
    /// logged nor charged as a call is, as the TypeScript engine's
    /// `userProcedureInvoke` is neither.
    pub(crate) fn user_procedure_call(&mut self) -> Pending {
        let stack = self.cpu.segments[SS].base;
        let sp = u32::from(self.cpu.regs[SP]);

        // Past the `INT 84h`, to the `RETF`.
        self.cpu.ip += 2;

        Pending {
            implementation: user_procedure,
            args: Args {
                stack,
                at: sp + 4 + 10,
                top: sp + 4,
                given: None,
                first: None,
            },
            logged: None,
        }
    }
}

/// The procedure AX names, called with the window procedure's arguments.
fn user_procedure(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (host, hwnd, message, wparam, lparam) = {
            let system = engine.system();
            let token = usize::from(system.cpu.regs[AX]);

            (
                system.proc_tokens.get(token).cloned(),
                args.word(&system),
                args.word(&system),
                args.word(&system),
                args.dword(&system),
            )
        };
        let Some(host) = host else {
            return Ok(Answer::Dword(0));
        };
        let answer = engine
            .host_proc(
                &host,
                hwnd,
                message,
                wparam,
                &mut crate::messages::Param::Value(lparam),
            )
            .await?;

        Ok(Answer::Dword(answer))
    })
}

/// A call made, its answer to come.
pub(crate) struct Pending {
    pub(crate) implementation: Async,
    pub(crate) args: Args,
    /// Where it is in the log, if there is one.
    pub(crate) logged: Option<usize>,
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
    /// Whether it reached only a stub.
    pub stub: bool,
    /// The instructions run when it was made, its `INT` among them.
    pub instructions: u64,
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
        // A call into a metafile's device context is kept as a record, not
        // answered by its function (`gdi/metafile.rs`).
        let metafile = gdi::metafile::recording(self, module.name, export, stack, sp);
        // A function the TypeScript engine only stubs is answered as its
        // stub answers: nought, in the bytes it answers in, or nothing.
        let implementation = match implementation(module.name, export.name) {
            Some(implementation) => implementation,
            None if export.stub => Implementation::Sync(match export.returns {
                0 => stub_nothing,
                1 | 2 => stub_word,
                _ => stub_dword,
            }),
            // Not called: the record answers, whether or not a function does.
            None if metafile.is_some() => Implementation::Sync(stub_word),
            None => {
                return Err(Stop::Missing {
                    module: module.name,
                    name: export.name,
                });
            }
        };
        let mut args = Args {
            stack,
            at: sp + 4 + u32::from(export.pops),
            top: sp + 4,
            given: None,
            first: None,
        };
        // Logged as it is made, its answer when it comes: a call made in
        // another's answer comes after it, as the TypeScript engine tells
        // its watcher.
        let instructions = self.instructions;
        let logged = self.log.as_mut().map(|log| {
            log.push(Call {
                module: module.name,
                name: export.name,
                ordinal,
                caller: (caller_cs, caller_ip.wrapping_sub(5)),
                result: None,
                stub: export.stub && self::implementation(module.name, export.name).is_none(),
                instructions,
            });
            log.len() - 1
        });

        // Past the `INT 80h`, to the `RETF`.
        self.cpu.ip += 2;

        if let Some(metafile) = metafile {
            gdi::metafile::record_call(self, metafile, ordinal, export, stack, sp);
            return Ok(None);
        }

        // GDI's segment as the program last read it let go, and the bitmaps
        // it was shown made to agree with their bits (`gdi/heap.rs`).
        self.gdi_heap_before_call();
        self.wing_before_call();

        match implementation {
            Implementation::Sync(answer) => {
                let answer = answer(self, &mut args);

                self.finish_call(logged, answer)?;
                Ok(None)
            }
            Implementation::Async(implementation) => Ok(Some(Pending {
                implementation,
                args,
                logged,
            })),
        }
    }

    /// A call's answer put in the log and in AX and DX.
    pub(crate) fn finish_call(
        &mut self,
        logged: Option<usize>,
        answer: Result<Answer, Stop>,
    ) -> Result<(), Stop> {
        self.gdi_heap_after_call();
        self.wing_after_call();

        if let (Some(at), Some(log)) = (logged, self.log.as_mut())
            && !log[at].stub
        {
            log[at].result = answer.as_ref().ok().and_then(|answer| answer.value());
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
        "USER" => user::implementation(name).or_else(|| crate::drivers::implementation(name)),
        "WIN87EM" => win87em_implementation(name),
        "GDI" => gdi::implementation(name),
        "TOOLHELP" => crate::toolhelp::implementation(name),
        "KEYBOARD" => crate::keyboard::implementation(name),
        "MMSYSTEM" => crate::mmsystem::implementation(name),
        "WING" => crate::wing::implementation(name),
        "SOUND" => crate::sound::implementation(name),
        "TIMER" => crate::timer::implementation(name),
        "MCIWAVE" | "MCISEQ" => crate::mmsystem::mci_drivers::implementation(name),
        "SHELL" => crate::shell::implementation(name),
        _ => None,
    }
}

#[allow(clippy::unnecessary_wraps)]
fn stub_nothing(_: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    Ok(Answer::Nothing)
}

#[allow(clippy::unnecessary_wraps)]
fn stub_word(_: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    Ok(Answer::Word(0))
}

#[allow(clippy::unnecessary_wraps)]
fn stub_dword(_: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    Ok(Answer::Dword(0))
}

fn win87em_implementation(name: &str) -> Option<Implementation> {
    Some(Implementation::Sync(match name {
        "__FPMATH" => win87em::fpmath,
        "WEP" => win87em::wep,
        "__WIN87EMINFO" => win87em::info,
        "__WIN87EMSAVE" => win87em::save,
        "__WIN87EMRESTORE" => win87em::restore,
        _ => return None,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The exports the TypeScript engine answers -- every one not a stub of
    /// its -- that no call here answers yet, by module: what is left to
    /// port. `cargo test -p winbox-win16 --lib -- --ignored --nocapture
    /// unported`.
    #[test]
    #[ignore = "a survey, not a check"]
    fn unported() {
        let mut total = 0;

        for kept in crate::kept::KEPT {
            let missing: Vec<&str> = kept
                .exports
                .iter()
                .flatten()
                .filter(|export| !export.stub && implementation(kept.name, export.name).is_none())
                .map(|export| export.name)
                .collect();

            if !missing.is_empty() {
                total += missing.len();
                println!("{} {}: {}", kept.name, missing.len(), missing.join(" "));
            }
        }

        println!("unported: {total}");
    }
}
