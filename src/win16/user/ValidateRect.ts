'use strict';

import { ClipRegion } from '../../raster/clip-region.js';
import { RasterWindow } from './raster-window.js';
import { setUpdate, updateOf } from './update-region.js';

/**
 * Takes a rectangle of a window off what it is due to paint, or the whole of
 * it with none: the next `GetMessage` makes no `WM_PAINT` for it when
 * nothing is left. A part cut from the update leaves the rest of it due
 * (`updrgn`, through `ValidateRgn`; see `update-region.ts`).
 *
 * @param {number} hwnd - The window.
 * @param {object} lprc - The rectangle, in its client area, or none.
 */
export function ValidateRect(this: any, hwnd: number, lprc: any) {
  const dialog = this.handles.resolve(hwnd);

  if (!(dialog instanceof RasterWindow)) {
    return;
  }

  const window = dialog.window;

  if (!lprc) {
    setUpdate(window, ClipRegion.EMPTY, false);
    return;
  }

  const x = window.left + window.client.left;
  const y = window.top + window.client.top;
  const part = ClipRegion.rect(lprc.left + x, lprc.top + y, lprc.right + x, lprc.bottom + y);

  setUpdate(window, updateOf(window).subtract(part), false);
}
