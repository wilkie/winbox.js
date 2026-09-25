'use strict';

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

  rasterOp(this.display, surface, nLeftRect, nTopRect, nwidth, nheight, fdwRop >>> 0, null, 0, 0);

  return TRUE;
}
