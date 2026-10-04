//! Programs started from other programs, and tasks giving each other the
//! processor, as winbox.js's `WinExec.ts` and `Scheduler` have them:
//! `WinExec`, `LoadModule`, `Yield` and `DirectedYield`; a message sent to
//! another task's window, run by that task; and a task's end.

use std::cell::RefCell;
use std::rc::Rc;

use winbox_machine::segment_selector;

use crate::call::{Answer, Args, Later, Stop};
use crate::engine::{Engine, Held};
use crate::messages::Param;
use crate::scheduler::Sent;
use crate::system::System;

impl Engine {
    /// Lets the others run, as `Yield` does: the processor given up and
    /// taken back in turn, answering anything sent this task meanwhile. A
    /// task named goes first, as `DirectedYield` asks (`tasks2`). With no
    /// other task waiting, even once those with a window to paint are woken,
    /// the turn comes straight back.
    pub(crate) async fn yield_turn(&self, first: Option<u16>) -> Result<(), Stop> {
        let slot = {
            let mut system = self.system();
            let Some(slot) = system.current_slot() else {
                return Ok(());
            };

            if let Some(named) = first.and_then(|first| system.slot_of(first)) {
                let waiting = &mut system.scheduler.waiting;

                if let Some(at) = waiting.iter().position(|&each| each == named)
                    && at > 0
                {
                    waiting.remove(at);
                    waiting.push_front(named);
                }
            }

            if first.is_none() && system.scheduler.waiting.is_empty() {
                system.wake_except(Some(slot));
            }

            // In line behind every task already waiting, then given up:
            // those run, each until it waits, before this one goes on.
            if first.is_some() || !system.scheduler.waiting.is_empty() {
                system.scheduler.waiting.push_back(slot);
                system.release();
            }

            slot
        };

        Held(self, slot).await;
        self.take_sent().await
    }

    /// What other tasks have sent this one run, in order, on its own state.
    pub(crate) async fn take_sent(&self) -> Result<(), Stop> {
        loop {
            let item = {
                let mut system = self.system();
                let Some(slot) = system.current_slot() else {
                    return Ok(());
                };

                system.scheduler.slots[slot].sent.pop_front()
            };
            let Some(Sent {
                proc,
                ax,
                hwnd,
                message,
                wparam,
                mut lparam,
                answer,
                from,
            }) = item
            else {
                return Ok(());
            };
            let value = self
                .call_proc_as(
                    &crate::classes::WndProc::Guest(proc),
                    ax,
                    hwnd,
                    message,
                    wparam,
                    &mut lparam,
                )
                .await?;

            *answer.borrow_mut() = Some((value, lparam));
            self.system().signal_slot(from);
        }
    }

    /// A window procedure of another task's, called as `SendMessage` calls
    /// one: handed to that task, which runs it where it waits for a message,
    /// while this one waits -- answering what is sent to it meanwhile -- for
    /// the answer.
    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn send_across(
        &self,
        target: usize,
        proc: u32,
        ax: u16,
        hwnd: u16,
        message: u16,
        wparam: u16,
        lparam: &mut Param,
    ) -> Result<u32, Stop> {
        let answer = Rc::new(RefCell::new(None));

        {
            let mut system = self.system();
            let from = system
                .current_slot()
                .ok_or(Stop::Unsupported("a send with no task"))?;

            system.scheduler.slots[target].sent.push_back(Sent {
                proc,
                ax,
                hwnd,
                message,
                wparam,
                lparam: lparam.clone(),
                answer: Rc::clone(&answer),
                from,
            });
            system.signal_slot(target);
        }

        loop {
            self.wait_for_wake(None).await;

            if let Some((value, back)) = answer.borrow_mut().take() {
                *lparam = back;
                return Ok(value);
            }

            self.take_sent().await?;
        }
    }

