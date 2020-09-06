"use strict";

import { NULL } from '../consts.js';

import { User } from '../user.js';

/**
 * The **DispatchMessage** function dispatches a message to a window. It is
 * typically used to dispatch a message retrieved by the
 * {@link User.GetMessage GetMessage} function.
 *
 * **See also**:
 * {@link User.GetMessage GetMessage}
 * {@link User.PeekMessage PeekMessage}
 * {@link User.PostMessage PostMessage}
 * {@link User.PostAppMessage PostAppMessage}
 * {@link User.TranslateMessage TranslateMessage}
 *
 * @static
 * @function DispatchMessage
 * @memberof User
 *
 * @param {Types.MSG} lpmsg - Points to an {@link User.MSG MSG} structure that
 *                            contains the message. The MSG structure must
 *                            contain valid message values. If the *`lpmsg`*
 *                            parameter points to a `WM_TIMER` message and the
 *                            *`lParam`* parameter of the `WM_TIMER` message is
 *                            not `NULL` then *`lParam`* points to a function
 *                            that is called instead of the window procedure.
 *
 * @return {Types.BOOL} The return value specifies the value returned by the
 *                      window procedure. Although its meaning depends on the
 *                      message being dispatched, generally the return value is
 *                      ignored.
 */
export function DispatchMessage(lpmsg) {
    // Get the window itself
    let dialog = this.handles.resolve(lpmsg.hwnd);

    // Get the window/class for the handle
    let windowClass = this.handles.retrieve(dialog.options.windowClass);

    return [
        ['callWndProc', windowClass, lpmsg.hwnd, lpmsg.message, lpmsg.wParam, lpmsg.lParam]
    ];
}
