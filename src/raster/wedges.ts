'use strict';

import { quarter } from './curves.js';

/**
 * `Arc`, `Chord` and `Pie`, as Windows 3.1's GDI makes them: the ellipse's
 * points cut at the two radials. **Read out of `GDI.EXE`** seg9, where the
 * three share `Ellipse`'s body (`02c4`) and its builder (`0b7e`), and
 * **recorded** by `wedges`.
 *
 * * The ellipse is a list of the points where its outline turns (`08fa`):
 *   from the right on the centre's row, round the top, the left and the
 *   bottom -- anticlockwise on the screen -- a quarter at a time, each
 *   quarter the walk `quarter` is. A quarter's straight runs are one edge,
 *   and a point two quarters share is there once.
 * * Each radial, from the centre through the point it is given, is found
 *   among the edges (`082b`): the first point anticlockwise of it, by a
 *   coarse step of an eighth of the list rounded to a power of two, then by
 *   halving. Anticlockwise is the sign of a cross product (`0750`).
 * * The edge before the start's point is walked a pixel at a time until it
 *   crosses the ray, and the edge after the end's point back until it has
 *   not; of the two pixels either side, the one past is kept unless the
 *   other is nearer the radial's point (`0794`).
 * * Radials that cross the same edge take two points of their own there, and
 *   the arc between them is the short way when the start is clockwise of
 *   the end, and the long way round the ellipse when it is not -- so a start
 *   and end the same is the whole ellipse.
 * * The list is turned to start at the start, and kept to the end; `Pie`
 *   ends with the centre. `Arc` draws the points as a polyline; `Chord` and
 *   `Pie` fill them and draw them closed, as `Polygon` does.
 *
 * Every point list this makes was checked against GDI's own code, run on
 * this emulator's processor, over every ellipse from 1 to 40 by 1 to 40.
 */

type Point = [number, number];

/**
 * The ellipse whose rectangle, right and bottom inside it, is `left` to
 * `right` and `top` to `bottom`, as the points where its outline turns, in
 * GDI's order (seg9 `08fa`, `0a97`). Empty for nothing to draw.
 */
export function ellipseVertices(left: number, top: number, right: number, bottom: number): Point[] {
  const cx = (left + right) >> 1;
  const cy = (top + bottom) >> 1;
  const ox = (left + right) & 1;
  const oy = (top + bottom) & 1;
  const rx = cx - Math.min(left, right);
  const ry = cy - Math.min(top, bottom);

  /* A radius of nought: the rectangle, or with no width or height, nothing. */
  if (!rx || !ry) {
    if (!(ox + rx) || !(ry + oy)) {
      return [];
    }

    return [
      [cx + ox + rx, cy - ry],
      [cx - rx, cy - ry],
      [cx - rx, cy + oy + ry],
      [cx + ox + rx, cy + oy + ry],
    ];
  }

  const q = quarter(rx, ry);
  const back = [...q].reverse();
  return joined([
    back.map(([x, y]) => [cx + ox + x, cy - y]),
    q.map(([x, y]) => [cx - x, cy - y]),
    back.map(([x, y]) => [cx - x, cy + oy + y]),
    q.map(([x, y]) => [cx + ox + x, cy + oy + y]),
  ]);
}

/**
 * A rounded rectangle, `right` and `bottom` inside it, as the points where
 * its outline turns in GDI's order: its corner's quarters, `cornerWidth` by
 * `cornerHeight`, pulled apart by the straight sides between them, as
 * `ellipseVertices` gives an ellipse's -- which is the rounded rectangle
 * whose corner is the whole of it. `inframe`'s rounded frames.
 */
export function roundVertices(
  left: number,
  top: number,
  right: number,
  bottom: number,
  cornerWidth: number,
  cornerHeight: number
): Point[] {
  const rx = cornerWidth >> 1;
  const ry = cornerHeight >> 1;

  if (!rx || !ry) {
    return [
      [right, top],
      [left, top],
      [left, bottom],
      [right, bottom],
    ];
  }

  const cx = left + rx;
  const cy = top + ry;
  const px = right - left - 2 * rx;
  const py = bottom - top - 2 * ry;
  const q = quarter(rx, ry);
  const back = [...q].reverse();

  return joined([
    back.map(([x, y]) => [cx + px + x, cy - y]),
    q.map(([x, y]) => [cx - x, cy - y]),
    back.map(([x, y]) => [cx - x, cy + py + y]),
    q.map(([x, y]) => [cx + px + x, cy + py + y]),
  ]);
}

/** Quarters' turning points joined into one list, none twice in a row. */
function joined(quarters: Point[][]): Point[] {
  const turns = (points: Point[]) =>
    points.filter((point, at) => {
      if (at === 0 || at === points.length - 1) {
        return true;
      }

      const [ax, ay] = points[at - 1];
      const [bx, by] = points[at + 1];

      return point[0] - ax !== bx - point[0] || point[1] - ay !== by - point[1];
    });
  const all: Point[] = [];

  for (const one of quarters) {
    for (const point of turns(one)) {
      const last = all[all.length - 1];

      if (!last || last[0] !== point[0] || last[1] !== point[1]) {
        all.push(point);
      }
    }
  }

  const [first, final] = [all[0], all[all.length - 1]];

  if (all.length > 1 && first[0] === final[0] && first[1] === final[1]) {
    all.pop();
  }

  return all;
}

