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
//! the hook leaves in the first four is what the procedure is given. The
//! message hooks are called with each message `GetMessage` or `PeekMessage`
//! hands over, taken or only looked at, once it is in the program's `MSG`
//! (`gmhook`; `get_message_hook`); the hardware hooks, and the
//! computer-based training hooks' `HCBT_KEYSKIPPED` and
//! `HCBT_CLICKSKIPPED`, by the system queue (`system_queue.rs`; `hwhook`).
//! The system message filters are called before the task's (`sysfilt`;
//! `filters`), and the computer-based training hooks are asked before USER
//! makes, destroys, activates, focuses, minimizes or moves a window and
//! before `DefWindowProc` carries out a system command (`cbthook`;
//! `ask_cbt`). A debugging hook is kept and passed on through, and never
//! called: in Windows the first hook called after one is put in calls it
//! for ever, and faults (`dbghook`).
//!
//! A hook is for one task or for every task (**read out**, `USER.EXE` seg1
//! `7d28`-`7e79`; **recorded** by `taskend`): `SetWindowsHook` puts a
//! message filter in for the task calling and any other kind for every
//! task; `SetWindowsHookEx` for the task given, or every task with none.
//! Each keeps the module its procedure is in. A chain is called from the
//! running task's own hooks, then on to every task's (`7ca2`-`7cd3`). As a
//! task ends its own hooks are taken out, and with its module's last
//! instance, or a library deleted, the module's hooks for every task
//! (`unhook_task`, `unhook_module`). As `hooks.ts`.
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
use crate::system_queue::{WH_JOURNALPLAYBACK, WH_JOURNALRECORD};

pub const WH_MSGFILTER: i16 = -1;
pub const WH_GETMESSAGE: i16 = 3;
pub const WH_CALLWNDPROC: i16 = 4;
pub const WH_CBT: i16 = 5;
pub const WH_SYSMSGFILTER: i16 = 6;
pub const WH_DEBUG: i16 = 9;
pub const WH_SHELL: i16 = 10;
pub const MSGF_SCROLLBAR: i16 = 5;
pub const HCBT_MOVESIZE: i16 = 0;
pub const HCBT_MINMAX: i16 = 1;
pub const HCBT_QS: i16 = 2;
pub const HCBT_CREATEWND: i16 = 3;
pub const HCBT_DESTROYWND: i16 = 4;
pub const HCBT_ACTIVATE: i16 = 5;
pub const HCBT_SYSCOMMAND: i16 = 8;
pub const HCBT_SETFOCUS: i16 = 9;
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

/// A hook: its kind, its procedure, its handle, the task it is for --
/// nought for every task -- and the module its procedure is in.
#[derive(Debug, Clone, Copy)]
pub struct Hook {
    pub kind: i16,
    pub proc: HookProc,
    pub handle: u32,
    pub task: u16,
    pub module: u16,
}

impl System {
    /// A chain as the running task calls it: its own hooks, newest first,
    /// then those for every task, newest first (`USER.EXE` seg1
    /// `7ca2`-`7cd3`). As `hooks.ts`'s `chainFor`.
    fn chain(&self, kind: i16) -> Vec<Hook> {
        self.chain_for(kind, self.task_handle)
    }

    fn chain_for(&self, kind: i16, task: u16) -> Vec<Hook> {
        let all = self
            .hooks
            .iter()
            .find(|(each, _)| *each == kind)
            .map(|(_, chain)| chain.as_slice())
            .unwrap_or_default();

        all.iter()
            .filter(|hook| hook.task != 0 && hook.task == task)
            .chain(all.iter().filter(|hook| hook.task == 0))
            .copied()
            .collect()
    }

    /// A hook put in for every task: the newest, called first. Its handle.
    pub(crate) fn install(&mut self, kind: i16, proc: HookProc) -> u32 {
        self.install_for(kind, proc, 0, 0)
    }

