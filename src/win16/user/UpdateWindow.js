"use strict";

/**
 * The **UpdateWindow** function updates the client area of the given window by
 * sending a `WM_PAINT` message to the window if the update region for the
 * window is not empty. The function sends a `WM_PAINT` message directly to the
 * window procedure of the given window, bypassing the application queue. If the
 * update region is empty, no message is sent.
 *
 * **See also**:
 * {@link User.ExcludeUpdateRgn ExcludeUpdateRgn}
 * {@link User.GetUpdateRect GetUpdateRect}
 * {@link User.GetUpdateRgn GetUpdateRgn}
 * {@link User.InvalidateRect InvalidateRect}
 * {@link User.InvalidateRgn InvalidateRgn}
 *
 * @static
 * @function UpdateWindow
 * @memberof User
 *
 * @param {Types.HWND} hwnd - Identifies the window to be updated.
 */
export function UpdateWindow(hwnd) {
}
