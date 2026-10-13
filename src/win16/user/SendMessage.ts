'use strict';

import { HWND_BROADCAST, sendBroadcast } from './broadcast.js';
import { ddeParametersRefused } from './dde-parameters.js';

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
 *                            message is sent to every window at the top,
 *                            owned ones too (`broadcast.ts`).
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
  /* -1 is every window at the top, never checked as a window (`USER.EXE`
   * seg1 `a786`; `broadcast.ts`). */
  if ((hwnd & 0xffff) === HWND_BROADCAST) {
    return await sendBroadcast(
      this,
      (to, message, first, second) => SendMessage.call(this, to, message, first, second),
      uMsg,
      wParam,
      lParam
    );
  }

  // Get the window itself
  const dialog = this.handles.resolve(hwnd);

  // A handle that is no window's is refused, as USER's validation layer does.
  if (!dialog?.options) {
    return 0;
  }

  /* A DDE message whose parameters USER's validation refuses is not sent
   * (`dde-parameters.ts`). */
  if (ddeParametersRefused(this, uMsg, wParam, lParam)) {
    return 0;
  }

  /* Get the window/class for the handle: the desktop window has none, and
   * its own procedure (`desktop-handle.ts`). */
  const windowClass = dialog.options.windowClass
    ? this.handles.retrieve(dialog.options.windowClass)
    : null;

  return await this.scheduler.callWndProc(windowClass, hwnd, uMsg, wParam, lParam);
}
