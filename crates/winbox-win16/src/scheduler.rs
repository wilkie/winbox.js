//! Tasks taking turns with the processor, as winbox.js's `Scheduler` gives
//! it: one task runs at a time, and gives the processor up only where it
//! waits -- for a message, in `Yield`, or for another task to answer what
//! it sent -- the next waiting granted it then, in the order they asked.
//!
//! The running task's state is the system's own: its `Task`, its handle,
//! the processor's registers, and DOS's current drive and directory. A
//! task that has given the processor up keeps them in its slot until it is
//! granted it again.

use std::cell::RefCell;
use std::collections::VecDeque;
use std::rc::Rc;

use winbox_cpu::{Segment, X87};
use winbox_machine::TimerId;

use crate::engine::Wait;
use crate::messages::Param;
use crate::system::System;
use crate::task::Task;

/// What a task keeps of its own while another has the processor.
#[derive(Debug, Clone)]
pub struct Context {
    pub task: Option<Task>,
    regs: [u16; 8],
    high: [u16; 8],
    ip: u16,
    flags: u16,
    segments: [Segment; 6],
    fpu: Option<X87>,
    depth: usize,
    transfer_area: (u16, u16),
    error_mode: u16,
    /// Its current drive, and that drive's directory. Windows keeps them in
    /// each task's database, TDB 66h and 67h: read from DOS's as the task
    /// is switched away from (`KRNL386.EXE` seg1 `8170`, calling `820a`),
    /// and made DOS's again before the next task's next call on a path,
    /// where another task's are DOS's (seg1 `1c64` to `1ce9`). A task
    /// starts in the directory of the one that started it (`curdir`).
    pub(crate) directory: (char, String),
}

/// A message another task sent this one's window, waiting for this one to
/// take it where it waits, and the answer, once it has.
#[derive(Debug)]
pub struct Sent {
    /// The window procedure, and AX as it is called.
    pub proc: u32,
    pub ax: u16,
    pub hwnd: u16,
    pub message: u16,
    pub wparam: u16,
    pub lparam: Param,
    pub answer: Rc<RefCell<Option<(u32, Param)>>>,
    /// The task that sent it, to be woken by the answer.
    pub from: usize,
}

/// A task, as the scheduler keeps it.
#[derive(Debug)]
pub struct Slot {
    /// Its handle, the instance `GetCurrentTask` answers.
    pub handle: u16,
    /// Its program's module.
    pub program: usize,
    /// Whether it runs, waits with the processor given up, or was woken.
    pub wait: Wait,
    /// The timer that ends its wait, where it waits for one.
    pub wait_timer: Option<TimerId>,
    /// Whether it waits for a message, as `WinExec` waits for a program it
    /// starts to (`winexec`).
    pub waiting_for_message: bool,
    pub ended: bool,
    /// The code it gave DOS as it ended, where it ended with others left
    /// to run on; 255 where it faulted, as the TypeScript engine ends one.
    pub exit_code: Option<u8>,
    /// What other tasks sent it, to be taken in order.
    pub sent: VecDeque<Sent>,
    /// Its own state, while another task has the processor.
    pub saved: Option<Box<Context>>,
}

/// The tasks, which has the processor, and those waiting for it.
#[derive(Debug, Default)]
pub struct Scheduler {
    pub slots: Vec<Slot>,
    pub current: Option<usize>,
    pub waiting: VecDeque<usize>,
    /// Tasks started, whose runs the engine is yet to take up.
    pub started: Vec<usize>,
}

impl System {
    /// The running task's slot.
    pub fn current_slot(&self) -> Option<usize> {
        self.scheduler.current
    }

    /// The slot of the task a handle names.
    pub fn slot_of(&self, handle: u16) -> Option<usize> {
        self.scheduler
            .slots
            .iter()
            .position(|slot| slot.handle == handle && !slot.ended)
    }

    /// The running task's slot, or with the processor given up, the one
    /// task there is: where a message for no task's window goes.
    pub fn lone_slot(&self) -> Option<usize> {
        self.scheduler.current.or_else(|| {
            let mut live = self
                .scheduler
                .slots
                .iter()
                .enumerate()
                .filter(|(_, slot)| !slot.ended);

            match (live.next(), live.next()) {
                (Some((slot, _)), None) => Some(slot),
                _ => None,
            }
        })
    }

    /// How many tasks have not ended.
    pub fn task_count(&self) -> usize {
        self.scheduler
            .slots
            .iter()
            .filter(|slot| !slot.ended)
            .count()
    }

    /// The slot of the task that made a window: none for no window, or
    /// one made with no task.
    pub fn window_slot(&self, hwnd: u16) -> Option<usize> {
        let index = self.window_named(hwnd)?;
        let task = self.windows[index].as_ref()?.task;

        self.slot_of(task)
    }

    /// Whether a window is the running task's, or one any task may take:
    /// with a single task, every window is.
    pub fn mine(&self, hwnd: u16) -> bool {
        self.task_count() < 2
            || hwnd == 0
            || self
                .window_slot(hwnd)
                .is_none_or(|slot| Some(slot) == self.scheduler.current)
    }

    /// How many of a program's instances run (`tasks2`): nought once the
    /// last has ended (`fault`).
    pub fn running_instances(&self, program: usize) -> usize {
        let path = self.modules[program].path.to_ascii_uppercase();

        self.scheduler
            .slots
            .iter()
            .filter(|slot| {
                !slot.ended && self.modules[slot.program].path.to_ascii_uppercase() == path
            })
            .count()
    }

