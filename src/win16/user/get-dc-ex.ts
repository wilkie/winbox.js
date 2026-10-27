'use strict';

import { ClipRegion } from '../../raster/clip-region.js';
import { DeleteObject } from '../gdi/DeleteObject.js';
import { Region } from '../gdi/gdi-objects.js';

import { GetDC } from './GetDC.js';
import { GetWindowDC } from './GetWindowDC.js';
import { RasterWindow } from './raster-window.js';
import {
  DCX_CACHE,
  DCX_EXCLUDERGN,
  DCX_INTERSECTRGN,
  DCX_LOCKWINDOWUPDATE,
  DCX_WINDOW,
  type Given,
  selectWindowRegion,
} from './visible-region-rule.js';

const DCX_KEEPCLIPRGN = 0x00040000;
const CS_OWNDC = 0x0020;
const CS_CLASSDC = 0x0040;

/**
 * A device context of a window's, as `GetDC` and `GetWindowDC` give one,
 * its visible region worked out by the flags (`USER.EXE` seg1 `a64c`, the
 * checks, then `847b`-`87b7`). **Recorded** by `getdcex` and `visrgn`:
 *
 * * No window, nought.
 * * Without `DCX_CACHE`, a window whose class has no context of its own
 *   gets none: USER looks among its contexts for the window's own or its
 *   class's (`8560`-`85b3`), and answers nought where there is none
 *   (`85b6`).
 * * `DCX_CACHE` gives the client area's, as `GetDC` does; with
 *   `DCX_WINDOW`, the whole window's, as `GetWindowDC` does.
 * * The region is USER's rule's for the flags (`visible-region-rule.ts`):
 *   `DCX_CLIPCHILDREN` keeps drawing off the window's children,
 *   `DCX_CLIPSIBLINGS` off its siblings above, `DCX_PARENTCLIP` gives the
 *   parent's, `DCX_USESTYLE` takes them from the styles.
 * * `DCX_INTERSECTRGN` keeps it inside a region given in the screen's
 *   terms; `DCX_EXCLUDERGN` out of it (`86e7`, `8745`). The region is
 *   deleted when the context is released, unless `DCX_KEEPCLIPRGN` is
 *   given too (`8703`-`8709`). For `DCX_INTERSECTRGN`, nought leaves
 *   nothing (`8711`-`871d`); for `DCX_EXCLUDERGN`, nought is nothing
 *   given (`874e`). A handle that is no region answers nought (`a658`):
 *   1, which the body takes for the whole screen (`86f0`, `876b`), is for
 *   USER's own callers.
 *
 * These are in the visible region, as Windows keeps them: `SelectClipRgn`
 * after leaves them.
 */
export function GetDCEx(this: any, hwnd: number, hrgnClip: number, flags: number) {
  if (!hwnd) {
    return 0;
  }

  /* A region given that is not one, nought (`a658`-`a66d`): even 1, which
   * USER's own callers pass for the whole screen (`visrule`). */
  if (hrgnClip && !(this.handles.resolve(hrgnClip) instanceof Region)) {
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

  /* With `DCX_LOCKWINDOWUPDATE`, the locked window's context as any
   * other's, on the screen (seg1 `15cb`; `visrule`). */
  const lock = flags & DCX_LOCKWINDOWUPDATE ? this._windowLock : null;

  if (lock) {
    this._windowLock = null;
  }

  const hdc = flags & DCX_WINDOW ? GetWindowDC.call(this, hwnd) : GetDC.call(this, hwnd);

  if (lock) {
    this._windowLock = lock;
  }
  const surface = hdc ? this.handles.resolve(hdc) : null;

  if (!hdc || !raster || !surface || surface.visFrom === null) {
    return hdc;
  }

  let given: Given = null;

  const region: Region | null = hrgnClip ? this.handles.resolve(hrgnClip) : null;

  if (flags & DCX_INTERSECTRGN) {
    given = { shape: region ? region.shape : ClipRegion.EMPTY, keep: 'intersect' };
  } else if (flags & DCX_EXCLUDERGN && region) {
    given = { shape: region.shape, keep: 'exclude' };
  }

  if (flags & (DCX_INTERSECTRGN | DCX_EXCLUDERGN) && region && !(flags & DCX_KEEPCLIPRGN)) {
    (this._dcExRegions ??= new Map()).set(hdc, hrgnClip);
  }

  selectWindowRegion(this, surface, raster.window, flags, given);

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
