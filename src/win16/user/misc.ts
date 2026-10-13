'use strict';

import { loadParameters } from './system-parameters.js';

/**
 * Small calls a program makes on its way up. **Recorded** by `misc`.
 */

/**
 * The time within which a second press makes a double click, in
 * milliseconds: `DoubleClickSpeed` in `WIN.INI`'s `[windows]`, 452 on the
 * installation the probes run on, as USER reads it as it starts
 * (`system-parameters.ts`), until it is set; set to nought, 500.
 */
export async function GetDoubleClickTime(this: any) {
  if (this._doubleClickTime === undefined) {
    await loadParameters(this);
  }

  return this._doubleClickTime ?? 500;
}

/** Sets the double-click time; nought is 500. */
export function SetDoubleClickTime(this: any, wCount: number) {
  this._doubleClickTime = wCount & 0xffff || 500;
}

/**
 * A message queue of a size for the task: USER makes a new one of that many
 * entries, what was posted to the old one lost (`USER.EXE` seg1 `56b0`,
 * `5326`; `Task.ringMake`). It answers non-nought, as Windows does when it
 * made one -- the new queue's handle there.
 */
export function SetMessageQueue(this: any, cMsg: number) {
  this.scheduler?.task?.ringMake?.(cMsg & 0xffff);

  return 1;
}
