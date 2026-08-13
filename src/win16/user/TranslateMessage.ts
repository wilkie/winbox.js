'use strict';

import { TRUE, FALSE } from '../consts.js';

import { User } from '../user.js';

/**
 * The **TranslateMessage** function translates virtual-key messages into
 * character messages, as follows:
 * * `WM_KEYDOWN`/`WM_KEYUP` combinations produce a `WM_CHAR` or `WM_DEADCHAR`
 * message.
 * * `WM_SYSKEYDOWN`/`WM_SYSKEYUP` combinations produce a `WM_CHAR` or
 * `WM_DEADCHAR` message.
 *
 * The character messages are posted to the application's message queue, to be
 * read the next time the application calls {@link User.GetMessage GetMessage}
 * or {@link User.PeekMessage PeekMessage} function.
 *
 * The **TranslateMessage** function does not modify the message pointed to by
 * the *lpmsg* parameter.
 *
 * **TranslateMessage** produces `WM_CHAR` messages only for keys that are
 * mapped to ASCII characters by the keyboard driver.
 *
 * An application should not call **TranslateMessage** if the application
 * processes virtual-key messages for some other purpose. For instance, an
 * application should not call **TranslateMessage** if the
 * {@link User.TranslateAccelerator TranslateAccelerator} function returns
 * nonzero.
 *
 * **See also**:
 * {@link User.PeekMessage PeekMessage}
 * {@link User.GetMessage GetMessage}
 * {@link User.TranslateAccelerator TranslateAccelerator}
 *
 * @static
 * @function TranslateMessage
 * @memberof User
 *
 * @param {Types.MSG} lpmsg - An MSG structure retrieved by a call to the
 *                            {@link User.GetMessage GetMessage} or
 *                            {@link User.PeekMessage PeekMessage} function.
 *                            The structure contains message information from
 *                            the application's message queue.
 *
 * @return {Types.BOOL} The return value is nonzero if the message is
 *                      `WM_KEYDOWN`, `WM_KEYUP`, `WM_SYSKEYDOWN` or
 *                      `WM_SYSKEYUP` regardless of whether the key that was
 *                      pressed or released generates a `WM_CHAR` message.
 *                      Otherwise, the return value is zero.
 */
export function TranslateMessage(lpmsg) {
  if (
    lpmsg.message === User.WM_KEYDOWN ||
    lpmsg.message === User.WM_KEYUP ||
    lpmsg.message === User.WM_SYSKEYUP ||
    lpmsg.message === User.WM_SYSKEYUP
  ) {
    // TODO: Potentially translate the key
    // We potentially push a new message
    //this.task.push(msg)

    return TRUE;
  }

  // If that is not a key event message, return FALSE.
  return FALSE;
}
