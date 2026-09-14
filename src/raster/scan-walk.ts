'use strict';

/**
 * The scan converter's own edge walk.
 *
 * Where `glyph-raster.ts` asks "where does this outline cross row *n*", this
 * asks the question the other way round -- "which cells does this edge pass
 * through" -- and answers it the way the scan converter does, by stepping a
 * cross product one scanline or one column at a time and writing down the cell
 * it is standing in. The two agree for a straight edge on all but ties; for a
 * curve they do not, because this accumulates its own error and an exact solve
 * does not, and the pixels this lands on are the ones Windows draws.
 *
 * Everything is in sixty-fourths of a pixel and the y axis points **up**, which
 * is the frame the scan converter works in. `walk` converts from device
 * coordinates, where y points down, and converts the emitted scan indices back.
 *
 * The lists are four: a crossing goes in the `on` list when its edge travels up
 * and the `off` list when it travels down, and correspondingly left or right
 * for the vertical pair. `BeginElement` decides that from the quadrant, which
 * is settled once per edge before the walk begins.
 */

const SUB = 64;
const SHIFT = 6;
const HALF = 32;

/** The next sample position at or above `p`, on the sub-pixel grid. */
function above(p: number) {
  return ((p + HALF) & -SUB) + HALF;
}

/** The next sample position strictly below `p`. */
function below(p: number) {
  return ((p - HALF - 1) & -SUB) + HALF;
}

/** The power of two strictly above `n`, as a shift count. */
function powerOfTwo(n: number) {
  let value = Math.abs(n);

  if (value === 0) {
    return 0;
  }

  let shifts = 0;

  for (const step of [16, 8, 4, 2]) {
    if (value >= 1 << step) {
      value >>>= step;
      shifts += step;
    }
  }

  if (value >= 2) {
    shifts += 1;
  }

  return shifts + 1;
}

/* How far the curve's arithmetic has to be shifted down to stay in range. */
const Z_SHIFT = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1,
  2, 2, 2, 3, 3,
];

export interface Lists {
  crowded?: Set<number>;
  horizOn: Map<number, number[]>;
  horizOff: Map<number, number[]>;
  vertOn: Map<number, number[]>;
  vertOff: Map<number, number[]>;
}

export function empty(): Lists {
  return {
    horizOn: new Map(),
    horizOff: new Map(),
    vertOn: new Map(),
    vertOff: new Map(),
  };
}

function put(into: Map<number, number[]>, key: number, value: number) {
  const list = into.get(key);

  if (list) {
    list.push(value);
  } else {
    into.set(key, [value]);
  }
}

/**
 * One edge, walked.
 *
 * The points are in sixty-fourths with y pointing up. `quadrant` decides which
 * of the four lists each emission goes to, exactly as `BeginElement` does.
 */
function element(lists: Lists, quadrant: number) {
  const horiz = quadrant === 1 || quadrant === 2 ? lists.horizOn : lists.horizOff;
  const vert = quadrant === 2 || quadrant === 3 ? lists.vertOn : lists.vertOff;

  return {
    addHoriz: (x: number, y: number) => put(horiz, y, x),
    addVert: (x: number, y: number) => put(vert, x, y),
  };
}

/**
 * The crossings a vertex contributes, when it lies exactly on a scanline.
 *
 * A walk starts at `ScanAbove(y1)`, which for a point already on a scanline is
 * the *next* one -- so an edge beginning on a sample line never records it, and
 * two edges meeting there record nothing between them. `CheckHorizTopology`
 * supplies what is missing, and how much it supplies depends on what the
 * outline does at that vertex: one crossing where it passes through, two where
 * it turns back, and none where it merely runs along the line.
 *
 * Without this the walk loses a crossing wherever a contour's vertex lands on a
 * sample line, which for a rounded letter is often enough to leave a row with
 * an odd number of entries and no way to pair them into runs.
 */
export class Endpoints {
  declare lists: Lists;
  declare x0: number;
  declare y0: number;
  declare x1: number;
  declare y1: number;
  declare firstX: number;
  declare firstY: number;
  declare secondX: number;
  declare secondY: number;
  declare started: boolean;

