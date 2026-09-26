'use strict';

import { RasterWindow } from './raster-window.js';

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

  if (!(dialog instanceof RasterWindow) || !dialog.window.needsPaint) {
    return empty();
  }

  const window: any = dialog.window;
  const originX = window.left + window.client.left;
  const originY = window.top + window.client.top;
  const area = window.paintClip ?? window.dirtyRect;
  const left = Math.max(0, area ? area[0] - originX : 0);
  const top = Math.max(0, area ? area[1] - originY : 0);
  const right = Math.min(window.clientWidth, area ? area[2] - originX : window.clientWidth);
  const bottom = Math.min(window.clientHeight, area ? area[3] - originY : window.clientHeight);

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
