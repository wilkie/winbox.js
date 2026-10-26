'use strict';

import { segmentSelector } from '../selectors.js';

/**
 * KERNEL's list of tasks, as its task databases chain them from the head
 * (`HeadTDB`, the word at 226h of its data, which `GetCurrentTask` answers
 * in DX: `KRNL386.EXE` seg1 `842c`-`843c`): by priority, the lowest first.
 * A task is put before the first of a priority as high as its own or
 * higher (`843d`-`848b`), so a task made goes before those of its priority
 * already there; and a task switched to is taken out and put back as
 * though its priority were one more (seg1 `811e`-`812b`), after the others
 * of its priority. **Recorded** by `thtask`: with a program started from
 * the probe waiting in its message loop, the program comes before the
 * probe. The order is kept here as task handles, beside winbox.js's own
 * tasks, with what each task's database holds that winbox.js does not keep
 * elsewhere: the task that made it (TDB 22h), its priority (TDB 8), its
 * events (TDB 6), its queue (TDB 20h).
 */
export interface TaskRecord {
  /** The task that was running as it was made (TDB 22h); nought for the first. */
  parent: number;
  /** Its priority (TDB 8): -32 to 15, nought to start with. */
  priority: number;
  /** Its events (TDB 6), which `PostEvent` adds to and `WaitEvent` takes. */
  events: number;
  /** Its queue (TDB 20h), once asked for; see `queueOf`. */
  queue: number;
  /** Its compatibility flags (TDB 4Eh), once read (`GetAppCompatFlags`). */
  compatibility: number | null;
  /** The procedure KERNEL signals for it (TDB 2Ah), once given
   * (`SetTaskSignalProc`). */
  signal?: number;
}

function records(system: any): Map<number, TaskRecord> {
  return (system._taskRecords ??= new Map<number, TaskRecord>());
}

function order(system: any): number[] {
  return (system._taskOrder ??= []);
}

/** A live task's record, made if it has none. */
export function taskRecord(system: any, handle: number): TaskRecord | null {
  const task = liveTask(system, handle);

  if (!task) {
    return null;
  }

  let record = records(system).get(handle);

  if (!record) {
    record = { parent: 0, priority: 0, events: 0, queue: 0, compatibility: null };
    records(system).set(handle, record);
  }

  return record;
}

/** The task a handle names, where it runs still. */
export function liveTask(system: any, handle: number) {
  const task = handle ? system.scheduler?.taskAt?.(handle & 0xffff) : null;

  return task && !task.ended ? task : null;
}

/** A handle put in the list by its priority (`KRNL386.EXE` seg1 `843d`). */
function insert(system: any, handle: number, priority: number) {
  const list = order(system);
  const at = list.indexOf(handle);

  if (at >= 0) {
    list.splice(at, 1);
  }

  place(system, handle, priority);
}

function place(system: any, handle: number, priority: number) {
  const list = order(system);
  const at = list.findIndex(
    (each) => liveTask(system, each) && (taskRecord(system, each)?.priority ?? 0) >= priority
  );

  if (at < 0) {
    list.push(handle);
  } else {
    list.splice(at, 0, handle);
  }
}

/** A task made: put in the list, with the task running then as its parent. */
export function taskMade(system: any, handle: number, parent: number) {
  const record = taskRecord(system, handle);

  if (!record) {
    return;
  }

  record.parent = parent & 0xffff;
  insert(system, handle, record.priority);
}

/** The live tasks, in the list's order, the head first. */
export function taskList(system: any): number[] {
  const list = order(system);
  const live = list.filter((handle) => liveTask(system, handle));

  if (live.length !== list.length) {
    list.splice(0, list.length, ...live);
  }

  return live;
}

/** A task switched to: after the others of its priority (seg1 `811e`-`812b`). */
export function taskRan(system: any, handle: number) {
  const record = taskRecord(system, handle);

  if (record) {
    insert(system, handle, record.priority + 1);
  }
}

/**
 * A task's priority changed by `delta`, held to -32 to 15, and the task
 * put in the list again: after the others of its new priority, or where
 * its priority is as it was, before them -- unless it is the running task
 * (`SetPriority`, `KRNL386.EXE` seg1 `7df0`-`7e3b`). Its new priority.
 */
export function changePriority(system: any, handle: number, delta: number) {
  const record = taskRecord(system, handle)!;
  const priority = Math.min(15, Math.max(-32, ((record.priority + delta) << 24) >> 24));

  const same = priority === record.priority;

  if (same && handle === system.scheduler.active) {
    return priority;
  }

  record.priority = priority;
  insert(system, handle, same ? priority : priority + 1);

  return priority;
}

/**
 * A task's queue (TDB 20h), as `GetTaskQueue` and TOOLHELP answer it.
 * Windows' is a block of USER's, made as the task calls `InitApp`;
 * winbox.js keeps a task's messages itself, and gives it a block of
 * nothing, its selector, the first time one is asked for, or keeps the one
 * `SetTaskQueue` gave -- a selector, as `GetTaskQueueDS` loads it.
 */
export function queueOf(system: any, handle: number) {
  const record = taskRecord(system, handle);

  if (!record) {
    return 0;
  }

  if (!record.queue) {
    const index = system.allocator.allocate(0);

    record.queue = index ? segmentSelector(index) : 0;
  }

  return record.queue;
}

/** A task's instance: its data segment's handle, one below its selector (`instds`). */
export function taskInstance(task: any) {
  const loader = task.loader;

  return (segmentSelector(loader.translate(loader.ds)) - 1) & 0xffff;
}
