'use strict';

import { CreateWindow } from './CreateWindow.js';

/**
 * `CreateWindow` with an extended style in front, which `GetWindowLong`
 * answers; `CreateWindow` makes the window as it says: topmost, in front of
 * all (`hidwnd`, `dlgfront`), with a modal frame, and so on.
 */
export async function CreateWindowEx(
  this: any,
  dwExStyle: number,
  ...rest: Parameters<typeof CreateWindow>
) {
  return CreateWindow.call(this, ...rest, dwExStyle);
}
