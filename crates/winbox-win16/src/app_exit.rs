//! What USER does as a task ends, KERNEL telling it through its signal
//! procedure, signal 20h with the task's queue and instance (`KRNL386.EXE`
//! seg1 `1938`-`194d`; `USER.EXE` seg1 `09bc`-`09fb` to `0b71`): **read
//! out**, **recorded** by `taskend`. As `app-exit.ts`.
//!
//! * Its own hooks taken out (`0be4`, `unhook_task`).
//! * Each of its windows given its class's own procedure, where its class
//!   is one of USER's, else `DefWindowProc` -- and a dialog its dialog
//!   procedure cleared -- so none of the program's procedures, nor a
//!   library's, is called as they go (`0c03`, `0ec1`-`0fb1`, the classes'
//!   procedures at `0fcc`).
//! * Its windows destroyed, as `DestroyWindow` destroys one, walking the
//!   desktop's windows in their order, each window of another task's
//!   looked under first, and from the first again after each destroyed
//!   (`0c0b`, `103c`-`1069`). `DestroyWindow` then tells no parent (seg8
//!   `0ac6`), hides a window at the top with 2097h (`0b0d`-`0b20`), and
//!   makes no window active where none is (`0ba8`-`0bb2`): `exiting`.
//! * With its module's last instance (`0c29`-`0c31`, `1088`-`10be`):
//!   `module_gone`.
//!
//! Its messages go to USER's procedures, so the hooks see them, but no
//! procedure of the program's is called. `exit_slot` takes off what is
//! left without messages, where a task ends some other way.

use crate::call::{Answer, Args, Later, Pending, Stop};
use crate::classes::{DIALOG_CLASS, HostProc, WndProc};
use crate::dialogs::DialogProc;
use crate::engine::Engine;
use crate::handles::Object;
use crate::system::System;

const GW_HWNDNEXT: u16 = 2;
const GW_CHILD: u16 = 5;

impl System {
    /// USER told the task ends, as a call the engine makes before `INT
    /// 21h` function 4Ch ends it, where it has not been yet.
    pub(crate) fn app_exit_pending(&mut self) -> Option<Pending> {
        let task = self.task_handle;

        (self.cpu.regs[winbox_cpu::AX] >> 8 == 0x4c
            && task != 0
            && !self.app_exited.contains(&task))
        .then(|| Pending {
            implementation: app_exit_call,
            args: Args::repeat(0),
            logged: None,
        })
    }

    /// A window given USER's procedure for its class: its class's own,
    /// where that is one of USER's -- a dialog's dialog procedure cleared
    /// too, as the seventh class's is (`USER.EXE` seg1 `0f82`-`0fa1`; the
    /// dialog class, seg3 `1547`-`1590`) -- else `DefWindowProc`
    /// (`0fa4`-`0fac`).
    fn use_default(&mut self, index: usize) {
        let Some(class_name) = self.windows[index]
            .as_ref()
            .map(|window| window.class.clone())
        else {
            return;
        };
        let own = self
            .class_named(&class_name)
            .is_some_and(|class| matches!(self.classes[class].proc, WndProc::Host(_)));
        let window = self.windows[index].as_mut().expect("a window");

        if own {
            window.proc = None;

            if class_name.eq_ignore_ascii_case(DIALOG_CLASS)
                && let Some(dialog) = window.dialog.as_mut()
            {
                dialog.proc = DialogProc::Guest(0);
            }
        } else {
            window.proc = Some(WndProc::Host(HostProc::DefWindow(class_name)));
        }
    }

    /// The windows a test takes, by their indices.
    fn windows_taken(&self, take: impl Fn(&crate::windows::Window) -> bool) -> Vec<usize> {
        (0..self.windows.len())
            .filter(|&index| {
                self.windows[index]
                    .as_ref()
                    .is_some_and(|window| window.hwnd != 0 && take(window))
            })
            .collect()
    }