  constructor(lists: Lists) {
    this.lists = lists;
    this.x0 = Infinity;
    this.y0 = Infinity;
    this.x1 = 0;
    this.y1 = 0;
    this.firstX = 0;
    this.firstY = 0;
    this.secondX = 0;
    this.secondY = 0;
    this.started = false;
  }

  begin(x: number, y: number) {
    this.x1 = x;
    this.y1 = y;
    this.x0 = Infinity;
    this.firstX = x;
    this.firstY = y;
    this.started = false;
  }

  private onScanline(p: number) {
    return ((p % SUB) + SUB) % SUB === HALF;
  }

  private addHorizOn() {
    put(this.lists.horizOn, this.y1 >> SHIFT, (this.x1 + HALF - 1) >> SHIFT);
  }

  private addHorizOff() {
    put(this.lists.horizOff, this.y1 >> SHIFT, (this.x1 + HALF) >> SHIFT);
  }

  private addVertOn() {
    put(this.lists.vertOn, this.x1 >> SHIFT, (this.y1 + HALF - 1) >> SHIFT);
  }

  private addVertOff() {
    put(this.lists.vertOff, this.x1 >> SHIFT, (this.y1 + HALF) >> SHIFT);
  }

  /**
   * Which way the outline turns at a vertex, as the binary decides it.
   *
   * `seg42:1342` classifies the turn by the **sign of the cross product** of
   * the direction into the vertex with the direction out of it, and by which
   * quadrant the outgoing direction lies in -- not by comparing the three
   * points, which is what this did. The two agree on a monotone crossing and
   * part at an extremum lying exactly on a sample line: a comparison says
   * "minimum, emit an `on` and an `off`", and the binary emits those only when
   * the turn is the other way about, and otherwise nothing.
   *
   * For a fill the two are the same picture, since an `on` and an `off` at one
   * pixel fill nothing between them. For the dropout's stub test they are not:
   * a coincident pair counts as a continuation and an absence does not. That
   * is the whole of the difference the two scan converter cells were, and it
   * is why nothing else in the corpus moves.
   */
  private flags(x: number, y: number) {
    const outX = x - this.x1;
    const outY = y - this.y1;

    /* The outgoing quadrant, as the binary shifts a bit for each test: right
     * and up, left and up, left and down, right and down. */
    const quadrant =
      outX > 0 && outY >= 0 ? 1 : outX <= 0 && outY > 0 ? 2 : outX < 0 && outY <= 0 ? 4 : 8;

    return {
      quadrant,
      cross: (this.x1 - this.x0) * outY - (this.y1 - this.y0) * outX < 0,
      // A horizontal run continuing horizontally, and a vertical one likewise.
      flat: outY === 0 && this.y0 === this.y1,
      upright: outX === 0 && this.x0 === this.x1,
    };
  }

  private horizTopology(x: number, y: number) {
    const { quadrant, cross, flat, upright } = this.flags(x, y);
    const up = (quadrant & 0x3) !== 0;
    const down = (quadrant & 0xc) !== 0;

    if (cross || upright) {
      if (up ? this.y0 > this.y1 : this.y0 < this.y1) {
        this.addHorizOn();
        this.addHorizOff();

        return;
      }
    }

    if (up) {
      if (cross) {
        this.addHorizOn();

        return;
      }

      if (flat && (quadrant & 0x1) !== 0 && this.x0 > this.x1) {
        this.addHorizOn();

        return;
      }
    }

    if (this.y0 < this.y1 && this.y1 < y) {
      this.addHorizOn();

      return;
    }

    if (down) {
      if (cross) {
        this.addHorizOff();

        return;
      }

      if (flat && (quadrant & 0x4) !== 0 && this.x0 < this.x1) {
        this.addHorizOff();

        return;
      }
    }

    if (this.y0 > this.y1 && this.y1 > y) {
      this.addHorizOff();
    }
  }

