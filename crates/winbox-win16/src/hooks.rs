//! Hooks: procedures a program puts in USER's way, called with a code, a
//! `WPARAM` and an `LPARAM` before USER does something, as winbox.js's
//! `hooks.ts` keeps them.
//!
//! **Recorded** by `hooks`, with three message filters: the newest hook is
//! called first, and each passes on to the one put in before it; a hook
//! that answers without passing on ends the chain, and its answer is the
//! answer. `SetWindowsHook` answers the new hook's own handle, which
//! `DefHookProc` goes on from.
//!
//! The shell hooks are called with `HSHELL_WINDOWCREATED` once a top-level
//! window with no owner has had its `WM_CREATE`, and with
//! `HSHELL_WINDOWDESTROYED` before its `WM_DESTROY` (`shlhook`). The window
//! procedure hooks are called before a window procedure with each message
//! sent it -- by a program or by USER -- and not one posted and dispatched
//! (`cwphook`): `LPARAM` points at five words on the stack, the message's
//! `LPARAM` low word first, its `WPARAM`, the message, the window, and what
//! the hook leaves in the first four is what the procedure is given. Other
//! kinds are kept and passed on through, and never called.
//!
//! A hook's procedure may be a program's, at its far address, or one of
//! winbox.js's own, as SHELL's shell hook is (`shell/shell_hook.rs`): the
//! TypeScript engine's hooks may be functions.

use std::future::Future;
use std::pin::Pin;

use winbox_cpu::{AX, DS, ES, SP, SS};

use crate::call::{Answer, Args, Later, Stop};
use crate::engine::{Engine, GuestArg, Register};
use crate::messages::Param;
use crate::system::System;

pub const WH_MSGFILTER: i16 = -1;
pub const WH_CALLWNDPROC: i16 = 4;
pub const WH_SHELL: i16 = 10;
pub const HSHELL_WINDOWCREATED: u16 = 1;
pub const HSHELL_WINDOWDESTROYED: u16 = 2;

/// A procedure of winbox.js's own called as a hook: given the code,
/// `WPARAM` and `LPARAM`, it answers as a program's hook does.
pub type HostHook =
    for<'a> fn(&'a Engine, i16, u16, u32) -> Pin<Box<dyn Future<Output = Result<u32, Stop>> + 'a>>;

/// What a hook calls: a program's procedure, or one of winbox.js's own.
#[derive(Debug, Clone, Copy)]
pub enum HookProc {
    Far(u32),
    Host(HostHook),
}

/// A hook: its kind, its procedure and its handle.
#[derive(Debug, Clone, Copy)]
pub struct Hook {
    pub kind: i16,
    pub proc: HookProc,
    pub handle: u32,
}

impl System {
    /// The hooks of a kind, newest first.
    fn chain(&self, kind: i16) -> Vec<Hook> {
        self.hooks
            .iter()
            .find(|(each, _)| *each == kind)
            .map(|(_, chain)| chain.clone())
            .unwrap_or_default()
    }

    /// A hook put in: the newest, called first. Its handle.
    pub(crate) fn install(&mut self, kind: i16, proc: HookProc) -> u32 {
        self.next_hook += 1;

        let hook = Hook {
            kind,
            proc,
            handle: self.next_hook,
        };

        match self.hooks.iter_mut().find(|(each, _)| *each == kind) {
            Some((_, chain)) => chain.insert(0, hook),
            None => self.hooks.push((kind, vec![hook])),
        }

        hook.handle
    }

    /// A hook taken out by its handle; whether there was one.
    pub(crate) fn remove_hook(&mut self, handle: u32) -> bool {
        self.hooks
            .iter_mut()
            .find_map(|(_, chain)| {
                let at = chain.iter().position(|hook| hook.handle == handle)?;

                chain.remove(at);
                Some(())
            })
            .is_some()
    }

    /// The hook after the one with this handle, in its chain; none at the
    /// end of its chain, and for a handle that is no hook's.
    fn hook_after(&self, handle: u32) -> Option<Hook> {
        self.hooks.iter().find_map(|(_, chain)| {
            let at = chain.iter().position(|hook| hook.handle == handle)?;

            chain.get(at + 1).copied()
        })
    }
}

