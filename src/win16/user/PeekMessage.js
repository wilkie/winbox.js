"use strict";

import { TRUE, FALSE } from '../consts.js';

import { User } from '../user.js';

/**
 * The **PeekMessage** function checks the application's message queue for a
 * message and places the message (if any) in the specified MSG structure.
 *
 * Unlike the {@link User.GetMessage GetMessage} function, the **PeekMessage**
 * function does not wait for a message to be placed in the queue before
 * returning. **PeekMessage** yields control to other tasks, unless the
 * `PM_NOYIELD` flag is set. However, if there is a `WM_TIMER` message pending,
 * **PeekMessage** will yield regardless of the `PM_NOYIELD` flag.
 *
 * **PeekMessage** retrieves only messages associated with the window identified
 * by the *`hwnd`* parameter, or any of its children as specified by the
 * {@link User.IsChild IsChild} function, and within the range of message values
 * given by the *`uFilterFirst`* and *`uFilterLast`* parameters. If *`hwnd`* is
 * `NULL`, **PeekMessage** retrieves messages for any window that belongs to the
 * application making the call. (**PeekMessage** does not retrieve messages for
 * windows that belong to other applications.) If *`uFilterFirst`* and
 * `*uFilterLast`* are both zero, **PeekMessage** returns all available messages
 * (no range filtering is performed).
 *
 * The `WM_KEYFIRST` and `WM_KEYLAST` flags can be used as filter values to
 * retrieve all key messages; the `WM_MOUSEFIRST` and `WM_MOUSELAST` flags
 * can be used to retrieve all mouse messages.
 *
 * **PeekMessage** does not remove `WM_PAINT` messages from the queue. The
 * messages remain in the queue until processed. The
 * {@link User.GetMessage GetMessage}, **PeekMessage**, and
 * {@link User.WaitMessage WaitMessage} functions yield control to other
 * applications. These calls provide the only way to let other applications run.
 * If your application does not call any of these functions for long periods of
 * time, other applications cannot run.
 *
 * As long as an application is in a **PeekMessage** loop, the system cannot
 * become idle. Therefore, an application should not remain in a **PeekMessage**
 * loop after the application's background processing has completed.
 *
 * When an application uses the **PeekMessage** function without removing the
 * message and then calls {@link User.WaitMessage WaitMessage} function,
 * **WaitMessage** does not return until the message is received. Applications
 * that use the **PeekMessage** function should remove any retrieved messages
 * from the queue before calling **WaitMessage**.
 *
 * **See also**:
 * {@link User.GetMessage GetMessage}
 * {@link User.IsChild IsChild}
 * {@link User.PostAppMessage PostAppMessage}
 * {@link User.SetMessageQueue SetMessageQueue}
 * {@link User.WaitMessage WaitMessage}
 *
 * @static
 * @function PeekMessage
 * @memberof User
 *
 * @param {Types.FARPTR} lpmsg - Points to an MSG structure that will receive
 *                               message information from the application's
 *                               message queue.
 * @param {Types.HWND} hwnd - Identifies the window whose messages are to be
 *                            examined.
 * @param {Types.UINT} uFilterFirst - Specifies the value of the first message
 *                                    in the range of messages to be examined.
 * @param {Types.UINT} uFilterLast - Specifies the value of the last message
 *                                   in the range of messages to be examined.
 * @param {Types.UINT} fuRemove - Specifies how the messages are handled. This
 *                                parameter can be a combination of the
 *                                following values (`PM_NOYIELD` can be combined
 *                                with either `PM_NOREMOVE` or `PM_REMOVE`):
 *
 * * `PM_NOREMOVE`: Messages are not removed from the queue after processing by
 *                  **PeekMessage**.
 * * `PM_NOYIELD`: Prevents the current task from halting and yielding system
 *                 resources to another task.
 * * `PM_REMOVE`: Messages are removed from the queue after processing by
 *                **PeekMessage**.
 *
 * @return {Types.BOOL} The return value is nonzero if a message is available.
 *                      Otherwise, it is zero.
 */
let i = 0;
export function PeekMessage(lpmsg, hwnd, uMsgFilterMin, uMsgFilterMax, fuRemove) {
    let msg = this.scheduler.task.peek();

    if (fuRemove & User.PM_REMOVE) {
        msg = this.scheduler.task.pull();
    }

    if (msg) {
        // Copy message to memory
        lpmsg.hwnd = msg.hwnd;
        lpmsg.message = msg.message;
        lpmsg.wParam = msg.wParam;
        lpmsg.lParam = msg.lParam;
        lpmsg.time = msg.time;
        lpmsg.pt.x = msg.pt.x;
        lpmsg.pt.y = msg.pt.y;

        if (!(fuRemove & User.PM_NOYIELD)) {
            return () => {
                return TRUE;
            };
        }

        return TRUE;
    }
    else {
        //i++;
        if (i == 20) {
            return () => { return TRUE; };
        }
        return FALSE;
    }
}