  private vertTopology(x: number, y: number) {
    const { quadrant, cross, flat, upright } = this.flags(x, y);
    const right = (quadrant & 0x9) !== 0;
    const left = (quadrant & 0x6) !== 0;

    if (cross || flat) {
      if (right ? this.x0 > this.x1 : this.x0 < this.x1) {
        this.addVertOn();
        this.addVertOff();

        return;
      }
    }

    if (left) {
      if (cross) {
        this.addVertOn();

        return;
      }

      if (flat && (quadrant & 0x2) !== 0 && this.y0 > this.y1) {
        this.addVertOn();

        return;
      }
    }

    if (this.x0 > this.x1 && this.x1 > x) {
      this.addVertOn();

      return;
    }

    if (right) {
      if (cross) {
        this.addVertOff();

        return;
      }

      if (upright && (quadrant & 0x8) !== 0 && this.y1 > this.y0) {
        this.addVertOff();

        return;
      }
    }

    if (this.x0 < this.x1 && this.x1 < x) {
      this.addVertOff();
    }
  }

  check(x: number, y: number, dropout = true) {
    /* A vertex sitting on a sample line and a sample column at once, kept for
     * the fill to charge against its column's block. See `fillWalked`.
     *
     * **Only where the outline leaves it going up.** The charge is one entry,
     * and which vertex earns it is not read; that it is the upward ones is
     * measured, on three corpora at once and against the three other one-bit
     * gates the quadrant offers:
     *
     *     charge when the vertex heads   square   not square   EGA/Hercules
     *     up    (quadrant & 0x3)          32394       2668         6044
     *     down  (quadrant & 0xc)          32386       2666         6043
     *     left  (quadrant & 0x6)          32386       2668         6044
     *     right (quadrant & 0x9)          32394       2666         6043
     *
     * Only `up` is clean on all three; each of the others loses one corpus to
     * win another. `up` is also the half of the quadrant that makes a vertex an
     * `on` crossing in `horizTopology` below -- which is suggestive and is not
     * a reading, because the block being charged is the *column's* and the
     * vertical pass turns on `left` and `right` rather than on `up` and `down`.
     */
    if (
      this.onScanline(this.y1) &&
      this.onScanline(this.x1) &&
      !(this.x1 === x && this.y1 === y) &&
      this.x0 !== Infinity &&
      !this.flags(x, y).cross &&
      (this.flags(x, y).quadrant & 0x3) !== 0
    ) {
      (this.lists.crowded ??= new Set()).add(this.x1 >> SHIFT);
    }

    /* A step that goes nowhere leaves the running vertex alone.
     *
     * `EvaluateEndPoint` returns before it shifts, so the vertex before this
     * one is still the vertex before the one that stayed put. Skipping only the
     * topology and shifting anyway makes a glyph's own point its predecessor,
     * which decides the topology at the next real vertex. It never showed while
     * this was called once a segment, because a segment of no length is rare;
     * a subdivision that cuts a spline into pieces makes them ordinary.
     */
    if (this.onScanline(this.y1)) {
      if (this.x1 === x && this.y1 === y) {
        return;
      }

      if (this.x0 === Infinity) {
        this.secondX = x;
        this.secondY = y;
        this.started = true;
      } else {
        this.horizTopology(x, y);
      }
    }

    // And the vertical pass only exists when dropout control asked for it.
    if (dropout && this.onScanline(this.x1)) {
      if (this.x1 === x && this.y1 === y) {
        return;
      }

      if (this.x0 === Infinity) {
        this.secondX = x;
        this.secondY = y;
        this.started = true;
      } else {
        this.vertTopology(x, y);
      }
    }

    this.x0 = this.x1;
    this.y0 = this.y1;
    this.x1 = x;
    this.y1 = y;
  }

  /**
   * Closing the contour.
   *
   * A closed contour's last piece ends where the first began, so by now the
   * running vertex *is* the first one and its predecessor is the point before
   * it. What was missing when the walk started -- the point that came *after*
   * the first vertex -- was put aside then, and this is where it is used.
   */
  end() {
    if (!this.started) {
      return;
    }

    if (this.onScanline(this.y1)) {
      this.horizTopology(this.secondX, this.secondY);
    }

    if (this.onScanline(this.x1)) {
      this.vertTopology(this.secondX, this.secondY);
    }
  }
}

