'use strict';

import { killTimer, setTimer } from './queue.js';

/**
 * The **SetTimer** function sets a timer: every `uTimeout` milliseconds, or
 * as near as Windows' clock ticks, `WM_TIMER` for the window, or a call of
 * `tmprc`. The message is made when the program asks for one and nothing
 * else is waiting; it is never queued, so a timer never has two due. See
 * `queue.ts`.
 *
 * @param {Types.HWND} hwnd - The window, or `NULL` for a timer of the program's own.
 * @param {Types.UINT} idTimer - The timer's identifier.
 * @param {Types.UINT} uTimeout - How often, in milliseconds.
 * @param {Types.FARPTR} tmprc - A procedure to call instead of posting, or `NULL`.
 *
 * @returns {Types.UINT} The timer's identifier.
 */
export function SetTimer(hwnd, idTimer, uTimeout, tmprc) {
  return setTimer(this, hwnd, idTimer, uTimeout, tmprc);
}

/**
 * The **KillTimer** function stops a timer {@link User.SetTimer SetTimer} set.
 *
 * @param {Types.HWND} hwnd - Its window.
 * @param {Types.UINT} idTimer - Its identifier.
 *
 * @returns {Types.BOOL} Whether there was such a timer.
 */
export function KillTimer(hwnd, idTimer) {
  return killTimer(this, hwnd, idTimer) ? 1 : 0;
}
