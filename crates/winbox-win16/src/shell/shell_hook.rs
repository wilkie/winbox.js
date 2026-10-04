//! SHELL's shell hook: the windows that ask, Program Manager's among them,
//! are told when a top-level window is made or goes.
//!
//! **Read out** of `SHELL.DLL` (seg4 `128c`, `11ca`) and **recorded** by
//! `shlhook`:
//!
//! * `RegisterShellHook` with a flag of 1 or 2 adds a window to SHELL's
//!   list; 2 makes it the shell's own window too. The first puts SHELL's
//!   `ShellHookProc` in as a `WH_SHELL` hook, and registers three messages:
//!   `OTHERWINDOWCREATED`, `OTHERWINDOWDESTROYED` and `ACTIVATESHELLWINDOW`.
//!   With a flag of nought it takes the window out, and when the list is
//!   empty takes the hook out. It answers 1, or nought when the hook cannot
//!   be put in.
//! * `ShellHookProc`, told a window was made (1) or went (2), posts the
//!   first or second message to every window on the list with that window
//!   in `wParam`, and drops any that is a window no more. Told to activate
//!   the shell window (3), it posts the third to the shell's own. It passes
//!   each call on.
//!
//! SHELL's hook is a procedure of winbox.js's own (`hooks::HookProc::Host`),
//! as the TypeScript engine's is a function.

use std::future::Future;
use std::pin::Pin;

use crate::call::{Answer, Args, Later, Stop};
use crate::engine::Engine;
use crate::hooks::{HookProc, WH_SHELL};
use crate::system::System;
use crate::user::register_message;

/// What SHELL keeps of its hook: whether it is in, and its handle; the
/// windows to tell, a slot nought where one was taken out; the shell's own
/// window; and the three messages' numbers.
#[derive(Debug, Clone, Default)]
pub struct ShellHook {
    pub hooked: bool,
    pub handle: u32,
    pub windows: Vec<u16>,
    pub shell: u16,
    pub created: u16,
    pub destroyed: u16,
    pub activate: u16,
}

/// Asks, or stops asking, to be told of top-level windows made and gone:
/// 1 to add the window, 2 to add it as the shell's own window, nought to
/// take it out. It answers 1, or nought when the hook could not be put in.
#[allow(clippy::unnecessary_wraps)]
pub fn register_shell_hook(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);
    let install = args.word(system);

    if install != 0 {
        if !system.shell.hook.hooked {
            let handle = system.install(WH_SHELL, HookProc::Host(host_hook));

            system.shell.hook.handle = handle;

            if handle == 0 {
                return Ok(Answer::Word(0));
            }

            system.shell.hook.hooked = true;
            system.shell.hook.created = register_message(system, "OTHERWINDOWCREATED".into());
            system.shell.hook.destroyed = register_message(system, "OTHERWINDOWDESTROYED".into());
            system.shell.hook.activate = register_message(system, "ACTIVATESHELLWINDOW".into());
        }

        let state = &mut system.shell.hook;

        // The first slot that is free, or a new one.
        match state.windows.iter().position(|&window| window == 0) {
            Some(free) => state.windows[free] = hwnd,
            None => state.windows.push(hwnd),
        }

        if install == 2 {
            state.shell = hwnd;
        }

        return Ok(Answer::Word(1));
    }

    let state = &mut system.shell.hook;

    if state.shell == hwnd {
        state.shell = 0;
    }

    if let Some(at) = state.windows.iter().rposition(|&window| window == hwnd) {
        state.windows[at] = 0;

        while state.windows.last() == Some(&0) {
            state.windows.pop();
        }

        if state.windows.is_empty() && state.hooked {
            let handle = state.handle;

            state.hooked = false;
            system.remove_hook(handle);
        }
    }

    Ok(Answer::Word(1))
}

/// SHELL's hook as the hook chain calls it.
fn host_hook(
    engine: &Engine,
    code: i16,
    wparam: u16,
    lparam: u32,
) -> Pin<Box<dyn Future<Output = Result<u32, Stop>> + '_>> {
    Box::pin(hook_proc(engine, code, wparam, lparam))
}

/// What SHELL's hook does with a call: see the module's notes. What the
/// hooks after it answer.
async fn hook_proc(engine: &Engine, code: i16, wparam: u16, lparam: u32) -> Result<u32, Stop> {
    let handle = {
        let mut system = engine.system();
        let system = &mut *system;
        let state = system.shell.hook.clone();

        if code == 3 && state.shell != 0 {
            system.post_message(state.shell, state.activate, 0, 0);
        }

        if code == 1 || (code == 2 && !state.windows.is_empty()) {
            let message = if code == 1 {
                state.created
            } else {
                state.destroyed
            };

            for (i, &window) in state.windows.iter().enumerate() {
                if window == 0 {
                    continue;
                }

                let alive = matches!(
                    crate::window_queries::is_window(system, &mut Args::repeat(window)),
                    Ok(Answer::Word(1))
                );

                if alive {
                    system.post_message(window, message, wparam, 0);
                } else {
                    system.shell.hook.windows[i] = 0;
                }
            }
        }

        state.handle
    };

    engine.call_after(handle, code, wparam, lparam).await
}

/// `ShellHookProc` called by a program, as the hook chain calls it.
pub fn shell_hook_proc(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (code, wparam, lparam) = {
            let system = engine.system();

            (
                args.signed(&system),
                args.word(&system),
                args.dword(&system),
            )
        };

        Ok(Answer::Dword(
            hook_proc(engine, code, wparam, lparam).await?,
        ))
    })
}
