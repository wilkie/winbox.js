'use strict';

import { segmentSelector } from '../selectors.js';
import { GetExpWinVer } from './GetExpWinVer.js';
import { GetModuleHandle } from './GetModuleHandle.js';
import { readProfile, WINDOWS_PROFILE } from './profiles.js';
import {
  changePriority,
  liveTask,
  queueOf,
  taskInstance,
  taskList,
  taskRecord,
} from './task-order.js';

/** A task handle, nought for the running task (`KRNL386.EXE` seg1 `7d7c`-`7d91`). */
function taskOrCurrent(system: any, hTask: number) {
  return hTask & 0xffff || (system.scheduler.active ?? 0);
}

/**
 * The handle given, where it names a task -- a selector of more than FCh
 * bytes with `TD` at FAh -- and nought otherwise (`KRNL386.EXE` seg1
 * `7e50`-`7e74`). Not TRUE: the task. **Recorded** by `ktask`.
 */
export function IsTask(this: any, hTask: number) {
  return liveTask(this, hTask) ? hTask & 0xffff : 0;
}

/** A task's queue (TDB 20h, `KRNL386.EXE` seg1 `7d9d`); see `queueOf`. **Recorded** by `ktask`. */
export function GetTaskQueue(this: any, hTask: number) {
  return queueOf(this, taskOrCurrent(this, hTask));
}

/** A task given a queue, the one it had answered (seg1 `7de3`). **Recorded** by `ktask`. */
export function SetTaskQueue(this: any, hTask: number, hQueue: number) {
  const handle = taskOrCurrent(this, hTask);
  const old = queueOf(this, handle);
  const record = taskRecord(this, handle);

  if (record) {
    record.queue = hQueue & 0xffff;
  }

  return old;
}

/**
 * An event for a task: TDB 6 counted up (seg1 `7d92`-`7d9a`). It answers
 * the task's handle, which is left in AX. **Recorded** by `ktask`.
 */
export function PostEvent(this: any, hTask: number) {
  const handle = taskOrCurrent(this, hTask);
  const record = taskRecord(this, handle);

  if (record) {
    record.events++;

    /* A task waiting in `WaitEvent` for it woken. */
    for (const waiter of record.eventWaiters?.splice(0) ?? []) {
      const task = this.scheduler.taskAt?.(waiter);
      const wake = task?.onWake;

      if (wake) {
        task.onWake = null;
        wake();
      }
    }
  }

  return handle;
}

/**
 * A task's event taken (`KRNL386.EXE` seg1 `7ca8`-`7cfc`): TDB 6 counted
 * down, nought answered, where it has one; else the count left at nought
 * and the processor given up until `PostEvent` gives it one, then taken,
 * FFh answered (AL set as the reschedule returns, `7cee`). A task starts
 * with one, which a program's start-up takes (`taskMade`). Under Windows
 * USER waits for a message so, and posts its own task an event as one
 * comes (`USER.EXE` seg1 `3d31`-`3da3`); here USER waits in its own way,
 * and only `PostEvent` gives a task an event.
 */
export async function WaitEvent(this: any, hTask: number) {
  const handle = taskOrCurrent(this, hTask);
  let answer = 0;

  for (;;) {
    const record = taskRecord(this, handle);

    if (!record) {
      return 0;
    }

    if (record.events > 0) {
      record.events--;
      return answer;
    }

    record.events = 0;
    (record.eventWaiters ??= []).push(this.scheduler.active ?? 0);
    await this.scheduler.waitForWake();
    answer = 0xff;
  }
}

/**
 * A task's priority moved by `delta`, held to -32 to 15, and the task put
 * in KERNEL's list again for it (seg1 `7df0`-`7e3b`; `changePriority`):
 * the new priority. **Recorded** by `ktask`.
 */
export function SetPriority(this: any, hTask: number, delta: number) {
  const handle = taskOrCurrent(this, hTask);

  if (!liveTask(this, handle)) {
    return 0;
  }

  return changePriority(this, handle, ((delta & 0xff) << 24) >> 24) & 0xffff;
}

/**
 * The running task's prefix (TDB 60h) in AX, and in DX the word at 220h of
 * KERNEL's data (`KRNL386.EXE` seg3 `024e`-`025e`). **Recorded** by
 * `ktask`.
 */
