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

  private horizTopology(x: number, y: number) {
    if (y > this.y1) {
      if (this.y1 > this.y0) {
        this.addHorizOn();
      } else if (this.y1 < this.y0) {
        this.addHorizOn();
        this.addHorizOff();
      } else if (this.x1 < this.x0) {
        this.addHorizOn();
      }
    } else if (y < this.y1) {
      if (this.y1 > this.y0) {
        this.addHorizOn();
        this.addHorizOff();
      } else if (this.y1 < this.y0) {
        this.addHorizOff();
      } else if (this.x1 > this.x0) {
        this.addHorizOff();
      }
    } else if (this.y1 > this.y0) {
      if (x > this.x1) {
        this.addHorizOn();
      }
    } else if (this.y1 < this.y0) {
      if (x < this.x1) {
        this.addHorizOff();
      }
    } else if (this.x1 > this.x0 && x < this.x1) {
      this.addHorizOff();
    } else if (this.x1 < this.x0 && x > this.x1) {
      this.addHorizOn();
    }
  }

  private vertTopology(x: number, y: number) {
    if (x < this.x1) {
      if (this.x1 < this.x0) {
        this.addVertOn();
      } else if (this.x1 > this.x0) {
        this.addVertOn();
        this.addVertOff();
      } else if (this.y1 < this.y0) {
        this.addVertOn();
      }
    } else if (x > this.x1) {
      if (this.x1 < this.x0) {
        this.addVertOn();
        this.addVertOff();
      } else if (this.x1 > this.x0) {
        this.addVertOff();
      } else if (this.y1 > this.y0) {
        this.addVertOff();
      }
    } else if (this.x1 < this.x0) {
      if (y > this.y1) {
        this.addVertOn();
      }
    } else if (this.x1 > this.x0) {
      if (y < this.y1) {
        this.addVertOff();
      }
    } else if (this.y1 > this.y0 && y < this.y1) {
      this.addVertOff();
    } else if (this.y1 < this.y0 && y > this.y1) {
      this.addVertOn();
    }
  }

  /** The next point along the contour. */
  check(x: number, y: number) {
    (globalThis as any).__wbCheck?.(
      this.x0,
      this.y0,
      this.x1,
      this.y1,
      x,
      y,
      this.onScanline(this.y1)
    );

    if (this.onScanline(this.y1)) {
      if (!(this.x1 === x && this.y1 === y)) {
        if (this.x0 === Infinity) {
          this.secondX = x;
          this.secondY = y;
          this.started = true;
        } else {
          this.horizTopology(x, y);
        }
      }
    }

    if (this.onScanline(this.x1)) {
      if (!(this.x1 === x && this.y1 === y)) {
        if (this.x0 === Infinity) {
          this.secondX = x;
          this.secondY = y;
          this.started = true;
        } else {
          this.vertTopology(x, y);
        }
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
export function calcLine(lists: Lists, x1: number, y1: number, x2: number, y2: number) {
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

  const { addHoriz, addVert } = element(lists, quadrant);

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

/** A quadratic, walked as a conic forward difference. */
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

  /* Which way to step.
   *
   * The pseudocode gives this as `q < 0 || dQx > rZ` in the dropout branch and
   * `q < 0 || dQy > tZ` in the other, which cannot both be the same decision.
   * Neither works: the derivative term is already several times its comparand
   * when the walk starts -- for one curve of Arial's `R` at twelve pixels per
   * em, `dQx` is 5,417,728 against an `rZ` of 1,478,656 -- so the guard fires on
   * the first step and every step after, and the walk takes all of its sideways
   * steps before any of its downward ones.
   *
   * The sign of the conic form on its own is what a forward-difference walk
   * tests, and measured it is right: 99.5% of curves then step where an exact
   * solve puts them, against 91.1% for the first reading and 90.9% for the
   * second.
   */
  const stepX = () => q < 0;

  if (alpha > 0) {
    while (x !== xStop && y !== yStop) {
      if (stepX()) {
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
      if (stepX()) {
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
