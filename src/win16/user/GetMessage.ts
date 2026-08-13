"use strict";

import { User } from '../user.js';

import { TRUE, FALSE } from '../consts.js';

/**
 * The **GetMessage** function retrieves a message from the application's
 * message queue and places the message in a MSG structure. If no message is
 * available, **GetMessage** yields control to other applications until a
 * message becomes available.
 *
 * **GetMessage** retrieves messages associated only with the given window and
 * within the given range of message values. The function does not retrieve
 * messages for windows that belong to other applications.
 *
 *
 * The return value is usually used to decide whether to terminate the
 * application's main loop and exit the program.
 *
 * The `WM_KEYFIRST` and `WM_KEYLAST` constants can be used as filter values to
 * retrieve all messages related to keyboard input; the `WM_MOUSEFIRST` and
 * `WM_MOUSELAST` constants can be used to retrieve all mouse-related messages.
 * If the *uMsgFilterMin* and *uMsgFilterMax* parameters are both zero, the
 * **GetMessage** function returns all available messages (without performing
 * any filtering)
 *
 * In addition to yielding control to other applications when no messages are
 * available, the **GetMessage** and {@link User.PeekMessage PeekMessage}
 * functions also yield control when `WM_PAINT` or `WM_TIMER` messages for
 * other tasks are available.
 *
 * The **GetMessage**, {@link User.PeekMessage PeekMessage}, and
 * {@link User.WaitMessage WaitMessage} functions are the only ways to let
 * other applications run. If your application does not call any of these
 * functions for long periods of time, other applications cannot run.
 *
 * **See also**:
 * {@link User.PeekMessage PeekMessage}
 * {@link User.PostQuitMessage PostQuitMessage}
 * {@link User.SetMessageQueue SetMessageQueue}
 * {@link User.WaitMessage WaitMessage}
 *
 * @static
 * @function GetMessage
 * @memberof User
 *
 * @param {Types.FARPTR} lpmsg - Points to an MSG structure that contains
 *                               message information from the application's
 *                               message queue.
 * @param {Types.HWND} hwnd - Identifies the window whose messages are to be
 *                            retrieved. If this parameter is `NULL`,
 *                            **GetMessage** retrieves messages for any window
 *                            that belongs to the application making the call.
 * @param {Types.UINT} uMsgFilterMin - Specifies the integer value of the
 *                                     lowest message value to be retrieved.
 * @param {Types.UINT} uMsgFilterMax - Specifies the integer value of the
 *                                     highest message value to be retrieved.
 *
 * @return {Types.BOOL} The return value is nonzero if a message other than
 *                      `WM_QUIT` is retrieved. It is zero if the `WM_QUIT`
 *                      message is retrieved.
 */
export async function GetMessage(lpmsg, hwnd, uMsgFilterMin, uMsgFilterMax) {
    // Wait until we have a message, and pull it
    const msg = await this.scheduler.task.pull();

    // Copy message to memory
    lpmsg.hwnd = msg.hwnd;
    lpmsg.message = msg.message;
    lpmsg.wParam = msg.wParam;
    lpmsg.lParam = msg.lParam;
    lpmsg.time = msg.time;
    lpmsg.pt.x = msg.pt.x;
    lpmsg.pt.y = msg.pt.y;

    //console.log("returning", lpmsg);
    if (msg.message == User.WM_QUIT) {
        return FALSE;
    }

    return TRUE;
}
