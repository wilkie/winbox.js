"use strict";

import { TRUE, FALSE, NULL } from '../consts.js';

import { BOOL } from '../types.js';

import { User, MSG } from '../user.js';

/**
 * The **DestroyWindow** function destroys the specified window. The function
 * sends appropriate messages to the window to deactivate it and remove the
 * input focus. It also destroys the window's menu, flushes the application
 * queue, destroys outstanding timers, removes clipboard ownership, and breaks
 * the clipboard-viewer chain (if the window is at the top of the viewer chain).
 * It sends `WM_DESTROY` and `WM_NCDESTROY` messages to the window. 
 *
 * If the given window is the parent of any windows, **DestroyWindow**
 * automatically destroys these child windows when it destroys the parent
 * window. The function destroys child windows first, and then the window
 * itself. 
 *
 * The **DestroyWindow** function also destroys modeless dialog boxes created by
 * the {@link User.CreateDialog CreateDialog} function. 
 *
 * Applications should always call the **DestroyWindow** function to destroy
 * their top-level windows before terminating. 
 *
 * If the window being destroyed is a child window and does not have the
 * `WS_NOPARENTNOTIFY` style set, a `WM_PARENTNOTIFY` message is sent to the
 * parent. 
 *
 * **See also**:
 * {@link User.CreateDialog CreateDialog}
 * {@link User.CreateWindow CreateWindow}
 * {@link User.CreateWindowEx CreateWindowEx}
 *
 * @static
 * @function DestroyWindow
 * @memberof User
 *
 * @param {Types.HWND} hwnd - Identifies the window to be destroyed.
 *
 * @return {Types.BOOL} The return value is nonzero if the function is
 *                      successful. Otherwise it is zero.
 */
export function DestroyWindow(hwnd) {
    // Get the window itself
    let dialog = this.handles.resolve(hwnd);

    // Get the window/class for the handle
    let windowClass = this.handles.retrieve(dialog.options.windowClass);

    // Destroy the window
    dialog.destroy();

    // TODO: Handle children

    // Send the WM_DESTROY message
    return [
        ['callWndProc', windowClass, hwnd, User.WM_DESTROY, 0, 0, () => {
        }]
    ];
}
