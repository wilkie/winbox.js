'use strict';

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

  /* Not a window: nothing written, as USER checks the window's class for its
   * signature first (`USER.EXE` seg1 `1837`). PIF Editor asks this of its
   * focus's parent, which is none while its own window has the focus. */
  if (!dialog) {
    return;
  }

  lprc.left = 0;
  lprc.top = 0;
  lprc.right = dialog.innerWidth;
  lprc.bottom = dialog.innerHeight;
}
