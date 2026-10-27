'use strict';

import { ShowCaret } from './caret.js';
import { releaseEntry } from './dc-entries.js';

/**
 * The **EndPaint** function marks the end of painting in the given window. This
 * function is required for each call to the {@link User.BeginPaint BeginPaint}
 * function, but only after painting is complete.
 *
 * If the caret was hidden by the {@link User.BeginPaint BeginPaint} function,
 * the **EndPaint** function restores the caret to the screen.
 *
 * **See also**:
 * {@link User.BeginPaint BeginPaint}
 *
 * @static
 * @function EndPaint
 * @memberof User
 *
 * @param {Types.HWND} hwnd - Identifies the window that has been repainted.
 * @param {Types.PAINTSTRUCT} lpps - Points to a PAINTSTRUCT structure that
 *                                   contains the painting information retrieved
 *                                   by the {@link User.BeginPaint BeginPaint}
 *                                   function.
 */
export function EndPaint(hwnd, lpps) {
  // Get the window
  const dialog = this.handles.resolve(hwnd);

  if (!dialog) {
    return;
  }

  /* The paint's clip goes with it. */
  if (dialog.window) {
    (dialog.window as any).paintClip = undefined;
    (dialog.window as any).paintShape = undefined;
  }

  if (dialog.caretHidden) {
    dialog.caretHidden = false;
    ShowCaret.call(this, hwnd);
  }

  /* The paint's context given back, its region given -- the update
   * region -- let go even where it is a window's own (`USER.EXE` seg1
   * `76cc`-`76d4`, `8805` with 1). */
  releaseEntry(this, lpps.hdc, true);
}
