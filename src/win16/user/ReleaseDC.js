"use strict";

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
    let dc = 1;
    if (hwnd == NULL) {
        // The desktop context... do nothing
    }
    else {
        // Get the window
        let dialog = this.handles.resolve(hwnd);

        // Get the surface
        let surface = dialog.surface;

        // Resolve the DC
        let compare = this.handles.resolve(hdc);

        // If this surface does not belong to the window, fail
        if (compare !== surface) {
            return FALSE;
        }

        // Free the handle
        this.handles.free(hdc);
    }

    return TRUE;
}
