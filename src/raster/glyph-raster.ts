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
export function fill(contours, options) {
  const { scale, originX = 0, originY = 0, width, height, dropout = false } = options;

  const pixels = new Uint8Array(width * height);

  /* Into device space as the pieces are built: x grows the same way, y is
   * measured up from the baseline and pixels are counted down from the top.
   */
  const place = (point) => [originX + point[0] * scale, originY - point[1] * scale];

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

  /* Whether the glyph is wide enough to touch a sample column at all.
   *
   * A glyph whose whole outline falls between two pixel centres would sample to
   * nothing and disappear, and Windows treats that case differently: it inks
   * the pixel the ordinary fill would have started at rather than the one below
   * it, and it does not apply the stub rule that would take the ends off what
   * little it drew. As soon as any part of the outline reaches a centre, both
   * come back.
   *
   * **Measured**, by a font that holds one bar still and sweeps only how wide
   * the glyph around it is. The switch lands on the pixel centre every time:
   * at eight pixels per em between right edges of 5.485 and 5.567, at nine
   * between 5.458 and 5.550, at eleven between 6.452 and 6.565, at seventeen
   * between 8.358 and 8.533. Read as a rule it is 144 of 144 on that font and
   * 94 of 96 on another built for a different question. `FONTS.md` section 6.
   *
   * The extent is taken from the points, including the control points, and not
   * from the glyph's own header -- a fabricated glyph whose header claims a box
   * twice its size draws exactly as one that tells the truth, in all 84
   * comparisons.
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

  /* Written the same way a span's coverage is, and that is the point: this is
   * `first < to - 0.5` applied to the whole outline instead of to one span, so
   * it asks whether the glyph's bitmap has any width at all. A description of
   * the scaler's interface says the engine sizes a monochrome bitmap from the
   * outline and hands back its bounds, which makes a glyph that covers no
   * column a bitmap zero pixels wide -- a case something has to special-case,
   * and the measurements say what it does.
   *
   * It also accounts for the asymmetry. A glyph covering no *row* gets no ink
   * at all -- thirty-six fabricated bars lying on their side say so, 27 of 27 --
   * because a bitmap zero pixels tall has no scanlines to sweep and the loop
   * never runs. A bitmap zero pixels wide still has rows, and each row's span
   * still has to put its ink somewhere.
   */
  const sampled = Math.ceil(leftmost - 0.5) < rightmost - 0.5;

  /* Every pixel dropout control would turn on, kept until the whole glyph has
   * been swept because whether one survives depends on its neighbours.
   */
  const rescues: any[] = [];

  /* Every span the sweep found, rescued or not. A rescued pixel at the end of a
   * run of them is not necessarily at the end of the stroke -- the rest of the
   * stroke may have been wide enough to fill ordinarily -- so the tips have to
   * be looked for among all the spans and not only among the rescues.
   */
  const strokes: any[] = [];

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
        strokes.push({ row, from, to });

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
      if (!dropout) {
        continue;
      }

      /* Which pixel gets turned on: the last one whose *centre* lies at or
       * below the far end of the span. `Hinter` and the column sweep below say
       * the rest of it.
       */
      const column = sampled ? Math.floor(to - 0.5) : Math.ceil(from - 0.5);

      if (column >= 0 && column < width) {
        rescues.push({ row, from, to, column });
      }
    }
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
   * sample column -- see `sampled` above.
   */
  const all = [...strokes, ...rescues];

  /* Two spans a row apart are the same stroke when they come within a pixel of
   * each other. Requiring them to overlap outright is too strict for a
   * diagonal, whose spans step sideways faster than they are wide, and every
   * scanline of one then looks like a tip; a pixel is the sampling interval and
   * the sweep is flat from 0.9 to 1.25 either side of it.
   */
  const touching = (one, two) => one.from - 1 < two.to && two.from - 1 < one.to;

  for (const rescue of rescues) {
    if (sampled) {
      const above = all.some((span) => span.row === rescue.row - 1 && touching(span, rescue));
      const below = all.some((span) => span.row === rescue.row + 1 && touching(span, rescue));

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
  const down: any[] = [];
  const downAll: any[] = [];

  for (let column = 0; column < width; column++) {
    const crossings: any[] = [];

    for (const piece of pieces) {
      crossesDown(piece, column + 0.5, crossings);
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

      if (row >= 0 && row < height) {
        down.push({ row, column, from, to });
      }
    }
  }

  for (const rescue of down) {
    if (sampled) {
      const left = downAll.some(
        (span) => span.column === rescue.column - 1 && touching(span, rescue)
      );
      const right = downAll.some(
        (span) => span.column === rescue.column + 1 && touching(span, rescue)
      );

      if (!left || !right) {
        continue;
      }
    }

    /* The same sentence down the other axis. `ceil(from - 0.5)` takes the lower
     * of the two rows a span lies between, so the other candidate is the row
     * above: 713 letters against 685, and guarding on the row below instead is
     * worth 688.
     */
    if (rescue.row > 0 && pixels[(rescue.row - 1) * width + rescue.column]) {
      continue;
    }

    pixels[rescue.row * width + rescue.column] = 1;
  }

  return pixels;
}