const sign = (value: number) => (value > 0 ? 1 : value < 0 ? -1 : 0);

/**
 * The points of an arc, chord or pie (seg9 `0b7e` from `0c13`): the
 * rectangle as `ellipseVertices` takes it, the radials' points `x3, y3` and
 * `x4, y4`, and `whole` for a start and end that are one point in device
 * terms but not in logical ones, anticlockwise of each other (`0360`).
 * Empty for nothing to draw.
 */
export function wedgePoints(
  kind: 'arc' | 'chord' | 'pie',
  left: number,
  top: number,
  right: number,
  bottom: number,
  x3: number,
  y3: number,
  x4: number,
  y4: number,
  whole = false
): Point[] {
  const p = ellipseVertices(left, top, right, bottom).map(([x, y]) => [x, y] as Point);
  const cx = (left + right) >> 1;
  const cy = (top + bottom) >> 1;

  if (!p.length || cx === left || cy === top) {
    return [];
  }

  /* The ray now asked about, its direction with y upwards. */
  let dx = 0;
  let dy = 0;

  /** Whether a point is anticlockwise of the ray (`0750`). */
  const past = (index: number) => {
    const [x, y] = p[index];

    return (cy - y) * dx - (x - cx) * dy > 0;
  };

  /** The first point anticlockwise of the ray, or -1 (`082b`). */
  const find = () => {
    const count = p.length;
    let step = 1;

    while (count > step) {
      step <<= 1;
    }

    step >>= 3;
    step ||= 1;

    let si = 0;
    let before = past(0);
    let di: number;

    for (;;) {
      di = step + si >= count ? step - count + si : step + si;

      const now = past(di);

      if (!before && now) {
        break;
      }

      if (si >= di) {
        return -1;
      }

      before = now;
      si = di;
    }

    let half = step >> 1;

    if (!half) {
      return di;
    }

    while (half > 0) {
      if (past(si)) {
        si -= half;
        si += si < 0 ? count : 0;
      } else {
        si += half;
        si -= si >= count ? count : 0;
      }

      half >>= 1;
    }

    if (past(si)) {
      return si;
    }

    return si + 1 >= count ? si + 1 - count : si + 1;
  };

  /** Whether `kept`, a pixel past the ray, is kept over `other`: unless `other` is nearer the radial's point (`0794`). */
  const keeps = (kept: Point, other: Point) => {
    const rx = cx + dx;
    const ry = cy - dy;

    return (rx - other[0]) ** 2 + (other[1] - ry) ** 2 >= (rx - kept[0]) ** 2 + (kept[1] - ry) ** 2;
  };

  const dx3 = x3 - cx;
  const dy3 = y3 - cy;
  const dx4 = x4 - cx;
  const dy4 = y4 - cy;

  [dx, dy] = [dx3, -dy3];
  let start = find();

  [dx, dy] = [dx4, -dy4];
  let end = find();

  if (start < 0 || end < 0) {
    return [];
  }

  let before = start - 1 < 0 ? p.length + start - 1 : start - 1;
  let short = false;

  /* Both radials on one edge: two points of their own there. */
  if (end === start || end === before) {
    p.splice(start, 0, [...p[start]] as Point, [...p[start]] as Point);

    if (end > start) {
      end += 2;
    }

    if (before > start) {
      before += 2;
    }

    p[start + 1] = [...p[before]] as Point;

    const turned = dx4 * dy3 - dx3 * dy4;

    if (whole || (end === start && turned > 0)) {
      end += 2;
      short = true;
    } else {
      start += 2;
      before = start - 1;
    }
  }

  /* The start: the edge into its point walked to the ray. */
  [dx, dy] = [dx3, -dy3];
  {
    const sx = sign(p[start][0] - p[before][0]);
    const sy = sign(p[start][1] - p[before][1]);

    while (!past(before)) {
      p[before] = [p[before][0] + sx, p[before][1] + sy];
    }

    const beyond = p[before];

    p[before] = [beyond[0] - sx, beyond[1] - sy];

    if (keeps(beyond, p[before])) {
      p[before] = beyond;
    }
  }

  /* The end: the edge out of the point before it walked back to the ray. */
  [dx, dy] = [dx4, -dy4];
  {
    const previous = end - 1 < 0 ? end + p.length - 1 : end - 1;
    const sx = sign(p[end][0] - p[previous][0]);
    const sy = sign(p[end][1] - p[previous][1]);

    while (past(end)) {
      p[end] = [p[end][0] - sx, p[end][1] - sy];
    }

    const within = p[end];

    p[end] = [within[0] + sx, within[1] + sy];

    if (keeps(within, p[end])) {
      p[end] = within;
    }
  }

  const from = before;
  let to = end;
  let points: Point[];

  /* The short way on one edge: its two points alone (`0edc`). */
  if (short) {
    points = [p[from], p[to]];
    to = 1;
  } else if (to < from) {
    points = [...p.slice(from), ...p.slice(0, from)];
    to += p.length - from;
  } else {
    points = p.slice(from);
    to -= from;
  }

  points = points.slice(0, to + 1);

  if (kind === 'pie') {
    points.push([cx, cy]);
  }

  return points;
}
