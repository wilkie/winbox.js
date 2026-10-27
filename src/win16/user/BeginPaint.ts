'use strict';

import { takeEntry } from './dc-entries.js';
import { withFont } from './GetDC.js';
import { NULL } from '../consts.js';

import { RasterWindow } from './raster-window.js';
import { DCX_INTERSECTRGN } from './visible-region-rule.js';
import { ClipRegion } from '../../raster/clip-region.js';
import { hideCaretFor } from './caret.js';
import { eraseNotDone, sendErase, sendNcPaint } from './erase.js';

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

  /* One of USER's entries (`dc-entries.ts`): `GetDCEx` with
   * `DCX_USESTYLE` and `DCX_INTERSECTRGN` of the update region (`USER.EXE`
   * seg1 `7640`-`7671`; `visrgn`): its visible region USER's rule's within
   * what is to be painted, where that is known; the whole client area where
   * it is not. Its origin and brush origin the client area's corner
   * (`brushorg`), its attributes a common context's (`dcreset`). */
  let due: ClipRegion | undefined;

  if (dialog instanceof RasterWindow) {
    const shown: any = dialog.window;
    const box: ClipRegion | undefined = shown.paintClip
      ? ClipRegion.rect(
          shown.paintClip[0],
          shown.paintClip[1],
          shown.paintClip[2],
          shown.paintClip[3]
        )
      : undefined;
    const shape: ClipRegion | undefined = shown.paintShape;

    due = box && shape ? box.intersect(shape) : (box ?? shape);
  }

  const dc = takeEntry(this, hwnd, 0, 0x00030000 | (due ? DCX_INTERSECTRGN : 0), due);

  /* The System font, if nothing is selected, as `GetDC` gives a context:
   * Calendar draws text in its paint without selecting one. */
  withFont(this, this.handles.resolve(dc));

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
      await sendNcPaint(this, hwnd, dialog, (dialog.window as any).paintClip);
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
