'use strict';

import { HWND_BROADCAST, postBroadcast } from './broadcast.js';
import { ddeRefused, isWindowHandle } from './dde-checks.js';
import { postMessage } from './queue.js';

/**
 * The **PostMessage** function puts a message in the queue of the program that
 * made a window, and returns without waiting for it to be handled.
 *
 * @param {Types.HWND} hwnd - The window.
 * @param {Types.UINT} uMsg - The message.
 * @param {Types.WPARAM} wParam - Its first parameter.
 * @param {Types.LPARAM} lParam - Its second.
 *
 * @returns {Types.BOOL} Where in its task's ring it was put, or nought.
 */
export function PostMessage(hwnd, uMsg, wParam, lParam) {
  /* -1 is every window at the top with no owner, never checked as a window
   * (`USER.EXE` seg1 `a7b7`; `broadcast.ts`). */
  if ((hwnd & 0xffff) === HWND_BROADCAST) {
    return postBroadcast(
      this,
      (to, message, first, second) => postMessage(this, to, message, first, second),
      uMsg,
      wParam,
      lParam
    );
  }

  /* USER's checks first: the window, and a DDE message's parameters
   * (`USER.EXE` seg1 `af70`; `dde-checks.ts`). */
  if (!isWindowHandle(this, hwnd & 0xffff) || ddeRefused(this, uMsg, wParam, lParam)) {
    return 0;
  }

  /* The message's place in the ring, as USER answers it (`5480`;
   * `dderaw`). */
  return postMessage(this, hwnd, uMsg, wParam, lParam);
}
