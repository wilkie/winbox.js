'use strict';

import { polygonSpans } from './polygon.js';

/**
 * Ellipses and rounded rectangles, as Windows 3.1's GDI makes them on a
 * display that leaves curves to it.
 *
 * **Read out of `GDI.EXE`**, and **recorded** by `curves`: 25 shapes on four
 * displays, fourteen ellipses and eleven rounded rectangles from one pixel
 * square to forty by thirty, with a pen one pixel wide, three wide and none,
 * over a light grey brush and none -- every pixel of all four agrees.
 *
 * GDI turns the shape into a list of points and fills that as a polygon,
 * with `ALTERNATE`, by the walk `polygonSpans` is (`Ellipse` and `RoundRect`
 * share a body at seg9 `02c4`):
 *
 * * with a pen no wider than a pixel, the points are the polygon, and the pen
 *   and brush draw it as `Polygon` does -- the brush filling it, then the pen
 *   along each edge;
 * * with a wider pen (seg21 `14b7`), the brush fills a smaller shape, and a
 *   solid brush of the pen's colour fills the ring between that and a larger
 *   one: the two lists as one polygon, which `ALTERNATE` makes a ring.
 */

/** A point, `[x, y]`. */
type Point = [number, number];

/**
 * A quarter of an ellipse whose radius along its longer axis is `a` and along
 * its shorter `b`, from `(a, 0)` to `(0, b)`. seg9 `1175`, whole numbers
 * throughout.
 *
 * The walk steps `y` while the curve is steeper than a diagonal, and `x`
 * after. In the second half, a point on the column it last stood on is
 * passed over whenever the error term says to step both ways: for a circle
 * of radius four that leaves out (3, 3), which the textbook midpoint walk
 * draws.
 */
function generate(a: number, b: number): Point[] {
  const a2 = a * a;
  const b2 = b * b;
  const points: Point[] = [];
  let x = a;
  let y = 0;
  let tx = 2 * a * b2;
  let ty = 0;
  let p = a2 - a * b2 + (b2 >> 2);
  const d = b2 - a2;
  const k = d + (d >> 1);

  do {
    points.push([x, y]);

    if (p >= 0) {
      x--;
      tx -= 2 * b2;
      p -= tx;
    }

    y++;
    ty += 2 * a2;
    p += ty + a2;
  } while (ty < tx);

  if (x < 0) {
    return points;
  }

  p += Math.floor((k - ty - tx) / 2);

  do {
    if (!(p >= 0 && points[points.length - 1][0] === x)) {
      points.push([x, y]);

      if (p < 0) {
        y++;
        ty += 2 * a2;
        p += ty;
      }
    }

    x--;
    tx -= 2 * b2;
    p -= tx;
    p += b2;
  } while (x >= 0);

  return points;
}

/**
 * The first quarter of an ellipse of radii `rx` and `ry`, from `(0, ry)` to
 * `(rx, 0)`. The generator walks from the end of the longer axis, so a tall
 * ellipse is walked on its side and turned back (seg9 `08fa`, `113e`).
 */
export function quarter(rx: number, ry: number): Point[] {
  if (ry <= rx) {
    return generate(rx, ry).reverse();
  }

  return generate(ry, rx).map(([x, y]) => [y, x] as Point);
}

/**
 * The points of a rounded rectangle, in order around it; the corners are
 * the quarters of an ellipse `cornerWidth` by `cornerHeight` pixels, counted
 * inclusively, and an `Ellipse` is the rounded rectangle whose corner is the
 * whole shape. seg9 `0b7e`.
 *
 * The right and bottom edges are inside the shape: GDI takes one from each
 * before it starts. The corner's radius is half its size, rounded down, and
 * when the size is odd the right and bottom quarters stand a pixel further
 * out, as do they by the length of the straight sides between them. A
 * radius of nought on either axis makes the shape a rectangle (`0a97`).
 */
export function roundPoints(
  left: number,
  top: number,
  right: number,
  bottom: number,
  cornerWidth: number,
  cornerHeight: number
): Point[] {
  const rx = cornerWidth >> 1;
  const ry = cornerHeight >> 1;
  const cx = left + rx;
  const cy = top + ry;
  const px = right - left - 2 * rx;
  const py = bottom - top - 2 * ry;

  if (!rx || !ry) {
    return [
      [right, top],
      [right, bottom],
      [left, bottom],
      [left, top],
    ];
  }

  const q = quarter(rx, ry);
  const back = [...q].reverse();

  return [
    ...q.map(([x, y]) => [cx + px + x, cy - y] as Point),
    ...back.map(([x, y]) => [cx + px + x, cy + py + y] as Point),
    ...q.map(([x, y]) => [cx - x, cy + py + y] as Point),
    ...back.map(([x, y]) => [cx - x, cy - y] as Point),
  ];
}

