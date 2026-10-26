'use strict';

import { ClipRegion } from '../../raster/clip-region.js';
import { DeleteObject } from '../gdi/DeleteObject.js';
import { Region } from '../gdi/gdi-objects.js';

import { GetDC } from './GetDC.js';
import { GetWindowDC } from './GetWindowDC.js';
import { RasterWindow } from './raster-window.js';

const DCX_WINDOW = 0x00000001;
const DCX_CACHE = 0x00000002;
const DCX_CLIPCHILDREN = 0x00000008;
const DCX_EXCLUDERGN = 0x00000040;
const DCX_INTERSECTRGN = 0x00000080;
const DCX_KEEPCLIPRGN = 0x00040000;
const CS_OWNDC = 0x0020;
const CS_CLASSDC = 0x0040;

/**
 * A device context of a window's, as `GetDC` and `GetWindowDC` give one,
 * with what drawing in it is kept to said by the flags (`USER.EXE` seg1
 * `a64c`, the checks, then `847b`-`87b7`). **Recorded** by `getdcex`:
 *
 * * No window, nought.
 * * Without `DCX_CACHE`, a window whose class has no context of its own
 *   gets none: USER looks among its contexts for the window's own or its
 *   class's (`8560`-`85b3`), and answers nought where there is none
 *   (`85b6`).
 * * `DCX_CACHE` gives the client area's, as `GetDC` does; with
 *   `DCX_WINDOW`, the whole window's, as `GetWindowDC` does.
 * * `DCX_CLIPCHILDREN` keeps drawing off the window's children: a complex
 *   region where one shows.
 * * `DCX_INTERSECTRGN` keeps it inside a region given in the screen's
 *   terms; `DCX_EXCLUDERGN` out of it (`86e7`, `8745`). The region is
 *   deleted when the context is released, unless `DCX_KEEPCLIPRGN` is
 *   given too (`8703`-`8709`). Nought with `DCX_INTERSECTRGN` leaves
 *   nothing (`8711`-`871d`); 1 is no region (`86f0`).
 *
 * WinBox keeps these in the context's clip region, which Windows keeps in
 * its visible region apart from it: `SelectClipRgn` after takes them away
 * here. `DCX_PARENTCLIP`, the parent's client area to draw in, is not done:
 * a window's context draws in its own client area only. Neither is
 * `DCX_USESTYLE`, the flags from the window's and its class's styles
 * (`8491`-`84fb`).
 */
export function GetDCEx(this: any, hwnd: number, hrgnClip: number, flags: number) {
  if (!hwnd) {
    return 0;
  }

  const window = this.handles.resolve(hwnd);
  const raster = window instanceof RasterWindow ? window : null;

  if (raster && !(flags & DCX_CACHE)) {
    const windowClass = raster.options?.windowClass;
    const style = windowClass ? (this.handles.retrieve(windowClass)?.style ?? 0) : 0;

    if (!(style & (CS_OWNDC | CS_CLASSDC))) {
      return 0;
    }
  }

  const hdc = flags & DCX_WINDOW ? GetWindowDC.call(this, hwnd) : GetDC.call(this, hwnd);
  const surface = hdc ? this.handles.resolve(hdc) : null;

  if (!hdc || !raster || !surface) {
    return hdc;
  }

  const shown: any = raster.window;
  const x = flags & DCX_WINDOW ? shown.left : shown.left + shown.client.left;
  const y = flags & DCX_WINDOW ? shown.top : shown.top + shown.client.top;
  const whole = () => ClipRegion.rect(0, 0, surface.width || 0, surface.height || 0);
  let clip: ClipRegion | null = null;

  if (flags & DCX_CLIPCHILDREN) {
    clip = whole();

    for (const child of raster.desktop.windows as any[]) {
      if (child.parent === shown && child.visible && !child.titleOf) {
        clip = clip.subtract(
          ClipRegion.rect(
            child.left - x,
            child.top - y,
            child.left - x + child.width,
            child.top - y + child.height
          )
        );
      }
    }
  }

  const how = flags & DCX_INTERSECTRGN ? 'intersect' : flags & DCX_EXCLUDERGN ? 'exclude' : null;

  if (how && (hrgnClip & 0xffff) !== 1) {
    const region = hrgnClip ? this.handles.resolve(hrgnClip) : null;

    if (region instanceof Region) {
      const shape = region.shape.offset(-x, -y);

      clip =
        how === 'intersect'
          ? (clip ?? whole()).intersect(shape)
          : (clip ?? whole()).subtract(shape);
    } else if (!hrgnClip && how === 'intersect') {
      clip = ClipRegion.EMPTY;
    }

    if (hrgnClip && !(flags & DCX_KEEPCLIPRGN)) {
      (this._dcExRegions ??= new Map()).set(hdc, hrgnClip);
    }
  }

  if (clip) {
    surface.clipRegion = clip;
  }

  return hdc;
}

/** The region `GetDCEx` was given, deleted as its context is released. */
export function releaseDCExRegion(system: any, hdc: number) {
  const region = system._dcExRegions?.get(hdc);

  if (region !== undefined) {
    system._dcExRegions.delete(hdc);
    DeleteObject.call(system, region);
  }
}
