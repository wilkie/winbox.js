'use strict';

import { RasterWindow } from './raster-window.js';

/**
 */
export async function InvalidateRect(hwnd, lprc, fErase) {
  // Get the window itself
  const dialog = this.handles.resolve(hwnd);

  /* On the raster desktop the window is only marked: it is painted when its
   * program next asks for a message and none is queued, as Windows does it.
   * What is to be painted again is kept as the rectangle around all of it,
   * on the screen: `BeginPaint` clips to it and answers it as `rcPaint`. */
  if (dialog instanceof RasterWindow) {
    const window: any = dialog.window;
    const was = window.needsPaint ? window.dirtyRect : null;

    if (lprc && was !== undefined) {
      const x = window.left + window.client.left;
      const y = window.top + window.client.top;
      const area = [lprc.left + x, lprc.top + y, lprc.right + x, lprc.bottom + y];

      window.dirtyRect = was
        ? [
            Math.min(was[0], area[0]),
            Math.min(was[1], area[1]),
            Math.max(was[2], area[2]),
            Math.max(was[3], area[3]),
          ]
        : area;
    } else {
      window.dirtyRect = undefined;
    }

    window.needsPaint = true;
    window.needsErase ||= fErase != 0;
    return;
  }
}
