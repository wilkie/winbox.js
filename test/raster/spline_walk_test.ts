/**
 * @jest-environment jsdom
 *
 * The walk against a second reading of the same pseudocode.
 *
 * `CalcSpline` is the one part of the scan converter written out instruction by
 * instruction in `FONT_PIXEL_CANDIDATES.md`, and the implementation in
 * `scan-walk.ts` is a transcription of it. Whether it is a *faithful*
 * transcription is not something reading it twice can settle, because the
 * second reading is done by whoever did the first.
 *
 * So this is a separate transcription, written from the document rather than
 * from the implementation, and the two are run against each other on twenty
 * thousand shapes. It is not a test of whether either matches Windows -- the
 * fixtures do that -- but of whether the implementation has drifted from the
 * thing it claims to be, which nothing else here would catch.
 *
 * What it catches was checked rather than assumed. Displacing an emitted
 * coordinate by one fails it. Adding one to `rZ` does not, and neither does
 * turning the derivative guard's `>` into `>=`: that guard decides seven steps
 * in seven hundred and fifty over the recorded letters, and it is rare for it
 * to sit exactly on its own boundary. So this covers the stepping and the
 * emissions closely and the guard's comparands loosely.
 */

'use strict';

import { calcSpline, empty } from '../../src/raster/scan-walk.js';

/* `CalcSpline`, transcribed from `FONT_PIXEL_CANDIDATES.md` without reference
 * to the implementation, so that comparing the two says whether the
 * implementation is the pseudocode or merely resembles it.
 */
const SUB = 64,
  HALF = 32,
  SHIFT = 6;
const ScanAbove = (p: number) => ((p + HALF) & -SUB) + HALF;
const ScanBelow = (p: number) => ((p - HALF - 1) & -SUB) + HALF;
const Z = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1,
  2, 2, 2, 3, 3,
];

function PowerOf2(n: number) {
  let v = Math.abs(n);
  if (v === 0) return 0;
  let shifts = 0;
  for (const step of [16, 8, 4, 2])
    if (v >= 1 << step) {
      v >>>= step;
      shifts += step;
    }
  if (v >= 2) shifts += 1;
  return shifts + 1;
}

function reference(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  dropout: boolean
) {
  const out: any[] = [];
  const AddHoriz = (x: number, y: number) => out.push(['h', x, y]);
  const AddVert = (x: number, y: number) => out.push(['v', x, y]);

  let q: number, quadrant: number, y: number, yStop: number, yIncrement: number, yOffset: number;
  let controlY: number, terminalY: number, initialY: number, initialYStep: number;

  if (y3 > y1) {
    q = 0;
    quadrant = 1;
    initialY = ScanAbove(y1);
    initialYStep = initialY - y1;
    y = initialY >> SHIFT;
    yStop = (ScanBelow(y3) >> SHIFT) + 1;
    yIncrement = 1;
    yOffset = 0;
    controlY = y2 - y1;
    terminalY = y3 - y1;
  } else {
    q = 1;
    quadrant = 4;
    initialY = ScanBelow(y1);
    initialYStep = y1 - initialY;
    y = initialY >> SHIFT;
    yStop = (ScanAbove(y3) >> SHIFT) - 1;
    yIncrement = -1;
    yOffset = 1;
    controlY = y1 - y2;
    terminalY = y1 - y3;
  }

  let x: number, xStop: number, xIncrement: number, xOffset: number;
  let controlX: number, terminalX: number, initialX: number, initialXStep: number;

  if (x3 > x1) {
    initialX = ScanAbove(x1);
    initialXStep = initialX - x1;
    x = initialX >> SHIFT;
    xStop = (ScanBelow(x3) >> SHIFT) + 1;
    xIncrement = 1;
    xOffset = 0;
    controlX = x2 - x1;
    terminalX = x3 - x1;
  } else {
    q = 1 - q;
    quadrant = quadrant + yIncrement;
    initialX = ScanBelow(x1);
    initialXStep = x1 - initialX;
    x = initialX >> SHIFT;
    xStop = (ScanAbove(x3) >> SHIFT) - 1;
    xIncrement = -1;
    xOffset = 1;
    controlX = x1 - x2;
    terminalX = x1 - x3;
  }

  if (!dropout) {
    if (y === yStop) return { quadrant, calls: out };
    if (x === xStop) {
      x += xOffset;
      while (y !== yStop) {
        AddHoriz(x, y);
        y += yIncrement;
      }
      return { quadrant, calls: out };
    }
  } else {
    if (x === xStop) {
      x += xOffset;
      while (y !== yStop) {
        AddHoriz(x, y);
        y += yIncrement;
      }
      return { quadrant, calls: out };
    }
    if (y === yStop) {
      y += yOffset;
      while (x !== xStop) {
        AddVert(x, y);
        x += xIncrement;
      }
      return { quadrant, calls: out };
    }
  }

  let alpha = (controlX * terminalY - controlY * terminalX) * 2;
  const aBits = PowerOf2(alpha);
  const xyBits = terminalX > terminalY ? PowerOf2(terminalX) : PowerOf2(terminalY);
  const zShift = Z[aBits + xyBits] ?? 3;
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

  const aX = terminalX - (controlX << 1);
  const aY = terminalY - (controlY << 1);
  const r = aY * aY,
    s2 = -aX * aY,
    t = aX * aX;
  const u2 = controlY * alpha,
    v2 = -controlX * alpha;

  const zSubpix = 1 << zBits;
  let dQx: number, dQy: number, rZ: number, sZ: number, tZ: number;
  const shl = (v: number, by: number) => v * 2 ** by;
  const shr = (v: number, by: number) => Math.floor(v / 2 ** by);

  if (xyBits <= 7) {
    q +=
      (r * initialXStep + shl(s2, 1) * initialYStep + shl(u2, 1)) * initialXStep +
      (t * initialYStep + shl(v2, 1)) * initialYStep;
    dQx = shl(
      r * (shl(initialXStep, 1) + zSubpix) + (shl(s2, 1) * initialYStep + shl(u2, 1)),
      zBits
    );
    dQy = shl(
      t * (shl(initialYStep, 1) + zSubpix) + (shl(s2, 1) * initialXStep + shl(v2, 1)),
      zBits
    );
    rZ = shl(r, zBits << 1);
    sZ = shl(shl(s2, 1), zBits << 1);
    tZ = shl(t, zBits << 1);
  } else {
    q +=
      shr(shr(r, 1) * initialXStep + s2 * initialYStep + u2, zBits) * initialXStep +
      shr(shr(t, 1) * initialYStep + v2, zBits) * initialYStep;
    dQx = r * (initialXStep + (zSubpix >> 1)) + s2 * initialYStep + u2;
    dQy = t * (initialYStep + (zSubpix >> 1)) + s2 * initialXStep + v2;
    rZ = shl(r, zBits - 1);
    sZ = shl(s2, zBits);
    tZ = shl(t, zBits - 1);
  }

  const ddQx = shl(rZ, 1),
    ddQy = shl(tZ, 1);

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
          AddHoriz(x, y);
          y += yIncrement;
          q += dQy;
          dQy += ddQy;
          dQx += sZ;
        }
      }
    } else {
      while (x !== xStop && y !== yStop) {
        if (q < 0 || dQx > rZ) {
          AddHoriz(x, y);
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
      AddHoriz(x, y);
      y += yIncrement;
    }
    return { quadrant, calls: out };
  }

  if (alpha > 0) {
    while (x !== xStop && y !== yStop) {
      if (q < 0 || dQy > tZ) {
        AddVert(x, y + yOffset);
        x += xIncrement;
        q += dQx;
        dQx += ddQx;
        dQy += sZ;
      } else {
        AddHoriz(x + xOffset, y);
        y += yIncrement;
        q += dQy;
        dQy += ddQy;
        dQx += sZ;
      }
    }
  } else {
    while (x !== xStop && y !== yStop) {
      if (q < 0 || dQx > rZ) {
        AddHoriz(x + xOffset, y);
        y += yIncrement;
        q += dQy;
        dQy += ddQy;
        dQx += sZ;
      } else {
        AddVert(x, y + yOffset);
        x += xIncrement;
        q += dQx;
        dQx += ddQx;
        dQy += sZ;
      }
    }
  }
  while (x !== xStop) {
    AddVert(x, y + yOffset);
    x += xIncrement;
  }
  while (y !== yStop) {
    AddHoriz(x + xOffset, y);
    y += yIncrement;
  }

  return { quadrant, calls: out };
}