export function GetCurrentPDB(this: any) {
  const task = liveTask(this, this.scheduler.active ?? 0);
  const pdb = task ? segmentSelector(task.programSegment) : 0;

  return pdb;
}

/** The running task's instance (TDB 1Ch), in AX and DX (seg1 `119f`-`11af`). **Recorded** by `ktask`. */
export function GetTaskDS(this: any) {
  const task = liveTask(this, this.scheduler.active ?? 0);
  const instance = task ? taskInstance(task) : 0;

  return ((instance << 16) | instance) >>> 0;
}

/**
 * The Windows version the running task's module was made for (TDB 1Ah,
 * `KRNL386.EXE` seg3 `07d9`-`07e5`), as `GetExpWinVer` answers for its
 * module. **Recorded** by `ktask`.
 */
export function GetExeVersion(this: any) {
  const task = liveTask(this, this.scheduler.active ?? 0);

  return task ? GetExpWinVer.call(this, taskInstance(task)) & 0xffff : 0;
}

/**
 * A task's compatibility flags (TDB 4Eh, `KRNL386.EXE` seg1 `9eeb`-`9f0e`):
 * nought for a task made for Windows 3.10 or later; for an older one, the
 * hexadecimal number after `0x` that `WIN.INI`'s `[Compatibility]` gives
 * its module's name (seg2 `2a38`-`2ab6`). Nought with no task. KERNEL
 * reads them as it makes the task; winbox.js reads them the first time
 * they are asked for, as `WIN.INI` is then. **Recorded** by `ktask`.
 */
export async function GetAppCompatFlags(this: any, hTask: number) {
  const handle = taskOrCurrent(this, hTask);
  const task = liveTask(this, handle);
  const record = taskRecord(this, handle);

  if (!task || !record) {
    return 0;
  }

  if (record.compatibility === null) {
    const version = GetExpWinVer.call(this, taskInstance(task)) & 0xffff;
    const profile = version < 0x30a ? await readProfile(this, WINDOWS_PROFILE) : null;

    record.compatibility = compatibilityFlags(
      version,
      String(task.loader?.name ?? ''),
      (key) => profile?.get('Compatibility', key) ?? ''
    );
  }

  return record.compatibility >>> 0;
}

/**
 * The compatibility flags `WIN.INI` gives a module, as KERNEL reads them
 * as it makes a task (`KRNL386.EXE` seg2 `2a38`-`2ab6`): for a module made
 * for a Windows before 3.10, `[Compatibility]`'s entry for its name, eight
 * characters at most, read as eleven characters at most; it must start
 * `0x` or `0X`, and then each character from `0` up is a hexadecimal
 * digit, as many as there are until one below `0`. Nought otherwise.
 */
export function compatibilityFlags(version: number, name: string, read: (key: string) => string) {
  if ((version & 0xffff) >= 0x30a) {
    return 0;
  }

  const text = read(String(name).slice(0, 8)).slice(0, 11);

  if (text.length < 2 || text[0] !== '0' || (text.charCodeAt(1) & 0xdf) !== 0x58) {
    return 0;
  }

  let flags = 0;

  for (let at = 2; at < text.length; at++) {
    let digit = text.charCodeAt(at) - 0x30;

    if (digit < 0) {
      break;
    }

    if (digit > 9) {
      digit = (digit + 0xf9) & 0xff;
    }

    flags = ((flags << 4) | (digit & 0xf)) >>> 0;
  }

  return flags >>> 0;
}

/**
 * DS made the running task's queue (`KRNL386.EXE` seg1 `7da7`-`7db4`), AX
 * and DX left as they were.
 */
export function GetTaskQueueDS(this: any) {
  this.machine.cpu.core.ds = queueOf(this, this.scheduler.active ?? 0);
}

/** ES made the running task's queue (seg1 `7db5`-`7dc4`). */
export function GetTaskQueueES(this: any) {
  this.machine.cpu.core.es = queueOf(this, this.scheduler.active ?? 0);
}

/** The handle of the first task in KERNEL's list, which `GetCurrentTask` answers in DX. */
export function headTask(system: any) {
  return taskList(system)[0] ?? 0;
}

/** A module handle's module, by its name, for `GetExePtr`. */
export function moduleHandleOf(system: any, name: string) {
  return GetModuleHandle.call(system, name) & 0xffff;
}
