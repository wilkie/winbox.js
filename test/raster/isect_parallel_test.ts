/**
 * @jest-environment jsdom
 *
 * What `ISECT` does when the two lines barely cross.
 *
 * The reference divides unless its denominator is exactly nought, so two lines a
 * fraction of a degree apart put the point an enormous distance away. Ours used
 * to take the midpoint whenever they were within about three degrees, on an
 * unexplained constant, and no recording could tell the difference because no
 * fixture had a near-parallel `ISECT` in it.
 *
 * These three do. The same five points every time, only the second line's far
 * end moving: at right angles, half a degree apart, and exactly parallel. Each
 * runs one `ISECT` and reports where the point landed.
 *
 * The point of the test is not that we match everywhere -- in the grazing case
 * we cannot, and the reason is the finding. It is that the fragility is real in
 * Windows, which the crossing and parallel cases pin down as controls.
 */

'use strict';

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { TrueTypeFont } from '../../src/raster/truetype-font.js';
import { prepareFonts } from '../oracle/replay.js';

const CASES = ['isect-crossing', 'isect-grazing', 'isect-parallel'] as const;

/** Sizes where the grazing answer matches Windows to the pixel. A floor. */
const EXACT = 10;

function readingsOf(name: string, font: any) {
  const fixture = JSON.parse(
    readFileSync(`oracle/fixtures/fabricated/hinting-${name}.json`, 'utf8')
  );
  const glyph = font.glyphFor('m'.charCodeAt(0));
  const out = new Map<number, { windows: number; ours: number }>();

  for (const record of fixture.records) {
    if (!/^"Arial",h=\d+,italic=1,'m'$/.test(record.args ?? '')) {
      continue;
    }

    const answer = /advance=(-?\d+),ppem=(\d+)/.exec(record.result);

    if (!answer || out.has(Number(answer[2]))) {
      continue;
    }

    font._hinters = undefined;

    out.set(Number(answer[2]), {
      windows: Number(answer[1]),
      ours: font.hintedAdvance(glyph, Number(answer[2])),
    });
  }

  return out;
}

if (!CASES.every((name) => existsSync(`oracle/fixtures/fabricated/hinting-${name}.json`))) {
  describe('ISECT on lines that barely cross', () => {
    it.skip('needs the recordings; run the oracle pipeline', () => {});
  });
} else {
  describe('ISECT on lines that barely cross', () => {
    let cross: Map<number, { windows: number; ours: number }>;
    let graze: Map<number, { windows: number; ours: number }>;
    let parallel: Map<number, { windows: number; ours: number }>;
    let live: number[];

    beforeAll(async () => {
      await prepareFonts();

      const read = (name: string) => {
        const dir = join('oracle/build/fonts', name);
        return readingsOf(
          name,
          new TrueTypeFont(new Uint8Array(readFileSync(join(dir, readdirSync(dir)[0]))))
        );
      };

      cross = read('isect-crossing');
      graze = read('isect-grazing');
      parallel = read('isect-parallel');

      /* Arial Italic has an `hdmx`, and a size it covers is answered from that
       * without the program running. Those sizes report the letter's own width
       * for all three, so a size counts as read only where the grazing answer
       * differs from the crossing one.
       */
      live = [...graze.keys()].filter(
        (ppem) => graze.get(ppem)!.windows !== cross.get(ppem)?.windows
      );
    }, 180000);

    it('divides rather than taking the midpoint, in Windows', () => {
      expect(live.length).toBeGreaterThan(20);

      for (const ppem of live) {
        // The controls put the point inside the glyph, a few pixels across.
        expect(Math.abs(cross.get(ppem)!.windows)).toBeLessThan(40);
        expect(Math.abs(parallel.get(ppem)!.windows)).toBeLessThan(40);

        /* Half a degree of angle puts it hundreds of pixels away instead, and
         * the direction is not stable: at some sizes Windows reports the point
         * five hundred pixels to the left rather than two hundred to the right.
         * Which side of the near-parallel pair the rounding lands on decides it,
         * which is the fragility saying so out loud.
         */
        expect(Math.abs(graze.get(ppem)!.windows)).toBeGreaterThan(60);
      }
    });

    it('agrees exactly where the lines properly cross, and where they do not cross at all', () => {
      for (const ppem of live) {
        expect(cross.get(ppem)!.ours).toBe(cross.get(ppem)!.windows);
        expect(parallel.get(ppem)!.ours).toBe(parallel.get(ppem)!.windows);
      }
    });

    it('cannot agree everywhere on the grazing pair, and says how far', () => {
      const exact = live.filter(
        (ppem) => graze.get(ppem)!.ours === graze.get(ppem)!.windows
      ).length;

      /* Dividing by a denominator near nought multiplies whatever the inputs
       * disagree by, and the inputs are sixty-fourths. A sixty-fourth of angle
       * on a point two hundred pixels out is tens of pixels, so matching at all
       * is the surprise and matching everywhere is not available.
       */
      expect(exact).toBeGreaterThanOrEqual(EXACT);

      console.log(
        `  ISECT: ${live.length} sizes read; crossing and parallel exact at all of them, ` +
          `grazing exact at ${exact}`
      );
    });
  });
}
