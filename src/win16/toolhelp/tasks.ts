'use strict';

import { segmentSelector } from '../selectors.js';
import { liveTask, queueOf, taskInstance, taskList, taskRecord } from '../kernel/task-order.js';
import { structure } from './structures.js';

/** `TASKENTRY`'s size. */
const TASKENTRY = 0x28;

/** The module's name as a task's database keeps it: eight bytes at most (TDB F2h). */
const NAME_LENGTH = 8;

/**
 * Where a task's stack is: the running task's in the processor, another's
 * as it gave the processor up. Windows keeps a task's SS and SP in its
 * database as it is switched away from (TDB 4 and 2, `KRNL386.EXE` seg1
 * `8156`-`815b`), so the running task's are where it last was; here they
 * are where it is.
 */
function stackOf(system: any, handle: number, task: any) {
  const core = system.machine.cpu.core;

  if (handle === system.scheduler.active) {
    return { ss: core.ss & 0xffff, sp: core.sp & 0xffff };
  }

  const registers = task.context?.registers ?? task.context;

  return {
    ss: (registers?.ss ?? taskInstance(task) + 1) & 0xffff,
    sp: (registers?.sp ?? 0) & 0xffff,
  };
}

/** A task's module's handle, as `GetModuleHandle` finds it. */
export function moduleOfTask(system: any, task: any) {
  const path = task.executable?.path;

  return (typeof path === 'string' ? system.modules.handleFromPath(path) : 0) ?? 0;
}

/** A task's module's name, as its executable's resident names begin. */
export function nameOfTask(task: any) {
  return String(task.loader?.name ?? task.executable?.name ?? '').toUpperCase();
}

/**
 * A `TASKENTRY` filled for a task, as `TOOLHELP.DLL` seg1 `0e69`-`0f19`
 * fills it from the task's database: the next task in KERNEL's list (TDB
 * 0), the task that made it (22h), its SS and SP (4, 2), its events (6),
 * its queue (20h), its prefix (60h), its instance and module (1Ch, 1Eh),
 * its module's name (F2h, eight bytes, then a nought), and the three words
 * at 0Ah, 0Ch and 0Eh of its stack's segment: the stack's top, the lowest
 * it has reached and its bottom. FALSE for a handle that is no task.
 */
function fill(system: any, far: number, handle: number) {
  const entry = structure(system, far, TASKENTRY);
  const task = liveTask(system, handle);

  if (!entry || !task) {
    return 0;
  }

  const record = taskRecord(system, handle)!;
  const list = taskList(system);
  const next = list[list.indexOf(handle) + 1] ?? 0;
  const { ss, sp } = stackOf(system, handle, task);
  const core = system.machine.cpu.core;

  entry.write16(0x26, next);
  entry.write16(0x04, handle);
  entry.write16(0x06, record.parent);
  entry.write16(0x0c, ss);
  entry.write16(0x0e, sp);
  entry.write16(0x16, record.events);
  entry.write16(0x18, queueOf(system, handle));
  entry.write16(0x24, segmentSelector(task.programSegment));
  entry.write16(0x08, taskInstance(task));
  entry.write16(0x0a, moduleOfTask(system, task));
  entry.writeString(0x1a, nameOfTask(task), NAME_LENGTH);

  if (core.peekDescriptor(ss)) {
    entry.write16(0x10, core.read16(ss, 0x0a));
    entry.write16(0x12, core.read16(ss, 0x0c));
    entry.write16(0x14, core.read16(ss, 0x0e));
  }

  return 1;
}

/** The first task in KERNEL's list, filled in (`TOOLHELP.DLL` seg1 `0caa`). */
export function TaskFirst(this: any, lpte: number) {
  return fill(this, lpte, taskList(this)[0] ?? 0);
}

/** The task after the one filled in, from its `hNext` (seg1 `0ced`); FALSE after the last. */
export function TaskNext(this: any, lpte: number) {
  const entry = structure(this, lpte, TASKENTRY);
  const next = entry?.read16(0x26) ?? 0;

  return next ? fill(this, lpte, next) : 0;
}

/** A task's entry, by its handle (seg1 `0d2e`): FALSE for one that is no task. */
export function TaskFindHandle(this: any, lpte: number, hTask: number) {
  return fill(this, lpte, hTask & 0xffff);
}

/**
 * Where a task will go on from when it next runs: nought for the running
 * task (`TOOLHELP.DLL` seg1 `0d97`-`0dbd`), else the CS and IP Windows
 * keeps in the frame its switch left on the task's stack. **Recorded** by
 * `thtask`: not nought for a program waiting in its message loop, nought
 * for the probe. Here, where the task gave the processor up.
 */
export function TaskGetCSIP(this: any, hTask: number) {
  const handle = hTask & 0xffff;
  const task = liveTask(this, handle);

  if (!task || handle === this.scheduler.active) {
    return 0;
  }

  const registers = task.context?.registers ?? task.context;

  return (((registers?.cs ?? 0) << 16) | (registers?.ip ?? 0)) >>> 0;
}
