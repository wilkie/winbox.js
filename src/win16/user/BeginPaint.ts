'use strict';

import { takeEntry } from './dc-entries.js';
import { withFont } from './GetDC.js';
import { NULL } from '../consts.js';

import { RasterWindow } from './raster-window.js';
import { DCX_INTERSECTRGN } from './visible-region-rule.js';
import { ClipRegion } from '../../raster/clip-region.js';
import { hideCaretFor } from './caret.js';
import { eraseNotDone, sendErase, sendNcPaint } from './erase.js';
import { GetClipBox } from '../gdi/clipping.js';
import { callHook } from '../gdi/dc-hook-calls.js';

const CS_PARENTDC = 0x0080;

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

  /* `rcPaint` is the context's clip box, cut to the client area for a
   * class with `CS_PARENTDC` (`USER.EXE` seg1 `7687`, `78be`-`790e`):
   * what of the update shows. Where nothing does, the window is not sent
   * its erase, and is not due it after (`762a`, `768c`). */
  const box = { left: 0, top: 0, right: 0, bottom: 0 };
  /* GDI calls the context's hook first, as for any `GetClipBox` (`dc-hook-calls.ts`). */
  await callHook(this, dc);

  let shows = GetClipBox.call(this, dc, box) > 1;

  if (shows && dialog instanceof RasterWindow) {
    const style = this.handles.retrieve(dialog.options.windowClass)?.style ?? 0;

    if (style & CS_PARENTDC) {
      box.left = Math.max(box.left, 0);
      box.top = Math.max(box.top, 0);
      box.right = Math.min(box.right, dialog.innerWidth);
      box.bottom = Math.min(box.bottom, dialog.innerHeight);
      shows = box.left < box.right && box.top < box.bottom;
    }
  }

  /* On the raster desktop, the window is validated: it is being painted, and
   * its background is erased first if it is due to be, by whatever the window
   * procedure does with `WM_ERASEBKGND`. */
  let unerased = 0;

  if (dialog instanceof RasterWindow) {
    const window: any = dialog.window;

    /* A frame that changed is painted first, by `WM_NCPAINT` to the window:
     * `showsb` recorded it between `WM_PAINT` and `WM_ERASEBKGND`. */
    if (window.needsNcPaint) {
      window.needsNcPaint = false;
      await sendNcPaint(this, hwnd, dialog, window.paintClip);
    }

    const erase = window.needsErase;

    dialog.window.needsPaint = false;
    window.walked = undefined;

    if (erase && shows) {
      await sendErase(this, hwnd, dialog, dc);
    } else if (erase) {
      window.needsErase = false;
      window.unerased = false;
    }

    /* The windows in it whose frames are due and nothing else are sent
     * `WM_NCPAINT` now (`76a7`, `7b30`-`7b4e`; `invchild`). */
    for (const child of dialog.desktop.windows.filter((other) => other.parent === window)) {
      const shown: any = child;

      if (child.needsPaint || !shown.needsNcPaint || !child.hwnd) {
        continue;
      }

      const owner = this.handles.resolve(child.hwnd);

      shown.needsNcPaint = false;

      if (owner instanceof RasterWindow) {
        await sendNcPaint(this, child.hwnd, owner, undefined);
      }
    }

    unerased = eraseNotDone(dialog);
  }

  /* `fErase` is 4 while the window's last erase was not done. */
  lpps.hdc = dc;
  lpps.fErase = unerased;
  lpps.rcPaint.left = shows ? box.left : 0;
  lpps.rcPaint.top = shows ? box.top : 0;
  lpps.rcPaint.right = shows ? box.right : 0;
  lpps.rcPaint.bottom = shows ? box.bottom : 0;

  lpps.fRestore = 0;
  lpps.fIncUpdate = 0;
  lpps.rgbReserved0 = 0;
  lpps.rgbReserved1 = 0;
  lpps.rgbReserved2 = 0;
  lpps.rgbReserved3 = 0;

  // Return that DC
  return dc;
}
