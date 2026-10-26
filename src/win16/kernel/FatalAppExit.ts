'use strict';

import { SEB_CLOSE, SEB_DEFBUTTON, sysErrorBox } from '../user/sys-error-box.js';

/** KERNEL's text for a message of none (data `084c`). */
export const CLOSING = 'Closing current application.';

/**
 * The **FatalAppExit** function displays a message box and terminates the
 * application when the message box is closed. If the user is running the
 * debugging version of the operating system, the message box gives the user
 * the opportunity to terminate the application or to cancel the message box
 * and return to the caller.
 *
 * **See also**:
 * {@link Kernel.FatalExit FatalExit}
 * {@link Kernel.TerminateApp TerminateApp}
 *
 * @static
 * @function FatalAppExit
 * @memberof Kernel
 *
 * **Read out** of `KRNL386.EXE` (seg1 `5cdf`-`5d09`, `5c80`-`5cdc`,
 * `5e01`-`5e19`): USER's system error box, "Application Error" its caption
 * and the text given its text, with one button, Close, the second place's
 * and the default (`SEB_CLOSE | SEB_DEFBUTTON`, 8008h; the first place
 * Cancel only where the byte at 328h of KERNEL's data has bit 3, which the
 * retail build's never has); then, Cancel not chosen, the task ended
 * through DOS, `INT 21h` 4CFFh. No box where the task's database has bit 1
 * of its word 18h, or before USER has given KERNEL its box; WinBox's tasks
 * are never so. The box is the one a fault shows (`fault`).
 *
 * @param {Types.UINT} fuAction - Reserved: must be zero.
 * @param {Types.LPCSTR} lpszMessageText - Points to a null-terminated string
 *                                         that is displayed in the message box.
 *                                         The message is displayed on a single
 *                                         line. To accommodate low-resolution
 *                                         screens, the string should contain
 *                                         no more than 35 characters.
 */
export async function FatalAppExit(this: any, fuAction: number, lpszMessageText: any) {
  /* A null pointer's segment: KERNEL's own text (`KRNL386.EXE` seg1
   * `5ce3`-`5cee`, data `084c`). */
  const text =
    lpszMessageText === null || typeof lpszMessageText === 'number'
      ? CLOSING
      : String(lpszMessageText);

  await sysErrorBox(this, text, 'Application Error', [0, SEB_CLOSE | SEB_DEFBUTTON, 0]);
  this.exitTask(0xff);
  void fuAction;
}
