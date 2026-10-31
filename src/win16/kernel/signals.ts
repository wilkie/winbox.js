'use strict';

import { segmentSelector } from '../selectors.js';
import { UINT } from '../types.js';
import { GetFocus } from '../user/GetFocus.js';
import { GetWindowTask, IsWindow } from '../user/window-queries.js';
import { taskRecord } from './task-order.js';

/**
 * A task's signal handler and its action, as KERNEL keeps them in the
 * task's database (TDB 24h and 26h), set with `SetSigHandler` and called
 * by `DoSignal` on Ctrl+Break. **Read out** of `KRNL386.EXE` and
 * **recorded** by `kgaps`. As the Rust engine's `kernel_calls/signals.rs`.
 */

/** The only signal `SetSigHandler` takes (seg3 `0695`-`0699`): Ctrl+Break. */
const SIGNAL_BREAK = 1;

/** The action whose handler `DoSignal` calls (seg1 `615a`). */
const ACTION_CALL = 2;

/** The action that sets nothing of the task's: KERNEL's own two words, 26h and 28h of its data (seg3 `069b`-`069f`). */
const ACTION_KERNEL = 4;

/**
 * KERNEL's own handler, a bare `RETF` (seg1 `6125`), which action nought
 * sets and every task starts with: `kgaps` was told it as the first old
 * handler, a procedure of KERNEL's. WinBox's is KERNEL's
 * `ValidateFreeSpaces`, a bare return in Windows as here (`kintrnl`).
 */
const DEFAULT_HANDLER_ORDINAL = 200;

function defaultHandler(system: any) {
  const info = system.modules
    .load(system.modules.fromName('KERNEL'))
    .lookup(DEFAULT_HANDLER_ORDINAL);

  return ((segmentSelector(info.segment) << 16) | info.offset) >>> 0;
}

/** A task's action and handler: nought and KERNEL's own until set. */
function taskSignal(system: any, handle: number) {
  const record: any = taskRecord(system, handle);

  if (record && record.sigHandler === undefined) {
    record.sigAction = 0;
    record.sigHandler = defaultHandler(system);
  }

  return record;
}

/**
 * The running task's Ctrl+Break handler set (`KRNL386.EXE` seg3
 * `068c`-`06f0`). A signal other than 1 does nothing. Otherwise, for any
 * action but 4, the action is exchanged with the task's (TDB 24h) and the
 * old one written through its pointer, where there is one; the handler --
 * KERNEL's own for action nought -- is exchanged with the task's (TDB 26h),
 * and the old one written through its pointer. Action 4 exchanges the
 * handler with KERNEL's own two words instead, and writes neither old one.
 * AX is nought; DX, for signal 1, the old handler's selector.
 *
 * With no pointer for the old handler the routine leaves without its
 * `pop ds` (`06e0`-`06ea`): DI is KERNEL's data selector, SI the caller's
 * DI and DS the caller's SI. **Recorded** by `kgaps`.
 */
export function SetSigHandler(
  this: any,
  lpfnHandler: number,
  lplpfnOld: number,
  lpwOldAction: number,
  wAction: number,
  wSignal: number
) {
  const core = this.machine.cpu.core;

  core.ax = 0;

  if (wSignal !== SIGNAL_BREAK) {
    return;
  }

  const handler = wAction === 0 ? defaultHandler(this) : lpfnHandler >>> 0;

  if (wAction === ACTION_KERNEL) {
    const old = (this._kernelSigHandler ?? 0) >>> 0;

    this._kernelSigHandler = handler;
    core.dx = old >>> 16;
    return;
  }

  const record = taskSignal(this, this.scheduler.active ?? 0);
  const oldAction = record?.sigAction ?? 0;
  const oldHandler = (record?.sigHandler ?? 0) >>> 0;

  if (record) {
    record.sigAction = wAction & 0xffff;
    record.sigHandler = handler;
  }

  if (lpwOldAction) {
    core.write16(lpwOldAction >>> 16, lpwOldAction & 0xffff, oldAction);
  }

  core.dx = oldHandler >>> 16;

  if (lplpfnOld) {
    core.write32(lplpfnOld >>> 16, lplpfnOld & 0xffff, oldHandler);
    return;
  }

  const di = core.di & 0xffff;

  core.di = this._moduleData?.KERNEL ?? 0;
  core.ds = core.si & 0xffff;
  core.si = di;
}

/**
 * Ctrl+Break, as the keyboard driver signals it (`KRNL386.EXE` seg1
 * `612c`-`6173`): the window with the focus, through USER's `GetFocus`,
 * `IsWindow` and `GetWindowTask`; where its task's action is 2, its handler
 * called with nought and then 1 pushed, DS the task's database, AX 1 and BX
 * nought. Every register is kept. **Recorded** by `kgaps`: called with the
 * probe's window focused, not with none, nor for action 1. WinBox's task
 * handles are not selectors of a database, so DS is left the caller's
 * (`kgaps:dosignalds`, a known gap).
 */
export async function DoSignal(this: any) {
  const core = this.machine.cpu.core;
  const saved = { ax: core.ax, bx: core.bx, cx: core.cx, dx: core.dx, si: core.si, di: core.di };
  const focus = GetFocus.call(this);

  if (!focus || !IsWindow.call(this, focus)) {
    return;
  }

  const task = GetWindowTask.call(this, focus) & 0xffff;
  const record = taskSignal(this, task);

  if (!record || record.sigAction !== ACTION_CALL) {
    return;
  }

  await this.scheduler.callProc(
    record.sigHandler,
    [
      [0, UINT],
      [1, UINT],
    ],
    { ax: 1, bx: 0 }
  );

  Object.assign(core, saved);
}
