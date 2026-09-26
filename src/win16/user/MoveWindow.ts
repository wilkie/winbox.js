'use strict';

import { RasterWindow } from './raster-window.js';
import { positionRaster } from './window-state.js';

import { FALSE } from '../consts.js';

export async function MoveWindow(hwnd, nLeft, nTop, nWidth, nHeight, fRepaint) {
  // Get the window itself
  const dialog = this.handles.resolve(hwnd);

  /* On the raster desktop, `SetWindowPos` with the place and size, and no
   * change to the order. */
  if (dialog instanceof RasterWindow) {
    return positionRaster(this, hwnd, dialog, 0, nLeft, nTop, nWidth, nHeight, 0x0004 | 0x0010);
  }

  /* Not a window of the desktop's. */
  return FALSE;
}
