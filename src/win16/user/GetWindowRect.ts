'use strict';

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

  /* Not a window: nothing written, as USER checks the window's class for its
   * signature first, in the code `GetClientRect` shares (`USER.EXE` seg1
   * `1837`). Catz asks this of window 0 as it starts. */
  if (!dialog) {
    return;
  }

  lprc.left = dialog.x;
  lprc.top = dialog.y;
  lprc.right = dialog.x + dialog.width;
  lprc.bottom = dialog.y + dialog.height;
}
