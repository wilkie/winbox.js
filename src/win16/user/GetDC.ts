'use strict';

import { NULL } from '../consts.js';

import { SYSTEM_FONT, stockFontHandle } from '../gdi/stock-fonts.js';

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
  let surface = null;

  if (hwnd == NULL) {
    /* The screen itself. This used to answer 1 -- a number that resolves to
     * nothing, so every GDI call made with it found no surface. Programs ask
     * the screen how big it is and how wide their text will be before they
     * have a window to ask, which is what both of the drawing probes do.
     */
    surface = this.screen;
  } else {
    const dialog = this.handles.resolve(hwnd);

    if (!dialog) {
      return NULL;
    }

    surface = dialog.surface;
  }

  if (!surface) {
    return NULL;
  }

  /* A device context comes with the system font already in it. Nothing has to
   * select a font before asking about text, and a program that never selects
   * one still draws in something -- so a context with no font is not a state
   * Windows ever hands out.
   *
   * Windows resets a common context's attributes on every `GetDC`, and this
   * does not: our context is the window's surface rather than a separate thing
   * borrowed from a pool of five, so what a program selects into it outlives
   * the release. That divergence is older and wider than this function.
   */
  if (!surface.font) {
    const font = stockFontHandle(this, SYSTEM_FONT);

    if (font) {
      surface.font = this.handles.resolve(font);
    }
  }

  return this.handles.allocate(surface);
}
