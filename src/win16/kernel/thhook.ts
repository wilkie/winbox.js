'use strict';

import { ExportedData } from '../exported-data.js';
import { segmentSelector } from '../selectors.js';
import { GetModuleHandle } from './GetModuleHandle.js';
import { headTask } from './task-calls.js';
import { liveTask } from './task-order.js';

/**
 * KERNEL's variables that `THHOOK` points a reader at, and the global
 * heap's own block that `GlobalMasterHandle` answers: what a debugger or a
 * memory viewer made for Windows 3.1 reads, as TOOLHELP does (`TOOLHELP.DLL`
 * seg1 `022d`-`0266`). **Read out** of `KRNL386.EXE` and **recorded** by
 * `kgaps`. As the Rust engine's `kernel_calls/thhook.rs`.
 */

/** Where `THHOOK` points, in KERNEL's data (`KRNL386.EXE` seg4 `0218`). */
export const THHOOK_OFFSET = 0x218;

/** The words from there, each where KERNEL's own code uses it. */
const HEAP_HANDLE = 0x218; // GlobalMasterHandle's AX (seg1 `1196`)
const HEAP_SELECTOR = 0x21a; // its DX; the arenas' segment (seg1 `0ef6`)
const FIRST_MODULE = 0x21c; // the module chain, by word 6 (seg2 `0b88`)
const KERNEL_PDB = 0x220; // KERNEL's own prefix (seg1 `9d24`)
const FIRST_PDB = 0x222; // the newest prefix, each linked by its word 42h (seg2 `21fe`)
const FIRST_TASK = 0x226; // the task chain's head, GetCurrentTask's DX (seg1 `842c`)
const RUNNING_TASK = 0x228; // the running task, GetCurrentTask's AX (seg1 `842c`)
const TASK_MADE = 0x22a; // the task LoadModule is making, between calls nought (seg2 `1374`)

/**
 * The global heap's own block: the words of it KERNEL's code touches run to
 * 44h (seg1 `2bbe`-`2bcb` and `97fd`-`9802`, a count at 1Eh and a flag at
 * 44h). WinBox lays out no arenas in it.
 */
const MASTER_SIZE = 0x46;

/**
 * The global heap's own block, made the first time it is asked for: fixed,
 * its handle its selector, as `kgaps` found KERNEL's.
 */
export function masterBlock(system: any) {
  if (!system._masterBlock) {
    const index = system.allocator.allocate(MASTER_SIZE, { flags: 0 });

    system.allocator._objects[index].selectorHandle = true;
    system._masterBlock = segmentSelector(index);
  }

  return system._masterBlock;
}

/**
 * The handle and the selector of the global heap's own block
 * (`KRNL386.EXE` seg1 `1190`-`119e`): the words at 218h and 21Ah of
 * KERNEL's data, the same, odd, a fixed block's. **Recorded** by `kgaps`.
 */
export function GlobalMasterHandle(this: any) {
  const selector = masterBlock(this);

  return ((selector << 16) | selector) >>> 0;
}

/** The newest live task's prefix, the head of KERNEL's chain of them. */
function newestPdb(system: any) {
  const tasks = [...(system.scheduler?._taskMap?.values() ?? [])] as any[];
  const live = tasks.filter((task) => task && !task.ended);
  const newest = live[live.length - 1];

  return newest?.programSegment ? segmentSelector(newest.programSegment) : 0;
}

/**
 * KERNEL's words at 218h-22Bh written as they stand: the heap's block, its
 * own module first in the chain (`kgaps`: `GetModuleHandle("KERNEL")`), its
 * prefix -- none in WinBox, a task's prefix having no parent -- the newest
 * prefix, the head of the task chain and the running task, and nought for
 * a task being made. Written as the address is handed out and again as
 * each call returns, so that a program reads them as they are whenever it
 * runs: a task switches only inside a call.
 */
export function refreshThhook(system: any) {
  const data = system._moduleData?.KERNEL;

  if (!data) {
    return;
  }

  const core = system.machine.cpu.core;
  const master = masterBlock(system);
  const running = liveTask(system, system.scheduler?.active ?? 0)
    ? system.scheduler.active & 0xffff
    : 0;

  core.write16(data, HEAP_HANDLE, master);
  core.write16(data, HEAP_SELECTOR, master);
  core.write16(data, FIRST_MODULE, GetModuleHandle.call(system, 'KERNEL') & 0xffff);
  core.write16(data, KERNEL_PDB, 0);
  core.write16(data, FIRST_PDB, newestPdb(system));
  core.write16(data, FIRST_TASK, headTask(system) & 0xffff);
  core.write16(data, RUNNING_TASK, running);
  core.write16(data, TASK_MADE, 0);
}

/** `THHOOK`: KERNEL's data at 218h, kept up to date once handed out. */
export const THHOOK = new ExportedData({
  offset: THHOOK_OFFSET,
  prepare(system: any) {
    system._onResume ??= () => refreshThhook(system);
    refreshThhook(system);
  },
});
