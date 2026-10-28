'use strict';

import { ClipRegion } from '../../raster/clip-region.js';
import { RasterWindow } from './raster-window.js';
import { tellLock } from './lock-window-update.js';
import { RDW_ERASE, RDW_INVALIDATE, redrawThrough } from './invalidate-through.js';

/**
 * A rectangle of a window's client area made due to paint, or all of it for
 * none: `RedrawWindow`'s body with `RDW_INVALIDATE`, and `RDW_ERASE` to
 * erase (`USER.EXE` seg1 `aa27`, `014c`, `3e1e`). Nothing for a window that
 * does not show; else through the window and, where it has no
 * `WS_CLIPCHILDREN`, the windows in it, each made due where the rectangle
 * meets it, erase and frame too (`invalidate-through.ts`; `invchild`).
 *
 * The window is only marked: it is painted when its program next asks for a
 * message and none is queued, as Windows does it. What is to be painted
 * again is kept as a region on the screen, and the rectangle around it:
 * `BeginPaint` clips to the region (`update-region.ts`).
 */
export async function InvalidateRect(hwnd, lprc, fErase) {
  const dialog = this.handles.resolve(hwnd);

  if (!(dialog instanceof RasterWindow)) {
    return;
  }

  const window: any = dialog.window;
  const x = window.left + window.client.left;
  const y = window.top + window.client.top;
  const region = lprc
    ? ClipRegion.rect(lprc.left + x, lprc.top + y, lprc.right + x, lprc.bottom + y)
    : null;

  /* Where a window is locked, what is made due is told to it as drawn
   * (`USER.EXE` seg1 `3f41`-`3f7c`). */
  redrawThrough(
    dialog.desktop,
    window,
    region,
    RDW_INVALIDATE | (fErase != 0 ? RDW_ERASE : 0),
    () => tellLock(this, window, lprc)
  );
}
