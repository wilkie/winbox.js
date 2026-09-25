'use strict';

import { CreateWindow } from './CreateWindow.js';

/**
 * `CreateWindow` with an extended style in front. The only extended styles
 * Windows 3.1 has -- a modal frame, no parent notification, topmost, drop
 * targets -- are not done here, and the window is made as `CreateWindow`
 * would make it.
 */
export async function CreateWindowEx(
  this: any,
  dwExStyle: number,
  ...rest: Parameters<typeof CreateWindow>
) {
  return await CreateWindow.apply(this, rest);
}