/** What a shape covers: the pen's pixels, and the brush's rows `[y, left, right)`. */
export interface Shape {
  pen: Point[];
  brush: [number, number, number][];
}

/**
 * The points' edges as `LineTo` draws them, each without its last pixel.
 * Neighbouring points are a pixel apart, or along a straight side, so every
 * edge is level, upright or diagonal and its pixels are plain.
 */
function edges(points: Point[]): Point[] {
  const pixels = new Map<string, Point>();

  points.forEach(([x, y], index) => {
    const [nx, ny] = points[(index + 1) % points.length];
    const sx = Math.sign(nx - x);
    const sy = Math.sign(ny - y);

    while (x !== nx || y !== ny) {
      pixels.set(`${x},${y}`, [x, y]);
      x += x === nx ? 0 : sx;
      y += y === ny ? 0 : sy;
    }
  });

  return [...pixels.values()];
}

/**
 * A rounded rectangle, or with `corner` null an ellipse, drawn by a pen
 * `penWidth` by `penHeight` device pixels (nought for no pen) and a brush or
 * none. `right` and `bottom` are outside the shape, as `Ellipse` takes them;
 * `corner` is the device size `RoundRect` was given.
 */
export function shapeOf(
  left: number,
  top: number,
  right: number,
  bottom: number,
  corner: [number, number] | null,
  penWidth: number,
  penHeight: number,
  brush: boolean
): Shape {
  const r = right - 1;
  const b = bottom - 1;

  if (r < left || b < top) {
    return { pen: [], brush: [] };
  }

  /* No larger than the shape: seg9 `0405`. */
  const cw = corner ? Math.min(Math.abs(corner[0]), r - left) : r - left;
  const ch = corner ? Math.min(Math.abs(corner[1]), b - top) : b - top;

  if (penWidth <= 1) {
    const points = roundPoints(left, top, r, b, cw, ch);

    return {
      pen: penWidth ? edges(points) : [],
      brush: brush ? polygonSpans(points) : [],
    };
  }

  /* The inner shape is the rectangle less the pen's larger half before and
   * its smaller half after, the outer that grown by the whole pen, and a
   * rounded corner shrinks and grows with them (seg21 `151d`, `178d`). */
  const il = left + ((penWidth + 1) >> 1);
  const it = top + ((penHeight + 1) >> 1);
  const ir = r - (penWidth >> 1);
  const ib = b - (penHeight >> 1);
  /* A corner of nought is `Rectangle`'s own body (seg25 `0056`), whose ring
   * is square: it does not grow with the pen (`widepoly`). */
  const square = !!corner && !cw && !ch;
  const grow = (by: number, dx: number, dy: number) =>
    corner ? (square ? ([0, 0] as const) : ([cw + by * dx, ch + by * dy] as const)) : null;
  const shape = (l: number, t: number, sr: number, sb: number, size: readonly number[] | null) =>
    roundPoints(l, t, sr, sb, size ? Math.max(size[0], 0) : sr - l, size ? Math.max(size[1], 0) : sb - t);

  const outer = polygonSpans(
    shape(il - penWidth, it - penHeight, ir + penWidth, ib + penHeight, grow(1, penWidth, penHeight))
  );

  /* Nothing inside: the ring is the whole shape (`1779`). */
  if (ir < il || ib < it) {
    return { pen: outer.flatMap(([y, from, to]) => span(y, from, to)), brush: [] };
  }

  const inner = polygonSpans(shape(il, it, ir, ib, grow(-1, penWidth, penHeight)));
  const inside = new Set<string>();

  for (const [y, from, to] of inner) {
    for (let x = from; x < to; x++) {
      inside.add(`${x},${y}`);
    }
  }

  return {
    pen: outer.flatMap(([y, from, to]) => span(y, from, to)).filter(([x, y]) => !inside.has(`${x},${y}`)),
    brush: brush ? inner : [],
  };
}

/** The pixels of a row from `from` up to `to`. */
function span(y: number, from: number, to: number): Point[] {
  return Array.from({ length: to - from }, (_, index) => [from + index, y] as Point);
}
