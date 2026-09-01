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
  const EXACT = 14268;
  const WRONG = 0;

  /* The one place an unhinted outline is drawn differently.
   *
   * `edge-sweep` exists to take the interpreter out of the question. Its
   * glyphs have no program at all, so the outline Windows rasterises is the one
   * written into the font and scaled once, and that scaling is already known to
   * agree -- it is what the `hdmx` advances and Arial Italic's `M` measure.
   * Every one of the thirty-six is a rectangle on a bearing of nothing whose
   * right edge is three font units further out than the last, eighteen of them
   * straight and eighteen with a gently curved right side, so the sweep carries
   * an edge across a column of sample points twice over the same ground.
   *
   * Ten of 216 cells disagree and every one of them is a curved variant: the
   * straight edges, walked by `CalcLine`, agree at every size and every step of
   * the sweep. So the whole of the difference is in `CalcSpline`.
   *
   * An earlier reading of this recording said the sweep agreed everywhere. It
   * did not. That reading compared the rightmost lit column rather than the
   * cell, and the test written to compare the cell looked the recording up by a
   * name it does not have, so it returned before asserting anything. Both are
   * fixed; a recording that cannot be found now fails rather than passes.
   */
  /* And the same sweep aimed at a curve's turning point rather than its edge.
   *
   * `edge-sweep` crossed the turning-point case once, by accident. `turn-sweep`
   * asks for it: each glyph is a rectangle with one curved side whose control
   * point is a font unit further out than the last, so the extreme -- the
   * average of the two scaled ends and the scaled control -- steps across a
   * sample column in halves of a sixty-fourth. Eighteen bulge right, where the
   * turn is a maximum, and eighteen left, where it is a minimum, and each is
   * given a bearing equal to its own `xMin` so the outline is carried onto
   * nothing.
   *
   * Nineteen of 216 cells still disagree and they are named rather than
   * excluded, because they are two different things and both are open.
   *
   * At sixteen pixels of cell height the extreme reaches a sample column two
   * steps before Windows lets it, on the right, and one step early on the
   * left. Rounding the turn toward the curve and carrying the two controls with
   * it takes the sweep from 22 disagreements to 17 and does not settle it.
   *
   * At eighteen the outermost column agrees for every variant and sixteen of
   * them still differ, by one pixel on the bottom row -- the end of the curve
   * rather than its extreme. That is the signature the recorded letters have
   * too, ink at the end of a run on a row with nothing below it, and this is
   * the first time it has been reproduced with nothing hinted.
   */
  const TURNS = 25;

  present('sweep a turning point across a sample column', async function () {
    const recording = all.find((entry) => entry.name === 'turn-sweep');

    expect(recording).toBeTruthy();

    const manager: any = await prepareFonts();
    const font: any = new TrueTypeFont(new Uint8Array(readFileSync(recording.file)));
    const face = font.faceName;
    const installed = manager._outlines[face];

    manager._outlines[face] = { regular: font };

    const wide = 'ABEKMNRSWXZabdefgjkmnostwy0123456789';
    const seen = new Set<string>();

    let differing = 0;

    try {
      for (const record of recording.fixture.records) {
        const asked = /^"([^"]+)",h=(\d+),weight=(\d+),italic=(\d+),'(.)'$/.exec(record.args);

        if (!asked || asked[1] !== face || asked[3] !== '400' || asked[4] !== '0') {
          continue;
        }

        const index = wide.indexOf(asked[5]);

        if (index < 0 || Number(asked[2]) < 12 || seen.has(`${asked[2]}|${asked[5]}`)) {
          continue;
        }

        seen.add(`${asked[2]}|${asked[5]}`);

        const replayed = await replayRecord(record, recording.fixture.display ?? 'vga');

        if (replayed.outcome !== 'agreed') {
          differing++;
        }
      }
    } finally {
      manager._outlines[face] = installed;
    }

    expect(seen.size).toBeGreaterThan(200);
    expect(differing).toBeLessThanOrEqual(TURNS);
  });

  const EDGES = 12;

  present('draw an unhinted edge the same except where it grazes a sample', async function () {
    const recording = all.find((entry) => entry.name === 'edge-sweep');

    // Not `return`: a name that stops matching would pass without running.
    expect(recording).toBeTruthy();

    const manager: any = await prepareFonts();
    const font: any = new TrueTypeFont(new Uint8Array(readFileSync(recording.file)));
    const face = font.faceName;
    const installed = manager._outlines[face];

    manager._outlines[face] = { regular: font };

    const wide = 'ABEKMNRSWXZabdefgjkmnostwy0123456789';
    const seen = new Set<string>();
    const differing: string[] = [];

    try {
      for (const record of recording.fixture.records) {
        const asked = /^"([^"]+)",h=(\d+),weight=(\d+),italic=(\d+),'(.)'$/.exec(record.args);

        if (!asked || asked[1] !== face || asked[3] !== '400' || asked[4] !== '0') {
          continue;
        }

        const index = wide.indexOf(asked[5]);

        // Below twelve the mapper answers with a strike rather than this face.
        if (index < 0 || Number(asked[2]) < 12 || seen.has(`${asked[2]}|${asked[5]}`)) {
          continue;
        }

        seen.add(`${asked[2]}|${asked[5]}`);

        const replayed = await replayRecord(record, recording.fixture.display ?? 'vga');

        if (replayed.outcome !== 'agreed') {
          differing.push(
            `${index >= 18 ? 'curved' : 'straight'} h=${asked[2]} at=${200 + (index % 18) * 3}`
          );
        }
      }
    } finally {
      manager._outlines[face] = installed;
    }

    expect(seen.size).toBeGreaterThan(200);
    expect(differing.length).toBeLessThanOrEqual(EDGES);
  });

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
