'use strict';

import { releaseToCache } from './GetDC.js';
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
  let surface;

  if (hwnd == NULL) {
    surface = this.screen;
  } else {
    const dialog = this.handles.resolve(hwnd);

    if (!dialog) {
      return FALSE;
    }

    surface = dialog.surface;
  }

  const released = this.handles.resolve(hdc);

  /* Or one `GetWindowDC` made over the window's whole rectangle. */
  if (released !== surface && !(hwnd != NULL && this._windowDCs?.get(released) === hwnd)) {
    return FALSE;
  }

  /* The handle goes back to the cache it came from, and still answers: a
   * released `GetDC(NULL)` gives the nearest colours and the device's
   * capabilities as it did, and the next `GetDC(NULL)` answers it again
   * (`reldc`). Reversi asks `GetNearestColor` of one it has released, and
   * made its board's brushes of the -1 winbox.js answered. The cache keeps
   * five, as USER's does; the one released longest ago goes. */
  releaseToCache(this, hdc, released);
  released.liveDCs = Math.max(0, (released.liveDCs ?? 1) - 1);

  return TRUE;
}
