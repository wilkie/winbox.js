/**
 * @jest-environment jsdom
 *
 * Glyphs drawn an order of magnitude taller than any cell the corpus had.
 *
 * Every glyph the corpus draws fits in a thirty-two row cell. `oracle/probes/
 * bands.c` draws two hundred rows into a sixty-four wide bitmap and writes down,
 * for each row, the leftmost inked column or `ff` for a row with no ink -- built
 * to ask whether GDI rasterises a tall glyph in bands and whether dropout
 * control survives a band boundary. **It does**; `FONTS.md` settled that when
 * the probe was first recorded, and nothing here changes it.
 *
 * This file exists because the write-up of that finding ends by saying nothing
 * replays these recordings, that the implementation has no banding and so would
 * "agree by construction", and that a test which cannot fail is worth less than
 * the recording it is made from.
 *
 * It did not agree by construction. It failed, and the failures were two things
 * the band question was silent about: four stock records this drew as nothing
 * at all, and a disagreement about which sub-pixel strokes dropout control
 * rescues at fifty to a hundred and twenty pixels per em. Both are now closed,
 * and each turned out to be a rule of its own.
 *
 * **The blank records were a buffer, not a shape.** A glyph too big for the
 * rasteriser's buffer is not drawn, and this measured that buffer as eight
 * bytes per row of the cell -- true, but only because every recording behind it
 * had a cell four bytes wide. It is twice the cell, and at a hundred rows tall
 * a cell is twelve and sixteen bytes across. See `Surface.outlineText`.
 *
 * **The rescues stop at forty-eight pixels per em.** Five more fabrications
 * were made to corner that one, all the same bars with a different companion,
 * and between them they say Windows rescues a sub-pixel bar only when the
 * glyph's box collapses in x:
 *
 *     times-bare-hairs   the bar alone                            rescued
 *     times-stacked      a second contour above it, same columns  rescued
 *     times-near-hairs   a block a hundred units across           refused
 *     times-hairs        a block eleven hundred units across      refused
 *     times-thin-pair    a second sub-pixel bar, which never draws refused
 *     times-beside       a block on the bar's own rows            refused
 *
 * `times-stacked` is the one that settles it: two contours, and rescued every
 * time, because the companion sits in the same columns and leaves the box one
 * column wide. It is not the contour count, not whether the companion draws,
 * not whether it shares scanlines, and not how far away it is.
 *
 * A sixth, `dropsize`, then swept the bar itself -- its width, its phase, its
 * height, its position, an arm on it, and the height of the box around it --
 * and found the answer turns on none of them and on the size alone: the same
 * bar is rescued at fifty-four device rows and refused at fifty-five, which is
 * forty-seven pixels per em and forty-eight, for two different box heights.
 *
 * All seven recordings are exact. See `FONTS.md` 8e.
 */

'use strict';

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { FontManager } from '../../src/win16/font-manager.js';
import { TrueTypeFont } from '../../src/raster/truetype-font.js';
import { prepareFonts, replayRecord } from '../oracle/replay.js';

const FIXTURES = 'oracle/fixtures/fabricated';
const FONTS = 'oracle/build/fonts';

/* The recordings, and what each is for. `cour-hairs` puts sub-pixel
 * hairlines in Courier New, whose own `SCANCTRL` gives up dropout control above
 * forty-four pixels per em, so it is the control: at these sizes a hairline that
 * misses every pixel centre should simply not be drawn. `times-hairs` puts the
 * same hairlines in Times New Roman, whose `SCANCTRL` is `0x17c` -- dropout
 * control on to a hundred and twenty-four pixels per em -- which is where the
 * question can actually be asked.
 *
 * Courier's hairlines are drawn all the same, and that is not a rescue: with
 * dropout control off the bar is drawn where it covers a pixel centre and not
 * where it does not, and Windows and this agree on every one of the 144.
 *
 * Each recording also draws the *other*, unmodified face at the same sizes, so
 * every run carries its own control: 288 records, half of them a stock face.
 */
const RECORDINGS = [
  'cour-hairs',
  'times-hairs',
  'times-bare-hairs',
  'times-near-hairs',
  'times-thin-pair',
  'times-stacked',
  'times-beside',

  /* And two of them again on a display whose pixel is not square, which is
   * where a glyph with no program of its own turned out to be asking the wrong
   * thing of the scan converter. See the ceilings below.
   */
  'cour-hairs-ega',
  'times-hairs-ega',
];

