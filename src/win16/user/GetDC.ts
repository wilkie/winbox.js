'use strict';

import { lockedSurface } from './lock-window-update.js';

import { NULL } from '../consts.js';

import { SYSTEM_FONT, stockFontHandle } from '../gdi/stock-fonts.js';
import { resetVisible } from '../gdi/visible-region.js';
import { lendsTo, takeEntry } from './dc-entries.js';

/**
 * The **GetDC** function retrieves the handle of a device context for the
 * client area of the given window. The device context can be used in
 * subsequent graphics device interface (GDI) functions to draw in the client
 * area.
 *
 * The **GetDC** function retrieves a common, class, or private device context
 * depending on the class style specified for the given window. For common
 * device contexts, **GetDC** assigns default attributes to the context each
 * time it is retrieved. For class and private contexts, **GetDC** leaves the
 * previously assigned attributes unchanged.
 *
 * Unless the device context belongs to a window class, the
 * {@link User.ReleaseDC ReleaseDC} function must be called to release the
 * context after drawing. Since only five common device contexts are available
 * at any given time, failure to release a device context can prevent other
 * applications from accessing a device context. If the *`hwnd`* parameter of
 * the **GetDC** function is `NULL`, the first parameter of **ReleaseDC** should
 * also be `NULL`.
 *
 * A device context with special characteristics is returned by the **GetDC**
 * function if `CS_CLASSDC`, `CS_OWNDC`, or `CS_PARENTDC` style was specified
 * in the `WNDCLASS` structure when the class was registered. For more
 * information about these characteristics, see the description of the
 * `WNDCLASS` structure.
 *
 * @static
 * @function GetDC
 * @memberof User
 *
 * @param {Types.HWND} hwnd - Identifies the window where the drawing will
 *                            occur. If this parameter is `NULL`, the function
 *                            returns a device context for the screen.
 *
 * @returns {Types.HDC} The return value is a handle of the device context for
 *                      the given window's client area, if the function is
 *                      successful. Otherwise, it is `NULL`.
 */
export function GetDC(hwnd) {
  /* The window `LockWindowUpdate` locked draws where it does not show: a
   * context of its own (`lock-window-update.ts`), not one of USER's
   * entries -- the design's fifth phase. */
  if (hwnd != NULL) {
    if (!lendsTo(this, hwnd)) {
      return NULL;
    }

    const locked = lockedSurface(this, hwnd);

    if (locked) {
      (this._windowDCs ??= new WeakMap()).set(locked, hwnd);
      resetVisible(locked);
      withFont(this, locked);

      return this.handles.allocate(locked);
    }
  }

  /* One of USER's entries (`dc-entries.ts`): `GetDCEx` of the window with
   * `DCX_USESTYLE`, and the high word's 2; of the desktop, with
   * `DCX_WINDOW | DCX_CACHE` (`USER.EXE` seg1 `8406`-`8428`). */
  const hdc =
    hwnd == NULL
      ? takeEntry(this, this.desktopWindow, 0, 0x00020003)
      : takeEntry(this, hwnd, 0, 0x00030000);

  if (hdc) {
    withFont(this, this.handles.resolve(hdc));
  }

  return hdc;
}

/**
 * A device context comes with the System font already in it, as every
 * display context starts: nothing has to select a font before asking about
 * text. USER's copy of a context's state has it; one made before the fonts
 * were loaded is given it here.
 */
export function withFont(system: any, surface: any) {
  if (surface && !surface.font) {
    const font = stockFontHandle(system, SYSTEM_FONT);

    if (font) {
      surface.font = system.handles.resolve(font);
    }
  }
}
