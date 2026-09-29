'use strict';

import { devicePoint, mapped } from './mapping.js';
import { ropOfMode } from './SetROP2.js';
import { wideStroke } from './LineTo.js';
import { penSize } from './Ellipse.js';

import { FALSE, TRUE } from '../consts.js';
import { polygonSpans } from '../../raster/polygon.js';
import { rasterOp } from '../../raster/raster-op.js';
import { wedgePoints } from '../../raster/wedges.js';

const PS_INSIDEFRAME = 6;

/**
 * `Arc`, `Chord` and `Pie`: the ellipse in the rectangle, cut at the radials
 * from its centre through the two points, anticlockwise from the first to
 * the second. **Read out of `GDI.EXE`** seg9 `02c4`, the body they share with
 * `Ellipse`, and **recorded** by `wedges`; the points are `wedgePoints`.
 *
 * * The rectangle and points are mapped to the device, the rectangle put in
 *   order and a pixel taken off its right and bottom; one with nothing left
 *   draws nothing and answers nought.
 * * A start and end that the mapping makes one point, though they were two,
 *   are the whole ellipse where the start is anticlockwise of the end, and
 *   for `Arc` nothing (`0360`).
 * * `Arc` draws its points as a polyline, each edge as `LineTo` does, the
 *   last point left off. `Chord` and `Pie` fill theirs with the brush, as
 *   `Ellipse` does, and draw every edge with the pen, as `Polygon` does.
 *
 * Not followed: a pen wider than a pixel, which GDI draws as a ring
 * (seg21 `14b7`) and which is drawn a pixel wide here.
 */
function wedge(this: any, kind: 'arc' | 'chord' | 'pie', hdc: number, args: number[]) {
  const surface = this.handles.resolve(hdc);

  if (!surface) {
    return FALSE;
  }

  const signed = (value: number) => (value << 16) >> 16;
  const [x1, y1, x2, y2, x3, y3, x4, y4] = args.map(signed);
  const m = mapped(surface);
  const device = (x: number, y: number) => (m ? devicePoint(surface, x, y) : [x, y]);
  const [dl, dt] = device(x1, y1);
  const [dr, db] = device(x2, y2);
  const [sx, sy] = device(x3, y3);
  const [ex, ey] = device(x4, y4);
  let whole = false;

  /* One point in the device that was two: which way round, in logical terms. */
  if (kind !== 'chord' && sx === ex && sy === ey) {
    const cx = (x1 + x2) >> 1;
    const cy = (y1 + y2) >> 1;

    whole = (x3 - cx) * (y4 - cy) - (x4 - cx) * (y3 - cy) > 0;

    if (whole && kind === 'arc') {
      return FALSE;
    }
  }

  const left = Math.min(dl, dr);
  const top = Math.min(dt, db);
  const right = Math.max(dl, dr) - 1;
  const bottom = Math.max(dt, db) - 1;

  if (left > right || top > bottom) {
    return FALSE;
  }

  /* `PS_INSIDEFRAME` wider than a pixel keeps a pie's or a chord's frame
   * inside the rectangle as it does a rectangle's: the rectangle less half
   * the pen, rounded down, on every side, and the shape drawn in it as any
   * other wide pen draws it -- but in the pen's colour as a brush has it,
   * patterned where the display lacks it. `inframe`. */
  const [penWidth, penHeight] = penSize(this, surface.pen);
  const inside = kind !== 'arc' && surface.pen?.style === PS_INSIDEFRAME && penWidth > 1;
  const [il, it, ir, ib] = inside
    ? [
        left + (penWidth >> 1),
        top + (penHeight >> 1),
        right - (penWidth >> 1),
        bottom - (penHeight >> 1),
      ]
    : [left, top, right, bottom];

  if (il > ir || it > ib) {
    return FALSE;
  }

  const points = wedgePoints(kind, il, it, ir, ib, sx, sy, ex, ey, whole);

  if (points.length < 2) {
    return FALSE;
  }

  const rop = ropOfMode(surface.rop2 ?? 13);

  if (kind !== 'arc' && surface.brush?.color?.alpha) {
    for (const [y, from, to] of polygonSpans(points)) {
      rasterOp(this.display, surface, from, y, to - from, 1, rop, null, 0, 0);
    }
  }

  /* A pen wider than a pixel: the arc's points, or a chord's or pie's back to
   * the first, as one wide polyline (`widepoly`). */
  if (
    surface.pen?.color?.alpha &&
    wideStroke(this, surface, kind === 'arc' ? points : [...points, points[0]], inside)
  ) {
    return TRUE;
  }

  if (surface.pen?.color?.alpha) {
    const edges = kind === 'arc' ? points.length - 1 : points.length;

    for (let index = 0; index < edges; index++) {
      const [ax, ay] = points[index];
      const [bx, by] = points[(index + 1) % points.length];

      surface.drawLine(ax, ay, bx, by);
    }
  }

  return TRUE;
}

export function Arc(this: any, hdc: number, ...args: number[]) {
  return wedge.call(this, 'arc', hdc, args);
}

export function Chord(this: any, hdc: number, ...args: number[]) {
  return wedge.call(this, 'chord', hdc, args);
}

export function Pie(this: any, hdc: number, ...args: number[]) {
  return wedge.call(this, 'pie', hdc, args);
}
