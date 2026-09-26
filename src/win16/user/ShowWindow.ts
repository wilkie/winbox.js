'use strict';

import { FALSE } from '../consts.js';

import { RasterWindow } from './raster-window.js';
import { showRaster } from './window-state.js';

import { User } from '../user.js';

/**
 * The **ShowWindow** function sets the given window's visibility state.
 *
 * The **ShowWindow** function must be called only once per application using
 * the *`nCmdShow`* parameter from the **WinMain** function. Subsequent calls to
 * **ShowWindow** must use one of the values listed in the parameter listing,
 * instead of the one specified by the *`nCmdShow`* parameter from **WinMain**.
 *
 * **See also**:
 * {@link User.IsWindowVisible IsWindowVisible}
 * {@link User.ShowOwnedPopups ShowOwnedPopups}
 *
 * @static
 * @function ShowWindow
 * @memberof User
 *
 * @param {Types.HWND} hwnd - Identifies the window.
 * @param {Types.INT} nCmdShow - Specifies how the window is to be shown. This
 *                               parameter can be one of the following values:
 * * `SW_HIDE`: Hides the window and passes activation to another window.
 * * `SW_MINIMIZE`: Minimizes the specified window and activates the top-level
 *                window in the system's list.
 * * `SW_RESTORE`: Activates and displays a window. If the window is minimized or
 *               maximized, the system restores it to its original size and
 *               position (same as `SW_SHOWNORMAL`)
 * * `SW_SHOW`: Activates a window and displays it in its current size and
 *              position.
 * * `SW_SHOWMAXIMIZED`: Activates a window and displays it as a maximized
 *                       window.
 * * `SW_SHOWMINIMIZED`: Activates a window and displays it as an icon.
 * * `SW_SHOWMINNOACTIVE`: Displays a window as an icon. The window that is
 *                         currently active remains active.
 * * `SW_SHOWNA`: Displays a window in its current state. The window that is
 *                currently active remains active.
 * * `SW_SHOWNOACTIVATE`: Displays a window in its most recent size and
 *                        position. The window that is currently active remains
 *                        active.
 * * `SW_SHOWNORMAL`: Activates and displays a window. If the window is
 *                    minimized or maximized, the system restores it to its
 *                    original size and position (same as `SW_RESTORE`)
 *
 * @return {Types.BOOL} The return value is nonzero if the window was previously
 *                      visible. It is zero if the window was previously hidden.
 */
export async function ShowWindow(hwnd, nCmdShow) {
  // Get the window itself
  const dialog = this.handles.resolve(hwnd);

  /* On the raster desktop, USER's own. See `window-state.ts`. */
  if (dialog instanceof RasterWindow) {
    return showRaster(this, hwnd, dialog, nCmdShow);
  }

  /* Not a window of the desktop's. */
  return FALSE;
}

/** The **OpenIcon** function restores a minimized window, and activates it. */
export async function OpenIcon(hwnd) {
  return ShowWindow.call(this, hwnd, User.SW_SHOWNORMAL);
}

/** The **CloseWindow** function minimizes a window; despite its name, it is not destroyed. */
export async function CloseWindow(hwnd) {
  await ShowWindow.call(this, hwnd, User.SW_MINIMIZE);
}
