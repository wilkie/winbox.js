'use strict';

import { postQuit } from './queue.js';

/**
 * Tells the program's message loop to end: the next `GetMessage` that finds
 * nothing else posted takes `WM_QUIT`, with this exit code, and returns
 * FALSE. See `postQuit` in `queue.ts` for where it comes.
 *
 * @param {number} nExitCode - What `WM_QUIT` carries as its `wParam`.
 */
export function PostQuitMessage(this: any, nExitCode: number) {
  postQuit(this, nExitCode);
}
