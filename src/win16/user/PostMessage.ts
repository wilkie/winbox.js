'use strict';

import { HWND_BROADCAST, postBroadcast } from './broadcast.js';
import { postMessage } from './queue.js';
import { ddeParametersRefused } from './dde-parameters.js';

/**
 * The **PostMessage** function puts a message in the queue of the program that
 * made a window, and returns without waiting for it to be handled.
 *
 * @param {Types.HWND} hwnd - The window.
 * @param {Types.UINT} uMsg - The message.
 * @param {Types.WPARAM} wParam - Its first parameter.
 * @param {Types.LPARAM} lParam - Its second.
 *
 * @returns {Types.BOOL} Whether it was posted.
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

  /* A DDE message whose parameters USER's validation refuses is not posted
   * (`dde-parameters.ts`). */
  if (ddeParametersRefused(this, uMsg, wParam, lParam)) {
    return 0;
  }

  return postMessage(this, hwnd, uMsg, wParam, lParam) ? 1 : 0;
}