    /// USER's work for a module going (`USER.EXE` seg1 `1088`-`10be`): its
    /// hooks for every task taken out (`10a1`-`10a6`); a window whose
    /// procedure is in it, of a program made for Windows 3.0 or later,
    /// given its class's or `DefWindowProc` (`10ac`-`10b5`,
    /// `0ee3`-`0f01`); its classes unregistered (`10b8`, `0b07`-`0b39`).
    /// For a program's module as its last instance ends (`app_exit`); for
    /// a library's as KERNEL deletes it, telling USER with signal 80h
    /// (`KRNL386.EXE` seg2 `0c4c`-`0c81`; `USER.EXE` seg1 `0a4d`-`0a54`).
    /// As `moduleGone`.
    pub(crate) fn module_gone(&mut self, module: u16) {
        if module == 0 {
            return;
        }

        self.unhook_module(module);

        for index in self.windows_taken(|_| true) {
            let (proc, instance) = {
                let window = self.windows[index].as_ref().expect("a window");
                let proc = window.proc.clone().or_else(|| {
                    self.class_named(&window.class)
                        .map(|class| self.classes[class].proc.clone())
                });

                (proc, window.instance)
            };

            if let Some(WndProc::Guest(far)) = proc
                && self.expected_windows_version(instance).unwrap_or(0) >= 0x300
                && crate::kernel_calls::code::module_of_proc(self, far) == module
            {
                self.use_default(index);
            }
        }

        // The classes it registered, unregistered (`0b07`-`0b39`).
        let classes: Vec<u16> = self
            .handles
            .objects()
            .filter_map(|(handle, object)| match object {
                Object::Class(index) if self.class_modules.get(index) == Some(&module) => {
                    Some(handle)
                }
                _ => None,
            })
            .collect();

        for handle in classes {
            self.free_class(handle);
        }
    }

    /// What `app_exit` lets go that needs no message, for a task ended
    /// some other way -- another's `TerminateApp` -- and again, harmlessly,
    /// for one told: its own hooks, and with its module's last instance
    /// (`module` given) `module_gone`. As `appExitWithoutMessages`.
    pub(crate) fn app_exit_without_messages(&mut self, task: u16, module: u16) {
        self.unhook_task(task);
        self.module_gone(module);
    }
}

impl Engine {
    /// USER told a task ends. As `appExit`.
    pub(crate) async fn app_exit(&self, task: u16) -> Result<(), Stop> {
        let (module, last, desktop) = {
            let mut system = self.system();

            if task == 0 || system.app_exited.contains(&task) {
                return Ok(());
            }

            system.app_exited.push(task);

            let (module, last) = match system.slot_of(task) {
                Some(slot) => {
                    let program = system.scheduler.slots[slot].program;

                    (
                        system.modules[program].handle,
                        system.running_instances(program) <= 1,
                    )
                }
                None => (0, false),
            };

            system.unhook_task(task);

            for index in system.windows_taken(|window| window.task == task) {
                system.use_default(index);
            }

            system.exiting = task;

            let desktop = system.handles.lookup(Object::Desktop).unwrap_or(0);

            (module, last, desktop)
        };

        let destroyed = if desktop == 0 {
            Ok(())
        } else {
            Box::pin(self.destroy_under(desktop, task)).await
        };

        self.system().exiting = 0;
        destroyed?;

        if last {
            self.system().module_gone(module);
        }

        Ok(())
    }

    /// The task's windows under a window destroyed, in the order of its
    /// children, each of another task's looked under first, and from the
    /// first child again after each one destroyed (`USER.EXE` seg1
    /// `103c`-`1069`). A window that will not go -- a hook refused it --
    /// is taken off as `exit_slot` takes one off, where Windows would ask
    /// again for ever. As `destroyUnder`.
    async fn destroy_under(&self, parent: u16, task: u16) -> Result<(), Stop> {
        let mut child = crate::window_queries::related(&self.system(), parent, GW_CHILD);

        while child != 0 {
            let ours = {
                let system = self.system();

                system
                    .window_index(child)
                    .and_then(|index| system.windows[index].as_ref())
                    .is_some_and(|window| window.task == task)
            };

            if ours {
                if !self.destroy_window(child).await? {
                    let mut system = self.system();

                    if let Some(index) = system.window_index(child) {
                        system.forget_window(index);
                    }
                }

                child = crate::window_queries::related(&self.system(), parent, GW_CHILD);
                continue;
            }

            Box::pin(self.destroy_under(child, task)).await?;
            child = crate::window_queries::related(&self.system(), child, GW_HWNDNEXT);
        }

        Ok(())
    }
}

/// `app_exit` for the running task, as the engine calls it before `INT
/// 21h` function 4Ch.
pub(crate) fn app_exit_call(engine: &Engine, _: Args) -> Later<'_> {
    Box::pin(async move {
        let task = engine.system().task_handle;

        engine.app_exit(task).await?;
        Ok(Answer::Nothing)
    })
}
