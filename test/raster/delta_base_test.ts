/**
 * @jest-environment jsdom
 *
 * Which size a delta exception names.
 *
 * A `DELTAP` exception packs a size and a nudge into one byte: the high nibble
 * counts sizes from the *delta base* and the low nibble says how far to move.
 * The base is a number a font may set with `SDB` and none of the installed ones
 * do -- not Arial, not Times New Roman, not Courier New, in any weight -- so it
 * is the scaler's own constant, and until now nothing measured had pinned it.
 *
 * `delta-ascending` could not, though it looks as if it should: its sixteen
 * exceptions cover every nibble and all move by the same amount, so whatever
 * the base is, one of them fires and the reading is identical. A sweep that
 * cannot tell its answers apart measures nothing.
 *
 * These sixteen each move by a different amount -- nibble `n` by `n` steps,
 * which at the default shift is `n` eighths of a pixel -- so the reading says
 * *which* exception fired, and the base falls out of it. Against the control,
 * which is the same point with no delta at all, every size that reports at all
 * moves by exactly the amount the exception for `ppem - 9` carries.
 *
 * **Measured**: the base is 9, which is what the reference sets it to. Five
 * sizes report; the rest are answered from `hdmx` and say nothing either way,
 * which is why the readable ones are named individually rather than counted.
 */

'use strict';

import { existsSync } from 'node:fs';

import { advanceOf, fixtureFor, ppemOf, readingsOf, type Reading } from './readout.js';

/** Only the fabricated letter reports anything; the rest of the sweep is noise. */
const ASKED = /^"Arial",h=(\d+),italic=1,'m'$/;

const CASES = ['delta-base-sweep', 'delta-base-control'] as const;

/**
 * How far the exception for a nibble moves the point, in the reading's units.
 *
 * The low nibble runs 0..15 and means -8..-1 then 1..8 -- there is no zero
 * step -- and the reading magnifies by eight, which cancels the shift of three
 * exactly. So the answer is the step itself.
 */
function stepFor(nibble: number) {
  return nibble - (nibble >= 8 ? 7 : 8);
}

if (!CASES.every((name) => existsSync(fixtureFor(name)))) {
  describe('the size a delta exception names', () => {
    it.skip('needs the recordings; run the oracle pipeline', () => {});
  });
} else {
  describe('the size a delta exception names', () => {
    let sweep: Map<number, Reading>;
    let control: Map<number, Reading>;

    beforeAll(async () => {
      sweep = await readingsOf('delta-base-sweep', ASKED);
      control = await readingsOf('delta-base-control', ASKED);
    }, 300000);

    it('counts sizes from nine', () => {
      /* One height per pixels-per-em: the sweep asks for many cell heights and
       * several of them fit the same size, which would count one answer twice.
       */
      const byPpem = new Map<number, number>();

      for (const [height, reading] of control) {
        if (!byPpem.has(ppemOf(reading))) {
          byPpem.set(ppemOf(reading), height);
        }
      }

      const moved: number[] = [];

      for (const [ppem, height] of byPpem) {
        const shift = advanceOf(sweep.get(height)!) - advanceOf(control.get(height)!);

        if (shift !== 0) {
          moved.push(ppem);
          expect([ppem, shift]).toEqual([ppem, stepFor(ppem - 9)]);
        }
      }

      /* Named rather than counted, so that a reading which stops reporting
       * fails here instead of quietly leaving the claim resting on fewer.
       */
      expect(moved).toEqual([10, 18, 20, 22, 23]);
    });

    for (const name of CASES) {
      it(`agrees with Windows on ${name}`, async () => {
        const readings = await readingsOf(name, ASKED);

        expect([...readings.values()].filter((reading) => !reading.agreed)).toEqual([]);
      });
    }
  });
}
