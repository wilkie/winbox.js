'use strict';

import { TRUE, FALSE, NULL } from '../consts.js';

import { BOOL, LRESULT } from '../types.js';

import { User, MSG } from '../user.js';

/**
 * The **SendMessage** function
 *
 * **See also**:
 * {@link User.PostMessage PostMessage}
 *
 * @static
 * @function SendMessage
 * @memberof User
 *
 * @param {Types.HWND} hwnd - Identifies the window to which the message will be
 *                            sent. If this parameter is `HWND_BROADCAST`, the
 *                            message will be sent to all top-level windows,
 *                            including disabled or invisible unowned windows.
 * @param {Types.UINT} uMsg - Specifies the message to be sent.
 * @param {Types.WPARAM} wParam - Specifies 16 bits of additional message-
 *                                dependent information.
 * @param {Types.LPARAM} lParam - Specifies 32 bits of additional message-
 *                                dependent information.
 *
 * @return {Types.BOOL} The return value specifies the result of the message
 *                      processing and depends on the message sent.
 */
export async function SendMessage(hwnd, uMsg, wParam, lParam) {
  // Get the window itself
  const dialog = this.handles.resolve(hwnd);
  console.log(dialog, dialog.options);

  // Get the window/class for the handle
  const windowClass = this.handles.retrieve(dialog.options.windowClass);

  // Send the message
  // TODO: handle result?
  console.log('sendmessage to:', windowClass);
  const result = await this.scheduler.callWndProc(windowClass, hwnd, uMsg, wParam, lParam);

  console.log('sendmessage done', result.toString(16));
  return result;
}