impl Engine {
    /// One hook's procedure called: one of winbox.js's own as it is, a
    /// program's as USER's one hook caller calls one (seg1 `808d`): AX, DS
    /// and ES the stack's segment.
    async fn call_hook(
        &self,
        hook: Hook,
        code: i16,
        wparam: u16,
        lparam: u32,
    ) -> Result<u32, Stop> {
        let proc = match hook.proc {
            HookProc::Far(proc) => proc,
            HookProc::Host(host) => return host(self, code, wparam, lparam).await,
        };
        let stack = self.system().cpu.segments[SS].selector;
        let args = [
            GuestArg::Word(code as u16),
            GuestArg::Word(wparam),
            GuestArg::Long(lparam),
        ];
        let registers = [
            Register::Word(AX, stack),
            Register::Segment(DS, stack),
            Register::Segment(ES, stack),
        ];

        Ok(self.call_with(proc, &args, &registers).await?.0)
    }

    /// A chain called from its newest hook; nought for no hooks.
    pub async fn call_hooks(
        &self,
        kind: i16,
        code: i16,
        wparam: u16,
        lparam: u32,
    ) -> Result<u32, Stop> {
        let first = self.system().chain(kind).first().copied();

        match first {
            Some(hook) => Box::pin(self.call_hook(hook, code, wparam, lparam)).await,
            None => Ok(0),
        }
    }

    /// The hook after the one with this handle called; nought for none.
    pub(crate) async fn call_after(
        &self,
        handle: u32,
        code: i16,
        wparam: u16,
        lparam: u32,
    ) -> Result<u32, Stop> {
        let next = self.system().hook_after(handle);

        match next {
            Some(hook) => Box::pin(self.call_hook(hook, code, wparam, lparam)).await,
            None => Ok(0),
        }
    }

    /// The window procedure hooks called with a message about to be sent:
    /// the message as the hooks leave it, or as it was with none. A
    /// structure in `LPARAM` is put on the stack first, under the hook's
    /// words, so that a hook can read it, and read back after.
    pub async fn sent_message_hook(
        &self,
        hwnd: u16,
        message: u16,
        wparam: u16,
        lparam: &mut Param,
    ) -> Result<(u16, u16), Stop> {
        if self.system().chain(WH_CALLWNDPROC).is_empty() {
            return Ok((message, wparam));
        }

        let (sp, at, far, size) = {
            let mut system = self.system();
            let cpu = &mut system.cpu;
            let sp = cpu.regs[SP];
            let stack = cpu.segments[SS].base;
            let selector = cpu.segments[SS].selector;
            let (far, size) = match lparam {
                Param::Struct(bytes) => {
                    cpu.regs[SP] = cpu.regs[SP].wrapping_sub(bytes.len() as u16) & 0xfffe;
                    cpu.bus.write(stack + u32::from(cpu.regs[SP]), bytes);
                    (
                        u32::from(selector) << 16 | u32::from(cpu.regs[SP]),
                        Some(bytes.len()),
                    )
                }
                Param::Value(value) => (*value, None),
            };

            cpu.regs[SP] = cpu.regs[SP].wrapping_sub(10);

            let at = cpu.regs[SP];
            let words = [far as u16, (far >> 16) as u16, wparam, message, hwnd];

            for (index, word) in words.iter().enumerate() {
                cpu.bus
                    .write16(stack + u32::from(at.wrapping_add(index as u16 * 2)), *word);
            }

            (
                sp,
                at,
                (u32::from(selector) << 16 | u32::from(at), far),
                size,
            )
        };

        self.call_hooks(WH_CALLWNDPROC, 0, 0, far.0).await?;

        let mut system = self.system();
        let cpu = &mut system.cpu;
        let stack = cpu.segments[SS].base;
        let read = |cpu: &winbox_cpu::Cpu<winbox_machine::Memory>, index: u16| {
            cpu.bus
                .read16(stack + u32::from(at.wrapping_add(index * 2)))
        };
        let left = u32::from(read(cpu, 0)) | u32::from(read(cpu, 1)) << 16;
        let (wparam, message) = (read(cpu, 2), read(cpu, 3));

        match (size, &mut *lparam) {
            // The structure as the hook left it, where the pointer was left
            // alone; else what the hook put there instead.
            (Some(size), Param::Struct(bytes)) if left == far.1 => {
                *bytes = cpu.bus.read(stack + u32::from(at.wrapping_add(10)), size);
            }
            _ => *lparam = Param::Value(left),
        }

        cpu.regs[SP] = sp;
        Ok((message, wparam))
    }
}

