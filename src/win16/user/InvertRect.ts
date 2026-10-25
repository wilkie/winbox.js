'use strict';

import { rasterOp } from '../../raster/raster-op.js';
import { rectBounds } from '../gdi/bounds.js';

/**
 * Inverts every pixel of a rectangle, each bit of its colour's index as the
 * raster operation `DSTINVERT` does; the right and bottom edges are outside
 * it.
 *
 * @param {Types.HDC} hdc - The device context.
 * @param {Types.RECT} lprc - The rectangle.
 */
export function InvertRect(hdc, lprc) {
  const surface = this.handles.resolve(hdc);

  if (!surface || !lprc) {
    return;
  }

  /* GDI's `PatBlt` takes what it draws in into the bounds (`bounds.ts`). */
  rectBounds(this, surface, lprc.left, lprc.top, lprc.right, lprc.bottom);

  rasterOp(
    this.display,
    surface,
    lprc.left,
    lprc.top,
    lprc.right - lprc.left,
    lprc.bottom - lprc.top,
    0x550009,
    null,
    0,
    0
  );
}
