'use strict';

import { deviceRect, mapped } from './mapping.js';

import { rasterOp } from '../../raster/raster-op.js';

import { TRUE, FALSE } from '../consts.js';

/**
 * Combines the selected brush with a rectangle of a device context under a
 * raster operation that reads no source: `PATCOPY`, `PATINVERT`, `DSTINVERT`,
 * `BLACKNESS`, `WHITENESS` and the rest. The same engine as `BitBlt`; see
 * `rasterOp`. The rectangle's right and bottom edges are outside it, recorded
 * by `bitbits`.
 *
 * @param {Types.HDC} hdc - Where to draw.
 * @param {Types.INT} nLeftRect - The rectangle's left edge.
 * @param {Types.INT} nTopRect - Its top edge.
 * @param {Types.INT} nwidth - Its width.
 * @param {Types.INT} nheight - Its height.
 * @param {Types.DWORD} fdwRop - The raster operation.
 *
 * @returns {Types.BOOL} Whether there was a device context to draw on.
 */
export function PatBlt(hdc, nLeftRect, nTopRect, nwidth, nheight, fdwRop) {
  const surface = this.handles.resolve(hdc);

  if (!surface) {
    return FALSE;
  }

  /* In device terms, in order, where a mapping mode says otherwise. */
  if (mapped(surface)) {
    const rect = deviceRect(surface, nLeftRect, nTopRect, nLeftRect + nwidth, nTopRect + nheight);

    nLeftRect = rect.left;
    nTopRect = rect.top;
    nwidth = rect.right - rect.left;
    nheight = rect.bottom - rect.top;
  }

  /* A width or height below nought reaches back from the corner given: a
   * height of -1 at 27 is row 26. The Towers from Hanoi of the corpus draws
   * its tool bar's bottom edge so, and Windows' screen shows it. */
  if (nwidth < 0) {
    nLeftRect += nwidth;
    nwidth = -nwidth;
  }

  if (nheight < 0) {
    nTopRect += nheight;
    nheight = -nheight;
  }

  rasterOp(this.display, surface, nLeftRect, nTopRect, nwidth, nheight, fdwRop >>> 0, null, 0, 0);

  return TRUE;
}
