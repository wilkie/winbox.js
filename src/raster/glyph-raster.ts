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
 *
 * Swept three times now -- on 846 glyphs rather than 90, again after the
 * crossing rule was corrected, and again after the interpreter was -- and the
 * peak is broad every time and lands at 0.45 every time, 710 glyphs exact
 * against 701 here, with the fewest wrong pixels somewhere else again at 0.325.
 * A number that keeps winning by nine glyphs and never sharpens is a fit. What the wider
 * sweep shows that the narrow one could not is the shape of the curve -- a
 * smooth trade of invented pixels for missing ones with no corner in it, and
 * the best threshold and the best pixel count in different places. That is what
 * a threshold standing in for a rule that is not a threshold looks like. Half a
 * pixel is kept because it is the one value here that means something; the two
 * either side of it are a fit to 846 records.
 *
 * The rule it stands in for is a question about shape rather than width: a stub
 * is where the outline turns back, so the two edges bounding an empty span are
 * two sides of one tip rather than two sides of a stroke. **Two ways of asking
 * that have been implemented and neither beats the threshold.**
 *
 * By topology -- the contour's pieces grouped into runs that never turn back,
 * so a tip four curve segments wide is still one turn, and the span refused
 * when its two runs meet at this very scanline. 661 glyphs exact against 674.
 *
 * By direction -- the two bounding edges' tangents, which point opposite ways
 * through a stroke and converge at a tip, refused when their normalised dot
 * product rises above a threshold. This one is clearly measuring something: at
 * its best it takes the missing pixels from 316 to **99**, so it does find the
 * strokes Windows rescues. It invents as many as it saves, though, and the
 * glyph agreement is 679 against 681.
 *
 * Both are recorded so the next attempt starts further along than this one did.
 * What neither has is the rule that stops a rescue Windows does not make.
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

      /* Which pixel gets turned on: the last one whose *centre* lies at or
       * below the far end of the span. `Hinter` and the column sweep below say
       * the rest of it.
       */
      const column = Math.floor(to - 0.5);

      if (column >= 0 && column < width) {
        pixels[row * width + column] = 1;
      }
    }
  }

  if (!dropout) {
    return pixels;
  }

  /* The same test down each column.
   *
   * A stroke can be too shallow to cover a row centre as easily as too narrow
   * to cover a column one, and a sweep along rows provably cannot see the first
   * kind: every scanline either crosses such a stroke properly or misses it
   * whole. The flag of a Courier New `1` at thirteen pixels per em is the case
   * -- two pixels Windows draws that nothing along a row can find.
   *
   * Which pixel gets turned on is **one rule for both sweeps**, and it is
   * about pixel centres rather than about pixels: the last centre lying at or
   * below the span's upper end, measured in the outline's own coordinates.
   *
   * Written in device coordinates that is two different-looking expressions,
   * because device rows count downward and glyph coordinates count up. Along a
   * row, `floor(to - 0.5)`; down a column, `ceil(from - 0.5)`. They are the
   * same sentence read along opposite axes, and on 846 recorded glyphs they
   * score identically to each other whichever way round they are written --
   * which is what says the symmetry is real and not a coincidence of this
   * fixture.
   *
   * This replaces a pair fitted on ninety glyphs -- the row sweep keeping the
   * pixel a span started in and the column sweep the one it ended in -- which
   * needed two rules to say and was worth 674 glyphs against **681** here, and
   * 462 wrong pixels against **437**. It is also the rule the format's own
   * scan converter is described as using, so the agreement is with something
   * outside this fixture as well. Re-swept after the crossing rule was
   * corrected and unchanged: 691 against 683 for anything else.
   *
   * **The crossing itself is not quantised.** Windows would have computed it in
   * fixed point, and a stroke whose edge lands within a sixty-fourth of a pixel
   * centre is exactly where that would show -- Arial's `7` at eighteen pixels
   * per em has its diagonal cross a row at 5.497 where Windows evidently has it
   * a shade past 5.5. Rounding the intersection to sixty-fourths costs 26
   * glyphs, flooring 35, ceiling 10. Exact wins outright, so whatever that
   * hundredth of a pixel is, it is in the outline and not in the arithmetic
   * here. **Measured.**
   */
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

      if (Math.ceil(from - 0.5) < to - 0.5 || to - from < STUB) {
        continue;
      }

      const row = Math.ceil(from - 0.5);

      if (row >= 0 && row < height) {
        pixels[row * width + column] = 1;
      }
    }
  }

  return pixels;
}