/** The lists, as `BeginElement` sorts entries into them by quadrant. */
function walked(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  dropout: boolean
) {
  const lists = empty();

  calcSpline(lists, x1, y1, x2, y2, x3, y3, dropout);

  return JSON.stringify([
    [...lists.horizOn].sort(),
    [...lists.horizOff].sort(),
    [...lists.vertOn].sort(),
    [...lists.vertOff].sort(),
  ]);
}

/** And the same, from the reference, sorted the same way. */
function transcribed(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  dropout: boolean
) {
  const lists = empty();
  const { quadrant, calls } = reference(x1, y1, x2, y2, x3, y3, dropout);

  const horiz = quadrant === 1 || quadrant === 2 ? lists.horizOn : lists.horizOff;
  const vert = quadrant === 2 || quadrant === 3 ? lists.vertOn : lists.vertOff;

  for (const [kind, x, y] of calls) {
    const into = kind === 'h' ? horiz : vert;
    const key = kind === 'h' ? y : x;
    const value = kind === 'h' ? x : y;

    if (!into.has(key)) into.set(key, []);
    into.get(key).push(value);
  }

  return JSON.stringify([
    [...lists.horizOn].sort(),
    [...lists.horizOff].sort(),
    [...lists.vertOn].sort(),
    [...lists.vertOff].sort(),
  ]);
}

describe('the spline walk', () => {
  /* Shapes chosen to reach every branch: both directions in each axis, the
   * degenerate ones where a whole axis spans nothing, curves bending each way,
   * and sizes either side of where the precision reduction switches on.
   */
  it('is the pseudocode it was transcribed from, step for step', function () {
    let seed = 20260831;
    const next = (span: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;

      return (seed % (2 * span + 1)) - span;
    };

    let compared = 0;
    const differing: string[] = [];

    for (let i = 0; i < 20000; i++) {
      const span = i < 10000 ? 400 : 4000;
      const x1 = next(span),
        y1 = next(span);
      const x2 = next(span),
        y2 = next(span);
      const x3 = next(span),
        y3 = next(span);
      const dropout = (i & 1) === 0;

      compared++;

      const ours = walked(x1, y1, x2, y2, x3, y3, dropout);
      const theirs = transcribed(x1, y1, x2, y2, x3, y3, dropout);

      if (ours !== theirs && differing.length < 3) {
        differing.push(`(${x1},${y1}) (${x2},${y2}) (${x3},${y3}) dropout=${dropout}`);
      }
    }

    expect(compared).toBeGreaterThan(19000);
    expect(differing).toEqual([]);
  });
});