/* Ceilings, and none may rise.
 *
 * **Every record of every recording.** Times New Roman and Courier New, stock
 * and with sub-pixel hairlines written into them, drawn at sixty to a hundred
 * and eighty pixels and a hundred rows tall, agree on all 288 records of each
 * of the seven files. That is the banding question answered from this side: a
 * glyph drawn in one pass, with no bands at all, reproduces Windows at ten
 * times the size anything else in the corpus asks for, and dropout control
 * behaves the same across what would have been a seam.
 *
 * The two rules that got the last of them here are the buffer in
 * `Surface.outlineText` -- twice the cell, not eight bytes a row -- and the cap
 * in `glyph-raster`, which stops rescuing a dropout above forty-eight pixels
 * per em in a glyph whose box has not collapsed. Each is load-bearing: without
 * the buffer, 38 of the `cour-hairs` hairlines and four stock records are blank;
 * without the cap, the four wide hairline recordings drop from 144 of 144 to 70
 * and `cour-hairs` to 77.
 */
/* The two EGA recordings are not exact, and the two things short of it are
 * named rather than chased.
 *
 * **A face's first size is not scan-converted like the rest** (8g): whatever is
 * decided when a face is first realized at a size is cached for that size for
 * the life of the process, and on a non-square pixel a cold realization gets no
 * dropout control. `bands` realizes Courier New at four sizes before it reaches
 * Times New Roman, so Times' first size -- sixty -- is the cold one, and 26 of
 * its 36 records are a rescue Windows did not make. There is no per-process
 * state here to model that with. `cour-hairs-ega` cannot see it: Courier New
 * gives dropout control up above forty-four pixels per em, so cold and warm
 * agree for it at every size the probe asks.
 *
 * The three stock Courier New records this also used to miss -- `g`, `n` and
 * `w` at a hundred and eighty -- are closed. They were not the stretch: the
 * control value cut-in does not apply to a `MIRP` that does not round, and the
 * comparison is strict. See `FONTS.md` 8i and `oracle/probes/stemsize.c`.
 */
const EXPECTED: Record<string, { stock: number; hairs: number; total: number }> = {
  'cour-hairs': { stock: 144, hairs: 144, total: 288 },
  'times-hairs': { stock: 144, hairs: 144, total: 288 },
  'times-bare-hairs': { stock: 144, hairs: 144, total: 288 },
  'times-near-hairs': { stock: 144, hairs: 144, total: 288 },
  'times-thin-pair': { stock: 144, hairs: 144, total: 288 },
  'times-stacked': { stock: 144, hairs: 144, total: 288 },
  'times-beside': { stock: 144, hairs: 144, total: 288 },
  'cour-hairs-ega': { stock: 144, hairs: 144, total: 288 },
  'times-hairs-ega': { stock: 144, hairs: 118, total: 288 },
};

function recordings() {
  if (!existsSync(FIXTURES) || !existsSync(FONTS)) {
    return [];
  }

  return RECORDINGS.map((name) => {
    const path = join(FIXTURES, `bands-${name}.json`);

    if (!existsSync(path)) {
      return null;
    }

    const fixture = JSON.parse(readFileSync(path, 'utf8'));
    const directory = join(FONTS, String(fixture.font));

    return existsSync(directory)
      ? { name, fixture, file: join(directory, readdirSync(directory)[0]) }
      : null;
  }).filter(Boolean) as any[];
}

const all = recordings();

if (all.length === 0) {
  describe('glyphs taller than a cell', () => {
    it.skip('needs the bands recordings; run the oracle pipeline', () => {});
  });
} else {
  describe('glyphs taller than a cell', () => {
    it('draws them the way Windows does', async () => {
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

        let stock = 0;
        let hairs = 0;
        let total = 0;

        try {
          for (const record of recording.fixture.records) {
            total++;

            const replayed = await replayRecord(record, display);
            const agreed = replayed.outcome === 'agreed';

            if (record.args.startsWith(`"${face}"`)) {
              hairs += agreed ? 1 : 0;
            } else {
              stock += agreed ? 1 : 0;
            }
          }
        } finally {
          if (installed) {
            manager._outlines[face] = installed;
          } else {
            delete manager._outlines[face];
          }
        }

        const want = EXPECTED[recording.name];

        report.push(
          `${recording.name.padEnd(12)} stock ${stock}/144   hairlines ${hairs}/144   (${total} records)`
        );

        expect(stock).toBeGreaterThanOrEqual(want.stock);
        expect(hairs).toBeGreaterThanOrEqual(want.hairs);
        expect(total).toBe(want.total);
      }

      console.log(report.join('\n'));
    }, 1800000);
  });
}
