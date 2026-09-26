'use strict';

import { RasterWindow } from './raster-window.js';

/**
 */
export async function InvalidateRect(hwnd, lprc, fErase) {
  // Get the window itself
  const dialog = this.handles.resolve(hwnd);

  /* On the raster desktop the window is only marked: it is painted when its
   * program next asks for a message and none is queued, as Windows does it.
   * Not the part of the window given -- the whole of it. */
  if (dialog instanceof RasterWindow) {
    dialog.window.needsPaint = true;
    (dialog.window as any).dirtyRect = undefined;
    dialog.window.needsErase ||= fErase != 0;
    return;
  }
}