    /// The first task made: the one running already.
    pub(crate) fn first_task(&mut self, handle: u16, program: usize) {
        self.scheduler.slots.push(Slot {
            handle,
            program,
            wait: Wait::Running,
            wait_timer: None,
            waiting_for_message: false,
            ended: false,
            exit_code: None,
            sent: VecDeque::new(),
            saved: None,
        });
        self.scheduler.current = Some(self.scheduler.slots.len() - 1);
    }

    /// The running task's state taken out of the system.
    fn take_context(&mut self) -> Context {
        let cpu = &self.cpu;

        Context {
            task: self.task.take(),
            regs: cpu.regs,
            high: cpu.high,
            ip: cpu.ip,
            flags: cpu.flags,
            segments: cpu.segments,
            fpu: cpu.fpu.clone(),
            depth: self.depth,
            transfer_area: self.transfer_area,
            error_mode: self.error_mode,
            directory: (self.files.drive, self.files.path()),
        }
    }

    /// A task's state put back as the system's own.
    fn put_context(&mut self, context: Context) {
        self.task = context.task;
        self.cpu.regs = context.regs;
        self.cpu.high = context.high;
        self.cpu.ip = context.ip;
        self.cpu.flags = context.flags;
        self.cpu.segments = context.segments;
        self.cpu.fpu = context.fpu;
        self.depth = context.depth;
        self.transfer_area = context.transfer_area;
        self.error_mode = context.error_mode;
        self.files.drive = context.directory.0;

        if !context.directory.1.is_empty() {
            self.files.set_path(&context.directory.1);
        }
    }

    /// A task made ready to run, its state as `make` leaves the system's --
    /// the running task's own kept meanwhile, and put back -- and put in
    /// line for the processor: first, where `first`.
    pub(crate) fn add_task(
        &mut self,
        handle: u16,
        program: usize,
        first: bool,
        make: impl FnOnce(&mut Self) -> Result<(), crate::call::Stop>,
    ) -> Result<usize, crate::call::Stop> {
        let mine = self.take_context();
        let task_handle = self.task_handle;

        self.task_handle = handle;
        self.depth = 0;

        let started = make(self);
        let theirs = self.take_context();

        self.put_context(mine);
        self.task_handle = task_handle;
        started?;
        self.scheduler.slots.push(Slot {
            handle,
            program,
            wait: Wait::Running,
            wait_timer: None,
            waiting_for_message: false,
            ended: false,
            exit_code: None,
            sent: VecDeque::new(),
            saved: Some(Box::new(theirs)),
        });

        let slot = self.scheduler.slots.len() - 1;

        if first {
            self.scheduler.waiting.push_front(slot);
        } else {
            self.scheduler.waiting.push_back(slot);
        }

        self.scheduler.started.push(slot);
        Ok(slot)
    }

    /// The processor given up by the running task: its state kept, and the
    /// next waiting granted it.
    pub(crate) fn release(&mut self) {
        let Some(slot) = self.scheduler.current.take() else {
            return;
        };
        let context = self.take_context();

        self.scheduler.slots[slot].saved = Some(Box::new(context));
        // The others with a window due to paint look again
        // (`RasterInput.wake`).
        self.wake_except(Some(slot));
        self.grant();
    }

    /// The processor, if nobody has it, to the first waiting for it -- a
    /// task that ended meanwhile passed over -- with its state as it left
    /// it.
    pub(crate) fn grant(&mut self) {
        if self.scheduler.current.is_some() {
            return;
        }

        while let Some(slot) = self.scheduler.waiting.pop_front() {
            if self.scheduler.slots[slot].ended {
                continue;
            }

            if let Some(context) = self.scheduler.slots[slot].saved.take() {
                self.put_context(*context);
            }

            self.task_handle = self.scheduler.slots[slot].handle;
            self.scheduler.current = Some(slot);
            return;
        }
    }

    /// Whether a task has the processor.
    pub(crate) fn has_processor(&self, slot: usize) -> bool {
        self.scheduler.current == Some(slot)
    }

    /// A task put in line for the processor, where it is not already.
    pub(crate) fn queue_for_processor(&mut self, slot: usize) {
        if !self.scheduler.waiting.contains(&slot) && self.scheduler.current != Some(slot) {
            self.scheduler.waiting.push_back(slot);
        }

        self.grant();
    }

    /// What wakes a task where it waits: put in line for the processor at
    /// once, so the tasks woken go in the order they were woken.
    pub fn signal_slot(&mut self, slot: usize) {
        let state = &mut self.scheduler.slots[slot];

        if state.wait == Wait::Waiting {
            state.wait = Wait::Woken;

            if let Some(timer) = state.wait_timer.take() {
                self.clock.cancel(timer);
            }

            self.queue_for_processor(slot);
        }
    }

    /// The running task's message queue, or another's.
    pub(crate) fn queue_of(&mut self, slot: usize) -> Option<&mut crate::queue::Queue> {
        if self.scheduler.current == Some(slot) {
            return self.task.as_mut().map(|task| &mut task.queue);
        }

        self.scheduler.slots[slot]
            .saved
            .as_mut()
            .and_then(|context| context.task.as_mut())
            .map(|task| &mut task.queue)
    }

    /// A task ended: it has the processor no more, its windows' messages go
    /// nowhere, and the next waiting is granted the processor.
    pub(crate) fn end_task(&mut self, slot: usize) {
        self.scheduler.slots[slot].ended = true;
        self.scheduler.waiting.retain(|&waiting| waiting != slot);

        if self.scheduler.current == Some(slot) {
            self.scheduler.current = None;
            self.task = None;
            self.grant();
        }
    }
}