/** A straight edge. */
export function calcLine(
  lists: Lists,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  dropout = true
) {
  let quadrant: number;
  let q: number;
  let y: number;
  let ySteps: number;
  let yIncrement: number;
  let yOffset: number;
  let terminalY: number;
  let initialYStep: number;

  if (y2 >= y1) {
    quadrant = 1;
    q = 0;
    const initial = above(y1);
    initialYStep = initial - y1;
    y = initial >> SHIFT;
    ySteps = (below(y2) >> SHIFT) - y + 1;
    yIncrement = 1;
    yOffset = 0;
    terminalY = y2 - y1;
  } else {
    quadrant = 4;
    q = 1;
    const initial = below(y1);
    initialYStep = y1 - initial;
    y = initial >> SHIFT;
    ySteps = y - (above(y2) >> SHIFT) + 1;
    yIncrement = -1;
    yOffset = 1;
    terminalY = y1 - y2;
  }

  if (y2 === y1) {
    y = (x2 < x1 ? above(y1 - 1) : above(y1)) >> SHIFT;
    ySteps = 0;
  }

  let x: number;
  let xSteps: number;
  let xIncrement: number;
  let xOffset: number;
  let terminalX: number;
  let initialXStep: number;

  if (x2 >= x1) {
    const initial = above(x1);
    initialXStep = initial - x1;
    x = initial >> SHIFT;
    xSteps = (below(x2) >> SHIFT) - x + 1;
    xIncrement = 1;
    xOffset = 0;
    terminalX = x2 - x1;
  } else {
    q = 1 - q;
    quadrant += yIncrement;
    const initial = below(x1);
    initialXStep = x1 - initial;
    x = initial >> SHIFT;
    xSteps = x - (above(x2) >> SHIFT) + 1;
    xIncrement = -1;
    xOffset = 1;
    terminalX = x1 - x2;
  }

  if (x2 === x1) {
    x = (y2 > y1 ? above(x1 - 1) : above(x1)) >> SHIFT;
    xSteps = 0;
  }

  const { addHoriz, addVert: rawVert } = element(lists, quadrant);

  /* With dropout control off there is no sweep down the columns to feed, and
   * `CalcLine`'s own branch for that emits nothing but horizontal entries. Ours
   * emitted both, which left a column holding entries the endpoint topology --
   * which does obey the flag -- had declined to match. Nothing read them, since
   * the vertical lists are only consulted when dropout control is on, but they
   * made the lists disagree with themselves. **Traced** on Arial's `W` at
   * twenty-four pixels per em, where column 7 held one entry and nothing to
   * pair it with.
   */
  const addVert = (atX: number, atY: number) => {
    if (!dropout) {
      return;
    }

    return rawVert(atX, atY);
  };

  if (y1 === y2) {
    for (let step = 0; step < xSteps; step++) {
      addVert(x, y);
      x += xIncrement;
    }

    return;
  }

  if (x1 === x2) {
    for (let step = 0; step < ySteps; step++) {
      addHoriz(x, y);
      y += yIncrement;
    }

    return;
  }

  q += terminalX * initialYStep - terminalY * initialXStep;

  const dQyStep = terminalX << SHIFT;
  const dQxStep = -terminalY << SHIFT;

  for (let step = 0; step < xSteps + ySteps; step++) {
    if (q > 0) {
      addVert(x, y + yOffset);
      x += xIncrement;
      q += dQxStep;
    } else {
      addHoriz(x + xOffset, y);
      y += yIncrement;
      q += dQyStep;
    }
  }
}

/**
 * A quadratic, cut into chords the way GDI.EXE cuts one.
 *
 * The document describes a spline split at its turning points and then walked as
 * a conic forward difference, and `calcSpline` below is that walk. It is not
 * what ships. The scan converter has one element walk and it is a line: the
 * eight routines behind the table at the font scaler's `ds:0x4a4` are four
 * quadrants of a determinant DDA in two scan kinds, and there is no second
 * `SCANABOVE` setup anywhere in the binary for a curve to have used.
 *
 * What draws a curve is segment 44 at 0x42, reached from segment 42 through a
 * thunk choosing between a 286 and a 386 build. It takes the curve's second
 * difference, picks a depth from how large that is, steps the curve at that many
 * equal parameter steps, and hands each chord to the line walker. A curve is a
 * polyline through points rounded to a sixty-fourth, and that rounding is what
 * our exactness had been showing up as wrong pixels against.
 */
