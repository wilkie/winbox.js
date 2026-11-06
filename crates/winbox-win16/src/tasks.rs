//! Programs started from other programs, and tasks giving each other the
//! processor, as winbox.js's `WinExec.ts` and `Scheduler` have them:
//! `WinExec`, `LoadModule`, `Yield` and `DirectedYield`; a message sent to
//! another task's window, run by that task; and a task's end.

use std::cell::RefCell;
use std::rc::Rc;

use winbox_machine::segment_selector;

use crate::call::{Answer, Args, Later, Stop};
use crate::engine::{Engine, Held};
use crate::handles::Object;
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
            // Handling it, the task is in a message another sent it
            // (`InSendMessage`, `USER.EXE` seg1 `3dba`), which its looks
            // meanwhile let the input go for (`system_queue.rs`).
            let slot = self.system().current_slot();
            let replied = Rc::new(std::cell::Cell::new(false));

            if let Some(slot) = slot {
                let mut system = self.system();
                let each = &mut system.scheduler.slots[slot];

                each.in_sent += 1;
                each.answering.push(crate::scheduler::Answering {
                    hwnd,
                    message,
                    wparam,
                    lparam: match &lparam {
                        Param::Value(value) => *value,
                        Param::Struct(_) => 0,
                    },
                    answer: Rc::clone(&answer),
                    replied: Rc::clone(&replied),
                    from,
                });
            }

            let value = self
                .call_proc_as(
                    &crate::classes::WndProc::Guest(proc),
                    ax,
                    hwnd,
                    message,
                    wparam,
                    &mut lparam,
                )
                .await;

            if let Some(slot) = slot {
                let mut system = self.system();

                if let Some(each) = system.scheduler.slots.get_mut(slot) {
                    each.in_sent = each.in_sent.saturating_sub(1);
                    each.answering.pop();
                }
            }

            let value = value?;

            // Answered already by `ReplyMessage`: what the procedure
            // answers after is not taken.
            if replied.get() {
                continue;
            }

            *answer.borrow_mut() = Some((value, lparam));
            self.system().signal_slot(from);
            self.hand_back(from).await;
        }
    }

    /// The processor handed back to the task whose message this one has
    /// answered, as USER's reply hands it, with `DirectedYield` (`USER.EXE`
    /// seg1 `3c8a`-`3c8f`): that task goes on at once, and this one is in
    /// line behind every task already waiting, as a directed yield leaves
    /// it (`tasks2`). Where the sender is not waiting for the processor,
    /// this one goes on.
    pub(crate) async fn hand_back(&self, to: usize) {
        let slot = {
            let mut system = self.system();
            let Some(slot) = system.current_slot() else {
                return;
            };

            if !system.first_in_line(to) {
                return;
            }

            system.scheduler.waiting.push_back(slot);
            system.release();
            slot
        };

        Held(self, slot).await;
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
            // The task sent to has the processor next: USER hands it over
            // with `DirectedYield` as it sends (`USER.EXE` seg1 `3b3d`-
            // `3b3e`), so no other task runs before the message is
            // answered -- two tasks' activations, each sending the other
            // windows their messages, never cross.
            system.first_in_line(target);
        }

        loop {
            self.wait_for_wake(None).await;

            if let Some((value, back)) = answer.borrow_mut().take() {
                *lparam = back;
                return Ok(value);
            }

            self.take_sent().await?;

            // Answered while this task answered another's message, and
            // handed the processor back in that: not woken, as it was not
            // waiting, so not to wait for it again.
            if let Some((value, back)) = answer.borrow_mut().take() {
                *lparam = back;
                return Ok(value);
            }
        }
    }

    /// A program started from its file: loaded, linked and set going, and
    /// run until it first gives the processor up (`run_started`), this task
    /// answering what it sends meanwhile; its instance, or the DOS error,
    /// and its task.
    pub(crate) async fn start_program(
        &self,
        path: &str,
        command_line: &str,
        show: u16,
        strings: Option<Vec<u8>>,
    ) -> Result<(u16, u16), Stop> {
        let child = {
            let mut system = self.system();
            // The parent's environment, as its segment holds it -- changed,
            // it may be, by the parent (`search`) -- unless one is given.
            let strings = strings.or_else(|| system.environment_block());

            match system.add_program(path, command_line, show, strings, true)? {
                Ok(child) => child,
                Err(error) => return Ok((error, 0)),
            }
        };

        self.run_started(child).await
    }

    /// A task just made run first: KERNEL gives the processor up once, by
    /// `Yield`, as the task is made (`KRNL386.EXE` seg2 `13a1`-`13a8`, seg1
    /// `7d21`), and this one has it back the first time the new one gives
    /// it up -- by `PeekMessage` or `Yield` as much as by waiting for a
    /// message -- or ends (recorded by `execpk`). Its instance, and its
    /// task.
    pub(crate) async fn run_started(&self, child: usize) -> Result<(u16, u16), Stop> {
        // Its instance: its data segment's handle (`instds`), as the task
        // was made -- a program that has ended by the time this has the
        // processor back has given its segments back (`exit_slot`).
        let (instance, task) = {
            let system = self.system();
            let program = system.scheduler.slots[child].program;
            let task = system.scheduler.slots[child].handle;

            (
                system.modules[program]
                    .data()
                    .map_or(task, |data| segment_selector(data) - 1),
                task,
            )
        };

        self.yield_turn(None).await?;

        Ok((instance, task))
    }
}

