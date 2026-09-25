'use strict';

import { User } from '../user.js';

import { RasterWindow } from './raster-window.js';

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
export async function SetWindowText(hwnd, lpsz) {
  this.debug('SetWindowText', hwnd, lpsz);

  // Get window
  const dialog = this.handles.resolve(hwnd);

  if (!dialog) {
    return;
  }

  const options = dialog.options;
  options.caption = lpsz;
  dialog.options = options;

  /* On the raster desktop, as Windows does it: `WM_SETTEXT` to the window,
   * with the program's own pointer, which `DefWindowProc` or the control
   * takes the text from -- so a subclassed window sees it. */
  if (dialog instanceof RasterWindow) {
    const far =
      lpsz && lpsz.segment !== undefined ? ((lpsz.segment << 16) | lpsz.offset) >>> 0 : lpsz;
    const windowClass = this.handles.retrieve(dialog.options.windowClass);

    if (windowClass) {
      await this.scheduler.callWndProc(windowClass, hwnd, User.WM_SETTEXT, 0, far ?? 0);
    } else {
      dialog.caption = lpsz === null || lpsz === undefined ? '' : String(lpsz);
    }
  }
}
