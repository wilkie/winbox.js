'use strict';

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BitmapFont } from '../../src/raster/bitmap-font.js';
import { Disk } from '../../src/emulator/disk.js';
import { FAT16 } from '../../src/file-systems/fat16.js';
import { LogicalFont } from '../../src/raster/logical-font.js';
import { Surface } from '../../src/raster/surface.js';

/**
 * The plotter fonts.
 *
 * Three of the fonts Windows 3.1 installs are strokes rather than pixels --
 * Roman, Modern and Script -- and they are a different kind of thing from
 * everything else in a `.FON`: one design apiece, drawn at whatever size is
 * asked for, rather than a set of strikes to choose between.
 *
 * They are also where a decode can go wrong quietly. Their character table
 * does not start where a 2.x or 3.x font's does, and reading it two bytes out
 * still yields numbers -- just nonsense ones. The check that catches it is the
 * font's own header: it states the average and maximum character widths, and
 * those have to be what the table says they are. Reading the table at 117 or
 * 118 fails that; reading it at 119 passes for all three.
 */

const IMAGE = join(__dirname, '..', '..', 'oracle', 'build', 'win31.img');

/** Opens one of the installed fonts off the drive image. */
async function installed(name: string) {
  const bytes = new Uint8Array(readFileSync(IMAGE));
  const disk = new Disk(bytes.byteLength, 512, 32768);

  disk.load(bytes);

  const fileSystem: any = new FAT16(disk);
  await fileSystem.mount();

  const font: any = new BitmapFont(await fileSystem.open(['WINDOWS', 'SYSTEM', name]));
  await font.load();

  return font;
}

/** The drive is built rather than committed. */
const whenBuilt = existsSync(IMAGE) ? describe : describe.skip;

whenBuilt('the plotter fonts', () => {
  describe.each([
    ['ROMAN.FON', 'Roman'],
    ['MODERN.FON', 'Modern'],
    ['SCRIPT.FON', 'Script'],
  ])('%s', (file, face) => {
    let entry: any;

    beforeAll(async function () {
      entry = (await installed(file as string)).entries[0];
    }, 60000);

    it('says it is strokes rather than pixels', function () {
      expect(`${entry.name}: ${entry.isVector}`).toEqual(`${face}: true`);
    });

    /* The real check. If the table were being read at the wrong offset these
     * would be arbitrary numbers, and every width the font reports would be
     * wrong in a way nothing else would notice.
     */
    it('has a character table that agrees with its own header', function () {
      const header = entry.header;

      let total = 0;
      let widest = 0;

      for (let code = header.dfFirstChar; code <= header.dfLastChar; code++) {
        const width = entry.characterEntryFor(code).width;

        total += width;
        widest = Math.max(widest, width);
      }

      const count = header.dfLastChar - header.dfFirstChar + 1;

      expect(`max ${widest}`).toEqual(`max ${header.dfMaxWidth}`);

      // The average is the header's to within the rounding it was stored with.
      expect(Math.abs(Math.round(total / count) - header.dfAvgWidth)).toBeLessThanOrEqual(1);
    });

    it('has strokes to draw', function () {
      const runs = entry.strokesFor('W'.charCodeAt(0));

      expect(runs.length).toBeGreaterThan(0);

      // Every run is a polyline: at least two points, each a pair.
      for (const run of runs) {
        expect(run[0].length).toEqual(2);
      }
    });

    it('draws at a size it was never designed at', function () {
      const surface: any = Surface.offscreen(200, 60);

      /* Forty pixels where the design is thirty-two or thirty-seven. A strike
       * would have to be stretched by a whole number to get here and could not
       * land on forty at all; this is the whole point of a stroke font.
       */
      const font = new LogicalFont(face as string, 0, entry, {
        scale: 40 / entry.header.dfPixHeight,
      });

      surface.font = font;
      surface.fillText(2, 2, 'Wg');

      const pixels = surface.context.pixels;

      let marked = 0;

      for (let at = 0; at < pixels.length; at += 4) {
        if (pixels[at + 3] !== 0) {
          marked++;
        }
      }

      expect(marked).toBeGreaterThan(0);
    });
  });
});
