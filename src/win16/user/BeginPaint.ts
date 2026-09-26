'use strict';

import { NULL } from '../consts.js';

import { User } from '../user.js';

import { RasterWindow } from './raster-window.js';
import { hideCaretFor } from './caret.js';

/**
 * The **BeginPaint** function prepares the specified window for painting and
 * fills a **PAINTSTRUCT** structure with information about the painting.
 *
 * The **BeginPaint** function automatically sets the clipping region of the
 * device context to exclude any area outside the update region. The update
 * region is set by the {@link User.InvalidateRect InvalidateRect} or
 * {@link User.InvalidateRgn InvalidateRgn} function and by the system after
 * sizing, moving, creating, scrolling, or any other operation that affects the
 * client area. If the update region is marked for erasing, **BeginPaint** sends
 * a `WM_ERASEBKGND` message to the window.
 *
 * An application should not call **BeginPaint** except in response to
 * `WM_PAINT` message. Each call to the **BeginPaint** function must have a
 * corresponding call to the {@link User.EndPaint EndPaint} function.
 *
 * If the caret is in the area to be painted, **BeginPaint** automatically hides
 * the caret to prevent it from being erased.
 *
 * If the window's class has a background brush, **BeginPaint** will use that
 * brush to erase the background of the update region before returning.
 *
 * **See also**:
 * {@link User.EndPaint EndPaint}
 * {@link User.InvalidateRect InvalidateRect}
 * {@link User.InvalidateRgn InvalidateRgn}
 * {@link User.ValidateRect ValidateRect}
 * {@link User.ValidateRgn ValidateRgn}
 *
 * @static
 * @function BeginPaint
 * @memberof User
 *
 * @param {Types.HWND} hwnd - Identifies the window to be repainted.
 * @param {Types.PAINTSTRUCT} lpps - Points to the PAINTSTRUCT structure that
 *                                   will receive the painting information.
 *
 * @return {Types.HDC} The return value is the handle of the device context for
 *                     the given window if the function is successful.
 */
export async function BeginPaint(hwnd, lpps) {
  // Get the window
  const dialog = this.handles.resolve(hwnd);

  if (!dialog) {
    return NULL;
  }

  // Get the window/class for the handle
  const windowClass = this.handles.retrieve(dialog.options.windowClass);

  // Get the surface
  const surface = dialog.surface;

  // Allocate a DC
  const dc = this.handles.allocate(surface);

  /* The caret, if it is this window's, is hidden until `EndPaint`, so the
   * painting does not leave it half drawn. */
  dialog.caretHidden = hideCaretFor(this, hwnd);

  /* On the raster desktop, the window is validated: it is being painted, and
   * its background is erased first if it is due to be, by whatever the window
   * procedure does with `WM_ERASEBKGND`. */
  if (dialog instanceof RasterWindow) {
    const erase = dialog.window.needsErase;

    dialog.window.needsErase = false;
    dialog.window.needsPaint = false;

    if (erase) {
      await this.scheduler.callWndProc(windowClass, hwnd, User.WM_ERASEBKGND, dc, 0);
    }
  } else if (dialog.data.erase) {
    dialog.data.erase = false;

    await this.scheduler.callWndProc(windowClass, hwnd, User.WM_ERASEBKGND, 0, 0);
  }

  // Set PAINTSTRUCT properties
  lpps.hdc = dc;
  lpps.fErase = 0;
  lpps.rcPaint.left = 0;
  lpps.rcPaint.right = dialog.innerWidth;
  lpps.rcPaint.top = 0;
  lpps.rcPaint.bottom = dialog.innerHeight;
  lpps.fRestore = 0;
  lpps.fIncUpdate = 0;
  lpps.rgbReserved0 = 0;
  lpps.rgbReserved1 = 0;
  lpps.rgbReserved2 = 0;
  lpps.rgbReserved3 = 0;

  // Return that DC
  return dc;
}
