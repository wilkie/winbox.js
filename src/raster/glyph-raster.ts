'use strict';

import { Endpoints, calcLine, empty, evaluateSpline } from './scan-walk.js';

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
 * The same, along a vertical line: where a piece crosses `x`, exactly.
 */
function crossesDown(piece, x, into) {
  const [x0, y0] = piece.from;
  const [x2, y2] = piece.to;

  if (!piece.control) {
    if (x0 === x2) {
      return;
    }

    if (!keeps(x, Math.min(x0, x2), Math.max(x0, x2))) {
      return;
    }

    const t = (x - x0) / (x2 - x0);

    into.push({ y: y0 + t * (y2 - y0), winding: x2 > x0 ? 1 : -1 });

    return;
  }

  const [x1, y1] = piece.control;

  const a = x0 - 2 * x1 + x2;
  const b = 2 * (x1 - x0);
  const c = x0 - x;

  const roots: number[] = [];

  if (a === 0) {
    if (b !== 0) {
      roots.push(-c / b);
    }
  } else {
    const under = b * b - 4 * a * c;

    if (under < 0) {
      return;
    }

    const root = Math.sqrt(under);

    roots.push((-b + root) / (2 * a), (-b - root) / (2 * a));
  }

  // The same turning point and the same half-open test, along the other axis.
  const turn = a === 0 ? null : -b / (2 * a);
  const at = (t) => (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * x1 + t * t * x2;
  const splits = turn !== null && turn > 0 && turn < 1;

  for (const t of roots) {
    if (t < 0 || t > 1) {
      continue;
    }

    const lo = splits && t > turn ? turn : 0;
    const hi = splits && t > turn ? 1 : splits ? turn : 1;

    if (!keeps(x, Math.min(at(lo), at(hi)), Math.max(at(lo), at(hi)))) {
      continue;
    }

    const slope = 2 * a * t + b;

    if (slope === 0) {
      continue;
    }

    const u = 1 - t;

    into.push({ y: u * u * y0 + 2 * u * t * y1 + t * t * y2, winding: slope > 0 ? 1 : -1 });
  }
}

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
 * Splits a contour into the pieces it is actually made of.
 *
 * The same walk `flatten` does, stopping one step earlier: where that turns
 * each quadratic into a run of line segments, this hands the quadratic back
 * whole, so a scanline can be intersected with it exactly.
 *
 * @param {Array} contour - Points, each `{x, y, on}`.
 * @returns {Array} Pieces, each `{from, to}` and a `control` if it curves.
 */
export function segmentsOf(contour, between: any = null) {
  if (contour.length === 0) {
    return [];
  }

  const points = contour.slice();

  if (!points[0].on) {
    const last = points[points.length - 1];

    points.unshift(
      last.on ? last : { x: (points[0].x + last.x) / 2, y: (points[0].y + last.y) / 2, on: true }
    );
  }

  const pieces: any[] = [];

  let at = [points[0].x, points[0].y];
  let control: any = null;

  const line = (to) => {
    pieces.push({ from: at, to });
    at = to;
  };

  const curve = (via, to) => {
    pieces.push({ from: at, control: [via.x, via.y], to });
    at = to;
  };

  for (let index = 1; index <= points.length; index++) {
    const point = points[index % points.length];

    if (point.on) {
      if (control) {
        curve(control, [point.x, point.y]);
        control = null;
      } else {
        line([point.x, point.y]);
      }

      continue;
    }

    if (control) {
      // Two controls in a row: the point between them is on the curve.
      curve(
        control,
        between ? between(control, point) : [(control.x + point.x) / 2, (control.y + point.y) / 2]
      );
    }

    control = point;
  }

  if (control) {
    curve(control, [points[0].x, points[0].y]);
  }

  return pieces;
}

/**
 * Where one piece of a contour crosses a horizontal line, exactly.
 *
 * A straight piece crosses at most once and the intersection is a division. A
 * quadratic crosses at most twice, at the roots of
 *
 *     (y0 - 2y1 + y2) t^2 + 2(y1 - y0) t + (y0 - Y) = 0
 *
 * which is the Bezier written out and set equal to the scanline. Each root
 * inside the piece gives an `x` and a direction, and the direction is the sign
 * of the tangent there rather than of the piece as a whole -- a curve that
 * turns over between its ends crosses the same line twice in opposite senses,
 * and counting it once either way is how an approximation loses a shape.
 *
 * The interval is half open, so a crossing exactly on a point two pieces share
 * belongs to one of them and not to both -- and **which one is decided by the
 * coordinate, not by the direction of travel.** The piece whose *higher* end
 * sits on the line gives it up; the piece whose lower end does keeps it.
 *
 * Directing it by travel instead is the obvious way to write it and is wrong
 * where it matters most. Take a vertex that is a local maximum sitting exactly
 * on the line -- the peak in the middle of a `w`, which grid-fitting puts
 * exactly there rather often. The arc arriving reaches the line at its far end
 * and is excluded; the arc leaving starts at the line and is kept. One crossing
 * where there should be nought or two, and the winding is inverted for the
 * whole rest of the scanline: every pixel from the peak to the right edge of
 * the glyph comes out the wrong colour. Arial's `w` at seventeen pixels per em
 * is exactly this, and so is its `N` at eleven.
 */
function keeps(y, low, high) {
  return y >= low && y < high;
}

function crossesAt(piece, y, into) {
  const [x0, y0] = piece.from;
  const [x2, y2] = piece.to;

  if (!piece.control) {
    if (y0 === y2) {
      return;
    }

    if (!keeps(y, Math.min(y0, y2), Math.max(y0, y2))) {
      return;
    }

    const t = (y - y0) / (y2 - y0);

    into.push({ x: x0 + t * (x2 - x0), winding: y2 > y0 ? 1 : -1 });

    return;
  }

  const [x1, y1] = piece.control;

  const a = y0 - 2 * y1 + y2;
  const b = 2 * (y1 - y0);
  const c = y0 - y;

  const roots: number[] = [];

  if (a === 0) {
    if (b !== 0) {
      roots.push(-c / b);
    }
  } else {
    const under = b * b - 4 * a * c;

    if (under < 0) {
      return;
    }

    const root = Math.sqrt(under);

    roots.push((-b + root) / (2 * a), (-b - root) / (2 * a));
  }

  /* Where the curve turns over in y, if it does inside the piece. Each root
   * belongs to whichever side of that it falls on, and the half-open test is
   * made against the ends of *that* arc rather than of the whole piece -- a
   * quadratic that turns over has two arcs and two chances to share a vertex.
   */
  const turn = a === 0 ? null : -b / (2 * a);
  const at = (t) => (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * y1 + t * t * y2;
  const splits = turn !== null && turn > 0 && turn < 1;

  for (const t of roots) {
    if (t < 0 || t > 1) {
      continue;
    }

    const lo = splits && t > turn ? turn : 0;
    const hi = splits && t > turn ? 1 : splits ? turn : 1;

    if (!keeps(y, Math.min(at(lo), at(hi)), Math.max(at(lo), at(hi)))) {
      continue;
    }

    // The tangent in y, which says which way the curve goes through the line.
    const slope = 2 * a * t + b;

    if (slope === 0) {
      continue;
    }

    const u = 1 - t;

    into.push({ x: u * u * x0 + 2 * u * t * x1 + t * t * x2, winding: slope > 0 ? 1 : -1 });
  }
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
/**
 * The same glyph, filled from the scan converter's own edge walk.
 *
 * `fill` computes where the outline crosses each scanline and rounds that to a
 * pixel. This walks each edge instead, the way `CalcLine` and `CalcSpline` do,
 * and takes the pixels the walk lands on. For a straight edge the two agree
 * except at ties; for a curve they do not, and a curve-bounded run end is
 * twenty times likelier to be wrong under the first method than a line-bounded
 * one.
 *
 * The walk works in sixty-fourths with y pointing up, so device coordinates are
 * negated going in and the emitted scan rows come back as `-row - 1`.
 */
export function fillWalked(contours, options) {
  const {
    scale,
    originX = 0,
    originY = 0,
    width,
    height,
    dropout = false,
    stubs = true,
    lean = 0,
    ppem = 0,
    across = 0,
  } = options;

  const pixels = new Uint8Array(width * height);
  /* Halves go away from zero, not upward.
   *
   * `Math.round` sends a half toward positive infinity, so it and the
   * interpreter's `mulDiv` -- which takes the sign off, rounds, and puts it
   * back -- part company on negative coordinates landing exactly between two
   * sixty-fourths. A glyph that has been hinted arrives already on the grid and
   * never notices; one scaled here does.
   */
  /* A half goes upward, not outward.
   *
   * A hinted glyph arrives on the grid already and the only fractions reaching
   * here are the points implied between two consecutive controls, which are
   * exact halves of a sixty-fourth. Rounding those away from zero makes which
   * way a half goes depend on which side of the baseline it falls, since `place`
   * negates y afterwards -- a tail below the baseline rounds one way and the
   * same shape above it rounds the other. One direction throughout is what
   * agrees: Times New Roman's `y` at twelve pixels, whose tail is built from
   * three pairs of consecutive controls, is drawn a pixel wide at its foot the
   * other way and exactly right this way. **Measured** across every recording:
   * 845 of 846 recorded glyphs against 844, `font`, `hinting` and `text`
   * unmoved at 100 per cent, and the fabricated set unchanged to the pixel.
   */
  const sixtyFourth = (value: number) => Math.round(value * scale * 64);

  const place = (point) => [
    originX + sixtyFourth(point[0]) / 64,
    originY - sixtyFourth(point[1]) / 64,
  ];

  /* Where two off-curve points meet, and which coordinates that midpoint is of.
   *
   * A pair of consecutive controls implies an on-curve point between them, and
   * a font is written expecting one. The question is what it is the midpoint
   * *of*: the design coordinates, or the scaled ones the scaler is working in.
   * It is the second, and it is halved the way every other halving in the walk
   * is halved -- `(a + b + 1) >> 1`, the same form `EvaluateSpline` uses for the
   * control it makes when it subdivides.
   *
   * **Recorded, and it is the last two cells of the glyph corpus.** Halving the
   * design coordinates and scaling afterwards puts Symbol's slanted `t` at
   * thirty-two pixels a column wide at two rows; halving the scaled ones puts it
   * exactly where Windows draws it. The difference is half a sixty-fourth on one
   * point, and it reaches the picture because it moves the second difference of
   * the piece that point belongs to -- which is what decides how finely the walk
   * flattens it. Truncating the halving instead of rounding it up costs 121
   * records, so the `+ 1` is measured and not inherited.
   *
   *     design coordinates, exact half   6,044 of 6,046
   *     scaled coordinates, truncated    5,925
   *     scaled coordinates, half up      **6,046**
   *
   * The fabricated corpus does not move: 26,055 cells and 9 wrong pixels either
   * way.
   */
  const between = (one, two) => {
    const half = (at: number, to: number) =>
      ((Math.round(at * scale * 64) + Math.round(to * scale * 64) + 1) >> 1) / (scale * 64);

    return [half(one.x, two.x), half(one.y, two.y)];
  };

  const lists = empty();
  const sub = (value) => Math.round(value * 64);

  const ends = new Endpoints(lists);

  for (const contour of contours) {
    const made = segmentsOf(contour, between);

    if (!made.length) {
      continue;
    }

    const first = place(made[0].from);

    ends.begin(sub(first[0]), -sub(first[1]));

    for (const piece of made) {
      const from = place(piece.from);
      const to = place(piece.to);

      if (piece.control) {
        const control = place(piece.control);

        /* Cut the turns out before walking, which is what `EvaluateSpline`
         * exists for: the walk takes a spline's extent from its two ends, so a
         * quadratic that goes out and comes back looks to it like one spanning
         * nothing at all. The endpoint check goes with each piece rather than
         * with the segment, since each is a spline as far as the walk is
         * concerned. See `scan-walk.ts`.
         */
        evaluateSpline(
          lists,
          ends,
          sub(from[0]),
          -sub(from[1]),
          sub(control[0]),
          -sub(control[1]),
          sub(to[0]),
          -sub(to[1]),
          dropout
        );

        continue;
      }

      calcLine(lists, sub(from[0]), -sub(from[1]), sub(to[0]), -sub(to[1]), dropout);

      ends.check(sub(to[0]), -sub(to[1]), dropout);
    }

    ends.end();
  }

  const sorted = (list) => {
    for (const entries of list.values()) {
      entries.sort((one, two) => one - two);
    }

    return list;
  };

  sorted(lists.horizOn);
  sorted(lists.horizOff);
  sorted(lists.vertOn);
  sorted(lists.vertOff);

  /* A column whose block is full loses its last `on` entry.
   *
   * The two lists of a column share one block. `seg42:0978` reads the `on`
   * count from the block's first word and the `off` count from its last, and
   * the `off` entries are scanned downward from there, so the `on` list fills
   * upward from the low end and the `off` list downward from the high one and
   * the two meet in the middle. `seg42:0f2a` sizes that block: it walks the
   * glyph's own points contour by contour, starting each contour's direction
   * from its last point against its first, counts every change of direction in
   * `x`, and `seg42:1132` rounds the count up to an even number and floors it
   * at two. And neither `AddVertSimpleScan` nor its horizontal twin checks a
   * bound -- both bump the end pointer, shift anything larger up, and store --
   * so an entry past the end of a region genuinely lands in the next one.
   *
   * What is **not** read is why a vertex on a sample line and a sample column
   * at once puts one entry more into its column than this does. That it does is
   * measured, and measured on everything: with the charge the fabricated corpus
   * is 32,394 of 32,394 cells with no wrong pixel and the recorded one is exact
   * but for the maximum width metric, and without it eight fabricated cells and
   * Courier New's `o` under a width come out differently. The condition it
   * carries is the sign of the cross product at the vertex, which is what
   * `seg42:1342` classifies the turn by, and the collision only happens where
   * that is not set. See `FONTS.md` section 8a.
   */
  if (lists.crowded?.size) {
    let turns = 0;

    for (const contour of contours) {
      if (contour.length < 2) {
        continue;
      }

      const at = (index) => place([contour[index].x, contour[index].y])[0];

      let rising = at(contour.length - 1) <= at(0);

      for (let index = 0; index < contour.length; index++) {
        const step = at(index) - at((index + contour.length - 1) % contour.length);

        if (step > 0 && !rising) {
          turns++;
          rising = true;
        } else if (step < 0 && rising) {
          turns++;
          rising = false;
        }
      }
    }

    const held = Math.max(2, turns + (turns & 1));

    for (const column of lists.crowded) {
      const on = lists.vertOn.get(column);
      const off = lists.vertOff.get(column);

      if (on && off && on.length + off.length >= held) {
        on.pop();
      }
    }
  }

  /* The runs, paired by index as `Blit` pairs them, and the box they are
   * written into.
   */
  const runs: any[] = [];

  for (const [walkRow, ons] of lists.horizOn) {
    const offs = lists.horizOff.get(walkRow) ?? [];
    const row = -walkRow - 1;

    for (let index = 0; index < ons.length && index < offs.length; index++) {
      runs.push({ row, on: ons[index], off: offs[index] });
    }
  }

  /* The box comes from the outline, not from the runs -- a glyph narrower than
   * the gap between two sample columns has no runs at all, every span of it
   * being a dropout, so there would be nothing to measure. See `fill`.
   */
  let leftmost = Infinity;
  let rightmost = -Infinity;
  let highest = Infinity;
  let lowest = -Infinity;

  /* A slanted glyph's box keeps its two roundings apart.
   *
   * The scaled coordinate is rounded to a sixty-fourth, the shear is rounded to
   * a sixty-fourth, and then the two are added. Folding them into one rounding
   * costs three of the 948 boxes read out of GDI's memory; keeping them apart
   * costs none. See `Surface.leanOf`.
   *
   * The points arriving here are already sheared, so the lean is taken back off
   * to recover the coordinate the first rounding applies to, and put back on
   * through the second.
   *
   * **The minimum is still over the points**, not over the corners of the
   * glyph's bounding box. Building it from `(xMin, yMin)` and `(xMax, yMax)`
   * instead is indistinguishable on every instrument here -- they are all
   * rectangles, where the leftmost point *is* the lowest point -- and it costs
   * five records of the real corpus, where they are not. So the corner reading
   * is the one thing about this box that was assumed rather than measured, and
   * the recorded glyphs refuse it.
   */

  for (const contour of contours) {
    for (const piece of segmentsOf(contour, between)) {
      for (const point of [piece.from, piece.to, piece.control]) {
        if (!point) {
          continue;
        }

        const at = place(point);

        /* When the glyph is being slanted the two roundings are kept apart, so
         * the x this box is built from is not the one `place` gives.
         *
         * And the un-shear rounds a half **down** where everything else here
         * rounds one up. That is not a second convention, it is the first one
         * being undone: the shear that put the point where it is rounded
         * `lean * y` to a sixty-fourth and a half went up, so subtracting the
         * unrounded `lean * y` back off lands exactly half a sixty-fourth above
         * the coordinate it started from. Rounding that down returns it.
         *
         * Symbol's slanted bar at eight pixels per em on an EGA is the case
         * that shows it, and all four of its corners: two have the shear term
         * on a half -- `round(-37.5)` -- and come back at 69.50 and 124.50
         * where the design says 69 and 124, and two do not and come back at
         * 68.75 and 123.75. A half downward returns all four; a half upward
         * returns the two that never left. The box's left edge is the one that
         * matters, because a dropout rescue is clamped into it, and half a
         * sixty-fourth there is a whole column: the rescue lands on three where
         * Windows puts it on two.
         *
         * **Measured.** `symbol-slant` on an EGA goes from 340 of 352 cells to
         * **352 with no wrong pixels**, the fabricated corpus stays at 32,394 of
         * 32,394, and the instruments drawn on a pixel that is not square go
         * from 2,654 of 2,668 to 2,666. Truncating instead of rounding the half
         * fixes the same twelve and costs four of the corpus, so it is the half
         * and not the direction of the whole.
         */
        const unsheared = (value: number) => Math.ceil(value * scale * 64 - 0.5);

        const across = lean
          ? originX +
            (unsheared(point[0] - lean * point[1]) + Math.round(lean * point[1] * scale * 64)) / 64
          : at[0];

        leftmost = Math.min(leftmost, across);
        rightmost = Math.max(rightmost, across);
        highest = Math.min(highest, at[1]);
        lowest = Math.max(lowest, at[1]);
      }
    }
  }

  const boxLeft = Math.ceil(leftmost - 0.5);
  const boxTop = Math.ceil(highest - 0.5);

  /* The box is allowed to collapse in y and is not allowed to in x.
   *
   * `fsc_SetupScan` rounds each edge onto the pixel grid independently and lets
   * the two land on the same index, which gives a band of no rows at all; and
   * `DoVertDropout` ends on `lYDrop >= lLoBitBand && lYDrop < lHiBitBand`, so a
   * glyph flatter than the gap between two scanlines has nowhere to put a
   * rescue and is drawn as nothing. That is the whole of what Windows does with
   * a bar half a pixel tall lying between two sample rows.
   *
   * `DoHorizDropout` has no such test -- it clamps into the box and writes --
   * so the x box keeps its minimum. Letting it collapse as well costs 5,368
   * pixels, and the asymmetry is the source's, not a guess.
   */
  const wanted = Math.floor(rightmost + 0.5);
  const boxRight = Math.max(boxLeft + 1, wanted);
  // The box would have collapsed in x, and only the minimum keeps it a column.
  const narrow = wanted <= boxLeft;
  const boxBottom = Math.floor(lowest + 0.5);

  const rescues: any[] = [];

  for (const run of runs) {
    if (run.on === run.off) {
      if (dropout) {
        rescues.push(run);
      }

      continue;
    }

    /* Either way round.
     *
     * `Blit` fills from `xStart` to `xStop` when the first is the smaller and
     * from `xStop` to `xStart` when it is not, so a pair whose `on` lies to the
     * right of its `off` is still a run. Filling only the first way leaves that
     * ink undrawn, and it is not caught as a dropout either, since that is the
     * case where the two are equal.
     */
    const from = Math.min(run.on, run.off);
    const to = Math.max(run.on, run.off);

    for (let column = from; column < to; column++) {
      if (column >= 0 && column < width && run.row >= 0 && run.row < height) {
        pixels[run.row * width + column] = 1;
      }
    }
  }

  /* How much of the outline continues past a dropout candidate, which is what
   * the stub test weighs.
   *
   * A **presence** test, not a tally: at most one from the `on` list and one
   * from the `off` list, so the answer is nought, one or two and never more.
   * **Read** out of the routine at `seg42:0db4`, which the whole stub test
   * goes through: it walks the `on` list to the first entry at or past the
   * target and, on a hit, *assigns* one -- `mov word [bp-0x4],0x1`, a flag,
   * where a tally would increment -- then walks the `off` list backwards the
   * same way and adds one. The pseudocode's `HorizCrossings` counts every
   * occurrence instead. The two part only where one list holds the same
   * coordinate twice, which nothing recorded does: adopting this changes no
   * cell of the recorded corpus and none of the 24,696 fabricated ones. It is
   * here because it is what the binary does, not because anything measured it.
   */
  const countHoriz = (x, row) =>
    ((lists.horizOn.get(-row - 1) ?? []).some((at) => at === x) ? 1 : 0) +
    ((lists.horizOff.get(-row - 1) ?? []).some((at) => at === x) ? 1 : 0);
  /* A vertical entry is recorded as `y + yOffset`, which already carries the
   * step the horizontal entries take from their key, so it converts back as
   * `-value` where a horizontal row converts as `-key - 1`. Checked against a
   * solve of every piece in the fixture: 99.9% agree this way and 43.5% the
   * other, the difference being a systematic row.
   */
  const countVert = (x, row) =>
    ((lists.vertOn.get(x) ?? []).some((at) => -at === row) ? 1 : 0) +
    ((lists.vertOff.get(x) ?? []).some((at) => -at === row) ? 1 : 0);

  /* `FindDropouts` goes down the rows from the top of the band, and each
   * rescue asks whether its neighbours are already lit, so a rescue made on one
   * row is visible to the next. The order is part of the answer. Here the runs
   * come out in whatever order the walk first touched a row.
   */
  rescues.sort((one, two) => one.row - two.row);

  for (const rescue of rescues) {
    const on = rescue.on;

    const continues = (step) => {
      const at = step < 0 ? rescue.row : rescue.row + 1;

      return countHoriz(on, rescue.row + step) + countVert(on - 1, at) + countVert(on, at) >= 2;
    };

    /* A glyph narrower than the gap between two sample columns is not asked
     * whether anything continues from it.
     *
     * The stub check suppresses a short protrusion off a main stroke, and it
     * does that by requiring a crossing on both sides of the row being rescued.
     * At the first and last row of an isolated run there is nothing on one
     * side, so it declines -- which is right for a stub and wrong for a glyph
     * that is nothing but the run.
     *
     * **Recorded**, by `cour-stubs`, which is the same sub-pixel post four times
     * over with an arm at the top, at the bottom, at both, and at neither. The
     * four answers are exhaustive and they disagree:
     *
     *     stub check   neither   top arm   foot arm   both
     *     applied       36 bad     0 bad     0 bad    0 bad
     *     skipped        0 bad    35 bad    35 bad    0 bad
     *
     * So the check is needed wherever an arm gives it something to find and
     * must not run where nothing can. The two cases differ in the box and in
     * nothing else: the bare post is one column wide and the armed ones are
     * four, and the bare post's box is a column only because the minimum below
     * makes it one -- rounded honestly it collapses, exactly as the box in y
     * collapses for a bar lying between two scanlines.
     *
     * This one is measured rather than read. The gate in the shipped code at
     * segment 42 0x0a69 is the scan kind and not the box, and the counter's own
     * guards at 0x0e60 and 0x0e8a make the vertical terms nought outside the box
     * rather than skipping the decision. So the rule is right about every cell
     * recorded and its mechanism is not yet located; `FONTS.md` says so.
     *
     * **And the scan kind cannot be it.** Run through the interpreter, every
     * installed family answers `SCANTYPE` 1 at every size recorded -- Arial,
     * Courier New, Times New Roman, Symbol and Wingdings, upright, bold and
     * italic alike -- so a gate on the scan kind would either apply the check
     * everywhere or nowhere, and the recorded cells need both.
     *
     * **The counts are the source's, and they are right.** `HorizCrossings`
     * walks the on list and the off list together and counts a hit in either,
     * so a zero-length run on the next row is worth two on its own and the edge
     * of a wide one is worth one. Instrumented on `cour-stubs` that is exactly
     * what comes out: an interior row of the post reads 2 above and 2 below, the
     * row where the arm joins reads 1 from the arm's own edge and 1 from a
     * vertical crossing, and a tip row reads 0. The vertical terms sit a row off
     * the horizontal one in both branches, and that offset cancels -- C's
     * "above" wants `VertCrossings(y + 1)` and gets it, C's "below" wants
     * `VertCrossings(y)` and gets it -- so the encoding shift the note above
     * describes is consistent rather than an error.
     *
     * **And the check itself is real.** Forced off, the armed post grows a foot
     * at row 14 that Windows does not draw. So `SK_STUBS` is set for Courier
     * New, and the source's own arithmetic then refuses the *bare* post's two
     * tips as well -- 36 pixels Windows does draw. `DoVertDropout` carries the
     * same check, so no second pass can be rescuing them either.
     *
     * That is a contradiction between the pseudocode and the recording rather
     * than a gap in this file: with one scan kind, one font and one stroke a
     * column wide, Windows draws the tips of a bare post and refuses the free
     * tip of an armed one, and nothing in `DoHorizDropout` tells the two apart.
     * Until the reason is found the box stands in for it.
     *
     * **The box is wrong about one thing, and it is the synthesised slant.**
     * Shearing a bar one column wide widens its *box* to four columns while
     * leaving every row of it one column, so the slant turns this check on and
     * the glyph loses its tip row: Symbol's twelve pixel bar inks rows 3 to 10
     * upright and rows 4 to 10 slanted, where Windows inks 3 to 10 both times.
     * Two ways of saying "nothing but the run" without the box were tried and
     * both cost more than they save, against 78,734 cells and 5,422 wrong
     * pixels for the box:
     *
     *     gate                              cells          wrong pixels
     *     every run zero-length             78,567           5,831
     *     no vertical crossings at all      78,622           5,758
     *
     * The second is the source's own quantity -- with no vertical crossings the
     * two `VertCrossings` terms can only ever be nought, so the check reduces to
     * the horizontal term and no tip of such a glyph could ever be drawn -- and
     * it is still worse. So the box stays until the mechanism is found.
     *
     * It is also not most of the synthesised slant. Forced off, the stub check
     * is worth 28 of that instrument's 220 wrong pixels, and the rest is not a
     * missing crossing either: with it off, 108 of the 156 differing rows are a
     * rescue landing on a different row or column, and the sheared bar's top row
     * has exactly the two crossings the model predicts. See `FONTS.md`
     * section 3.
     */
    /* Above forty-eight pixels per em a run like this is simply not rescued.
     *
     * Not the font's `SCANCTRL`, which says a hundred and twenty-four for Times
     * New Roman and forty-four for Courier New and would put the two thresholds
     * eighty pixels apart; both stop here. **Recorded**: the `dropsize` sweep
     * draws the same quarter-pixel bar at every height from sixteen to seventy
     * and watches the ink stop between fifty-four and fifty-five, which is
     * forty-seven pixels per em and forty-eight.
     *
     * Everything else about the bar was swept first and ruled out: its width
     * and phase across six of each, its height from three device rows to a
     * hundred and eight, its position from the bottom of the box to the top, an
     * arm on it of six lengths at six heights, and four companions -- near,
     * far, on its own rows, and one as sub-pixel as itself. None of them moves
     * the answer, and two boxes of different heights cross at the same place,
     * so it is the size and not the glyph.
     *
     * The narrow case is exempt because it is not this path at all: a glyph
     * whose box collapses in `x` is drawn a run per column whatever the size,
     * which is what `times-bare-hairs` and `times-stacked` say -- 144 of 144
     * each at every size up to a hundred and twenty-three pixels per em.
     *
     * **It costs nothing and it is load-bearing.** With it the fabricated
     * corpus still disagrees about nothing at all, `glyphs` stays 6,046 on each
     * of four displays, `lines` 2,478 and `plotter` 1,584; without it the four
     * wide hairline recordings fall from 144 of 144 to 70, and `cour-hairs`
     * from 144 to 77.
     *
     * **And it is a square pixel's rule.** That was recorded afterwards, by
     * running the same sweep on an EGA, where the horizontal size is four
     * thirds of this one: nothing stops. Times keeps rescuing every one of the
     * twelve bars at every height to seventy, which is fifty-one pixels per em
     * down the page and sixty-eight across -- both well past forty-eight.
     *
     * So the cap is not a threshold on either size, and the three readings that
     * would make it one are refused by count on the two EGA recordings, 840
     * records:
     *
     *     this size, uncapped by the pixel   325 and 330
     *     the horizontal size                244 and 249
     *     capped only on a square pixel      420 and 415
     *
     * The five are `dropdown`'s largest height and are not this rule; see 8g.
     * What a stretch does to make the cap not apply is **not read** -- the
     * font's own `SCANCTRL` has bits for stretched text and Times New Roman
     * does not set them, so this is GDI's or the scaler's and not the font's.
     */
    if (!narrow && ppem >= 48 && across === ppem) {
      continue;
    }

    if (!narrow && stubs && (!continues(-1) || !continues(1))) {
      continue;
    }

    /* The neighbour is asked about before the run is moved left, and only when
     * the run is clear of the corresponding edge.
     *
     * `DoHorizDropout` guards each of its two `GetBit` calls -- `lXDrop >
     * lBoxLeft` for the one to the left and `lXDrop < lBoxRight` for the one to
     * the right -- and both read the *undecremented* coordinate. Asking after
     * the decrement and the clamp, and asking unguarded, are two different
     * mistakes: the first reads a different pixel when the rescue was clamped,
     * and the second lets a stroke lying along the right edge of the box block
     * the column beside it. The left-hand call reads the pixel this is about to
     * write, so it only ever saves the write.
     */
    if (on < boxRight && on >= 0 && on < width && pixels[rescue.row * width + on]) {
      continue;
    }

    /* Always to the left, which is what **simple** dropout control does.
     *
     * `DoHorizDropout` has two placements and picks between them on the scan
     * kind: `lXDrop--` for a simple dropout and, for a smart one, the average
     * of the two exact crossings, `(fxX1 + fxX2 - 1) >> (SUBSHFT + 1)`. Every
     * installed family answers `SCANTYPE` 1, which is the simple kind, so this
     * is the branch that runs.
     *
     * **The other branch has not been tested, and an attempt that said it had
     * is withdrawn.** It wants the two crossings unrounded, and this walk never
     * forms them: `calcLine` steps a Bresenham over pixels and emits indices
     * outright, which is exactly why the reference recomputes the crossings
     * through `pfnHCallBack` when it needs them. An attempt to keep them
     * alongside took them from `Endpoints`, the *other* emitter, whose lists
     * cover only the vertices that land on a sample line -- so the values it
     * averaged belonged to different crossings than the runs it placed, and the
     * counts it produced mean nothing.
     *
     * Testing it properly means evaluating the edge behind each entry at the
     * scanline, which is the callback the reference keeps a table of.
     */
    let column = on - 1;

    if (column < boxLeft) {
      column = boxLeft;
    }

    if (column >= boxRight) {
      column = boxRight - 1;
    }

    if (column >= 0 && column < width && rescue.row >= 0 && rescue.row < height) {
      pixels[rescue.row * width + column] = 1;
    }
  }

  /* And the same down each column, which `FindDropouts` does after the rows.
   * The vertical lists hold walk rows, so they come back as `-row - 1`, and
   * they are sorted ascending in the walk's frame -- which is bottom to top on
   * screen, so the pairing is done there and converted after.
   */
  /* The box travels out with the pixels, because emboldening needs it -- with
   * dropout control off as well as on. Returning before it was attached left
   * a glyph with no box above the size a face gives dropout up at, Arial's
   * seventeen, and the smear's bounds fell back to the whole surface: Arial's
   * `B` at a cell of twenty-four was smeared a column past its box, where
   * Windows stops. **Recorded** by `rotstyle`. */
  (pixels as any).box = { left: boxLeft, right: boxRight };

  if (!dropout) {
    return pixels;
  }

  for (const [column, ons] of lists.vertOn) {
    const offs = lists.vertOff.get(column) ?? [];

    /* Read in the order these entries are held, which the oracle settles.
     *
     * `FindDropouts` reads a column's entries in reverse, and each rescue
     * declines where a neighbour is already lit, so the direction decides which
     * of two rescues a row apart survives: read one way the first blocks the
     * second and one pixel is drawn, read the other and both are.
     *
     * **Recorded**, by a fabrication built to ask that and nothing else -- two
     * horizontal hairlines with the gap between them swept from four fifths of
     * a pixel to two and a quarter, so that some of the thirty-six land with
     * their rescues on neighbouring rows. Windows draws both rows, every time.
     * Reading these lists forward agrees with it on 199 of 216 cells and
     * backward on 176, and the recorded letters are 780 and 105 wrong pixels
     * against 778 and 109.
     *
     * The frame reasoning points the other way and is measurably wrong; every
     * combination of this, the neighbour tested and the row conversion has been
     * swept, and `FONTS.md` has the table.
     */
    for (let index = 0; index < ons.length && index < offs.length; index++) {
      if (ons[index] !== offs[index]) {
        continue;
      }

      const row = -ons[index];

      const continues = (step) => {
        const near = step < 0 ? column : column + 1;

        return (
          countVert(column + step, row) + countHoriz(near, row) + countHoriz(near, row - 1) >= 2
        );
      };

      /* And the same exemption the horizontal pass takes; see `stubs`.
       *
       * `DoVertDropout` carries stub control word for word as `DoHorizDropout`
       * does, so a glyph Windows is slanting is spared it in both passes or
       * neither. Sparing it in only one was worth nothing here and everything
       * on a dot: `dot-sweep` puts a single sub-pixel square in each glyph, and
       * where the slant leaves it straddling a column both passes find a
       * zero-length run -- the horizontal one across the row, the vertical one
       * down the next column -- and Windows draws both pixels. With this pass
       * still checking for stubs the second was refused and the dot came back
       * one pixel wide.
       */
      if (stubs && (!continues(-1) || !continues(1))) {
        continue;
      }

      /* A dropout outside the band is dropped, not brought inside it.
       *
       * `PerformVertDropout` returns before it does anything else when its row
       * is beyond `loBitBand` or `hiBitBand`, which without banding are the box
       * -- so a vertical run found outside it is not drawn at all. Clamping it
       * in instead paints a pixel Windows never paints, and worse, that pixel
       * then stops a later rescue in the same column, because a rescue declines
       * where a neighbour is already lit.
       */
      if (row < boxTop || row > boxBottom) {
        continue;
      }

      let at = row;

      if (at < boxTop) {
        at = boxTop;
      }

      if (at >= boxBottom) {
        at = boxBottom - 1;
      }

      /* The neighbour is only asked about when the rescue sits inside the box.
       *
       * `PerformVertDropout` guards each of its two `GetBit` calls on the row
       * being off the corresponding edge, so a rescue whose row falls outside
       * and is clamped in is placed without asking anything.
       */
      /* The neighbour is only asked about when the rescue sits inside the box.
       *
       * `PerformVertDropout` guards each of its two `GetBit` calls on the row
       * being clear of the corresponding edge -- `yDrop > boxBottom` for one and
       * `yDrop < boxTop` for the other -- so a rescue whose row falls outside
       * the box, and is then clamped back into it, is placed without asking
       * about anything. Asking anyway is how a stroke lying along the bottom of
       * the box came to block the row above it.
       *
       * **Recorded.** Two horizontal hairlines a row apart, swept through
       * thirty-six gaps and six sizes: Windows draws both rows every time, and
       * with the guard this draws all 264 cells of that recording exactly,
       * against 199 of 216 without it. It is also what settles the argument
       * about which end of a column is read first -- with the guard in place
       * the two directions agree there, because nothing is left to block.
       */
      if (row === at && at > 0 && pixels[(at - 1) * width + column]) {
        continue;
      }

      /* `DoVertDropout` places nothing when the clamped row falls outside the
       * band, and for a glyph whose rounded extent collapses onto a single
       * scanline the band is empty, so nothing is placed at all.
       */
      if (!(at >= boxTop && at < boxBottom)) {
        continue;
      }

      if (column >= 0 && column < width && at >= 0 && at < height) {
        pixels[at * width + column] = 1;
      }
    }
  }

  /* A glyph narrower than a sample column is drawn as one run per column.
   *
   * The same condition as the stub check above is exempted under, and for a
   * related reason: a shape that crosses no vertical sample line puts nothing in
   * the vertical lists, so a gap in it has no zero-length run to be rescued from
   * and no way to be filled by the ordinary machinery. Windows fills it anyway.
   *
   * **Recorded**, by `cour-gaps`: one sub-pixel bar cut into two pieces with the
   * gap between them swept from a quarter of a pixel to six, at three phases and
   * seven sizes. Two things make this more than the first rule that fits.
   *
   * The direction is unanimous. Over 258 cells there is not one where Windows
   * leaves a hole we fill -- every disagreement is ink Windows has and we lack,
   * before the rule and after it. A rule that fills too eagerly would show up
   * immediately as the opposite sign, and does not.
   *
   * And the discriminator is the phase, not the gap. At thirteen pixels per em
   * Windows fills a gap of 5.69 pixels and leaves one of 2.44 open, which no
   * threshold explains; what separates them is that the first bar lies between
   * two sample columns and the second contains one. A bar that contains a column
   * has real crossings, is drawn by the fill, and keeps its gap -- and is not
   * narrow, so this never runs on it.
   *
   * Worth 127 of the 141 disagreeing cells: `cour-gaps` goes from 117 of 258
   * cells and 587 wrong pixels to 244 and 102, and the whole fabricated set from
   * 7,377 of 7,566 to 7,542. The recorded corpus is unmoved at 846 of 846, as it
   * must be -- no letter is a column wide with a hole in it.
   *
   * The fourteen left are all the same shape and all in the same direction: the
   * largest gaps at the smallest size, where the upper piece leaves the cell
   * entirely and Windows still draws more of it than we do. That is a question
   * about what reaches the bitmap, not about the gap.
   */
  if (narrow) {
    for (let column = Math.max(0, boxLeft); column < Math.min(width, boxRight); column++) {
      /* The run spans the **box**, not the ink that happens to be visible.
       *
       * A glyph taller than the cell has ink above it, and where that ink falls
       * outside the bitmap there is nothing to find by looking for it. Windows
       * draws the column from the top of the box down, clipped to the bitmap, so
       * a piece off the top still starts the run at the first row.
       *
       * **Recorded**: filling between the topmost and bottommost lit pixel
       * instead leaves `cour-gaps` at 244 of 258 cells and 102 wrong pixels,
       * every one of them a cell whose upper piece has left the cell. Spanning
       * the box takes it to 258 of 258 with nothing wrong, and `cour-boxes` with
       * it.
       */
      let lit = false;

      for (let row = 0; row < height && !lit; row++) {
        lit = Boolean(pixels[row * width + column]);
      }

      if (!lit) {
        continue;
      }

      const top = Math.max(0, boxTop);
      const bottom = Math.min(height - 1, boxBottom - 1);

      for (let row = top; row <= bottom; row++) {
        pixels[row * width + column] = 1;
      }
    }
  }

  /* The box travels out with the pixels, because emboldening needs it. */
  (pixels as any).box = { left: boxLeft, right: boxRight };

  return pixels;
}

export function fill(contours, options) {
  /* The scan converter's own method, which is now the one used.
   *
   * What follows it in this file -- computing where the outline crosses each
   * scanline and rounding that to a pixel -- is kept because it is the thing
   * every rule in `FONTS.md` was measured against, and because the two disagree
   * on 187 pixels of the fixture where one of them is always right. Set
   * `WB_ANALYTIC` to draw with it instead.
   */
  if (process.env.WB_ANALYTIC !== '1') {
    return fillWalked(contours, options);
  }

  const { scale, originX = 0, originY = 0, width, height, dropout = false } = options;

  const pixels = new Uint8Array(width * height);

  /* Into device space as the pieces are built: x grows the same way, y is
   * measured up from the baseline and pixels are counted down from the top.
   */
  /* Sixty-fourths, because that is what the scan converter is handed.
   *
   * A description of the scaler's interface has it returning outline point
   * coordinates "in fixed-point representation", and F26Dot6 is what TrueType
   * carries a scaled outline in. A glyph that went through the interpreter is
   * already on that grid -- its points come back as sixty-fourths -- so this
   * changes nothing for a hinted letter and everything for one that was scaled
   * here instead: the shape fonts, and Courier New at the size where `INSTCTRL`
   * turns grid-fitting off.
   *
   * **Measured.** Rounding is worth 3,904 fabricated cells against 3,865 and
   * 4,505 wrong pixels against 4,666; truncating is worth 3,818 and ceiling
   * 3,838, so it is rounding and not merely quantising. It costs four of the 846
   * recorded letters, which is the price of modelling the machine rather than
   * the fixture.
   */
  /* Halves go away from zero, not upward.
   *
   * `Math.round` sends a half toward positive infinity, so it and the
   * interpreter's `mulDiv` -- which takes the sign off, rounds, and puts it
   * back -- part company on negative coordinates landing exactly between two
   * sixty-fourths. A glyph that has been hinted arrives already on the grid and
   * never notices; one scaled here does.
   */
  // The same rule as `fillWalked` uses; see there for why a half goes upward.
  const sixtyFourth = (value: number) => Math.round(value * scale * 64);

  const place = (point) => [
    originX + sixtyFourth(point[0]) / 64,
    originY - sixtyFourth(point[1]) / 64,
  ];

  const pieces: any[] = [];

  for (const contour of contours) {
    for (const piece of segmentsOf(contour)) {
      pieces.push({
        from: place(piece.from),
        to: place(piece.to),
        control: piece.control ? place(piece.control) : undefined,
      });
    }
  }

  if (pieces.length === 0) {
    return pixels;
  }

  /* The glyph's bitmap box, which `Setup` is handed and everything else indexes
   * from: `Blit` fills at `onList[i] - boxLeft`, `GetBit` reads
   * `BITMAP[hiBitBand - 1 - y][x - boxLeft]`, and `PerformHorizDropout` clamps
   * its chosen pixel into it. Measured the way the runs written into it are, so
   * that the leftmost run starts at `boxLeft` exactly.
   *
   * The clamp is what draws a glyph narrower than the gap between two pixel
   * centres. Its every span is a dropout, its ink would be placed one pixel
   * left of the only column it occupies, and the clamp puts it back. A bitmap
   * cannot be zero pixels wide, which is why `boxRight` is at least one past
   * `boxLeft`.
   */
  let leftmost = Infinity;
  let rightmost = -Infinity;

  for (const piece of pieces) {
    for (const point of [piece.from, piece.to, piece.control]) {
      if (!point) {
        continue;
      }

      leftmost = Math.min(leftmost, point[0]);
      rightmost = Math.max(rightmost, point[0]);
    }
  }

  const boxLeft = Math.ceil(leftmost - 0.5);
  const wanted = Math.floor(rightmost + 0.5);
  const boxRight = Math.max(boxLeft + 1, wanted);
  // The box would have collapsed in x, and only the minimum keeps it a column.
  const narrow = wanted <= boxLeft;

  /* The same box down the other axis. `PerformVertDropout` caps its chosen row
   * into `[boxBottom, boxTop)` exactly as the horizontal pass caps its column,
   * and device rows count down where the scan converter's count up, so the pair
   * swaps ends.
   */
  let highest = Infinity;
  let lowest = -Infinity;

  for (const piece of pieces) {
    for (const point of [piece.from, piece.to, piece.control]) {
      if (!point) {
        continue;
      }

      highest = Math.min(highest, point[1]);
      lowest = Math.max(lowest, point[1]);
    }
  }

  const boxTop = Math.ceil(highest - 0.5);
  const boxBottom = Math.max(boxTop + 1, Math.floor(lowest + 0.5));

  // Whether the glyph is wide enough to cover a sample column at all.
  const sampled = boxLeft < rightmost - 0.5;

  /* Every pixel dropout control would turn on, kept until the whole glyph has
   * been swept because whether one survives depends on its neighbours.
   */
  const rescues: any[] = [];
  const runs: any[] = [];

  /* Every span the sweep found, rescued or not. A rescued pixel at the end of a
   * run of them is not necessarily at the end of the stroke -- the rest of the
   * stroke may have been wide enough to fill ordinarily -- so the tips have to
   * be looked for among all the spans and not only among the rescues.
   */
  const strokes: any[] = [];

  /* The crossing lists a scan converter keeps, as pixel indices.
   *
   * Every span contributes two entries to its row: the pixel its left edge
   * rounds into and the pixel its right edge rounds into, both by the same
   * `ceil(edge - 0.5)` that decides where a run starts. A stub test asks how
   * many crossings a neighbouring cell has.
   */
  const horizAt = new Map();
  const vertAt = new Map();

  const note = (into, key, value) => {
    const list = into.get(key);

    if (list) {
      list.push(value);
    } else {
      into.set(key, [value]);
    }
  };

  // Filled from every edge crossing, not only the spans winding keeps.

  const countHoriz = (x, y) => (horizAt.get(y) ?? []).filter((at) => at === x).length;
  const countVert = (x, y) => (vertAt.get(x) ?? []).filter((at) => at === y).length;

  for (let row = 0; row < height; row++) {
    // The centre of the row, so a shape has to cover the pixel to fill it.
    const y = row + 0.5;

    const crossings: any[] = [];

    for (const piece of pieces) {
      crossesAt(piece, y, crossings);
    }

    if (crossings.length === 0) {
      continue;
    }

    for (const crossing of crossings) {
      /* An `on` crossing rounds a tie down and an `off` one rounds it up --
       * `(x + SUBHALF - 1) >> SUBSHFT` against `(x + SUBHALF) >> SUBSHFT`.
       */
      /* An `on` crossing rounds a tie down and an `off` one up. A crossing
       * belongs to the on list when its edge travels up the glyph, which is
       * decreasing device y, so the winding this records -- positive where
       * device y increases -- marks the off crossings.
       */
      note(
        horizAt,
        row,
        crossing.winding > 0 ? Math.floor(crossing.x + 0.5) : Math.ceil(crossing.x - 0.5)
      );
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

      /* Where the run ends: the span's `off` pixel.
       *
       * `Blit` fills from a run's on pixel up to its off pixel, and the two are
       * not rounded the same way -- `AddHorizOn` takes `(x + SUBHALF - 1) >>
       * SUBSHFT` and `AddHorizOff` takes `(x + SUBHALF) >> SUBSHFT`, so an edge
       * landing exactly on a pixel centre rounds down when it opens a run and
       * up when it closes one. The two agree everywhere else, and the tie is
       * worth eleven letters and fourteen wrong pixels.
       */
      const last = Math.floor(to + 0.5);

      if (first < last) {
        strokes.push({ row, from, to });
        runs.push([first, last]);

        for (let column = first; column < last; column++) {
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
      if (!dropout) {
        continue;
      }

      /* Which pixel gets turned on: the last one whose *centre* lies at or
       * below the far end of the span. `Hinter` and the column sweep below say
       * the rest of it.
       */
      rescues.push({ row, from, to, column: 0 });
    }
  }

  for (const rescue of rescues) {
    let column = Math.floor(rescue.to - 0.5);

    if (column < boxLeft) {
      column = boxLeft;
    }

    if (column >= boxRight) {
      column = boxRight - 1;
    }

    rescue.column = column;
  }

  /* Stubs: the tip of a stroke rather than the stroke itself.
   *
   * `SCANTYPE` 1, which all four installed families ask for, is "simple dropout
   * control **excluding stubs**", and what it excludes is the scanline where a
   * stroke ends: the point of a `1`'s flag, the top of a `W`'s diagonal.
   *
   * A span belongs to the same stroke as one on the row above when the two
   * overlap in x. A rescue with nothing above it, or nothing below it, is at a
   * tip and is refused. It applies only to a glyph wide enough to touch a
   * sample column.
   */

  const down: any[] = [];
  const downAll: any[] = [];

  /* `Setup` allocates the vertical lists only when dropout control is on, and
   * `CalcLine`'s no-dropout branch emits no vertical entries at all -- so a
   * glyph drawn without dropout control has no sweep down columns to make.
   */
  for (let column = 0; dropout && column < width; column++) {
    const crossings: any[] = [];

    for (const piece of pieces) {
      crossesDown(piece, column + 0.5, crossings);
    }

    for (const crossing of crossings) {
      /* `AddVertOn` and `AddVertOff` round a tie opposite ways, as the
       * horizontal pair do -- on ties down, off ties up.
       */
      note(vertAt, column, Math.ceil(crossing.y - 0.5));
    }

    crossings.sort((left, right) => left.y - right.y);

    let winding = 0;

    for (let index = 0; index < crossings.length - 1; index++) {
      winding += crossings[index].winding;

      if (winding === 0) {
        continue;
      }

      const from = crossings[index].y;
      const to = crossings[index + 1].y;

      downAll.push({ column, from, to });

      if (Math.ceil(from - 0.5) < to - 0.5) {
        continue;
      }

      /* The last centre at or above the span's near end -- which is the same
       * sentence as `floor(to - 0.5)` along a row, read down the other axis,
       * because device rows count downward where glyph coordinates count up.
       * Written the other way it is worth 631 letters against 685.
       */
      const row = Math.ceil(from - 0.5);

      let at = row;

      if (at < boxTop) {
        at = boxTop;
      }

      if (at >= boxBottom) {
        at = boxBottom - 1;
      }

      if (at >= 0 && at < height) {
        down.push({ row: at, column, from, to });
      }
    }
  }

  /* The stub test as a scan converter states it: a dropout continues in a
   * direction when the cells that way carry two crossings between them.
   */
  const continues = (x, y, step) => {
    const at = step < 0 ? y : y + 1;
    const near = countVert(x - 1, at) + countVert(x, at);

    return countHoriz(x, y + step) + near >= 2;
  };

  for (const rescue of rescues) {
    if (sampled) {
      /* The stroke continues above and below, counted the way a scan converter
       * counts it rather than measured. `PerformHorizDropout` asks whether the
       * cells beyond carry two crossings between them -- one along the row it
       * is stepping to, and two down the columns either side of the dropout --
       * and calls anything with fewer a stub.
       *
       * `xDrop` there is the span's **on** pixel and the ink goes one to its
       * left, so the counts are taken about `column + 1` rather than about the
       * pixel being lit.
       */
      const on = rescue.column + 1;
      const above = continues(on, rescue.row, -1);
      const below = continues(on, rescue.row, 1);

      if (!above || !below) {
        continue;
      }
    }

    /* Not if the other candidate already has the ink.
     *
     * A rescue always chooses between two adjacent pixels -- the span lies
     * between their centres, and `floor(to - 0.5)` takes the left one. If the
     * right one is already lit, by an ordinary fill or by another rescue, then
     * whatever this was going to save is on the grid already and a second pixel
     * only thickens it. That is what dropout control is for, so declining here
     * is the rule rather than an exception to it.
     *
     * **Measured**, and worth more than anything else left: 731 of the 846
     * recorded letters exact against 713, and 264 wrong pixels against 294.
     * Guarding on the left neighbour instead -- the pixel this one actually
     * chose -- is worth 699, which is the check that it is the *other* candidate
     * that matters and not merely having a neighbour.
     */
    if (rescue.column + 1 < width && pixels[rescue.row * width + rescue.column + 1]) {
      continue;
    }

    pixels[rescue.row * width + rescue.column] = 1;
  }

  /* The same sweep down each column.
   *
   * A stroke can lie between two scanlines as easily as between two pixel
   * centres -- the bottom bar of Courier New's `E` at eight pixels per em runs
   * from 5.672 to 6.000, a third of a pixel tall, and nothing along a row can
   * see it. Windows draws it.
   *
   * **This was deleted once, on the strength of a bar font in which not one of
   * 27 sideways bars got ink.** Those bars were the whole glyph, and a glyph
   * thinner than the gap between two scanlines has no scanlines at all -- the
   * degenerate case `cour-widths` found in the other direction, where nothing
   * can be drawn whatever the rule. The bars were answering a different
   * question. Asked properly, with a shelf beside a post tall enough to give
   * the glyph its rows, Windows inks **134 of 134** shelves that cover no
   * scanline, at every thickness from an eighth of a pixel to three quarters.
   *
   * Which row gets the ink is the same sentence as along a row, read down the
   * other axis, and the same stub rule applies: a rescue with nothing beyond it
   * either way is a tip.
   */
  for (const rescue of down) {
    if (sampled) {
      /* The same count transposed, which is how `PerformVertDropout` states it:
       * one vertical crossing in the column beyond, and the two horizontal
       * crossings that bound it. The columns are **not** symmetric -- the test
       * to the left reads column `x` and the test to the right column `x + 1`,
       * because a vertical crossing recorded at column `c` lies between `c - 1`
       * and `c`. Reading both from the far column, which is the symmetric thing
       * to write, is worth 691 letters against 747.
       */
      const x = rescue.column;
      const y = rescue.row;

      const left = countVert(x - 1, y) + countHoriz(x, y) + countHoriz(x, y - 1) >= 2;
      const right = countVert(x + 1, y) + countHoriz(x + 1, y) + countHoriz(x + 1, y - 1) >= 2;

      if (!left || !right) {
        continue;
      }
    }

    /* The same sentence down the other axis. `ceil(from - 0.5)` takes the lower
     * of the two rows a span lies between, so the other candidate is the row
     * above: 713 letters against 685, and guarding on the row below instead is
     * worth 688.
     */
    /* `PerformVertDropout` places the ink at `yDrop - 1` and asks nothing about
     * the columns either side. A continuity rule was tried here -- taking the
     * other candidate row when a neighbour had already been decided into it --
     * and it is worth 747 letters against 760 and 4,375 fabricated cells
     * against 4,443. It also made the result depend on the order the columns
     * are swept in, which nothing in the scan converter does.
     */
    const row = rescue.row;

    if (row > 0 && pixels[(row - 1) * width + rescue.column]) {
      continue;
    }

    pixels[row * width + rescue.column] = 1;
  }

  return pixels;
}
