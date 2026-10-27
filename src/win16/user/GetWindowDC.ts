'use strict';

import { NULL } from '../consts.js';

import { SYSTEM_FONT, stockFontHandle } from '../gdi/stock-fonts.js';
import { resetVisible } from '../gdi/visible-region.js';

import { RasterWindow } from './raster-window.js';
import { DCX_USESTYLE, DCX_WINDOW, selectWindowRegion } from './visible-region-rule.js';

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
  let surface: any;

  /* The desktop window's is the screen's, as nought's (`visrgn`). */
  if (hwnd == NULL || hwnd === this.desktopWindow) {
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

  /* Its visible region by USER's rule for the whole window, as `GetDCEx`
   * with `DCX_WINDOW` and `DCX_USESTYLE`, and its origin its corner; the
   * screen's what it shows (`GetDC`). */
  const shown = surface !== this.screen ? this.handles.resolve(hwnd) : null;

  if (shown instanceof RasterWindow) {
    selectWindowRegion(this, surface, shown.window, DCX_WINDOW | DCX_USESTYLE);
  } else {
    resetVisible(surface);
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