/// A hook put in; what to hand `DefHookProc`: its own handle.
pub fn set_windows_hook(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let kind = args.signed(system);
    let proc = args.dword(system);

    Ok(Answer::Dword(system.install(kind, HookProc::Far(proc))))
}

/// A hook put in, as `SetWindowsHook` does; the module and task it is for
/// are not followed.
pub fn set_windows_hook_ex(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let kind = args.signed(system);
    let proc = args.dword(system);

    args.word(system);
    args.word(system);
    Ok(Answer::Dword(system.install(kind, HookProc::Far(proc))))
}

/// The hook put in for this procedure taken out; whether there was one.
pub fn unhook_windows_hook(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let kind = args.signed(system);
    let proc = args.dword(system);
    let found = system
        .hooks
        .iter_mut()
        .find(|(each, _)| *each == kind)
        .and_then(|(_, chain)| {
            let at = chain
                .iter()
                .position(|hook| matches!(hook.proc, HookProc::Far(far) if far == proc))?;

            chain.remove(at);
            Some(())
        });

    Ok(Answer::Word(u16::from(found.is_some())))
}

/// A hook taken out by its handle; whether there was one.
pub fn unhook_windows_hook_ex(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.dword(system);

    Ok(Answer::Word(u16::from(system.remove_hook(handle))))
}

/// A hook's call passed on to the hook put in before it.
pub fn call_next_hook_ex(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (handle, code, wparam, lparam) = {
            let system = engine.system();

            (
                args.dword(&system),
                args.signed(&system),
                args.word(&system),
                args.dword(&system),
            )
        };

        Ok(Answer::Dword(
            engine.call_after(handle, code, wparam, lparam).await?,
        ))
    })
}

/// As `CallNextHookEx`, for a hook put in with `SetWindowsHook`: the value
/// `SetWindowsHook` answered is at `lplpfnNextHook`.
pub fn def_hook_proc(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (code, wparam, lparam, handle) = {
            let system = engine.system();
            let code = args.signed(&system);
            let wparam = args.word(&system);
            let lparam = args.dword(&system);
            let far = args.dword(&system);

            if far == 0 {
                return Ok(Answer::Dword(0));
            }

            let bytes = system.read_far(far, 4);

            (
                code,
                wparam,
                lparam,
                u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]),
            )
        };

        Ok(Answer::Dword(
            engine.call_after(handle, code, wparam, lparam).await?,
        ))
    })
}

impl Engine {
    /// The message filters called with a message a loop of USER's own took,
    /// in a block of USER's kept for it: whether one took it (`hooks`).
    pub(crate) async fn message_filter(
        &self,
        message: &crate::queue::Message,
        code: i16,
    ) -> Result<bool, Stop> {
        let far = {
            let mut guard = self.system();
            let system = &mut *guard;

            if system.chain(WH_MSGFILTER).is_empty() {
                return Ok(false);
            }

            if system.hook_message == 0 {
                let index =
                    system
                        .global
                        .allocate(&mut system.cpu.bus, &mut system.descriptors, 32, 0x42);

                system.hook_message = index.map_or(0, |index| {
                    u32::from(winbox_machine::segment_selector(index)) << 16
                });
            }

            let far = system.hook_message;
            let words = [
                message.hwnd,
                message.message,
                message.wparam,
                message.lparam as u16,
                (message.lparam >> 16) as u16,
                message.time as u16,
                (message.time >> 16) as u16,
                message.pt.0 as u16,
                message.pt.1 as u16,
            ];
            let bytes: Vec<u8> = words.iter().flat_map(|word| word.to_le_bytes()).collect();

            system.write_far(far, &bytes);
            far
        };

        // A filter answers in AX alone, what is in DX besides is no answer
        // (`USER.EXE` seg1 `80f0`): File Manager's leaves its own there,
        // and every key in its Copy box was taken as filtered.
        Ok(self.call_hooks(WH_MSGFILTER, code, 0, far).await? & 0xffff != 0)
    }
}

/// The message filters called with a program's own message: whether one
/// answered non-nought.
pub fn call_msg_filter(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (far, code) = {
            let system = engine.system();

            (args.dword(&system), args.signed(&system))
        };
        let answer = engine.call_hooks(WH_MSGFILTER, code, 0, far).await?;

        // In AX alone (`USER.EXE` seg1 `80f0`, `message_filter`).
        Ok(Answer::Word(u16::from(answer & 0xffff != 0)))
    })
}