export function evaluateSpline(
  lists: Lists,
  ends: Endpoints,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  dropout = true,
  given = -1
) {
  const secondX = x1 - 2 * x2 + x3;
  const secondY = y1 - 2 * y2 + y3;

  let depth = given;

  if (depth < 0) {
    /* Two of the larger and one of the smaller: an octagonal norm, which the
     * binary reaches by comparing the two and shifting whichever wins. Halving a
     * quadratic quarters its second difference, so dividing by four until the
     * norm falls under 0x80 counts the halvings wanted.
     */
    const spanX = Math.abs(secondX);
    const spanY = Math.abs(secondY);
    let size = spanY >= spanX ? spanX + 2 * spanY : 2 * spanX + spanY;

    depth = 1;

    while (size > 0x80) {
      depth++;
      size >>= 2;
    }

    if (depth > 8) {
      depth = 8;
    }
  }

  /* Past five it halves the curve and recurses instead, rather than let the
   * accumulator below carry a shift wider than ten. The halves round: the new
   * control is `(p1 + p2 + 1) >> 1` and the new end `(p1 + 2p2 + p3 + 2) >> 2`,
   * neither of which is the truncating midpoint the document writes.
   */
  if (depth > 5) {
    const nearX = (x1 + x2 + 1) >> 1;
    const nearY = (y1 + y2 + 1) >> 1;
    const midX = (x1 + 2 * x2 + x3 + 2) >> 2;
    const midY = (y1 + 2 * y2 + y3 + 2) >> 2;
    const farX = (x2 + x3 + 1) >> 1;
    const farY = (y2 + y3 + 1) >> 1;

    evaluateSpline(lists, ends, x1, y1, nearX, nearY, midX, midY, dropout, depth - 1);

    return evaluateSpline(lists, ends, midX, midY, farX, farY, x3, y3, dropout, depth - 1);
  }

  const steps = 1 << depth;
  const shift = depth * 2;
  const half = 1 << (shift - 1);

  /* The accumulator carries the point scaled by the square of the step count, so
   * the first difference at nought is the second difference less twice the step
   * count's worth of the first, and the running second difference doubles.
   */
  let stepX = secondX - ((x1 - x2) << (depth + 1));
  let stepY = secondY - ((y1 - y2) << (depth + 1));
  const growX = secondX * 2;
  const growY = secondY * 2;

  let atX = x1 << shift;
  let atY = y1 << shift;
  let fromX = x1;
  let fromY = y1;

  for (let step = 0; step < steps; step++) {
    atX += stepX;
    stepX += growX;
    atY += stepY;
    stepY += growY;

    const toX = (atX + half) >> shift;
    const toY = (atY + half) >> shift;

    // Each chord is an element in its own right, endpoint and all.
    ends.check(toX, toY, dropout);
    calcLine(lists, fromX, fromY, toX, toY, dropout);

    fromX = toX;
    fromY = toY;
  }
}

/**
 * The conic walk the document describes, kept for the test that checks our
 * reading of it against an independent transcription. Nothing draws with it:
 * see `evaluateSpline` for what the binary does instead.
 */
