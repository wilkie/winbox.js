'use strict';

import { ClipRegion } from '../../raster/clip-region.js';
import { RasterWindow } from './raster-window.js';
import { RDW_VALIDATE, redrawThrough } from './invalidate-through.js';

/**
 * Takes a rectangle of a window off what it is due to paint, or the whole of
 * it with none: `RedrawWindow`'s body with `RDW_VALIDATE` (`USER.EXE` seg1
 * `aa47`, `0142`, `3e1e`). Nothing for a window that does not show; else
 * through the window and, where it has no `WS_CLIPCHILDREN`, the windows in
 * it (`invalidate-through.ts`; `invchild`). A part cut from the update
 * leaves the rest of it due (`updrgn`).
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
  const x = window.left + window.client.left;
  const y = window.top + window.client.top;
  const part = lprc
    ? ClipRegion.rect(lprc.left + x, lprc.top + y, lprc.right + x, lprc.bottom + y)
    : null;

  redrawThrough(dialog.desktop, window, part, RDW_VALIDATE, () => {});
}
