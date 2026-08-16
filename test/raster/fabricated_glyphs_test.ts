/**
 * @jest-environment jsdom
 *
 * Replaying the fabricated *glyph* recordings -- the pixels, not the advances.
 *
 * Sixteen of the recordings under `oracle/fixtures/fabricated/` were made with
 * the glyph probe rather than the hinting one, so each holds 846 monochrome
 * cells drawn by Windows from a font we built. Twelve of them replace Courier
 * New's letters with shapes chosen to isolate one variable of dropout control
 * -- bars of known width and phase, wedges, slants in both directions, a
 * mirrored pair, a phase sweep -- and four alter Times New Roman's `cvt`.
 *
 * They had been read once each by hand and then left, which is the wrong place
 * for three thousand records of pixel truth to sit. What makes them worth more
 * than the 846 recorded letters is that **nothing in them is hinted**: a shape
 * font carries no glyph program, so the outline the rasteriser is handed is
 * exactly the outline that was drawn, to the design unit. A disagreement here
 * cannot be blamed on the interpreter, which is the one thing a disagreement
 * about a letter can always be blamed on.
 *
 * That is what decided the column sweep, which is now gone: scored here,
 * deleting it was better on both counts -- 1,816 cells exact against 1,776 and
 * 6,892 wrong pixels against 7,171 -- while on the recorded letters deleting it
 * is worse, 369 wrong pixels against 307. The two only look contradictory until
 * the difference between them is named: the letters are hinted and these are
 * not. A rule that helps where the outline came through an interpreter and
 * hurts where it did not is not a rule about scan conversion, and the bars
 * settled it outright -- of the 27 sideways bars that miss every scanline, not
 * one is inked by Windows at any height up to a full pixel or at any phase.
 * `FONTS.md` section 6 has the rest.
 *
 * Four of them -- `cour-crowd`, `cour-boxes`, `cour-lies` and `cour-sides` --
 * answer a different question: it draws the
 * same bar three ways -- plain, subdivided into three times as many collinear
 * points, and beside a second contour down in the descender that shares no row
 * and no column with it. Windows draws the first two identically in all 84
 * comparisons and the third differently in 29 of them. Outline complexity is
 * therefore something the rasteriser notices, and the three that follow narrow
 * it to the glyph's width in x, measured from the points rather than from the
 * header. Section 6 of `FONTS.md` has the matrix.
 */

'use strict';

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { TrueTypeFont } from '../../src/raster/truetype-font.js';
import { prepareFonts, replayRecord } from '../oracle/replay.js';

const FIXTURES = join(__dirname, '..', '..', 'oracle', 'fixtures', 'fabricated');
const FONTS = join(__dirname, '..', '..', 'oracle', 'build', 'fonts');

/** Every fabricated recording made with the glyph probe. */
function recordings() {
  if (!existsSync(FIXTURES) || !existsSync(FONTS)) {
    return [];
  }

  return readdirSync(FIXTURES)
    .filter((name) => name.startsWith('glyphs-') && name.endsWith('.json'))
    .sort()
    .map((name) => {
      const fixture = JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'));
      const directory = join(FONTS, String(fixture.font));

      if (!existsSync(directory)) {
        return null;
      }

      return {
        name: name.replace(/^glyphs-|\.json$/g, ''),
        fixture,
        file: join(directory, readdirSync(directory)[0]),
      };
    })
    .filter(Boolean) as any[];
}

describe('the fabricated glyph recordings', () => {
  const all = recordings();
  const present = all.length ? it : it.skip;

  /* Where this stands, so that a change which moves it says so.
   *
   * These are not a target -- more than a third of the cells disagree, and the
   * shape fonts were built to disagree informatively rather than to pass. They
   * are a ratchet: the totals may improve and must not quietly get worse, which
   * is the property the recordings had lost by not being replayed at all.
   */
  const EXACT = 3865;
  const WRONG = 4666;

  present(
    'agree with Windows on three thousand cells of chosen geometry',
    async function () {
      const manager: any = await prepareFonts();

      let exact = 0;
      let wrong = 0;
      let total = 0;

      const report: string[] = [];

      for (const recording of all) {
        const font: any = new TrueTypeFont(new Uint8Array(readFileSync(recording.file)));
        const face = font.faceName;

        /* The fabricated file stands in for the face it was cut from, so the
         * mapper has to answer with it and not with the installed one. Putting
         * it back afterwards keeps the recordings independent of each other.
         */
        const installed = manager._outlines[face];

        manager._outlines[face] = { regular: font };

        let fileExact = 0;
        let fileWrong = 0;
        let fileTotal = 0;

        try {
          for (const record of recording.fixture.records) {
            if (!record.args.startsWith(`"${face}"`)) {
              continue;
            }

            fileTotal++;

            const replayed = await replayRecord(record, recording.fixture.display ?? 'vga');
            const wanted = String(replayed.expected);
            const drawn = replayed.actual === null ? '' : String(replayed.actual);

            if (replayed.outcome === 'agreed') {
              fileExact++;
            }

            if (wanted.length !== drawn.length) {
              fileWrong += wanted.length * 4;

              continue;
            }

            for (let at = 0; at < wanted.length; at++) {
              const differing = parseInt(wanted[at], 16) ^ parseInt(drawn[at], 16);

              fileWrong +=
                (differing & 1) +
                ((differing >> 1) & 1) +
                ((differing >> 2) & 1) +
                ((differing >> 3) & 1);
            }
          }
        } finally {
          manager._outlines[face] = installed;
        }

        exact += fileExact;
        wrong += fileWrong;
        total += fileTotal;

        report.push(
          `  ${recording.name.padEnd(18)} ${String(fileExact).padStart(4)}/${String(fileTotal).padStart(4)} cells  ${String(fileWrong).padStart(5)} wrong pixels`
        );
      }

      report.push(`  ${'TOTAL'.padEnd(18)} ${exact}/${total} cells  ${wrong} wrong pixels`);

      console.log(report.join('\n'));

      // Sixteen recordings of 846 cells, of which those naming the face count.
      expect(total).toBeGreaterThan(3000);

      expect(exact).toBeGreaterThanOrEqual(EXACT);
      expect(wrong).toBeLessThanOrEqual(WRONG);
    },
    1800000
  );
});
