'use strict';

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
  /* Which surface the context has to be over for this to be the right window
   * releasing it. `GetDC(NULL)` hands out the screen, so `ReleaseDC(NULL, ...)`
   * gives it back -- the documentation is explicit that the two calls have to
   * agree about the window, and it is a real mistake to catch.
   */
  let surface = null;

  if (hwnd == NULL) {
    surface = this.screen;
  } else {
    const dialog = this.handles.resolve(hwnd);

    if (!dialog) {
      return FALSE;
    }

    surface = dialog.surface;
  }

  if (this.handles.resolve(hdc) !== surface) {
    return FALSE;
  }

  /* Only the handle goes. The surface behind it is the window's own pixels --
   * or the screen's -- and outlives every context handed out over it.
   */
  this.handles.free(hdc);

  return TRUE;
}
