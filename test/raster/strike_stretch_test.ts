/**
 * @jest-environment jsdom
 *
 * How many times over a strike is drawn, and how many times across.
 *
 * A bitmap face has a handful of strikes and is asked for every size, so most
 * sizes are answered by drawing a smaller strike a whole number of times over.
 * Which strike and how many times is a question the sparse sweep could not
 * answer: it jumped 24, 29, 37, and every threshold that matters falls inside
 * one of those gaps. This reads the dense one -- every height from one to
 * forty, then every third to a hundred and twenty.
 *
 * Two faces have exactly one strike each, which makes them the clean case:
 * there is no choice of strike to confound the multiple. Fixedsys is fifteen
 * rows and System is sixteen, and both step at `cell * m - offset` with a
 * constant offset -- three and four respectively, which is a quarter of the
 * cell. So the multiple is `floor((height + cell / 4) / cell)`, and a request
 * can come back *taller* than it asked for: twenty-eight pixels of System is
 * answered with thirty-two.
 *
 * That is the whole of what is settled. The choice *between* strikes is not:
 * see `FONTS.md` section 3 for what Courier and Small Fonts still do that no
 * rule tried here reproduces.
 */

'use strict';

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURE = join(__dirname, '..', '..', 'oracle', 'fixtures', 'font.json');

/** Every recorded cell height for one face, by the height asked for. */
function heightsOf(face: string) {
  const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  const out = new Map<number, number>();

  for (const record of fixture.records) {
    if (record.function !== 'CreateFont heights') {
      continue;
    }

    const asked = new RegExp(`^"${face}",h=(\\d+),w=0,weight=400,italic=0,`).exec(record.args);

    if (asked && Number(asked[1]) > 0) {
      out.set(Number(asked[1]), Number(/height=(\d+)/.exec(record.result)![1]));
    }
  }

  return out;
}

if (!existsSync(FIXTURE)) {
  describe('the whole-number stretch', () => {
    it.skip('needs the recordings; run the oracle pipeline', () => {});
  });
} else {
  describe('the whole-number stretch', () => {
    /* The two single-strike faces, and the cell each one holds. */
    for (const [face, cell] of [
      ['Fixedsys', 15],
      ['System', 16],
    ] as const) {
      it(`steps ${face} a quarter of a cell early`, () => {
        const heights = heightsOf(face);

        expect(heights.size).toBeGreaterThan(60);

        for (const [asked, got] of heights) {
          const times = Math.max(1, Math.min(8, Math.floor((asked + (cell >> 2)) / cell)));

          expect([asked, got]).toEqual([asked, cell * times]);
        }
      });
    }

    it('never draws a strike more than eight times over', () => {
      /* Both faces are asked for up to a hundred and twenty pixels, which is
       * eight of Fixedsys and seven and a half of System. Neither goes further,
       * and Fixedsys stopping exactly at eight is what pins the cap: nine would
       * have answered 135 somewhere in the sweep and does not.
       */
      const fixed = heightsOf('Fixedsys');

      expect(Math.max(...fixed.values())).toBe(120);
      expect(fixed.get(120)).toBe(120);
    });
  });
}
