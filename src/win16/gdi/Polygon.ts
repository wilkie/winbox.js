'use strict';

import { FALSE, TRUE } from '../consts.js';
import { BitmapContext } from '../../raster/bitmap-context.js';

/**
 * Fills a closed shape with the selected brush and outlines it with the
 * selected pen.
 *
 * The fill is GDI's own scanline walk, which a display reporting
 * `POLYGONALCAPS` 8 leaves to GDI: see `Surface.fillPolygon`, recorded by
 * `polyfill` on 117 quadrilaterals under both fill modes. The outline is each
 * edge drawn as `LineTo` draws a line, the last back to the first point, so
 * every vertex is drawn once as the start of the edge that leaves it --
 * recorded by the same probe with a black pen, alone and over the fill. A null
 * brush or a null pen draws nothing of its part.
 *
 * Not yet measured: a shape that is not convex, where the fill mode decides
 * which parts are inside, and the return value.
 *
 * @param {Types.HDC} hdc - The device context to draw on.
 * @param {Types.FARPTR} lpPoints - Points to `nCount` `POINT`s, each two
 *                                  signed words.
 * @param {Types.INT} nCount - The number of points.
 *
 * @returns {Types.BOOL} Whether the shape was drawn.
 */
export function Polygon(hdc, lpPoints, nCount) {
  const surface = this.handles.resolve(hdc);
  this.debug('Polygon', lpPoints, nCount);

  if (!surface || !lpPoints || nCount < 2) {
    return FALSE;
  }

  const core = this.machine.cpu.core;
  const segment = (lpPoints >>> 16) & 0xffff;
  const offset = lpPoints & 0xffff;
  const signed = (word) => (word & 0x8000 ? word - 0x10000 : word);
  const points: number[][] = [];

  for (let index = 0; index < nCount; index++) {
    points.push([
      signed(core.read16(segment, offset + index * 4)),
      signed(core.read16(segment, offset + index * 4 + 2)),
    ]);
  }

  if (surface.brush?.color?.alpha && surface.context instanceof BitmapContext) {
    surface.fillPolygon(points, surface.brush.color);
  }

  if (surface.pen?.color?.alpha) {
    for (let index = 0; index < points.length; index++) {
      const [x, y] = points[index];
      const [x2, y2] = points[(index + 1) % points.length];

      surface.drawLine(x, y, x2, y2);
    }
  }

  return TRUE;
}