export function calcSpline(
  lists: Lists,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  dropout = true
) {
  let quadrant: number;
  let q: number;
  let y: number;
  let yStop: number;
  let yIncrement: number;
  let yOffset: number;
  let controlY: number;
  let terminalY: number;
  let initialYStep: number;

  if (y3 > y1) {
    q = 0;
    quadrant = 1;
    const initial = above(y1);
    initialYStep = initial - y1;
    y = initial >> SHIFT;
    yStop = (below(y3) >> SHIFT) + 1;
    yIncrement = 1;
    yOffset = 0;
    controlY = y2 - y1;
    terminalY = y3 - y1;
  } else {
    q = 1;
    quadrant = 4;
    const initial = below(y1);
    initialYStep = y1 - initial;
    y = initial >> SHIFT;
    yStop = (above(y3) >> SHIFT) - 1;
    yIncrement = -1;
    yOffset = 1;
    controlY = y1 - y2;
    terminalY = y1 - y3;
  }

  let x: number;
  let xStop: number;
  let xIncrement: number;
  let xOffset: number;
  let controlX: number;
  let terminalX: number;
  let initialXStep: number;

  if (x3 > x1) {
    const initial = above(x1);
    initialXStep = initial - x1;
    x = initial >> SHIFT;
    xStop = (below(x3) >> SHIFT) + 1;
    xIncrement = 1;
    xOffset = 0;
    controlX = x2 - x1;
    terminalX = x3 - x1;
  } else {
    q = 1 - q;
    quadrant += yIncrement;
    const initial = below(x1);
    initialXStep = x1 - initial;
    x = initial >> SHIFT;
    xStop = (above(x3) >> SHIFT) - 1;
    xIncrement = -1;
    xOffset = 1;
    controlX = x1 - x2;
    terminalX = x1 - x3;
  }

  const { addHoriz, addVert } = element(lists, quadrant);

  if (!dropout && y === yStop) {
    return;
  }

  if (x === xStop) {
    x += xOffset;

    while (y !== yStop) {
      addHoriz(x, y);
      y += yIncrement;
    }

    return;
  }

  if (dropout && y === yStop) {
    y += yOffset;

    while (x !== xStop) {
      addVert(x, y);
      x += xIncrement;
    }

    return;
  }

  let alpha = (controlX * terminalY - controlY * terminalX) * 2;

  const aBits = powerOfTwo(alpha);
  const xyBits = terminalX > terminalY ? powerOfTwo(terminalX) : powerOfTwo(terminalY);

  const zShift = Z_SHIFT[aBits + xyBits] ?? 3;
  const zBits = SHIFT - zShift;

  if (zShift > 0) {
    const zRound = 1 << (zShift - 1);

    controlX = (controlX + zRound) >> zShift;
    controlY = (controlY + zRound) >> zShift;
    terminalX = (terminalX + zRound) >> zShift;
    terminalY = (terminalY + zRound) >> zShift;

    initialXStep = (initialXStep + zRound) >> zShift;
    initialYStep = (initialYStep + zRound) >> zShift;

    alpha = (controlX * terminalY - controlY * terminalX) * 2;
  }

  const aX = terminalX - controlX * 2;
  const aY = terminalY - controlY * 2;

  const r = aY * aY;
  const s2 = -aX * aY;
  const t = aX * aX;
  const u2 = controlY * alpha;
  const v2 = -controlX * alpha;

  const zSubpix = 1 << zBits;

  let dQx: number;
  let dQy: number;
  let rZ: number;
  let sZ: number;
  let tZ: number;

  /* The shifts are written as multiplications: JavaScript's `<<` works on
   * thirty-two bits and these products do not always fit. The scan converter
   * picks `zShift` to keep them inside its own word, and borrowing the shift
   * without the word size silently loses the high bits.
   */
  /* `q`, the derivative terms and `r`, `s2`, `t`, `u2`, `v2` are all `int32` in
   * the scan converter, so a shift that leaves the word wraps rather than
   * growing -- and `u2 << 1` does leave it, `u2` being a control coordinate
   * times the curvature.
   */
  /* `q`, the derivative terms and `r`, `s2`, `t`, `u2` and `v2` are `int32` in
   * the scan converter, so in principle a shift leaving the word wraps rather
   * than growing. Measured over every curve of the fixture it never does: the
   * largest `rZ` is 1.5e8 against a limit of 2.1e9, and computing these with
   * thirty-two bit shifts throughout gives the identical result -- 586 letters
   * and 580 wrong pixels either way.
   */
  const up = (value: number, by: number) => value * 2 ** by;
  const down = (value: number, by: number) => Math.floor(value / 2 ** by);

  if (xyBits <= 7) {
    q +=
      (r * initialXStep + s2 * 2 * initialYStep + u2 * 2) * initialXStep +
      (t * initialYStep + v2 * 2) * initialYStep;
    dQx = up(r * (initialXStep * 2 + zSubpix) + (s2 * 2 * initialYStep + u2 * 2), zBits);
    dQy = up(t * (initialYStep * 2 + zSubpix) + (s2 * 2 * initialXStep + v2 * 2), zBits);

    rZ = up(r, zBits * 2);
    sZ = up(s2 * 2, zBits * 2);
    tZ = up(t, zBits * 2);
  } else {
    q +=
      down(down(r, 1) * initialXStep + s2 * initialYStep + u2, zBits) * initialXStep +
      down(down(t, 1) * initialYStep + v2, zBits) * initialYStep;
    dQx = r * (initialXStep + zSubpix / 2) + s2 * initialYStep + u2;
    dQy = t * (initialYStep + zSubpix / 2) + s2 * initialXStep + v2;

    rZ = up(r, zBits - 1);
    sZ = up(s2, zBits);
    tZ = up(t, zBits - 1);
  }

  const ddQx = rZ * 2;
  const ddQy = tZ * 2;

  /* Without dropout control the walk records only horizontal crossings, tests a
   * different derivative, and has already stepped `x` past the offset -- three
   * differences, all of which move where a nearly horizontal curve puts its
   * crossing.
   */
  if (!dropout) {
    x += xOffset;
    xStop += xOffset;

    if (alpha > 0) {
      while (x !== xStop && y !== yStop) {
        if (q < 0 || dQy > tZ) {
          x += xIncrement;
          q += dQx;
          dQx += ddQx;
          dQy += sZ;
        } else {
          addHoriz(x, y);
          y += yIncrement;
          q += dQy;
          dQy += ddQy;
          dQx += sZ;
        }
      }
    } else {
      while (x !== xStop && y !== yStop) {
        if (q < 0 || dQx > rZ) {
          addHoriz(x, y);
          y += yIncrement;
          q += dQy;
          dQy += ddQy;
          dQx += sZ;
        } else {
          x += xIncrement;
          q += dQx;
          dQx += ddQx;
          dQy += sZ;
        }
      }
    }

    while (y !== yStop) {
      addHoriz(x, y);
      y += yIncrement;
    }

    return;
  }

  /* Which way to step: the sign of the conic form, or the derivative running
   * ahead of its comparand.
   *
   * The guard reads differently in the two branches the pseudocode gives --
   * `dQy` against `tZ` where the curve bends one way and `dQx` against `rZ`
   * where it bends the other -- which is not a contradiction but the same test
   * taken along whichever axis is doing the leading.
   *
   * It earns its place and barely speaks. Over the recorded letters the walk
   * takes 750 steps, of which the sign of the form decides 535 and the guard is
   * true on twelve, deciding seven the sign alone would have sent the other way.
   * An earlier reading here had the derivative several times its comparand on
   * every step and the guard firing always, which was a shift out of place in
   * `rZ` and `tZ` rather than anything about the rule.
   */

  if (alpha > 0) {
    while (x !== xStop && y !== yStop) {
      if (q < 0 || dQy > tZ) {
        addVert(x, y + yOffset);
        x += xIncrement;
        q += dQx;
        dQx += ddQx;
        dQy += sZ;
      } else {
        addHoriz(x + xOffset, y);
        y += yIncrement;
        q += dQy;
        dQy += ddQy;
        dQx += sZ;
      }
    }
  } else {
    while (x !== xStop && y !== yStop) {
      if (q < 0 || dQx > rZ) {
        addHoriz(x + xOffset, y);
        y += yIncrement;
        q += dQy;
        dQy += ddQy;
        dQx += sZ;
      } else {
        addVert(x, y + yOffset);
        x += xIncrement;
        q += dQx;
        dQx += ddQx;
        dQy += sZ;
      }
    }
  }

  while (x !== xStop) {
    addVert(x, y + yOffset);
    x += xIncrement;
  }

  while (y !== yStop) {
    addHoriz(x + xOffset, y);
    y += yIncrement;
  }
}
