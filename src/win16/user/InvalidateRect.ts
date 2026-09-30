'use strict';

import { ClipRegion } from '../../raster/clip-region.js';
import { RasterWindow } from './raster-window.js';
import { setUpdate, updateOf } from './update-region.js';

const union = (a: ClipRegion, b: ClipRegion) => ClipRegion.combine(a, b, (x, y) => x || y);

/**
 */
export async function InvalidateRect(hwnd, lprc, fErase) {
  // Get the window itself
  const dialog = this.handles.resolve(hwnd);

  /* On the raster desktop the window is only marked: it is painted when its
   * program next asks for a message and none is queued, as Windows does it.
   * What is to be painted again is kept as a region on the screen, and the
   * rectangle around it: `BeginPaint` clips to the region and answers the
   * rectangle as `rcPaint` (`update-region.ts`). */
  if (dialog instanceof RasterWindow) {
    const window: any = dialog.window;
    const was = window.needsPaint ? window.dirtyRect : null;

    if (lprc && was !== undefined) {
      const x = window.left + window.client.left;
      const y = window.top + window.client.top;
      const area = ClipRegion.rect(lprc.left + x, lprc.top + y, lprc.right + x, lprc.bottom + y);

      /* Added to what it was due as a region, not a box (`updrgn`). */
      setUpdate(window, union(updateOf(window), area), fErase != 0);
      return;
    }

    window.dirtyRect = undefined;
    window.dirtyShape = undefined;

    window.needsPaint = true;
    window.needsErase ||= fErase != 0;
    return;
  }
}
