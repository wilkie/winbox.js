'use strict';

import { SYSTEM_FONT, stockFontHandle } from '../gdi/stock-fonts.js';
import { NULL } from '../consts.js';

import { User } from '../user.js';

import { RasterWindow } from './raster-window.js';
import { hideCaretFor } from './caret.js';
import { eraseNotDone, sendErase } from './erase.js';

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
  /* The System font, if nothing is selected, as `GetDC` gives a context:
   * Calendar draws text in its paint without selecting one. */
  if (!surface.font) {
    const font = stockFontHandle(this, SYSTEM_FONT);

    if (font) {
      surface.font = this.handles.resolve(font);
    }
  }

  /* A clip region or saved levels a program left do not outlive the device
   * context it had: Windows hands out a fresh one. Not recorded. */
  surface.clipRegion = null;
  surface.saved = [];

  const dc = this.handles.allocate(surface);

  /* The caret, if it is this window's, is hidden until `EndPaint`, so the
   * painting does not leave it half drawn. */
  dialog.caretHidden = hideCaretFor(this, hwnd);

  /* On the raster desktop, the window is validated: it is being painted, and
   * its background is erased first if it is due to be, by whatever the window
   * procedure does with `WM_ERASEBKGND`. */
  let unerased = 0;

  if (dialog instanceof RasterWindow) {
    /* A frame that changed is painted first, by `WM_NCPAINT` to the window:
     * `showsb` recorded it between `WM_PAINT` and `WM_ERASEBKGND`. */
    if ((dialog.window as any).needsNcPaint) {
      (dialog.window as any).needsNcPaint = false;
      await this.scheduler.callWndProc(windowClass, hwnd, User.WM_NCPAINT, 1, 0);
    }

    const erase = dialog.window.needsErase;

    dialog.window.needsPaint = false;

    if (erase) {
      await sendErase(this, hwnd, dialog, dc);
    }

    unerased = eraseNotDone(dialog);
  }

  /* `fErase` is 4 while the window's last erase was not done. */
  lpps.hdc = dc;
  lpps.fErase = unerased;
  lpps.rcPaint.left = 0;
  lpps.rcPaint.right = dialog.innerWidth;
  lpps.rcPaint.top = 0;
  lpps.rcPaint.bottom = dialog.innerHeight;

  /* Only what was to be painted again, when that is known. */
  const clip = (dialog as any).window?.paintClip;

  if (dialog instanceof RasterWindow && clip) {
    const window: any = dialog.window;
    const x = window.left + window.client.left;
    const y = window.top + window.client.top;

    lpps.rcPaint.left = Math.max(0, clip[0] - x);
    lpps.rcPaint.top = Math.max(0, clip[1] - y);
    lpps.rcPaint.right = Math.min(dialog.innerWidth, clip[2] - x);
    lpps.rcPaint.bottom = Math.min(dialog.innerHeight, clip[3] - y);
  }

  lpps.fRestore = 0;
  lpps.fIncUpdate = 0;
  lpps.rgbReserved0 = 0;
  lpps.rgbReserved1 = 0;
  lpps.rgbReserved2 = 0;
  lpps.rgbReserved3 = 0;

  // Return that DC
  return dc;
}