/// Why a program could not be launched beside those running
/// (`System::launch`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Launch {
    /// No program has started: the first is started as the task holding
    /// the processor as the run begins (`survey::start`).
    First,
    /// The DOS error, as `WinExec` answers it: 2 for no file, 11 for no
    /// Windows program.
    Dos(u16),
    /// Its registers could not be set.
    Stopped(Stop),
}

impl System {
    /// A program made a task from its file, as `WinExec` makes one: loaded
    /// -- a second instance of a program that runs given the first as its
    /// previous one -- linked, and put in line for the processor, first
    /// where `first`. Its slot, or the DOS error: 2 for no file, 11 for no
    /// Windows program.
    pub(crate) fn add_program(
        &mut self,
        path: &str,
        command_line: &str,
        show: u16,
        strings: Option<Vec<u8>>,
        first: bool,
    ) -> Result<Result<usize, u16>, Stop> {
        let Some((folder, file)) = path.rsplit_once('\\') else {
            return Ok(Err(2));
        };
        let Some((_, bytes)) = self.files.read_from(folder, file) else {
            return Ok(Err(2));
        };
        if let Some(error) = crate::modules_kernel::load_error(&bytes) {
            return Ok(Err(error));
        }

        let Ok(executable) = winbox_ne::Executable::parse(bytes) else {
            return Ok(Err(11));
        };

        self.add_executable(executable, path, command_line, show, strings, first)
    }

    /// A program made a task, as `add_program` makes one, from its
    /// executable as read: from its file, or made in memory (`progman`).
    pub(crate) fn add_executable(
        &mut self,
        executable: winbox_ne::Executable,
        path: &str,
        command_line: &str,
        show: u16,
        strings: Option<Vec<u8>>,
        first: bool,
    ) -> Result<Result<usize, u16>, Stop> {
        let folder = path.rsplit_once('\\').map_or("", |(folder, _)| folder);

        // A library it imports found nowhere: not started (`search`).
        if self.missing_library(&executable, Some(folder)).is_some() {
            return Ok(Err(2));
        }

        // The instance of the same program already running, if any.
        let previous = self
            .scheduler
            .slots
            .iter()
            .find(|slot| !slot.ended && self.modules[slot.program].path.eq_ignore_ascii_case(path))
            .map_or(0, |slot| slot.handle);
        let (program, libraries, handle) = self.load_program(executable, path);

        self.link(program);

        let command_line = command_line.to_string();

        self.add_task(handle, program, first, move |system| {
            system
                .start_with(program, libraries, &command_line, show, previous, strings)
                .map_err(Stop::Processor)
        })
        .map(Ok)
    }

