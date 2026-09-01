/**
 * @jest-environment jsdom
 *
 * Which vector a twilight point is placed along.
 *
 * A twilight point has no outline behind it, so `MIAP` does not move it -- it
 * puts it there, at the control value's distance from the origin, along a
 * vector. Which vector was a guess: we used the one points are free to move
 * along, and the scaler uses the one distances are measured along. The two are
 * the same until a program separates them, and separating them is what diagonal
 * hinting does.
 *
 * `twilight-square` leaves both vectors on the x axis, where the question does
 * not arise, and is the control. `twilight-crossed` measures along x and frees
 * along y, then reads the placed point's coordinate back: placing along the
 * measuring vector puts it where the control did, and placing along the freeing
 * vector leaves it with no x at all.
 *
 * Both read the control value, so it is the measuring vector.
 */

'use strict';

import { existsSync } from 'node:fs';
import { advanceOf, fixtureFor, readingsOf, type Reading } from './readout.js';

/** Only the fabricated letter reports anything; the rest of the sweep is noise. */
const ASKED = /^"Arial",h=(\d+),italic=1,'m'$/;

const CASES = ['twilight-crossed', 'twilight-square'] as const;

/** The sizes the program runs at, told apart by a fabrication that answers nought. */
const LIVE = 'getinfo-nothing';

/** What the fabrications write into the control value table, in pixels. */
const WRITTEN = 24;

if (![...CASES, LIVE].every((name) => existsSync(fixtureFor(name)))) {
  describe('where a twilight point is put', () => {
    it.skip('needs the recordings; run the oracle pipeline', () => {});
  });
} else {
  describe('where a twilight point is put', () => {
    let all: Map<string, Map<number, Reading>>;
    let live: number[];

    beforeAll(async () => {
      all = new Map();

      for (const name of [...CASES, LIVE]) {
        all.set(name, await readingsOf(name, ASKED));
      }

      live = [...all.get(LIVE)!.keys()].filter(
        (height) => advanceOf(all.get(LIVE)!.get(height)!) === 0
      );
    }, 300000);

    it('is along the vector it is measured along', () => {
      expect(live.length).toBeGreaterThan(10);

      for (const height of live) {
        /* Crossed reads what square reads. Freeing along y while measuring
         * along x would have placed the point off the x axis entirely, and the
         * reading would have been nought rather than the value written.
         */
        expect(advanceOf(all.get('twilight-crossed')!.get(height)!)).toBe(WRITTEN);
        expect(advanceOf(all.get('twilight-square')!.get(height)!)).toBe(WRITTEN);
      }
    });

    for (const name of CASES) {
      it(`agrees with Windows on ${name}`, () => {
        expect([...all.get(name)!.values()].filter((reading) => !reading.agreed).length).toBe(0);
      });
    }
  });
}
