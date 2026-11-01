'use strict';

import { DesktopHandle } from './desktop-handle.js';
import { RasterWindow } from './raster-window.js';
import { cutToParents } from './invalidate-through.js';

/**
 * The smallest rectangle around what a window is due to paint, in its
 * client area; answers whether there is any (documented). Write asks before
 * it paints, and paints nothing -- validating nothing -- when told there is
 * nothing, so `WM_PAINT` came back for ever while this answered nought.
 *
 * Not followed: `bErase`, which would have the background erased first.
 */
export function GetUpdateRect(this: any, hwnd: number, lprc: any, _bErase: number) {
  const dialog = this.handles.resolve(hwnd);
  const empty = () => {
    if (lprc) {
      lprc.left = lprc.top = lprc.right = lprc.bottom = 0;
    }

    return 0;
  };

  /* The desktop window: what of the desktop itself is due ([[probe:rdwmore]]). */
  if (dialog instanceof DesktopHandle) {
    const box = this.rasterDesktop?.backgroundRegion?.box;

    if (!box) {
      return empty();
    }

    if (lprc) {
      lprc.left = box.left;
      lprc.top = box.top;
      lprc.right = box.right;
      lprc.bottom = box.bottom;
    }

    return 1;
  }

  /* Another task's making it due, looked at (`USER.EXE` seg1 `4684`). */
  if (dialog instanceof RasterWindow) {
    (dialog.window as any).otherTask = false;
  }

  if (!(dialog instanceof RasterWindow) || !dialog.window.needsPaint) {
    return empty();
  }

  const window: any = dialog.window;
  const originX = window.left + window.client.left;
  const originY = window.top + window.client.top;
  const area = window.paintClip ?? window.dirtyRect;
  /* Cut to the client area, and to those of the windows it is in
   * (`USER.EXE` seg1 `46d6`-`46f2`, `8bb3`; `invchild`). */
  const seen = cutToParents(window, [
    Math.max(originX, area ? area[0] : originX),
    Math.max(originY, area ? area[1] : originY),
    Math.min(originX + window.clientWidth, area ? area[2] : originX + window.clientWidth),
    Math.min(originY + window.clientHeight, area ? area[3] : originY + window.clientHeight),
  ]);

  if (!seen) {
    return empty();
  }

  const [left, top, right, bottom] = [
    seen[0] - originX,
    seen[1] - originY,
    seen[2] - originX,
    seen[3] - originY,
  ];

  if (right <= left || bottom <= top) {
    return empty();
  }

  if (lprc) {
    lprc.left = left;
    lprc.top = top;
    lprc.right = right;
    lprc.bottom = bottom;
  }

  return 1;
}
