/**
 * @jest-environment jsdom
 *
 * The buffer a glyph has to fit in, asked at a cell that is not four bytes wide.
 *
 * GDI refuses to draw a glyph whose bitmap will not fit the buffer it keeps for
 * one, and the ceiling had been measured twice at a cell sixteen rows tall --
 * `times-reach` and `times-wide` -- where the face is fifteen pixels across and
 * pads to four bytes a row. At that width three different rules give the same
 * 128 bytes: twice the character's cell, twice the face's cell, and the face's
 * cell with one more long on each row. Nothing in that instrument separates
 * them, and the flat `8 * (ascent + descent)` it was written as is the third
 * one with the width frozen.
 *
 * `bands` was the first thing to notice, because a hundred-row Courier cell is
 * twelve and sixteen bytes across and the frozen four refuses glyphs Windows
 * plainly draws. `oracle/probes/buffer.c` is what settles it.
 *
 * Every glyph of the fabrication carries the same marker by the baseline and a
 * block standing above the ascender, where the cell clips it away -- the block
 * is never seen, only counted, so a blank bitmap means the glyph was refused.
 * The ten characters run from `W` at 1933 units of advance to the apostrophe at
 * 369.
 *
 *     times-buffer        one block for all ten      Windows refuses none
 *     times-buffer-bare   the marker with no block   the control
 *     times-buffer-sweep  ten blocks of ten heights  the ceiling, at every size
 *
 * The first refutes the character's own cell outright: ten characters whose
 * cells differ by four to one carry an identical shape, and Windows draws every
 * one of them at every size, including cells that rule says are far too small.
 * The third gives the ceiling directly -- the block heights are assigned in an
 * order deliberately uncorrelated with the advances, so a face-wide limit cuts
 * them in height order and a per-character one does not, and they cut in height
 * order at every size below a cell of 142.
 *
 * The threshold, in bytes a cell row: 8 at a cell of 30, 12 from 34 to 66, 16
 * from 70 to 98, 20 from 102 to 134, 24 at 138. `tmMaxCharWidth` pads to 4, 8,
 * 12, 16 and 20 across those same bands, so the buffer is the face's own cell
 * and one long more on every row. It is the bounding box and not the widest
 * advance: at a cell of thirty-four they pad to eight bytes and four, and the
 * recording says twelve.
 *
 * Above a cell of 142 the sweep stops being monotone, and that is a second
 * finding rather than noise: the height is counted in sixty-fourths of a row in
 * sixteen signed bits, so a glyph reaching more than 512 rows above the
 * baseline wraps negative and is always drawn. `r` reaches 506 rows at a cell
 * of 138 and 519 at 142; `M` reaches 502 at 166 and 513 at 170; each comes back
 * exactly where it crosses, while every shorter block between them stays blank.
 * See `Surface.outlineText`.
 */

'use strict';

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { FontManager } from '../../src/win16/font-manager.js';
import { TrueTypeFont } from '../../src/raster/truetype-font.js';
import { prepareFonts, replayRecord } from '../oracle/replay.js';

const FIXTURES = 'oracle/fixtures/fabricated';
const FONTS = 'oracle/build/fonts';

/* Ceilings, and none may rise.
 *
 * The one record short of every record is `r` at a cell of a hundred and
 * ninety, which is inside the wrap: both sides draw it, and Windows inks all
 * two hundred rows of the bitmap where this inks the marker's sixteen. The same
 * character four sizes earlier, equally wrapped, inks the marker and nothing
 * else on both sides. What makes the block itself appear once the height has
 * gone negative is **not known**, and one cell of a deliberate arithmetic
 * overflow is not enough to read it from.
 */
const EXPECTED: Record<string, number> = {
  'times-buffer': 410,
  'times-buffer-bare': 410,
  'times-buffer-sweep': 409,
};

function recordings() {
  if (!existsSync(FIXTURES) || !existsSync(FONTS)) {
    return [];
  }

  return Object.keys(EXPECTED)
    .map((name) => {
      const path = join(FIXTURES, `buffer-${name}.json`);

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
  describe('the glyph buffer', () => {
    it.skip('needs the buffer recordings; run the oracle pipeline', () => {});
  });
} else {
  describe('the glyph buffer', () => {
    it('refuses the glyphs Windows refuses', async () => {
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

        report.push(`${recording.name.padEnd(18)} ${agreed}/${total}`);

        expect(agreed).toBeGreaterThanOrEqual(EXPECTED[recording.name]);
        expect(total).toBe(410);
      }

      console.log(report.join('\n'));
    }, 1800000);
  });
}
