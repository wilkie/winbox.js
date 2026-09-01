/**
 * @jest-environment jsdom
 *
 * Whether the end of a thin run is drawn when nothing continues from it.
 *
 * `cour-bars` leaves the first and last row of an isolated upright bar undrawn
 * where Windows draws them, and the mechanism is known: a bar that thin and that
 * straight puts nothing in the vertical lists, so the stub check collapses to
 * "does the next row have crossings", which is false at both ends of any
 * isolated run. What was not known is whether continuation is what actually
 * decides it, since every fabrication that agrees -- `cour-shelves`,
 * `cour-feet`, `cour-phases` -- happens to give the check something to find.
 *
 * `cour-stubs` asks it directly: the same sub-pixel post four times over, with
 * an arm at the top, at the bottom, at both, and at neither. The arm is wide and
 * thick enough to be drawn outright, so it is continuation and nothing else.
 */

'use strict';

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { TrueTypeFont } from '../../src/raster/truetype-font.js';
import { prepareFonts, replayRecord } from '../oracle/replay.js';

const FIXTURE = 'oracle/fixtures/fabricated/glyphs-cour-stubs.json';
const FONTS = 'oracle/build/fonts';

/** The order `fabricate.mjs` lays the variants out in, nine glyphs each. */
const WIDE = 'ABEKMNRSWXZabdefgjkmnostwy0123456789';
const KIND = ['neither', 'top arm', 'foot arm', 'both'];

/** What is left: only the bare post disagrees, and only some of the time. */
const BARE = 36;

if (!existsSync(FIXTURE)) {
  describe('an arm at either end of a thin post', () => {
    it.skip('needs the recording; run the oracle pipeline', () => {});
  });
} else {
  describe('an arm at either end of a thin post', () => {
    let tally: Map<string, { cells: number; bad: number }>;

    beforeAll(async () => {
      const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));
      const dir = join(FONTS, String(fixture.font));
      const manager: any = await prepareFonts();
      const font: any = new TrueTypeFont(
        new Uint8Array(readFileSync(join(dir, readdirSync(dir)[0])))
      );
      const face = font.faceName;
      const installed = manager._outlines[face];

      manager._outlines[face] = { regular: font };
      tally = new Map();

      try {
        for (const record of fixture.records) {
          const asked = /^"([^"]+)",h=\d+,weight=400,italic=0,'(.)'$/.exec(record.args);

          if (!asked || asked[1] !== face) {
            continue;
          }

          const index = WIDE.indexOf(asked[2]);

          if (index < 0) {
            continue;
          }

          const kind = KIND[Math.floor(index / 9) % 4];
          const entry = tally.get(kind) ?? { cells: 0, bad: 0 };

          entry.cells++;

          if ((await replayRecord(record, fixture.display ?? 'vga')).outcome !== 'agreed') {
            entry.bad++;
          }

          tally.set(kind, entry);
        }
      } finally {
        manager._outlines[face] = installed;
      }
    }, 180000);

    it('is enough, wherever it is', () => {
      console.log(
        [...tally.entries()]
          .map(([kind, entry]) => `  ${kind.padEnd(9)} ${entry.cells} cells, ${entry.bad} disagree`)
          .join('\n')
      );

      /* An arm anywhere is sufficient, and it is sufficient at the far end as
       * well as the near one -- a post with an arm only at the top draws its
       * bare bottom row correctly too, which is not what a rule applied once per
       * row would give.
       */
      for (const kind of ['top arm', 'foot arm', 'both']) {
        expect(tally.get(kind)!.bad).toBe(0);
      }

      expect(tally.get('neither')!.bad).toBeLessThanOrEqual(BARE);
    });
  });
}
