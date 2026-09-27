'use strict';

import { CreateWindow } from './CreateWindow.js';
import { RasterWindow } from './raster-window.js';

/**
 * `CreateWindow` with an extended style in front, which `GetWindowLong`
 * answers. Of the extended styles Windows 3.1 has, only topmost is done: the
 * window is kept above every window that is not (`hidwnd`). A modal frame,
 * no parent notification and drop targets are not done here.
 */
export async function CreateWindowEx(
  this: any,
  dwExStyle: number,
  ...rest: Parameters<typeof CreateWindow>
) {
  const hwnd = await CreateWindow.apply(this, rest);
  const made = this.handles.resolve(hwnd);

  if (made instanceof RasterWindow) {
    const window = made.window;
    const windows = made.desktop.windows;

    window.exStyle = dwExStyle >>> 0;

    if (dwExStyle & WS_EX_TOPMOST && !window.parent) {
      window.topmost = true;
      windows.splice(windows.indexOf(window), 1);
      windows.splice(made.desktop.front(window), 0, window);
    }
  }

  return hwnd;
}

const WS_EX_TOPMOST = 0x0008;
