'use strict';

import { ShowCaret } from './caret.js';

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

  // Get the surface
  const surface = dialog.surface;

  /* The paint's clip goes with it. */
  if (dialog.window) {
    (dialog.window as any).paintClip = undefined;
    (dialog.window as any).paintShape = undefined;
  }

  if (dialog.caretHidden) {
    dialog.caretHidden = false;
    ShowCaret.call(this, hwnd);
  }

  // Deallocate the allocated DC
  const referredSurface = this.handles.resolve(lpps.hdc);
  if (surface === referredSurface) {
    this.handles.free(lpps.hdc);
    surface.liveDCs = Math.max(0, (surface.liveDCs ?? 1) - 1);
  }
}
