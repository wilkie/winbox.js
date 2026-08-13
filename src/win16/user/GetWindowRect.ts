"use strict";

/**
 * The **GetWindowRect** function retrieves the dimensions of the bounding
 * rectangle of a given window. The dimensions are given in screen coordinates,
 * relative to the upper-left corner of the display screen, and include the
 * title bar, border, and scroll bars, if present.
 *
 * **See also**:
 * {@link User.GetClientRect GetClientRect}
 * {@link User.MoveWindow MoveWindow}
 * {@link User.SetWindowPos SetWindowPos}
 *
 * @static
 * @function GetWindowRect
 * @memberof User
 *
 * @param {Types.HWND} hwnd - Identifies the window.
 * @param {Types.RECT} lprc - Points to a RECT structure that receives the
 *                            screen coordinates of the upper-left and lower-
 *                            right corners of a window.
 */
export function GetWindowRect(hwnd, lprc) {
    const dialog = this.handles.resolve(hwnd);

    lprc.left = dialog.x;
    lprc.top = dialog.y;
    lprc.right = dialog.x + dialog.width;
    lprc.bottom = dialog.y + dialog.height;
}
