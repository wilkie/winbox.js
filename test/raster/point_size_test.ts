/**
 * @jest-environment jsdom
 *
 * What `MPS` answers, which is nothing.
 *
 * The scaler keeps a point size beside the pixel size, and a font may ask for
 * it. What Windows puts there had been assumed: we answered the pixels-per-em
 * in sixty-fourths, on the reasoning that the two agree at seventy-two dots to
 * the inch and that the interpreter deals in sixty-fourths.
 *
 * Two fabrications ask. One puts the reply straight onto the advance phantom as
 * a coordinate, where a plain count of points is too small to read but a count
 * in sixty-fourths reads as itself; the other multiplies by sixty-four first,
 * where the plain count reads as itself. Either way a size that was really
 * there would show in one of them.
 *
 * Both read nought, so the field is nought and GDI never fills it in. The
 * channel is known to carry a number, because `getinfo-version` reports a three
 * through the same phantom in the same sweep.
 */

'use strict';

import { existsSync } from 'node:fs';
import { advanceOf, fixtureFor, readingsOf, type Reading } from './readout.js';

/** Only the fabricated letter reports anything; the rest of the sweep is noise. */
const ASKED = /^"Arial",h=(\d+),italic=1,'m'$/;

const CASES = ['mps-raw', 'mps-scaled'] as const;

/** The sizes the program runs at, told apart by a fabrication that answers. */
const LIVE = 'getinfo-nothing';

if (![...CASES, LIVE].every((name) => existsSync(fixtureFor(name)))) {
  describe('the point size MPS answers', () => {
    it.skip('needs the recordings; run the oracle pipeline', () => {});
  });
} else {
  describe('the point size MPS answers', () => {
    let all: Map<string, Map<number, Reading>>;
    let live: number[];

    beforeAll(async () => {
      all = new Map();

      for (const name of [...CASES, LIVE]) {
        all.set(name, await readingsOf(name, ASKED));
      }

      /* A size `hdmx` covers is answered without the program running, and
       * reports the letter's own width whatever the fabrication. A size where
       * a fabrication that always answers nought does so is a size that ran.
       */
      live = [...all.get(LIVE)!.keys()].filter(
        (height) => advanceOf(all.get(LIVE)!.get(height)!) === 0
      );
    }, 300000);

    it('is nought, in either unit', () => {
      expect(live.length).toBeGreaterThan(10);

      for (const name of CASES) {
        const readings = all.get(name)!;

        for (const height of live) {
          expect(advanceOf(readings.get(height)!)).toBe(0);
        }
      }
    });

    for (const name of CASES) {
      it(`agrees with Windows on ${name}`, () => {
        expect([...all.get(name)!.values()].filter((reading) => !reading.agreed).length).toBe(0);
      });
    }
  });
}
