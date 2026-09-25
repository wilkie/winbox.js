'use strict';

import { RasterWindow } from './raster-window.js';

/**
 * Takes a window off the list of those due to be painted, as painting it
 * would: the next `GetMessage` makes no `WM_PAINT` for it.
 *
 * As `InvalidateRect` marks the whole of a window rather than the part given,
 * this unmarks the whole of it; the raster desktop keeps no region.
 *
 * @param {number} hwnd - The window.
 */
export function ValidateRect(this: any, hwnd: number) {
  const dialog = this.handles.resolve(hwnd);

  if (dialog instanceof RasterWindow) {
    dialog.window.needsPaint = false;
    dialog.window.needsErase = false;
  }
}
