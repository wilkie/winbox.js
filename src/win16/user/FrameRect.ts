'use strict';

import { rasterOp } from '../../raster/raster-op.js';
import { realiseBrush } from '../gdi/CreatePatternBrush.js';
import { deviceRect, mapped } from '../gdi/mapping.js';

const PATCOPY = 0x00f00021;

/**
 * A border one unit wide just inside a rectangle, in a brush: its left and
 * top edges on the rectangle's, its right and bottom a unit in from them, as
 * `FillRect` fills, with the brush and `PATCOPY` (documented). SkiFree frames
 * its score box so, and Windows shows all four sides of it where winbox.js
 * drew the right and bottom a pixel short, off the box.
 */
export function FrameRect(hdc, lprc, hbr) {
  const brush = this.handles.resolve(hbr);
  const surface = this.handles.resolve(hdc);

  if (!surface || !lprc || !brush) {
    return 0;
  }

  const old = surface.brush;
  const box = mapped(surface)
    ? deviceRect(surface, lprc.left, lprc.top, lprc.right, lprc.bottom)
    : lprc;
  const width = box.right - box.left;
  const height = box.bottom - box.top;

  if (width <= 0 || height <= 0) {
    return 0;
  }

  surface.brush = brush;
  realiseBrush(surface, brush);

  for (const [x, y, w, h] of [
    [box.left, box.top, width, 1],
    [box.left, box.bottom - 1, width, 1],
    [box.left, box.top, 1, height],
    [box.right - 1, box.top, 1, height],
  ]) {
    rasterOp(this.display, surface, x, y, w, h, PATCOPY, null, 0, 0);
  }

  surface.brush = old;

  return 0;
}
