'use strict';

import { WM_SYSTIMER } from './caret.js';
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

/**
 * Ordinal 11, which Windows 3.1 names `Bear11`: `SetTimer` for a system
 * timer, which comes as `WM_SYSTIMER`, 118h -- USER's `SetTimer` body
 * entered with CX 1, the flag kept at 0Ah of the timer's entry (`USER.EXE`
 * seg1 `744c`, the body `744f`-`74ed`). A system timer is found by its
 * window, identifier and that flag (`759c`), so a window may have a timer
 * and a system timer of the same identifier. USER's own -- the caret's
 * blink, a scroll bar's repeat -- are system timers. **Recorded** by
 * `systimer`: the identifier answered, 1 for nought; the timer of the same
 * window and identifier left by `KillTimer`; a procedure given comes in
 * `lParam` and is called by `DispatchMessage` with 118h.
 *
 * @param {Types.HWND} hwnd - The window, or `NULL` for a timer of the program's own.
 * @param {Types.UINT} idTimer - The timer's identifier.
 * @param {Types.UINT} uTimeout - How often, in milliseconds.
 * @param {Types.FARPTR} tmprc - A procedure to call instead of posting, or `NULL`.
 *
 * @returns {Types.UINT} The timer's identifier.
 */
export function Bear11(hwnd, idTimer, uTimeout, tmprc) {
  return setTimer(this, hwnd, idTimer, uTimeout, tmprc, WM_SYSTIMER);
}

/**
 * Ordinal 182, `Bear182`: `KillTimer` for a system timer (`USER.EXE` seg1
 * `74f4`, the body `74f7`-`7517`). **Recorded** by `systimer`: 1, then
 * nought once it is gone.
 *
 * @param {Types.HWND} hwnd - Its window.
 * @param {Types.UINT} idTimer - Its identifier.
 *
 * @returns {Types.BOOL} Whether there was such a system timer.
 */
export function Bear182(hwnd, idTimer) {
  return killTimer(this, hwnd, idTimer, WM_SYSTIMER) ? 1 : 0;
}
