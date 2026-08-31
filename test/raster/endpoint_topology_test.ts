/**
 * @jest-environment jsdom
 *
 * The endpoint topology decision, as GDI.EXE actually branches it.
 *
 * `CheckHorizTopology` in the pseudocode decides what a point sitting exactly on
 * a scanline contributes, from three comparisons. The shipped code decides the
 * same thing from precomputed flags instead: a quadrant, a cross product of the
 * incoming edge against the outgoing one, and two degeneracy bits. The two are
 * not the same function, and this pins down exactly how they differ, so that a
 * later change to either can be told from a change to both.
 *
 * The transcription is from segment 42 at 0x1390 through 0x1445, reached by the
 * recursive descent in `scripts/oracle/descend.mjs`. It is kept here rather than
 * in `src` because the implementation follows the pseudocode: the two are
 * indistinguishable on every fixture recorded so far, and the reason they are is
 * the property this file asserts.
 */

const ON = 'on';
const OFF = 'off';
const BOTH = 'on+off';
const NONE = '';

/** `CheckHorizTopology`, as the pseudocode states it and `scan-walk.ts` implements it. */
function stated(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number) {
  if (y2 > y1) {
    if (y1 > y0) return ON;
    if (y1 < y0) return BOTH;
    return x1 < x0 ? ON : NONE;
  }
  if (y2 < y1) {
    if (y1 > y0) return BOTH;
    if (y1 < y0) return OFF;
    return x1 > x0 ? OFF : NONE;
  }
  if (y1 > y0) return x2 > x1 ? ON : NONE;
  if (y1 < y0) return x2 < x1 ? OFF : NONE;
  if (x1 > x0 && x2 < x1) return OFF;
  if (x1 < x0 && x2 > x1) return ON;
  return NONE;
}

/** The same decision as GDI.EXE segment 42 branches it, at 0x1390. */
function compiled(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const quadrant = dx > 0 && dy >= 0 ? 1 : dx <= 0 && dy > 0 ? 2 : dx < 0 && dy <= 0 ? 3 : 4;
  const cross = (x1 - x0) * dy - (y1 - y0) * dx < 0;
  const flatX = dx === 0 && x0 === x1;
  const flatY = dy === 0 && y0 === y1;

  if ((cross || flatX) && (quadrant <= 2 ? y0 > y1 : y0 < y1)) return BOTH;
  if (quadrant <= 2) {
    if (cross) return ON;
    if (flatY && quadrant === 1 && x0 > x1) return ON;
  }
  if (y0 < y1 && y1 < y2) return ON;
  if (quadrant >= 3) {
    if (cross) return OFF;
    if (flatY && quadrant === 3 && x0 < x1) return OFF;
  }
  if (y0 > y1 && y1 > y2) return OFF;
  return NONE;
}

const RANGE = [-2, -1, 0, 1, 2];

function everyArrangement(visit: (p: number[]) => void) {
  for (const x0 of RANGE) {
    for (const y0 of RANGE) {
      for (const x1 of RANGE) {
        for (const y1 of RANGE) {
          for (const x2 of RANGE) {
            for (const y2 of RANGE) {
              visit([x0, y0, x1, y1, x2, y2]);
            }
          }
        }
      }
    }
  }
}

describe('the endpoint topology as GDI.EXE branches it', () => {
  it('disagrees with the pseudocode, and only ever about a coincident pair', () => {
    const kinds = new Map<string, number>();

    everyArrangement((p) => {
      const [x0, y0, x1, y1, x2, y2] = p;
      const a = stated(x0, y0, x1, y1, x2, y2);
      const b = compiled(x0, y0, x1, y1, x2, y2);

      if (a !== b) {
        const kind = `${a || '-'} -> ${b || '-'}`;
        kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
      }
    });

    // Both directions occur, so neither tree is a strict weakening of the other.
    expect([...kinds.keys()].sort()).toEqual(['- -> on+off', 'on+off -> -']);
  });

  it('cannot change a bitmap unless the point is a pixel centre in both axes', () => {
    /* Every disagreement is an `on` and an `off` together against neither. The
     * two go into different lists at `(x + 31) >> 6` and `(x + 32) >> 6`, which
     * name the same column unless x is itself on a scanline -- so the pair spans
     * no pixel, and adding it is the same as adding nothing. */
    const on = (x: number) => (x + 31) >> 6;
    const off = (x: number) => (x + 32) >> 6;

    for (let x = -4096; x <= 4096; x++) {
      if (((x % 64) + 64) % 64 === 32) {
        expect(off(x)).toBe(on(x) + 1);
      } else {
        expect(off(x)).toBe(on(x));
      }
    }
  });
});
