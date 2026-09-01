/**
 * @jest-environment jsdom
 *
 * Whether a delta list has to arrive sorted by size.
 *
 * `DELTAP` and `DELTAC` carry a list of exceptions, each naming a size and a
 * nudge, and the obvious reading is a walk down the list applying the ones that
 * name the size being drawn at. A walk cannot care what order the list is in.
 *
 * Windows does care. The two fabrications hold the same sixteen exceptions --
 * one for every size the first delta band covers, each moving the reported
 * point a whole pixel -- and differ only in the order they sit on the stack.
 * Ascending, the exception lands; descending, it does not, and the reading is a
 * whole pixel short at every size where the two can be told apart.
 *
 * So the list is not walked. It is searched, by halving, as if it were sorted,
 * and then read forward only until a size past the wanted one turns up. A font
 * that lists its exceptions out of order loses them, and that is the behaviour
 * to match rather than an optimisation to see through.
 */

'use strict';

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { FontManager } from '../../src/win16/font-manager.js';
import { TrueTypeFont } from '../../src/raster/truetype-font.js';
import { prepareFonts, replayRecord } from '../oracle/replay.js';

const CASES = ['delta-ascending', 'delta-descending'] as const;
const FONTS = 'oracle/build/fonts';

const fixtureFor = (name: string) => `oracle/fixtures/fabricated/hinting-${name}.json`;

/** Only the fabricated letter reports anything; the rest of the sweep is noise. */
const ASKED = /^"Arial",h=(\d+),italic=1,'m'$/;

/** What is left. */
const DIFFER: Record<string, number> = {
  'delta-ascending': 0,
  'delta-descending': 0,
};

async function readingsOf(name: string) {
  const fixture = JSON.parse(readFileSync(fixtureFor(name), 'utf8'));
  const dir = join(FONTS, String(fixture.font));
  const manager: any = await prepareFonts();
  const font: any = new TrueTypeFont(new Uint8Array(readFileSync(join(dir, readdirSync(dir)[0]))));
  const face = font.faceName;
  const installed = manager._outlines[face];

  manager._outlines[face] = {
    ...(installed ?? {}),
    [FontManager.styleKey(font.boldFace, font.italicFace)]: font,
  };

  const out = new Map<number, { windows: string; agreed: boolean }>();

  try {
    for (const record of fixture.records) {
      const asked = ASKED.exec(record.args ?? '');

      if (!asked) {
        continue;
      }

      out.set(Number(asked[1]), {
        windows: record.result,
        agreed: (await replayRecord(record, fixture.display ?? 'vga')).outcome === 'agreed',
      });
    }
  } finally {
    manager._outlines[face] = installed;
  }

  return out;
}

if (!CASES.every((name) => existsSync(fixtureFor(name)))) {
  describe('the order a delta list arrives in', () => {
    it.skip('needs the recordings; run the oracle pipeline', () => {});
  });
} else {
  describe('the order a delta list arrives in', () => {
    let all: Map<string, Map<number, { windows: string; agreed: boolean }>>;
    let live: number[];

    beforeAll(async () => {
      all = new Map();

      for (const name of CASES) {
        all.set(name, await readingsOf(name));
      }

      const up = all.get('delta-ascending')!;
      const down = all.get('delta-descending')!;

      live = [...up.keys()].filter(
        (height) => up.get(height)!.windows !== down.get(height)?.windows
      );
    }, 300000);

    it('decides whether the exception is found at all', () => {
      /* The same sixteen exceptions, the same sizes, the same everything but
       * the order. A list that is walked cannot tell them apart, so any size
       * where Windows does is a size where it did not walk.
       */
      expect(live.length).toBeGreaterThan(0);

      const up = all.get('delta-ascending')!;
      const down = all.get('delta-descending')!;

      for (const height of live) {
        const before = /advance=(-?\d+)/.exec(up.get(height)!.windows)![1];
        const after = /advance=(-?\d+)/.exec(down.get(height)!.windows)![1];

        /* One exception's worth: a whole pixel at the default delta shift,
         * times the eight the reading is magnified by. Sorted finds it, out of
         * order loses it, and nothing else moves.
         */
        expect(Number(before) - Number(after)).toBe(8);
      }
    });

    for (const name of CASES) {
      it(`agrees with Windows on ${name}`, () => {
        const readings = all.get(name)!;
        const differ = [...readings.entries()].filter(([, reading]) => !reading.agreed);

        expect(differ.map(([height]) => height).length).toBeLessThanOrEqual(DIFFER[name]);
      });
    }
  });
}
