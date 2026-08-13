"use strict";

/**
 * The **GetClientRect** function retrieves the client coordinates of a window's
 * client area. The client coordinates specify the upper-left and lower-right
 * corners of the client area. Because client coordinates are relative to the
 * upper-left corner of a window's client area, the coordinates of the upper-
 * left corner are (0,0).
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
 * @param {Types.HWND} hwnd - Identifies the window whose client coordinates are
 *                            to be retrieved.
 * @param {Types.RECT} lprc - Points to a RECT structure that receives the
 *                            client coordinates. The **left** and **top**
 *                            members will be zero. The **right** and **bottom**
 *                            members will contain the width and height of the
 *                            window.
 */
export function GetClientRect(hwnd, lprc) {
    const dialog = this.handles.resolve(hwnd);

    lprc.left = 0;
    lprc.top = 0;
    lprc.right = dialog.innerWidth;
    lprc.bottom = dialog.innerHeight;
}