    /// A hook put in for a task, or every task with nought, its procedure
    /// in a module: the newest, called first. Its handle.
    pub(crate) fn install_for(&mut self, kind: i16, proc: HookProc, task: u16, module: u16) -> u32 {
        self.next_hook += 1;

        let hook = Hook {
            kind,
            proc,
            handle: self.next_hook,
            task,
            module,
        };

        match self.hooks.iter_mut().find(|(each, _)| *each == kind) {
            Some((_, chain)) => chain.insert(0, hook),
            None => self.hooks.push((kind, vec![hook])),
        }

        // A journal hook put in makes the mouse move where it is (`USER.EXE`
        // seg1 `7e4a`, the kinds' flags at `7c96`, `52e9`).
        if kind == WH_JOURNALRECORD || kind == WH_JOURNALPLAYBACK {
            let _ = self.nudge();
        }

        hook.handle
    }

    /// A hook taken out by its handle; whether there was one.
    pub(crate) fn remove_hook(&mut self, handle: u32) -> bool {
        let gone = self.hooks.iter_mut().find_map(|(kind, chain)| {
            let at = chain.iter().position(|hook| hook.handle == handle)?;

            chain.remove(at);
            Some(*kind)
        });

        if let Some(kind) = gone {
            self.hook_gone(kind);
        }

        gone.is_some()
    }

    /// A journal playback hook taken out: the queue is read again, the
    /// running task woken to look at it (`USER.EXE` seg1 `7e7c`-`7e97`).
    fn hook_gone(&mut self, kind: i16) {
        if kind == WH_JOURNALPLAYBACK {
            self.playback_due = None;
            self.signal();
        }
    }

    /// The hook after the one with this handle: the next of its task's,
    /// then on to every task's, for a task's own hook; the next of every
    /// task's for one of theirs (`USER.EXE` seg1 `7cbb`-`7cd3`). None at
    /// the end, and for a handle that is no hook's. As `callAfter`.
    fn hook_after(&self, handle: u32) -> Option<Hook> {
        let hook = self
            .hooks
            .iter()
            .find_map(|(_, chain)| chain.iter().find(|hook| hook.handle == handle))
            .copied()?;
        let order = self.chain_for(hook.kind, hook.task);
        let at = order.iter().position(|each| each.handle == handle)?;

        order.get(at + 1).copied()
    }

    /// The hooks a test says go taken out, as USER takes one out (`7e7c`).
    fn unhook_where(&mut self, gone: impl Fn(&Hook) -> bool) {
        let mut kinds = Vec::new();

        for (kind, chain) in &mut self.hooks {
            let before = chain.len();

            chain.retain(|hook| !gone(hook));

            if chain.len() != before {
                kinds.push(*kind);
            }
        }

        for kind in kinds {
            self.hook_gone(kind);
        }
    }

    /// A task's own hooks taken out as it ends (`USER.EXE` seg1 `0be4`,
    /// `7f51`-`7f9e` with its queue): **recorded** by `taskend`. As
    /// `unhookTask`.
    pub(crate) fn unhook_task(&mut self, task: u16) {
        self.unhook_where(|hook| hook.task != 0 && hook.task == task);
    }