    /// A program started from its file: loaded, linked and set going, and
    /// run until it waits for a message, this task answering what it sends
    /// meanwhile; its instance, or the DOS error.
    pub(crate) async fn start_program(
        &self,
        path: &str,
        command_line: &str,
        show: u16,
        strings: Option<Vec<u8>>,
    ) -> Result<u16, Stop> {
        let child = {
            let mut system = self.system();
            let Some((folder, file)) = path.rsplit_once('\\') else {
                return Ok(2);
            };
            let Some((_, bytes)) = system.files.read_from(folder, file) else {
                return Ok(2);
            };
            let Ok(executable) = winbox_ne::Executable::parse(bytes) else {
                return Ok(11);
            };
            // The instance of the same program already running, if any.
            let previous = system
                .scheduler
                .slots
                .iter()
                .find(|slot| {
                    !slot.ended && system.modules[slot.program].path.eq_ignore_ascii_case(path)
                })
                .map_or(0, |slot| slot.handle);
            // The parent's environment, as it has it, unless one is given.
            let strings = strings.or_else(|| system.environment_bytes());
            let (program, libraries, handle) = system.load_program(executable, path);

            system.link(program);

            let command_line = command_line.to_string();

            system.add_task(handle, program, true, move |system| {
                system
                    .start_with(program, libraries, &command_line, show, previous, strings)
                    .map_err(Stop::Processor)
            })?
        };

        // The new program has the processor first; this one has it back
        // when the new one waits for a message.
        self.yield_turn(None).await?;

        loop {
            let (ended, waiting) = {
                let system = self.system();
                let slot = &system.scheduler.slots[child];

                (slot.ended, slot.waiting_for_message)
            };

            if ended || waiting {
                break;
            }

            self.yield_turn(None).await?;
        }

        // Its instance: its data segment's handle (`instds`).
        let system = self.system();
        let program = system.scheduler.slots[child].program;

        Ok(system.modules[program]
            .data()
            .map_or(system.scheduler.slots[child].handle, |data| {
                segment_selector(data) - 1
            }))
    }
}

impl System {
    /// The running task's environment, as its segment holds it.
    fn environment_bytes(&self) -> Option<Vec<u8>> {
        let environment = self.task.as_ref()?.environment;

        Some(self.cpu.bus.read((environment as u32) << 16, 256))
    }

    /// The running task ended, as the kernel ends one at INT 21h function
    /// 4Ch: the windows it left taken off the screen with their timers,
    /// without messages to it -- there is no program left to call -- and
    /// the processor to the next task waiting for it.
    pub(crate) fn exit_task(&mut self) {
        let Some(slot) = self.current_slot() else {
            return;
        };
        let handle = self.scheduler.slots[slot].handle;
        let left: Vec<usize> = self
            .z_order
            .iter()
            .copied()
            .filter(|&index| {
                self.windows[index]
                    .as_ref()
                    .is_some_and(|window| window.task == handle && window.hwnd != 0)
            })
            .collect();

        for index in left {
            self.forget_window(index);
        }

        if let Some(task) = self.task.as_mut() {
            task.queue.quit_code = None;
        }

        self.end_task(slot);
    }
}

/// A program started by its command line: its name, a space, and what it
/// is given, its spaces kept; a name with no extension given `.EXE`; found
/// as `OpenFile` finds it, else the DOS error (`winexec`).
pub fn win_exec(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (text, show) = {
            let system = engine.system();
            let far = args.dword(&system);
            let show = args.word(&system);
            let text: String = if far == 0 {
                String::new()
            } else {
                system
                    .read_string(far)
                    .into_iter()
                    .map(char::from)
                    .collect()
            };

            (text, show)
        };
        let text = text.trim_start_matches(' ');
        let (name, command_line) = text.split_once(' ').unwrap_or((text, ""));
        let mut name = name.to_ascii_uppercase();

        if name.is_empty() {
            return Ok(Answer::Word(2));
        }

        let part = name.rsplit(['\\', ':']).next().unwrap_or(&name).to_string();

        if !part.contains('.') {
            name.push_str(".EXE");
        }

        let found = crate::shell::programs::locate(&mut engine.system(), &name, "");
        let path = match found {
            Ok(path) => path,
            Err(error) => return Ok(Answer::Word(error)),
        };

        Ok(Answer::Word(
            engine
                .start_program(&path, command_line, show, None)
                .await?,
        ))
    })
}

