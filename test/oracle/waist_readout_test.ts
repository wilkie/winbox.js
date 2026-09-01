/**
 * @jest-environment jsdom
 *
 * Where Windows puts the two points that bound the waist of an eight.
 *
 * The recorded letters are the interpreter's, and Times New Roman's `8` is the
 * worst of them -- wrong at five of the seven sizes recorded. Nothing in a
 * bitmap says where a point went, only where the ink landed, so the difference
 * had to be read directly. These two fabrications keep the glyph and its whole
 * program and append a readout that moves the advance phantom onto one point's
 * **height**, magnified sixty-four times, which `GetTextExtent` then reports.
 *
 * Times New Roman carries an `hdmx`, so a size the table covers is answered
 * from the cache without the program running at all; those records come back as
 * the ordinary advance and are skipped here. What is left is the sizes the table
 * does not cover, which is where a reading means something.
 */

'use strict';

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { TrueTypeFont } from '../../src/raster/truetype-font.js';
import { prepareFonts } from './replay.js';

/**
 * Four readouts: the two that bound the waist of Times New Roman's `8`, and the
 * two control points of Arial's `7` where its diagonal is drawn a row early.
 *
 * Arial's fabrications drop `hdmx` and `LTSH` as well. Both are caches of what
 * a program would have come to, and Windows answers from either without running
 * anything -- Arial's cover every size in the sweep, so with them in place the
 * readout said nothing at all.
 */
const WAIST = [
  ['times-8-waist-upper', 26, 'Times New Roman', '8'],
  ['times-8-waist-lower', 39, 'Times New Roman', '8'],
  ['arial-7-diagonal-right', 5, 'Arial', '7'],
  ['arial-7-diagonal-left', 11, 'Arial', '7'],
  ['arial-7-anchor-high', 13, 'Arial', '7'],
  ['times-W-interpolated', 23, 'Times New Roman', 'W'],
  ['times-y-tail-right', 26, 'Times New Roman', 'y'],
  ['times-y-tail-c27', 27, 'Times New Roman', 'y'],
  ['times-y-tail-c28', 28, 'Times New Roman', 'y'],
  ['times-y-tail-foot', 29, 'Times New Roman', 'y'],
  ['times-y-tail-depth', 29, 'Times New Roman', 'y'],
] as const;

/** Readable sizes still disagreeing. Both are ceilings. */
const DIFFER: Record<string, number> = {
  'times-8-waist-upper': 0,
  'times-8-waist-lower': 0,
  'arial-7-diagonal-right': 0,
  'arial-7-diagonal-left': 0,
  // The anchor the left diagonal interpolates from, and a point of `W` that
  // `IUP` places: both exact, which is what makes the diagonal's error its own.
  'arial-7-anchor-high': 0,
  'times-W-interpolated': 0,
  'times-y-tail-right': 0,
  'times-y-tail-c27': 0,
  'times-y-tail-c28': 0,
  'times-y-tail-foot': 0,
  'times-y-tail-depth': 0,
};

/** Below this the answer is `hdmx`, not the program. */
const CACHED = 100;

const missing = WAIST.some(
  ([name]) => !existsSync(`oracle/fixtures/fabricated/hinting-${name}.json`)
);

if (missing) {
  describe('the waist of an eight', () => {
    it.skip('needs the recordings; run the oracle pipeline', () => {});
  });
} else {
  describe('the waist of an eight', () => {
    it('is not where we put it', async () => {
      await prepareFonts();

      const report: string[] = [];

      for (const [name, point, face, character] of WAIST) {
        const fixture = JSON.parse(
          readFileSync(`oracle/fixtures/fabricated/hinting-${name}.json`, 'utf8')
        );
        const dir = join('oracle/build/fonts', String(fixture.font));
        const font: any = new TrueTypeFont(
          new Uint8Array(readFileSync(join(dir, readdirSync(dir)[0])))
        );
        const glyph = font.glyphFor(character.charCodeAt(0));
        const seen = new Set<number>();

        let differ = 0;

        for (const record of fixture.records) {
          if (
            record.args !==
            `"${face}",h=${/h=(\d+)/.exec(record.args)?.[1]},italic=0,'${character}'`
          ) {
            continue;
          }

          const answer = /advance=(-?\d+),ppem=(\d+)/.exec(record.result);

          /* The tail's depth is below the baseline, so a genuine reading of it
           * is negative; a positive one is the ordinary advance answering
           * instead, the same as a small one is elsewhere.
           */
          const reading = Number(answer[1]);

          if (!answer || (name.endsWith('depth') ? reading >= 0 : reading < CACHED)) {
            continue;
          }

          const ppem = Number(answer[2]);

          /* Past forty the magnified coordinate outgrows what an advance can
           * carry and the reading wraps, which is not a disagreement.
           */
          if (ppem > 40) {
            continue;
          }

          if (seen.has(ppem)) {
            continue;
          }

          seen.add(ppem);
          font._hinters = undefined;

          const ours = font.hintedAdvance(glyph, ppem);
          const windows = Number(answer[1]);

          if (ours !== windows) {
            differ++;
            report.push(
              `  ${name} point ${point} ppem ${String(ppem).padStart(2)}: ` +
                `windows ${String(windows).padStart(4)} ours ${String(ours).padStart(4)} ` +
                `(${windows - ours > 0 ? '+' : ''}${windows - ours}/64)`
            );
          }
        }

        expect(seen.size).toBeGreaterThan(0);
        expect(differ).toBeLessThanOrEqual(DIFFER[name]);
      }

      console.log(report.join('\n'));
    }, 180000);
  });
}