    /// A module's hooks for every task taken out, as its last instance ends
    /// or the library is deleted (`USER.EXE` seg1 `108c`-`10a6`,
    /// `7f51`-`7f9e` with its module): **recorded** by `taskend`. As
    /// `unhookModule`.
    pub(crate) fn unhook_module(&mut self, module: u16) {
        if module != 0 {
            self.unhook_where(|hook| hook.task == 0 && hook.module == module);
        }
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

impl Engine {
    /// The computer-based training hooks asked before USER does something,
    /// where one is in: what they answered, DX and AX. The callers each
    /// test the answer as USER's caller of that code does.
    pub(crate) async fn ask_cbt(&self, code: i16, wparam: u16, lparam: u32) -> Result<u32, Stop> {
        if !self.system().has_hooks(WH_CBT) {
            return Ok(0);
        }

        self.call_hooks(WH_CBT, code, wparam, lparam).await
    }

    /// As `ask_cbt`, with a structure of USER's own on the stack for the
    /// `LPARAM`: the answer, and the structure as the hooks left it.
    pub(crate) async fn ask_cbt_with(
        &self,
        code: i16,
        wparam: u16,
        structure: &[u8],
    ) -> Result<(u32, Vec<u8>), Stop> {
        if !self.system().has_hooks(WH_CBT) {
            return Ok((0, structure.to_vec()));
        }

        self.call_hooks_with(WH_CBT, code, wparam, structure).await
    }
}

impl Engine {
    /// The computer-based training hooks asked as a window is made,
    /// `HCBT_CREATEWND`: the window, and a `CBT_CREATEWND` -- a far pointer
    /// to the `CREATESTRUCT`, `CreateWindow`'s own arguments on the stack in
    /// Windows (`USER.EXE` seg8 `0459`-`045f`), and the window to put it
    /// after, nought (`0467`). Both laid on the stack here, the structure
    /// above. What they answered, the `CREATESTRUCT`'s bytes and the window
    /// to put it after as they left them.
    pub(crate) async fn ask_cbt_create(
        &self,
        hwnd: u16,
        create: &[u8],
    ) -> Result<(u32, Vec<u8>, u16), Stop> {
        if !self.system().has_hooks(WH_CBT) {
            return Ok((0, create.to_vec(), 0));
        }

        let (sp, lpcs, at, far) = {
            let mut system = self.system();
            let cpu = &mut system.cpu;
            let sp = cpu.regs[SP];
            let stack = cpu.segments[SS].base;
            let selector = cpu.segments[SS].selector;

            cpu.regs[SP] = sp.wrapping_sub((create.len() as u16 + 1) & !1);

            let lpcs = cpu.regs[SP];

            cpu.bus.write(stack + u32::from(lpcs), create);
            cpu.regs[SP] = cpu.regs[SP].wrapping_sub(6);

            let at = cpu.regs[SP];

            for (index, word) in [lpcs, selector, 0].iter().enumerate() {
                cpu.bus
                    .write16(stack + u32::from(at.wrapping_add(index as u16 * 2)), *word);
            }

            (sp, lpcs, at, u32::from(selector) << 16 | u32::from(at))
        };
        let answer = self.call_hooks(WH_CBT, HCBT_CREATEWND, hwnd, far).await;
        let mut system = self.system();
        let cpu = &mut system.cpu;
        let stack = cpu.segments[SS].base;
        let left = cpu.bus.read(stack + u32::from(lpcs), create.len());
        let after = cpu.bus.read16(stack + u32::from(at.wrapping_add(4)));

        cpu.regs[SP] = sp;
        Ok((answer?, left, after))
    }
}

/// A hook put in; what to hand `DefHookProc`: its own handle. A message
/// filter for the task calling, any other kind for every task; its module
/// the procedure's (`USER.EXE` seg1 `7d3b`-`7d5f`). As `SetWindowsHook`.
pub fn set_windows_hook(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let kind = args.signed(system);
    let proc = args.dword(system);
    let task = if kind == WH_MSGFILTER {
        system.task_handle
    } else {
        0
    };
    let module = crate::kernel_calls::code::module_of_proc(system, proc);

    Ok(Answer::Dword(system.install_for(
        kind,
        HookProc::Far(proc),
        task,
        module,
    )))
}

/// A hook put in for the task given, or every task with none. As
/// `SetWindowsHookEx`.
pub fn set_windows_hook_ex(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let kind = args.signed(system);
    let proc = args.dword(system);
    let instance = args.word(system);
    let task = args.word(system);

    // A kind outside -1 to 10 is refused, and so is an instance that is no
    // module's (`USER.EXE` seg1 `7d8f`-`7db2`).
    if !(WH_MSGFILTER..=WH_SHELL).contains(&kind) {
        return Ok(Answer::Dword(0));
    }

    let module = crate::kernel_calls::tasks::exe_ptr(system, instance);

    if module == 0 {
        return Ok(Answer::Dword(0));
    }

    // A kind no task may have for itself -- the journal hooks and the
    // system message filters -- asked for one task is refused (`USER.EXE`
    // seg1 `7db7`-`7dc4`, the kinds' flags at `7c96`, bit 0 clear;
    // **recorded** by `sysfilt`), and so is a task with no queue
    // (`7dd2`-`7ddb`, `7cfa`).
    if task != 0
        && (matches!(
            kind,
            WH_JOURNALRECORD | WH_JOURNALPLAYBACK | WH_SYSMSGFILTER
        ) || !system.live_task(task))
    {
        return Ok(Answer::Dword(0));
    }

    Ok(Answer::Dword(system.install_for(
        kind,
        HookProc::Far(proc),
        task,
        module,
    )))
}

/// The hook put in for this procedure taken out, looked for in the chain
/// as the task calling calls it (`USER.EXE` seg1 `7f26`-`7f49`); whether
/// there was one.
pub fn unhook_windows_hook(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let kind = args.signed(system);
    let proc = args.dword(system);
    let found = system
        .chain(kind)
        .into_iter()
        .find(|hook| matches!(hook.proc, HookProc::Far(far) if far == proc));

    if let Some(hook) = found {
        system.remove_hook(hook.handle);
    }

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
    /// `CallMsgFilter` with a message a program handed to USER, as
    /// `IsDialogMessage` calls it (`USER.EXE` seg25 `0c38`): `filters`.
    pub(crate) async fn call_msg_filter(
        &self,
        message: &crate::queue::Message,
        code: i16,
    ) -> Result<bool, Stop> {
        self.message_filter(message, code).await
    }

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

            if system.chain(WH_MSGFILTER).is_empty() && system.chain(WH_SYSMSGFILTER).is_empty() {
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

        Ok(self.filters(code, far).await? != 0)
    }

    /// USER's one caller of the message filters (`USER.EXE` seg1 `80cd`):
    /// none while a window is system-modal (`80d8`); else the system's,
    /// `WH_SYSMSGFILTER`, first, and the task's, `WH_MSGFILTER`, only where
    /// the system's answered nought (`80e8`-`8103`). The answer is the last
    /// chain's AX alone, whatever is left in DX (`80f0`): File Manager's
    /// filter leaves its own there, and every key in its Copy box was taken
    /// as filtered. **Recorded** by `sysfilt`.
    async fn filters(&self, code: i16, far: u32) -> Result<u16, Stop> {
        if self.system().sys_modal_window() != 0 {
            return Ok(0);
        }

        let first = self.call_hooks(WH_SYSMSGFILTER, code, 0, far).await? as u16;

        if first != 0 {
            return Ok(first);
        }

        Ok(self.call_hooks(WH_MSGFILTER, code, 0, far).await? as u16)
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
        // What the filter that ended it answered, in AX (`filters`).
        Ok(Answer::Word(engine.filters(code, far).await?))
    })
}

impl Engine {
    /// The message hooks called with a message a look hands over
    /// (`USER.EXE` seg1 `2597`-`25b7`): `HC_ACTION`, the look's flags as the
    /// program gave them -- `PM_REMOVE` for `GetMessage` -- with
    /// `PM_NOYIELD` added where the task has locked itself with
    /// `LockMyTask` (`245b`-`2462`), and the program's own `MSG`, at `far`,
    /// which the message is read from again after. So what a hook leaves
    /// there is the message handed over, and `GetMessage` answers nought
    /// where it is then `WM_QUIT` (`25bc`-`25cf`). Called for a message only
    /// looked at too, which stays in the queue as it was (`gmhook`).
    pub(crate) async fn get_message_hook(&self, far: u32, flags: u16) -> Result<(), Stop> {
        let flags = {
            let system = self.system();

            if far == 0 || !system.has_hooks(WH_GETMESSAGE) {
                return Ok(());
            }

            system.look_flags(flags)
        };

        self.call_hooks(WH_GETMESSAGE, 0, flags, far).await?;
        Ok(())
    }
}
