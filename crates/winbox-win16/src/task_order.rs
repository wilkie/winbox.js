//! KERNEL's list of tasks, as its task databases chain them from the head
//! (`HeadTDB`, the word at 226h of its data, which `GetCurrentTask`
//! answers in DX: `KRNL386.EXE` seg1 `842c`-`843c`): by priority, the
//! lowest first. A task is put before the first of a priority as high as
//! its own or higher (`843d`-`848b`), so a task made goes before those of
//! its priority already there; and a task switched to is taken out and put
//! back as though its priority were one more (seg1 `811e`-`812b`), after
//! the others of its priority. **Recorded** by `thtask`: with a program
//! started from the probe waiting in its message loop, the program comes
//! before the probe. Kept as task handles, beside the scheduler's tasks,
//! with what each task's database holds that is kept nowhere else: the
//! task that made it (TDB 22h), its priority (TDB 8), its events (TDB 6),
//! its queue (TDB 20h). As `task-order.ts`.

use winbox_machine::segment_selector;

use crate::system::System;

/// What a task's database holds that the scheduler does not.
#[derive(Debug, Clone, Copy, Default)]
pub struct TaskRecord {
    /// The task that was running as it was made (TDB 22h); nought for the
    /// first.
    pub parent: u16,
    /// Its priority (TDB 8): -32 to 15, nought to start with.
    pub priority: i8,
    /// Its events (TDB 6), which `PostEvent` adds to.
    pub events: u16,
    /// Its queue (TDB 20h), once asked for; see `queue_of`.
    pub queue: u16,
    /// Its compatibility flags (TDB 4Eh), once read (`GetAppCompatFlags`).
    pub compatibility: Option<u32>,
}

/// The order and the records.
#[derive(Debug, Clone, Default)]
pub struct TaskOrder {
    pub order: Vec<u16>,
    pub records: std::collections::HashMap<u16, TaskRecord>,
    /// The task granted the processor last.
    pub last_granted: Option<u16>,
}

impl System {
    /// Whether a handle names a task that runs still.
    pub(crate) fn live_task(&self, handle: u16) -> bool {
        handle != 0 && self.slot_of(handle).is_some()
    }

    /// A live task's record, made if it has none.
    pub(crate) fn task_record(&mut self, handle: u16) -> Option<&mut TaskRecord> {
        if !self.live_task(handle) {
            return None;
        }

        Some(self.task_order.records.entry(handle).or_default())
    }

    fn priority_of(&self, handle: u16) -> i16 {
        self.task_order
            .records
            .get(&handle)
            .map_or(0, |record| i16::from(record.priority))
    }

    /// A handle put in the list by its priority (`KRNL386.EXE` seg1
    /// `843d`).
    fn insert_task(&mut self, handle: u16, priority: i16) {
        self.task_order.order.retain(|&each| each != handle);

        let at = self
            .task_order
            .order
            .iter()
            .position(|&each| self.live_task(each) && self.priority_of(each) >= priority);

        match at {
            Some(at) => self.task_order.order.insert(at, handle),
            None => self.task_order.order.push(handle),
        }
    }

    /// A task made: put in the list, with the task running then as its
    /// parent.
    pub(crate) fn task_made(&mut self, handle: u16, parent: u16) {
        let Some(record) = self.task_record(handle) else {
            return;
        };

        record.parent = parent;

        let priority = i16::from(record.priority);

        self.insert_task(handle, priority);
    }

    /// The live tasks, in the list's order, the head first.
    pub(crate) fn task_list(&mut self) -> Vec<u16> {
        let live: Vec<u16> = self
            .task_order
            .order
            .iter()
            .copied()
            .filter(|&each| self.live_task(each))
            .collect();

        self.task_order.order.clone_from(&live);
        live
    }

    /// A task granted the processor: after the others of its priority
    /// (seg1 `811e`-`812b`), where it is not the one granted last.
    pub(crate) fn task_ran(&mut self, handle: u16) {
        if self.task_order.last_granted != Some(handle) && self.live_task(handle) {
            let priority = self.priority_of(handle) + 1;

            self.task_record(handle);
            self.insert_task(handle, priority);
        }

        self.task_order.last_granted = Some(handle);
    }

    /// A task's priority changed by `delta`, held to -32 to 15, and the
    /// task put in the list again: after the others of its new priority,
    /// or where its priority is as it was, before them -- unless it is the
    /// running task (`SetPriority`, `KRNL386.EXE` seg1 `7df0`-`7e3b`). Its
    /// new priority.
    pub(crate) fn change_priority(&mut self, handle: u16, delta: i8) -> i8 {
        let running = Some(handle) == self.current_task();
        let Some(record) = self.task_record(handle) else {
            return 0;
        };
        let priority = record.priority.wrapping_add(delta).clamp(-32, 15);
        let same = priority == record.priority;

        if same && running {
            return priority;
        }

        record.priority = priority;
        self.insert_task(handle, i16::from(priority) + i16::from(!same));
        priority
    }

    /// The running task's handle, if any.
    pub(crate) fn current_task(&self) -> Option<u16> {
        self.scheduler
            .current
            .map(|slot| self.scheduler.slots[slot].handle)
    }

    /// A task's queue (TDB 20h), as `GetTaskQueue` and TOOLHELP answer it.
    /// Windows' is a block of USER's, made as the task calls `InitApp`;
    /// winbox.js keeps a task's messages itself, and gives it a block of
    /// nothing, its selector, the first time one is asked for, or keeps
    /// the one `SetTaskQueue` gave -- a selector, as `GetTaskQueueDS`
    /// loads it.
    pub(crate) fn task_queue(&mut self, handle: u16) -> u16 {
        let Some(queue) = self.task_record(handle).map(|record| record.queue) else {
            return 0;
        };

        if queue != 0 {
            return queue;
        }

        let made = self
            .global
            .allocate(&mut self.cpu.bus, &mut self.descriptors, 0, 0)
            .map_or(0, segment_selector);

        if let Some(record) = self.task_record(handle) {
            record.queue = made;
        }

        made
    }

    /// A task's instance: its data segment's handle, one below its
    /// selector (`instds`).
    pub(crate) fn task_instance(&self, handle: u16) -> u16 {
        self.slot_of(handle)
            .and_then(|slot| self.modules[self.scheduler.slots[slot].program].data())
            .map_or(0, |data| segment_selector(data) - 1)
    }
}
