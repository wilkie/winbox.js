'use strict';

import { DWORD, UINT } from '../types.js';
import { PostMessage } from '../user/PostMessage.js';
import { isTask } from './checks.js';

/**
 * `DriverCallback`: how a driver tells a program a device opened, a buffer
 * is done, a device closed. The twin of `mmsystem/callback.rs`.
 *
 * **Read out** of `MMSYSTEM.DLL` (seg1 `3ab`). A driver calls it with the
 * callback and its kind as the program gave them at the open -- the kind the
 * high word of the open's flags, `CALLBACK_WINDOW` and the rest -- the
 * device's handle, the message, the program's own doubleword and two
 * parameters:
 *
 * * No callback, or no kind, answers nought, as does a handle MMSYSTEM is
 *   closing for a task that ended (none is, here).
 * * Unless `DCB_NOSWITCH` (8) is among the flags, MMSYSTEM moves to one of
 *   its interrupt stacks for the call and back (`StackEnter`,
 *   `StackLeave`); WinBox has no interrupt time to need one.
 * * A window (`DCB_WINDOW`, 1) is posted the message, the handle its wParam
 *   and the first parameter its lParam. A task (`DCB_TASK`, 2) is posted it
 *   the same way.
 * * A function (`DCB_FUNCTION`, 3), if the callback's selector is a code
 *   segment's, is called with the handle, the message, the program's
 *   doubleword and both parameters, and the answer is 1; else nought.
 * * Another kind answers nought.
 */

/** The handle MMSYSTEM keeps as the one it is closing for a task that ended. */
const CLOSING = 0xffff;

/** A callback to a window or a task, posted: what posting answered; nought for another kind. */
export function postCallback(
  system: any,
  callback: number,
  flags: number,
  device: number,
  message: number,
  first: number
) {
  const low = callback & 0xffff;

  if (!callback || device === CLOSING) {
    return 0;
  }

  switch (flags & 7) {
    case 1:
      return PostMessage.call(system, low, message, device, first >>> 0) ? 1 : 0;

    case 2:
      if (!low || !isTask(system, low)) {
        return 0;
      }

      return PostMessage.call(system, 0, message, device, first >>> 0) ? 1 : 0;

    default:
      return 0;
  }
}

/** A driver's callback made: what `DriverCallback` answers. */
export async function driverCallback(
  system: any,
  callback: number,
  flags: number,
  device: number,
  message: number,
  user: number,
  first: number,
  second: number
) {
  callback >>>= 0;
  flags &= 0xffff;
  device &= 0xffff;

  if (!callback || device === CLOSING) {
    return 0;
  }

  switch (flags & 7) {
    case 1:
    case 2:
      return postCallback(system, callback, flags, device, message & 0xffff, first);

    case 3: {
      const selector = (callback >>> 16) & 0xffff;
      const descriptor =
        selector & 0xfffc ? system.machine.cpu.core.peekDescriptor(selector) : null;

      if (!descriptor || !descriptor.type || !descriptor.executable) {
        return 0;
      }

      await system.scheduler.callProc(callback, [
        [device, UINT],
        [message & 0xffff, UINT],
        [user >>> 0, DWORD],
        [first >>> 0, DWORD],
        [second >>> 0, DWORD],
      ]);

      return 1;
    }

    default:
      return 0;
  }
}

/** `DriverCallback`, called by a driver. */
export async function DriverCallback(
  this: any,
  dwCallback: number,
  uFlags: number,
  hDevice: number,
  uMessage: number,
  dwUser: number,
  dwParam1: number,
  dwParam2: number
) {
  return driverCallback(this, dwCallback, uFlags, hDevice, uMessage, dwUser, dwParam1, dwParam2);
}
