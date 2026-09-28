'use strict';

import { User } from '../user.js';

import { callTimerProc, timerProcOf } from './queue.js';
import { WM_SYSTIMER } from './caret.js';

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
export async function DispatchMessage(lpmsg) {
  /* A timer set with a procedure calls it, not the window's procedure. */
  if (lpmsg.message === User.WM_TIMER && (lpmsg.lParam || hasFunctionProc(this, lpmsg))) {
    return await callTimerProc(this, lpmsg);
  }

  /* A system timer, such as the caret's blink, always has one. */
  if (lpmsg.message === WM_SYSTIMER) {
    return await callTimerProc(this, lpmsg);
  }

  // Get the window itself
  const dialog = this.handles.resolve(lpmsg.hwnd);

  /* The desktop, which has no class of a program's: what USER sends it --
   * a mouse move with no window under the cursor (`mousemv`) -- its own
   * procedure takes and does nothing visible with. */
  if (!dialog?.options?.windowClass) {
    return 0;
  }

  // Get the window/class for the handle
  const windowClass = this.handles.retrieve(dialog.options.windowClass);

  return await this.scheduler.callWndProc(
    windowClass,
    lpmsg.hwnd,
    lpmsg.message,
    lpmsg.wParam,
    lpmsg.lParam
  );
}

/** A timer whose procedure is one of winbox.js's own functions, which a message's `lParam` cannot carry. */
function hasFunctionProc(system: any, lpmsg: any) {
  return typeof timerProcOf(system, lpmsg.hwnd, lpmsg.wParam) === 'function';
}
