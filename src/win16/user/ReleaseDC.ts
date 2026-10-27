'use strict';

import { entryOf, releaseEntry } from './dc-entries.js';
import { NULL, TRUE, FALSE } from '../consts.js';

/**
 * The **ReleaseDC** function releases the given device context freeing it for
 * use by other applications.
 *
 * The effect of **ReleaseDC** depends on the type of device context. It frees
 * only common and window device contexts. It has no effect on class or private
 * device contexts.
 *
 * The application must call the **ReleaseDC** function for each call to the
 * {@link User.GetWindowDC GetWindowDC} function and for each call to the
 * {@link User.GetDC GetDC} function that retrieves a common device context.
 *
 * @static
 * @function ReleaseDC
 * @memberof User
 *
 * @param {Types.HWND} hwnd - Identifies the window whose device context is to
 *                            be released.
 * @param {Types.HDC} hdc - Identifies the device context to be released.
 *
 * @returns {Types.INT} The return value is 1 if the function is successful.
 *                      Otherwise, it is 0.
 */
export function ReleaseDC(hwnd, hdc) {
  /* The window's handle is checked, and the context's (`USER.EXE` seg1
   * `a61f`-`a641`), then the entry is found by its context alone: the
   * window is not asked (`8805`). */
  if (hwnd != NULL && !this.handles.resolve(hwnd)) {
    return FALSE;
  }

  /* The locked window's own context (`GetDC`), no entry of USER's. */
  const released = this.handles.resolve(hdc);

  if (released && this._windowDCs?.get(released) !== undefined && !entryOf(this, hdc)) {
    if (this._windowDCs.get(released) !== hwnd) {
      return FALSE;
    }

    this._windowDCs.delete(released);
    this.handles.free(hdc);

    return TRUE;
  }

  /* Given back to USER's entries (`dc-entries.ts`): a common one's state
   * set back from USER's copy, its visible region and origin staying, and
   * the handle still answering -- a released `GetDC(NULL)` gives the
   * nearest colours and the device's capabilities as it did, and the next
   * `GetDC(NULL)` answers it again (`reldc`). Reversi asks
   * `GetNearestColor` of one it has released, and made its board's
   * brushes of the -1 winbox.js answered. Nought for one not lent
   * (`dcentry`, `dcreuse`). */
  return releaseEntry(this, hdc, false) ? TRUE : FALSE;
}
