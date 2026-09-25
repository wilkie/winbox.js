'use strict';

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
 * @returns {Types.BOOL} Whether it was posted.
 */
export function PostMessage(hwnd, uMsg, wParam, lParam) {
  return postMessage(this, hwnd, uMsg, wParam, lParam) ? 1 : 0;
}
