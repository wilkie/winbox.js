/**
 * @jest-environment jsdom
 *
 * The size at which a dropout stops being rescued, and the order that decides it.
 *
 * `oracle/probes/dropsize.c` draws the same sub-pixel bar at every cell height
 * from sixteen to seventy, then one at a time across the crossing, against two
 * fabrications: one whose glyph is the bar alone and one that carries a ballast
 * so the box is wide. On a VGA the ballasted bar is rescued to a cell of
 * fifty-four and refused from fifty-five, which is forty-seven pixels per em
 * and forty-eight; the bare bar is drawn at every size, as a collapsed box
 * always is.
 *
 * `oracle/probes/dropdown.c` is the same sweep walked downward, so every size
 * is realized having seen only larger ones rather than only smaller ones. On a
 * VGA the two are identical, record for record.
 *
 * On an EGA they are not, and that is the second thing these recordings hold.
 * **Nothing stops on a non-square pixel**: every one of the twelve bars is
 * rescued at every height to seventy, which is fifty-one pixels per em down the
 * page and sixty-eight across. So the cap is not a threshold on either size --
 * reading it as the vertical one costs 325 and 330 of the 420, and as the
 * horizontal one 244 and 249 -- it applies only where the pixel is square.
 *
 * **Except at one height, and that one is not a size rule at all.** The
 * descending sweep disagrees with the ascending one at exactly one cell, its
 * first: seventy, the only size either sweep realizes cold. A face realized for
 * the first time in a process on a non-square pixel is scan-converted without
 * dropout control, and the answer is then cached for that size for the life of
 * the process. `oracle/probes/scanleak.c` is what pins that down; see
 * `FONTS.md` 8g. Nothing here models it, so the five records of that height are
 * the five this cannot reproduce.
 */

'use strict';

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { FontManager } from '../../src/win16/font-manager.js';
import { TrueTypeFont } from '../../src/raster/truetype-font.js';
import { prepareFonts, replayRecord } from '../oracle/replay.js';

const FIXTURES = 'oracle/fixtures/fabricated';
const FONTS = 'oracle/build/fonts';

/* Ceilings, and none may rise. The one short of everything is the cold
 * realization described above.
 */
const EXPECTED: Record<string, { agreed: number; total: number }> = {
  'dropsize-times-hairs': { agreed: 420, total: 420 },
  'dropsize-times-bare-hairs': { agreed: 420, total: 420 },
  'dropsize-times-beside': { agreed: 336, total: 336 },
  'dropdown-times-hairs': { agreed: 420, total: 420 },
  'dropsize-times-hairs-ega': { agreed: 420, total: 420 },
  'dropsize-times-bare-hairs-ega': { agreed: 420, total: 420 },
  'dropdown-times-hairs-ega': { agreed: 415, total: 420 },
};

function recordings() {
  if (!existsSync(FIXTURES) || !existsSync(FONTS)) {
    return [];
  }

  return Object.keys(EXPECTED)
    .map((name) => {
      const path = join(FIXTURES, `${name}.json`);

      if (!existsSync(path)) {
        return null;
      }

      const fixture = JSON.parse(readFileSync(path, 'utf8'));
      const directory = join(FONTS, String(fixture.font));

      return existsSync(directory)
        ? { name, fixture, file: join(directory, readdirSync(directory)[0]) }
        : null;
    })
    .filter(Boolean) as any[];
}

const all = recordings();

if (all.length === 0) {
  describe('where a dropout stops being rescued', () => {
    it.skip('needs the dropsize recordings; run the oracle pipeline', () => {});
  });
} else {
  describe('where a dropout stops being rescued', () => {
    it('stops where Windows stops', async () => {
      const report: string[] = [];

      for (const recording of all) {
        const display = recording.fixture.display ?? 'vga';
        const manager: any = await prepareFonts(display);
        const font: any = new TrueTypeFont(new Uint8Array(readFileSync(recording.file)));
        const face = font.faceName;
        const installed = manager._outlines[face];

        manager._outlines[face] = {
          ...(installed ?? {}),
          [FontManager.styleKey(font.boldFace, font.italicFace)]: font,
        };

        let agreed = 0;
        let total = 0;

        try {
          for (const record of recording.fixture.records) {
            total++;

            const replayed = await replayRecord(record, display);

            agreed += replayed.outcome === 'agreed' ? 1 : 0;
          }
        } finally {
          if (installed) {
            manager._outlines[face] = installed;
          } else {
            delete manager._outlines[face];
          }
        }

        const want = EXPECTED[recording.name];

        report.push(`${recording.name.padEnd(30)} ${agreed}/${total}  (${display})`);

        expect(agreed).toBeGreaterThanOrEqual(want.agreed);
        expect(total).toBe(want.total);
      }

      console.log(report.join('\n'));
    }, 3600000);
  });
}
