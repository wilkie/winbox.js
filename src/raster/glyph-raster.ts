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
export function segmentsOf(contour) {
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
      curve(control, [(control.x + point.x) / 2, (control.y + point.y) / 2]);
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
  const { scale, originX = 0, originY = 0, width, height, dropout = false } = options;

  const pixels = new Uint8Array(width * height);
  /* Halves go away from zero, not upward.
   *
   * `Math.round` sends a half toward positive infinity, so it and the
   * interpreter's `mulDiv` -- which takes the sign off, rounds, and puts it
   * back -- part company on negative coordinates landing exactly between two
   * sixty-fourths. A glyph that has been hinted arrives already on the grid and
   * never notices; one scaled here does.
   */
  const sixtyFourth = (value: number) =>
    Math.sign(value) * Math.round(Math.abs(value) * scale * 64);

  const place = (point) => [
    originX + sixtyFourth(point[0]) / 64,
    originY - sixtyFourth(point[1]) / 64,
  ];

  const lists = empty();
  const sub = (value) => Math.round(value * 64);

  const ends = new Endpoints(lists);

  for (const contour of contours) {
    const made = segmentsOf(contour);

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

  for (const contour of contours) {
    for (const piece of segmentsOf(contour)) {
      for (const point of [piece.from, piece.to, piece.control]) {
        if (!point) {
          continue;
        }

        const at = place(point);

        leftmost = Math.min(leftmost, at[0]);
        rightmost = Math.max(rightmost, at[0]);
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

  const countHoriz = (x, row) =>
    (lists.horizOn.get(-row - 1) ?? []).filter((at) => at === x).length +
    (lists.horizOff.get(-row - 1) ?? []).filter((at) => at === x).length;
  /* A vertical entry is recorded as `y + yOffset`, which already carries the
   * step the horizontal entries take from their key, so it converts back as
   * `-value` where a horizontal row converts as `-key - 1`. Checked against a
   * solve of every piece in the fixture: 99.9% agree this way and 43.5% the
   * other, the difference being a systematic row.
   */
  const countVert = (x, row) =>
    (lists.vertOn.get(x) ?? []).filter((at) => -at === row).length +
    (lists.vertOff.get(x) ?? []).filter((at) => -at === row).length;

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
     */
    if (!narrow && (!continues(-1) || !continues(1))) {
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

      if (!continues(-1) || !continues(1)) {
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
  const sixtyFourth = (value: number) =>
    Math.sign(value) * Math.round(Math.abs(value) * scale * 64);

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
