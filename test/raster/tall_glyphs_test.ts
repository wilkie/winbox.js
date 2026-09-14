/**
 * @jest-environment jsdom
 *
 * Glyphs drawn an order of magnitude taller than any cell the corpus had.
 *
 * Every glyph ever recorded before this fits in a thirty-two row cell, and one
 * question cannot be asked at that size: whether GDI rasterises a tall glyph in
 * bands, and whether dropout control survives a band boundary. The scaler's own
 * client interface offers two banding strategies and says only the more
 * expensive one "can preserve dropout-control behaviour", which says the cheaper
 * one loses it -- and a stroke thin enough to be rescued on every scanline would
 * then fail on one particular device row, the same row for every glyph at that
 * size.
 *
 * `oracle/probes/bands.c` draws two hundred rows into a sixty-four wide bitmap
 * and records, for each row, the leftmost inked column or `ff` for a row with no
 * ink. A break shows as one `ff` between two equal values and needs no
 * interpretation.
 *
 * **The answer is that nothing breaks.** In Windows' own recording the tallest
 * rescued hairline runs 108 consecutive rows and the tallest stroke 148, and
 * there is not one single-row gap anywhere in either recording. Whatever GDI
 * does, dropout control is intact across it, and drawing a glyph in one pass --
 * which is what `fillWalked` does -- is right. See `FONTS.md` section 8e.
 *
 * What the sweep did find is two things nothing at thirty-two rows could have,
 * and the ceilings below hold them where they were measured.
 */

'use strict';

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { FontManager } from '../../src/win16/font-manager.js';
import { TrueTypeFont } from '../../src/raster/truetype-font.js';
import { prepareFonts, replayRecord } from '../oracle/replay.js';

const FIXTURES = 'oracle/fixtures/fabricated';
const FONTS = 'oracle/build/fonts';

/* The two recordings, and what each is for. `cour-hairs` puts sub-pixel
 * hairlines in Courier New, whose own `SCANCTRL` gives up dropout control above
 * forty-four pixels per em, so it is the control: at these sizes a hairline that
 * misses every pixel centre should simply not be drawn. `times-hairs` puts the
 * same hairlines in Times New Roman, whose `SCANCTRL` is `0x17c` -- dropout
 * control on to a hundred and twenty-four pixels per em -- which is where the
 * question can actually be asked.
 *
 * Each recording also draws the *other*, unmodified face at the same sizes, so
 * every run carries its own control: 288 records, half of them a stock face.
 */
const RECORDINGS = ['cour-hairs', 'times-hairs'];

/* Ceilings, and none may rise.
 *
 * **The stock faces are all but four.** Times New Roman and Courier New, drawn
 * at sixty to a hundred and eighty pixels and a hundred rows tall, agree on 140
 * of 144 records each. That is the result that answers the banding question
 * from this side: a glyph drawn in one pass, with no bands at all, reproduces
 * Windows at ten times the size anything else in the corpus asks for.
 *
 * The four are `M` and `W` of Times at a hundred and forty and `A` and `M` of
 * Courier at a hundred and eighty, and all four have the same shape -- Windows
 * draws the glyph and this draws **nothing at all**, no ink in any of the
 * sixty-four columns on any of the two hundred rows. They are the widest
 * letters at the largest size each face is asked for, which is a lead and not
 * yet a reason.
 *
 * **The hairlines are what is really open**, and they are not the band boundary
 * either. Windows leaves 74 of the 144 `times-hairs` records blank and this
 * draws a stroke in every one of them; where the two disagree in `cour-hairs`
 * it is 38 the other way -- Windows draws a stroke this leaves blank -- and 27
 * that differ in some other way. At fifty-two pixels per em and up, with
 * `SCANCTRL` measured on and a stroke a quarter of a pixel wide, Windows is
 * refusing rescues this makes and making rescues this refuses, and no rule
 * already in `FONTS.md` predicts which.
 */
const EXPECTED: Record<string, { stock: number; hairs: number; total: number }> = {
  'cour-hairs': { stock: 142, hairs: 61, total: 288 },
  'times-hairs': { stock: 142, hairs: 70, total: 288 },
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
