'use strict';

import { paintMessage } from './paint-icon.js';
import { RasterWindow } from './raster-window.js';

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
export async function UpdateWindow(hwnd) {
  const dialog = this.handles.resolve(hwnd);

  /* Only the raster desktop keeps what is due to be painted. */
  if (!(dialog instanceof RasterWindow) || !dialog.window.needsPaint || !dialog.visible) {
    return;
  }

  const windowClass = this.handles.retrieve(dialog.options.windowClass);

  dialog.desktop.aboutToPaint(dialog.window);

  const { message, wParam } = paintMessage(this, hwnd);

  await this.scheduler.callWndProc(windowClass, hwnd, message, wParam, 0);
}
