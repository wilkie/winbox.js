'use strict';

import { NULL } from '../consts.js';

import { SYSTEM_FONT, stockFontHandle } from '../gdi/stock-fonts.js';

import { RasterWindow } from './raster-window.js';

/**
 * A device context for the whole of a window, its frame, caption and menu bar
 * as well as its client area, with its origin at the window's corner. A
 * program draws its own frame with one. `ReleaseDC` gives it back.
 *
 * Only on the raster desktop, where the frame is pixels; `NULL` is the whole
 * screen, as it is for `GetDC`.
 *
 * @param {number} hwnd - The window.
 * @returns {number} The device context, or `NULL`.
 */
export function GetWindowDC(this: any, hwnd: number) {
  let surface: any = null;

  if (hwnd == NULL) {
    surface = this.screen;
  } else {
    const dialog = this.handles.resolve(hwnd);

    if (!(dialog instanceof RasterWindow)) {
      return NULL;
    }

    surface = dialog.desktop.windowSurface(dialog.window);
    this._windowDCs ??= new WeakMap();
    this._windowDCs.set(surface, hwnd);
  }

  if (!surface) {
    return NULL;
  }

  /* A context comes with the system font already in it; see `GetDC`. */
  if (!surface.font) {
    const font = stockFontHandle(this, SYSTEM_FONT);

    if (font) {
      surface.font = this.handles.resolve(font);
    }
  }

  return this.handles.allocate(surface);
}
