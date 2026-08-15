'use strict';

/**
 * Turning an outline into pixels.
 *
 * A TrueType contour is a closed loop of points, each either on the curve or a
 * control point for the quadratic joining its neighbours. Two control points
 * in a row imply an on-curve point halfway between them, which is how the
 * format stores a run of curves without repeating what it can work out.
 *
 * This flattens those curves into line segments and fills what they enclose by
 * the non-zero winding rule, sampling at the centre of each pixel. It does not
 * hint. Windows runs the font's own bytecode first, which moves the outline
 * onto the pixel grid before any of this happens, and at text sizes that
 * changes the result substantially -- a stem that lands between two columns
 * gets pushed onto one of them rather than being drawn faintly across both.
 * What comes out of here is the right shape and not the same pixels, and
 * `oracle/fixtures/glyphs.json` is what says by how much.
 */

/** How many segments a quadratic is broken into. */
const CURVE_STEPS = 8;

/**
 * How wide a span has to be before dropout control will rescue it.
 *
 * `SCANTYPE` 1, which all four installed families ask for, is "simple dropout
 * control **excluding stubs**", and a stub is the tapering tip of a stroke
 * rather than the stroke itself -- the point of a `1`'s flag, the top of a
 * `W`'s diagonal. Inking those puts a pixel where Windows leaves none.
 *
 * Half a pixel separates the two: the sampling interval, and the only value
 * here with a reason behind it rather than a fit. **Measured**, but the peak is
 * broad -- anything from 0.3 to 0.5 agrees on the same 79 of 90 recorded
 * glyphs, so the recording pins the rule and not the number. Below 0.3 the
 * stubs come back; above 0.5 real dropouts start being refused.
 */
const STUB = 0.5;

/**
 * Flattens one contour into a closed polygon.
 *
 * @param {Array} contour - Points, each `{x, y, on}` in font units.
 * @returns {Array} Points, each `[x, y]`.
 */
export function flatten(contour) {
  if (contour.length === 0) {
    return [];
  }

  /* A contour may begin on a control point, in which case the implied start is
   * halfway to the last point -- or is the last point, if that one is on the
   * curve. Getting this wrong rotates the whole outline by one segment.
   */
  const points = contour.slice();

  if (!points[0].on) {
    const last = points[points.length - 1];

    points.unshift(
      last.on ? last : { x: (points[0].x + last.x) / 2, y: (points[0].y + last.y) / 2, on: true }
    );
  }

  const polygon: number[][] = [[points[0].x, points[0].y]];

  let control: any = null;

  const quadratic = (from, via, to) => {
    for (let step = 1; step <= CURVE_STEPS; step++) {
      const t = step / CURVE_STEPS;
      const s = 1 - t;

      polygon.push([
        s * s * from[0] + 2 * s * t * via.x + t * t * to[0],
        s * s * from[1] + 2 * s * t * via.y + t * t * to[1],
      ]);
    }
  };

  for (let index = 1; index <= points.length; index++) {
    const point = points[index % points.length];

    if (point.on) {
      if (control) {
        quadratic(polygon[polygon.length - 1], control, [point.x, point.y]);
        control = null;
      } else {
        polygon.push([point.x, point.y]);
      }

      continue;
    }

    if (control) {
      // Two controls in a row: the point between them is on the curve.
      const midpoint = [(control.x + point.x) / 2, (control.y + point.y) / 2];

      quadratic(polygon[polygon.length - 1], control, midpoint);
    }

    control = point;
  }

  if (control) {
    quadratic(polygon[polygon.length - 1], control, polygon[0]);
  }

  return polygon;
}

/**
 * Fills a set of contours into a bitmap.
 *
 * The winding rule is the non-zero one TrueType specifies: a pixel is inside
 * when the contours around it wind a net non-zero number of times, which is
 * what lets a counter -- the hole in an `o` -- be a contour wound the other
 * way rather than a special case.
 *
 * @param {Array} contours - Contours in font units.
 * @param {Object} options - `scale` to pixels, `originY` for the baseline, and
 *                           `width`/`height` of the target.
 * @returns {Uint8Array} One byte per pixel, non-zero where inked.
 */
export function fill(contours, options) {
  const { scale, originX = 0, originY = 0, width, height, dropout = false } = options;

  const pixels = new Uint8Array(width * height);

  const edges: any[] = [];

  for (const contour of contours) {
    const polygon = flatten(contour);

    for (let index = 0; index < polygon.length; index++) {
      const from = polygon[index];
      const to = polygon[(index + 1) % polygon.length];

      /* Into device space as the edges are built: x grows the same way, y is
       * measured up from the baseline and pixels are counted down from the top.
       */
      const x0 = originX + from[0] * scale;
      const y0 = originY - from[1] * scale;
      const x1 = originX + to[0] * scale;
      const y1 = originY - to[1] * scale;

      if (y0 === y1) {
        continue;
      }

      edges.push({ x0, y0, x1, y1, winding: y1 > y0 ? 1 : -1 });
    }
  }

  if (edges.length === 0) {
    return pixels;
  }

  for (let row = 0; row < height; row++) {
    // The centre of the row, so a shape has to cover the pixel to fill it.
    const y = row + 0.5;

    const crossings: any[] = [];

    for (const edge of edges) {
      const top = Math.min(edge.y0, edge.y1);
      const bottom = Math.max(edge.y0, edge.y1);

      if (y < top || y >= bottom) {
        continue;
      }

      const t = (y - edge.y0) / (edge.y1 - edge.y0);

      crossings.push({ x: edge.x0 + t * (edge.x1 - edge.x0), winding: edge.winding });
    }

    if (crossings.length === 0) {
      continue;
    }

    crossings.sort((left, right) => left.x - right.x);

    let winding = 0;

    for (let index = 0; index < crossings.length - 1; index++) {
      winding += crossings[index].winding;

      if (winding === 0) {
        continue;
      }

      const from = crossings[index].x;
      const to = crossings[index + 1].x;

      const first = Math.ceil(from - 0.5);

      if (first < to - 0.5) {
        for (let column = first; column < to - 0.5; column++) {
          if (column >= 0 && column < width) {
            pixels[row * width + column] = 1;
          }
        }

        continue;
      }

      /* Dropout control: this span turned on no pixel at all.
       *
       * A stroke thinner than the gap between two pixel centres can pass
       * between them and leave nothing behind, and the letter comes apart --
       * the crossbar of an `A` loses its end, a thin diagonal breaks in half.
       * Where that happens one pixel is turned on anyway. The fonts ask for it
       * outright: Arial's `prep` sets `SCANCTRL` to 0x111, Times New Roman's to
       * 0x17c and Courier New's to 0x12c, which are the same instruction saying
       * "below seventeen, a hundred and twenty-four, and forty-four pixels per
       * em" respectively. All three set `SCANTYPE` to 1.
       */
      if (!dropout || to - from < STUB) {
        continue;
      }

      const column = Math.floor(from);

      if (column >= 0 && column < width) {
        pixels[row * width + column] = 1;
      }
    }
  }

  return pixels;
}
