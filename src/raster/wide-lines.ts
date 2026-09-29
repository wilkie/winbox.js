'use strict';

/**
 * Lines drawn with a pen wider than a pixel, as Windows 3.1's GDI draws them
 * on a display that leaves them to it: the polyline swept by a polygon the
 * pen's size, filled with `WINDING` in the pen's colour. **Read out of
 * `GDI.EXE`** seg21, `Polyline`'s body (`0726`) and its wide path (`10cd`),
 * and **recorded** by `widelin`: twenty lines and polylines, 2 to 8 pixels
 * wide, level, upright, slanted, a point, and with joins -- every pixel
 * agrees.
 *
 * * The pen (`0f90`) is sixteen points, clockwise on the screen from the
 *   left. Up to 5 wide it is a square, from less half the width, rounded
 *   away from nought, to the rest of it; wider, a sixteen-sided figure of
 *   GDI's own table scaled to the width by `MulDiv`, its left and top made
 *   exactly a width from its right and bottom.
 * * Each segment's direction is one of sixteen, by the signs of its steps,
 *   which is the longer, and whether the shorter is more than half of it
 *   (`0cb6`, `0d48`). At each point, the pen's points from the way in to the
 *   way out go on one side of the outline, and the point opposite each on
 *   the other; at the ends the way is turned round, so the pen's half
 *   facing out of the line caps it.
 * * The two sides, the second turned back, are one polygon.
 *
 * Every outline this makes was checked against GDI's own code, run on this
 * emulator's processor, for each of `widelin`'s cases.
 */

type Point = [number, number];

/** GDI's sixteen-sided pen, on a radius of 10000 (`GDI.EXE` data segment `0484`). */
const ROUND: Point[] = [
  [-9808, -1951],
  [-8317, -5556],
  [-5556, -8317],
  [-1951, -9808],
  [1951, -9808],
  [5556, -8317],
  [8317, -5556],
  [9808, -1951],
  [9808, 1951],
  [8317, 5556],
  [5556, 8317],
  [1951, 9808],
  [-1951, 9808],
  [-5556, 8317],
  [-8317, 5556],
  [-9808, 1951],
];

/** `MulDiv` as GDI has it (seg1 `41b0`): the product over the divisor, to the nearest, a half away from nought. */
function mulDiv(a: number, b: number, c: number) {
  const negative = (a < 0 !== b < 0) !== c < 0;
  const value = Math.floor((Math.abs(a) * Math.abs(b) + (Math.abs(c) >> 1)) / Math.abs(c));

  if (value > 0x7fff) {
    return negative ? -0x7fff : 0x7fff;
  }

  return negative ? -value : value;
}

/** The pen as sixteen points, for a pen `width` by `height` device pixels (seg21 `0f90`). */
export function penPoints(width: number, height: number): Point[] {
  const w = Math.max(width, 1);
  const h = Math.max(height, 1);

  if (w > 5) {
    const pen = ROUND.map(([x, y]) => [mulDiv(x, w, 20000), mulDiv(y, h, 20000)] as Point);

    pen[0][0] = pen[15][0] = pen[7][0] - w;
    pen[3][1] = pen[4][1] = pen[12][1] - h;

    return pen;
  }

  const right = mulDiv(10000, w, 20000);
  const bottom = mulDiv(10000, h, 20000);
  const left = right - w;
  const top = bottom - h;

  return [
    ...Array.from({ length: 4 }, () => [left, top] as Point),
    ...Array.from({ length: 4 }, () => [right, top] as Point),
    ...Array.from({ length: 4 }, () => [right, bottom] as Point),
    ...Array.from({ length: 4 }, () => [left, bottom] as Point),
  ];
}

/** Which of sixteen ways a step goes (seg21 `0d48`). */
function way(dx: number, dy: number) {
  let sector = 7;
  let across = dx;
  let down = dy;

  if (across < 0) {
    sector ^= 0xf;
    across = -across;
  }

  if (down < 0) {
    sector ^= 7;
    down = -down;
  }

  if (down < across) {
    sector ^= 3;
    [down, across] = [across, down];
  }

  if (down >> 1 < across) {
    sector ^= 1;
  }

  return sector;
}

/** The outline of a polyline drawn with the pen, as one polygon (seg21 `0cb6`). */
export function wideOutline(points: Point[], pen: Point[]): Point[] {
  const front: Point[] = [];
  const back: Point[] = [];
  let into = -1;

  for (let index = 0; index < points.length; index++) {
    const [x, y] = points[index];
    const at = (k: number) => [x + pen[k & 0xf][0], y + pen[k & 0xf][1]] as Point;
    let from = into;
    let out: number;

    if (index === points.length - 1) {
      out = (from + 8) & 0xf;
    } else {
      const [nx, ny] = points[index + 1];

      out = way(nx - x, ny - y);

      if (from < 0) {
        from = (out + 8) & 0xf;
      }
    }

    const turn = (out - from + 16) & 0xf;

    if (turn <= 8) {
      for (let k = 0; k <= turn; k++) {
        front.push(at(from + k));
      }

      back.push(at(from + 8));

      if (from !== out) {
        back.push(at(out + 8));
      }
    } else {
      front.push(at(from), at(out));

      for (let k = 0; k <= 16 - turn; k++) {
        back.push(at(from + 8 - k));
      }
    }

    into = out;
  }

  /* The sides as one, the last point off, as GDI answers it (`0ce3`). */
  return [...front, ...back.reverse()].slice(0, -1);
}
