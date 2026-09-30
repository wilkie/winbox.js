'use strict';

import { BitmapContext } from '../../raster/bitmap-context.js';
import { ringsSpans } from '../../raster/polygon.js';
import { rasterOp } from '../../raster/raster-op.js';
import { line } from './LineTo.js';
import { ropOfMode } from './SetROP2.js';

/**
 * A polygon's fill and outline under the drawing mode. In `R2_COPYPEN`, 13,
 * as they always were; under another, through the raster operation that
 * reads the screen, the fill with the brush and the outline as `LineTo`
 * draws it. The fill runs under the outline at the top and left, as an
 * ellipse's does, so under `R2_NOT` a top edge is inverted twice and shows
 * as it was (`metafile`).
 */
export function fillRings(
  system: any,
  surface: any,
  rings: number[][][],
  winding: boolean,
  closed: boolean
) {
  if (!surface.brush?.color?.alpha || !(surface.context instanceof BitmapContext)) {
    return;
  }

  const mode = surface.rop2 ?? 13;

  if (mode === 13) {
    surface.fillPolygons(rings, surface.brush.color, winding, closed);
    return;
  }

  const rop = ropOfMode(mode);

  for (const [y, from, to] of ringsSpans(rings, winding, closed)) {
    rasterOp(system.display, surface, from, y, to - from, 1, rop, null, 0, 0);
  }
}

/** One side of an outline, under the drawing mode. */
export function outlineSide(surface: any, x: number, y: number, x2: number, y2: number) {
  if ((surface.rop2 ?? 13) === 13) {
    surface.drawLine(x, y, x2, y2);
  } else {
    line(surface, x, y, x2, y2);
  }
}
