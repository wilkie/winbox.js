'use strict';

import { GetProfileInt } from '../kernel/GetProfileInt.js';

/**
 * Small calls a program makes on its way up. **Recorded** by `misc`.
 */

/**
 * The time within which a second press makes a double click, in
 * milliseconds: `DoubleClickSpeed` in `WIN.INI`'s `[windows]`, 452 on the
 * installation the probes run on, until it is set; set to nought, 500.
 */
export async function GetDoubleClickTime(this: any) {
  this._doubleClickTime ??= await GetProfileInt.call(this, 'windows', 'DoubleClickSpeed', 500);

  return this._doubleClickTime;
}

/** Sets the double-click time; nought is 500. */
export function SetDoubleClickTime(this: any, wCount: number) {
  this._doubleClickTime = wCount & 0xffff || 500;
}

/**
 * A message queue of a size for the task. The queue here holds any number,
 * so there is nothing to make: it answers non-nought, as Windows does when it
 * made one -- the new queue's handle there.
 */
export function SetMessageQueue(this: any, _cMsg: number) {
  return 1;
}