    /// A program started beside those running, as Program Manager starts
    /// one whose item's working directory is where the program is: made a
    /// task as `WinExec` makes one, shown normally, with Windows'
    /// environment, in its own folder -- its own current directory, the
    /// others staying in theirs (`curdir`) -- and put in line for the
    /// processor behind those waiting for it, granted it at once where none
    /// has it. A run takes it up as it takes up a task `WinExec` started
    /// (`EngineRun::step`). Its task's handle.
    ///
    /// # Errors
    ///
    /// Where no program has started yet (`Launch::First`), or this one could
    /// not be.
    pub fn launch(&mut self, path: &str) -> Result<u16, Launch> {
        if self.scheduler.slots.is_empty() {
            return Err(Launch::First);
        }

        let slot = self
            .add_program(path, "", crate::task::SW_SHOWNORMAL, None, false)
            .map_err(Launch::Stopped)?
            .map_err(Launch::Dos)?;

        if let Some((folder, _)) = path.rsplit_once('\\')
            && let Some(saved) = self.scheduler.slots[slot].saved.as_mut()
        {
            let folder = if folder.len() > 2 {
                folder.to_string()
            } else {
                format!("{folder}\\")
            };

            saved.directory = (
                folder.chars().next().unwrap_or('C').to_ascii_uppercase(),
                folder,
            );
        }

        self.grant();

        Ok(self.scheduler.slots[slot].handle)
    }

    /// The running task ended, as the kernel ends one at INT 21h function
    /// 4Ch: the windows it left taken off the screen with their timers,
    /// without messages to it -- there is no program left to call -- and
    /// the processor to the next task waiting for it. Its code kept with
    /// it, for the host to tell.
    pub(crate) fn exit_task(&mut self, code: u8) {
        let Some(slot) = self.current_slot() else {
            return;
        };

        self.exit_slot(slot, code);
    }

    /// A task ended by its handle, as `exit_task` ends the running one --
    /// TOOLHELP's `TerminateApp` ends another so -- with `code`.
    pub(crate) fn end_task_of(&mut self, handle: u16, code: u8) {
        if let Some(slot) = self.slot_of(handle) {
            self.exit_slot(slot, code);
        }
    }

    fn exit_slot(&mut self, slot: usize, code: u8) {
        let running = self.scheduler.current == Some(slot);

        self.scheduler.slots[slot].exit_code = Some(code);
        let handle = self.scheduler.slots[slot].handle;

        // USER has been told first, where the task ends itself, and its
        // hooks and windows have gone with their messages (`app_exit.rs`).
        // What is left goes here without messages: a task another ends,
        // its hooks taken out and its windows taken off as USER would take
        // them. As `exitTask`.
        {
            let program = self.scheduler.slots[slot].program;
            let module = if self.running_instances(program) <= 1 {
                self.modules[program].handle
            } else {
                0
            };

            self.app_exit_without_messages(handle, module);
        }
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

        if running && let Some(task) = self.task.as_mut() {
            task.queue.quit_code = None;
        }

        // Its selectors given back as KERNEL ends a task (**read out**,
        // `KRNL386.EXE` seg1 `18b3`-`1a1f`): USER's message queue as USER is
        // told the task ends (`194d`); the libraries its program brought, the
        // last first, as its module is freed (`19c3`, seg2 `0a84`-`0ad1`;
        // `search`); its data segment, its module's database where this was
        // its last instance, and its other segments
        // (`free_module_segments`); its program segment prefix
        // (`19fc`-`1a01`); then its second selector, the one its database
        // keeps at B0h, by `FreeSelector` (`1a20`), and its database
        // (`1a31`). Each on top of the free list (`segfree`). Its
        // environment is DPMI's DOS memory, not from KERNEL's list: let go,
        // not given back. As `exitTask`.
        let program = self.scheduler.slots[slot].program;
        let own = self.modules[program].own.take();

        if let Some(own) = own
            && !matches!(
                self.handles.resolve_module(self.modules[program].handle),
                Some(Object::Kept(_))
            )
        {
            self.descriptors.give(&mut self.cpu.bus, own.queue);
        }

        let mut brought = std::mem::take(&mut self.modules[program].brought);

        brought.reverse();
        self.release_libraries(&brought);
        self.end_task(slot);

        // Its module gone with its last instance: deleted, as KERNEL deletes
        // one -- its segments and its database given back, and its name, its
        // file and its handle found no more -- but WinBox's Program
        // Manager's, the module it keeps (`progman`).
        let last = self.running_instances(program) == 0;
        let handle = self.modules[program].handle;
        let database = (last
            && handle != 0
            && matches!(self.handles.resolve_module(handle), Some(Object::Task(_))))
        .then(|| winbox_machine::index_for(handle));

        // WinBox's Program Manager's code and data are the kept module's.
        let kept = matches!(self.handles.resolve_module(handle), Some(Object::Kept(_)));

        if let Some(own) = own.filter(|_| !kept) {
            self.free_module_segments(program, database, last);

            if database.is_some() {
                self.handles.free_module(handle);
            }

            for index in [own.prefix, own.second, own.database] {
                self.descriptors.give(&mut self.cpu.bus, index);
            }

            if let Some(environment) = own.environment {
                self.descriptors.release(&mut self.cpu.bus, environment);
            }
        }

        if last {
            let path = self.modules[program].path.clone();

            for module in &mut self.modules {
                if !module.is_library() && module.path.eq_ignore_ascii_case(&path) {
                    module.handle = 0;

                    if !kept {
                        module.name.clear();
                        module.path.clear();
                    }
                }
            }
        }

        self.app_exited.retain(|&task| task != handle);
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
        Ok(Answer::Word(engine.win_exec_line(&text, show).await?))
    })
}

