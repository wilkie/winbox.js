'use strict';

/**
 * The **SetWindowText** function sets the given window's title to the specified
 * text.
 *
 * The function causes a `WM_SETTEXT` message to be sent to the given window or
 * control.
 *
 * If the window specified by the *`hwnd`* parameter is a control, the text
 * within the control is set. If the specified window is a list-box control
 * created with `WS_CAPTION` style, however, **SetWindowText** will set the
 * caption for the control, not for the list-box entries.
 *
 * **See also**:
 * {@link User.GetWindowText GetWindowText}
 *
 * @static
 * @function SetWindowText
 * @memberof User
 *
 * @param {Types.HWND} hwnd - Identifies the window or control whose text is to
 *                            be set.
 * @param {Types.LPCSTR} lpsz - Points to a null-terminated string to be used as
 *                              the new title or control text.
 */
export function SetWindowText(hwnd, lpsz) {
  this.debug('SetWindowText', hwnd, lpsz);

  // Get window
  const dialog = this.handles.resolve(hwnd);

  const options = dialog.options;
  options.caption = lpsz;
  dialog.options = options;
}