/// A program started with a parameter block, as `WinExec` does with a
/// command line (`tasks2`): an environment's segment, a far pointer to the
/// command's tail -- its length in a byte, then its characters -- and a far
/// pointer to two words, 2 and the way to show the window. A block of -1
/// loads a library instead. An environment of the block's own is given as
/// its strings alone, then a count of nought and no path; with none, the
/// parent's is given whole (`loadenv`).
pub fn load_module(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (name_far, block) = {
            let system = engine.system();

            (args.dword(&system), args.dword(&system))
        };

        if block == 0xffff_ffff {
            return Err(Stop::Unsupported("LoadModule of a library"));
        }

        let (path, command_line, show, strings) = {
            let mut system = engine.system();
            let mut name: String = if name_far == 0 {
                String::new()
            } else {
                system
                    .read_string(name_far)
                    .into_iter()
                    .map(char::from)
                    .collect::<String>()
                    .to_ascii_uppercase()
            };

            if name.is_empty() {
                return Ok(Answer::Word(2));
            }

            let part = name.rsplit(['\\', ':']).next().unwrap_or(&name).to_string();

            if !part.contains('.') {
                name.push_str(".EXE");
            }

            let path = match crate::shell::programs::locate(&mut system, &name, "") {
                Ok(path) => path,
                Err(error) => return Ok(Answer::Word(error)),
            };
            let word = |system: &System, far: u32, at: u32| {
                let bytes =
                    system.read_far((far & 0xffff_0000) | (far.wrapping_add(at) & 0xffff), 2);

                u16::from_le_bytes([bytes[0], bytes[1]])
            };
            let far = |system: &System, at: u32| {
                u32::from(word(system, block, at + 2)) << 16 | u32::from(word(system, block, at))
            };
            let mut command_line = String::new();
            let mut show = 1;
            let mut strings = None;

            if block != 0 && word(&system, block, 0) != 0 {
                let segment = u32::from(word(&system, block, 0));
                let mut bytes = Vec::new();

                for at in 0..0x8000u32 {
                    let byte = system.read_far(segment << 16 | at, 1)[0];

                    if byte == 0 && bytes.last().is_none_or(|&last| last == 0) {
                        break;
                    }

                    bytes.push(byte);
                }

                bytes.extend_from_slice(&[0, 0, 0, 0]);
                strings = Some(bytes);
            }

            if block != 0 {
                let tail = far(&system, 2);
                let shows = far(&system, 6);

                if tail != 0 {
                    let length = system.read_far(tail, 1)[0];

                    for at in 1..=u32::from(length) {
                        let far = (tail & 0xffff_0000) | (tail.wrapping_add(at) & 0xffff);

                        command_line.push(char::from(system.read_far(far, 1)[0]));
                    }
                }

                if shows != 0 && word(&system, shows, 0) >= 2 {
                    show = word(&system, shows, 2);
                }
            }

            (path, command_line, show, strings)
        };

        Ok(Answer::Word(
            engine
                .start_program(&path, &command_line, show, strings)
                .await?,
        ))
    })
}

/// Lets the other tasks run, and goes on when they wait (`tasks2`).
pub fn yield_call(engine: &Engine, _: Args) -> Later<'_> {
    Box::pin(async move {
        engine.yield_turn(None).await?;
        Ok(Answer::Nothing)
    })
}

/// Lets the other tasks run, a given one first (`tasks2`).
pub fn directed_yield(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let task = args.word(&engine.system());

        engine.yield_turn(Some(task)).await?;
        Ok(Answer::Nothing)
    })
}

impl System {
    /// A finished task's window taken away (`exitTask`): its timers
    /// stopped, off the desktop -- a window at the top still shown as it
    /// goes, so what it covered is uncovered -- and its handle free.
    fn forget_window(&mut self, index: usize) {
        let Some(hwnd) = self.windows[index].as_ref().map(|window| window.hwnd) else {
            return;
        };

        self.kill_timers_of(hwnd);

        if let Some(window) = self.windows[index].as_mut()
            && window.parent.is_some()
        {
            window.visible = false;
        }

        self.leave_icon(index);

        if self.z_order.contains(&index) {
            self.take_away(index, true);
        }

        self.windows[index] = None;
        self.handles.free(hwnd);
    }
}