impl Engine {
    /// `WinExec`'s work on its command line, for USER's and SHELL's own
    /// callers too: the program's instance, or the DOS error.
    pub(crate) async fn win_exec_line(&self, text: &str, show: u16) -> Result<u16, Stop> {
        let text = text.trim_start_matches(' ');
        let (name, command_line) = text.split_once(' ').unwrap_or((text, ""));
        let mut name = name.to_ascii_uppercase();

        if name.is_empty() {
            return Ok(2);
        }

        let part = name.rsplit(['\\', ':']).next().unwrap_or(&name).to_string();

        if !part.contains('.') {
            name.push_str(".EXE");
        }

        let found = crate::shell::programs::locate(&mut self.system(), &name, "");

        match found {
            Ok(path) => Ok(self.start_program(&path, command_line, show, None).await?.0),
            // `PROGMAN.EXE` found nowhere: WinBox's own (`progman`).
            Err(2) if crate::progman::wanted(&name) => {
                Ok(self.start_progman(command_line, show, None).await?.0)
            }
            Err(error) => Ok(error),
        }
    }

    /// A program named started, as `LoadModule` starts it once its block is
    /// read: found as KERNEL looks for it, or, for `PROGMAN.EXE` and
    /// `MMTASK.TSK` found nowhere, WinBox's own. The instance in the low
    /// word, or an error below 32; the new task in the high, `LoadModule`'s
    /// DX (`KRNL386.EXE` seg2 `1d4f`), nought where none was. As
    /// `WinExec.ts`'s `startNamed`.
    pub(crate) async fn start_named(
        &self,
        name: &str,
        command_line: &str,
        show: u16,
        strings: Option<Vec<u8>>,
    ) -> Result<u32, Stop> {
        let found = crate::shell::programs::locate(&mut self.system(), name, "");
        let (instance, task) = match found {
            Ok(path) => {
                self.start_program(&path, command_line, show, strings)
                    .await?
            }
            Err(2) if crate::mmsystem::mmtask::wanted(name) => {
                self.start_mmtask(command_line, show, strings).await?
            }
            Err(2) if crate::progman::wanted(name) => {
                self.start_progman(command_line, show, strings).await?
            }
            Err(error) => return Ok(u32::from(error)),
        };
        let task = if instance >= 32 { task } else { 0 };

        Ok(u32::from(task) << 16 | u32::from(instance))
    }
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
            let system = engine.system();
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

            (name, command_line, show, strings)
        };

        Ok(Answer::Dword(
            engine
                .start_named(&path, &command_line, show, strings)
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

/// The processor given up as KERNEL gives it up itself, with no look at
/// USER's queue (`KRNL386.EXE` seg1 `7d3e`-`7d6f`): `FFFFh`. As
/// `WinExec.ts`'s `OldYield`.
pub fn old_yield(engine: &Engine, _: Args) -> Later<'_> {
    Box::pin(async move {
        engine.yield_turn(None).await?;
        Ok(Answer::Word(0xffff))
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
    pub(crate) fn forget_window(&mut self, index: usize) {
        let Some(hwnd) = self.windows[index].as_ref().map(|window| window.hwnd) else {
            return;
        };

        self.kill_timers_of(hwnd);

        if let Some(window) = self.windows[index].as_mut()
            && window.parent.is_some()
        {
            window.visible = false;
        }

        self.drop_icon_title(index);

        if self.z_order.contains(&index) {
            self.take_away(index, true);
        }

        self.lose_focus(index);
        self.windows[index] = None;
        self.handles.free(hwnd);
    }
}
