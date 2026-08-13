"use strict";

import { TRUE, FALSE, NULL } from '../consts.js';

import { BOOL } from '../types.js';

import { SetFocus } from './SetFocus.js';
import { RedrawWindow } from './RedrawWindow.js';

import { User, MSG, WINDOWPOS } from '../user.js';

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

    // Get the window/class for the handle
    const windowClass = this.handles.retrieve(dialog.options.windowClass);

    // What is the current state?
    const visible = dialog.visible;

    // Determine the ultimate return value.
    let ret = FALSE;
    if (visible) {
        ret = TRUE;
    }

    // The wParam is TRUE if the window is being shown, FALSE if being hidden
    // The lParam is 0 if WM_SHOWWINDOW is generated from ShowWindow
    console.log("WM_SHOWWINDOW");
    //await this.scheduler.callWndProc(windowClass, hwnd, User.WM_SHOWWINDOW, dialog.visible ? TRUE : FALSE, 0);

    // We send a WM_WINDOWPOSCHANGING
    const windowPos = new WINDOWPOS();
    windowPos.hwnd = hwnd;
    windowPos.hwndInsertAfter = NULL;
    windowPos.x = dialog.x;
    windowPos.y = dialog.y;
    windowPos.cx = dialog.width;
    windowPos.cy = dialog.height;
    windowPos.flags = User.SWP_SHOWWINDOW | User.SWP_NOSIZE | User.SWP_NOMOVE;

    // Query the window position
    console.log("WM_WINDOWPOSCHANGING");
    //await this.scheduler.callWndProc(windowClass, hwnd, User.WM_WINDOWPOSCHANGING, 0, [windowPos]);

    if (!(windowPos.flags & User.SWP_NOSIZE)) {
        dialog.width = windowPos.cx;
        dialog.height = windowPos.cy;
    }

    if (!(windowPos.flags & User.SWP_NOMOVE)) {
        dialog.x = windowPos.x;
        dialog.y = windowPos.y;
    }

    if (windowPos.flags & User.SWP_SHOWWINDOW) {
        switch (nCmdShow) {
            case User.SW_HIDE:
                dialog.hide();
                break;
            case User.SW_NORMAL:
                dialog.restore();
            // falls through
            case User.SW_SHOW:
                dialog.show();
                break;
            case User.SW_MAXIMIZE:
                dialog.maximize();
                break;
            case User.WM_MINIMIZE:
                dialog.minimize();
                break;
        }

        let timesShown = dialog.options.timesShown;

        if (dialog.visible) {
            timesShown++;
            dialog.options = Object.assign({}, dialog.options, {
                timesShown: timesShown
            });

            // Focus on the window
            await SetFocus.bind(this)(hwnd);

            // WM_SIZE
            console.log("WM_SIZE");
            const wmSizeLParam = (dialog.width & 0xffff) | ((dialog.height & 0xffff) << 16);
            await this.scheduler.callWndProc(windowClass, hwnd, User.WM_SIZE, 0, wmSizeLParam);

            // WM_MOVE
            console.log("WM_MOVE");
            const wmMoveLParam = (dialog.x & 0xffff) | ((dialog.y & 0xffff) << 16);
            await this.scheduler.callWndProc(windowClass, hwnd, User.WM_MOVE, 0, wmMoveLParam);

            // WM_PAINT
            /*
            console.log("WM_PAINT");
            let msg = new MSG();
            msg.hwnd = hwnd;
            msg.message = User.WM_PAINT;
            this.scheduler.task.push(msg);*/
            //await this.scheduler.callWndProc(windowClass, hwnd, User.WM_PAINT, wmMoveLParam);
        }
    }

    console.log("SHOWWINDOW DONE", ret);

    return ret;
}
