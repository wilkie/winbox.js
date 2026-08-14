'use strict';

import { TRUE } from '../consts.js';

/**
 * The **ExitWindows** function ends the Windows session.
 *
 * A program calls this when it is finished with Windows rather than merely
 * finished itself -- which for a program running as the shell amounts to the
 * same thing, since there is nothing left to run once it stops.
 *
 * The task is halted rather than merely returned from. Without that a shell
 * that reaches the end of its work simply starts over, and a program which
 * writes a file spends the rest of the session rewriting it.
 *
 * @static
 * @function ExitWindows
 * @memberof User
 *
 * @param {Types.DWORD} dwReserved - Reserved; must be zero.
 * @param {Types.UINT} wReturnCode - Reserved; must be zero.
 *
 * @return {Types.BOOL} Does not return if the session ends.
 */
export function ExitWindows(dwReserved, wReturnCode) {
  const task = this.scheduler.task;

  if (task) {
    task.end();
  }

  return TRUE;
}
