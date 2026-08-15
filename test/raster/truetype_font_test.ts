'use strict';

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Disk } from '../../src/emulator/disk.js';
import { FAT16 } from '../../src/file-systems/fat16.js';
import { TrueTypeFont } from '../../src/raster/truetype-font.js';

/**
 * Reading a TrueType font for what it says about itself.
 *
 * This covers the tables that describe the font -- its name, its coordinate
 * space, its advance widths and the map from characters to glyphs -- and not
 * the ones that draw it. That split is deliberate and is explained where the
 * class is: the metrics Windows reports for these fonts turn out not to be a
 * scaling of anything in these tables, so reading them is groundwork for a
 * rasteriser rather than a substitute for one.
 *
 * The values checked here are the fonts' own, so they are the same on any
 * Windows 3.1 with the same files. Nothing here is compared against a
 * recording, because there is nothing to record: a program cannot ask what
 * `unitsPerEm` is.
 */

const IMAGE = join(__dirname, '..', '..', 'oracle', 'build', 'win31.img');

/** Opens one of the installed outline fonts off the drive image. */
async function installed(name: string) {
  const bytes = new Uint8Array(readFileSync(IMAGE));
  const disk = new Disk(bytes.byteLength, 512, 32768);

  disk.load(bytes);

  const fileSystem: any = new FAT16(disk);
  await fileSystem.mount();

  const file = await fileSystem.open(['WINDOWS', 'SYSTEM', name]);

  return new TrueTypeFont(new Uint8Array(await file.read(0, file.size)));
}

/** The drive is built rather than committed. */
const whenBuilt = existsSync(IMAGE) ? describe : describe.skip;

whenBuilt('reading a TrueType font', () => {
  describe.each([
    ['ARIAL.TTF', 'Arial', false],
    ['TIMES.TTF', 'Times New Roman', false],
    ['COUR.TTF', 'Courier New', true],
    ['WINGDING.TTF', 'Wingdings', false],
  ])('%s', (file, face, fixed) => {
    let font: any;

    beforeAll(async function () {
      font = await installed(file as string);
    }, 60000);

    it('names itself', function () {
      /* The name is what `GetTextFace` answers and what the font mapper
       * matches against, so reading the wrong one would be wrong everywhere
       * at once.
       */
      expect(font.faceName).toEqual(face);
    });

    it('has a coordinate space to scale from', function () {
      // A power of two, and 2048 for every font Microsoft shipped in 3.1.
      expect(font.unitsPerEm).toEqual(2048);
    });

    it('says how far its characters reach above and below the line', function () {
      expect(font.ascender).toBeGreaterThan(0);
      expect(font.descender).toBeGreaterThan(0);

      // Between them they cover more than the em, which is the internal leading.
      expect(font.ascender + font.descender).toBeGreaterThan(font.unitsPerEm);
    });

    it('maps the characters a program will ask for', function () {
      const cmap = font.cmap;

      expect(cmap.size).toBeGreaterThan(0);

      /* A symbol font maps its characters into a private range rather than at
       * the codepoints they are written with, so `advanceFor` looks there too
       * and a letter still measures as something.
       */
      expect(font.advanceFor('W'.charCodeAt(0))).toBeGreaterThan(0);
      expect(font.advanceFor('g'.charCodeAt(0))).toBeGreaterThan(0);
    });

    it('knows whether every character is the same width', function () {
      expect(font.fixedPitch).toEqual(fixed);

      const w = font.advanceFor('W'.charCodeAt(0));
      const i = font.advanceFor('i'.charCodeAt(0));

      /* Which the advances have to agree with -- but only for a font whose
       * letters are letters. A symbol font puts arbitrary pictures at those
       * codepoints, so which of them is wider says nothing.
       */
      if (face !== 'Wingdings') {
        expect(fixed ? w === i : w > i).toEqual(true);
      }
    });
  });

  describe('the grid-fitted tables', () => {
    let arial: any;

    beforeAll(async function () {
      arial = await installed('ARIAL.TTF');
    }, 60000);

    /* These are the tables that make the metrics answerable without running
     * the hinting bytecode: what the outlines came out as once fitted to the
     * grid, tabulated per pixel size when the font was built.
     */
    it('states what the face comes out as at a pixel size', function () {
      // Verified against what Windows reports for a sixteen pixel cell.
      expect(arial.extentAt(13)).toEqual({ ascent: 13, descent: 3 });
    });

    it('has nothing to say about a size it was not built for', function () {
      expect(arial.extentAt(7)).toBeNull();
    });

    it('finds the size that fills a cell without overflowing it', function () {
      const found = arial.sizeForHeight(16);

      expect(`${found.ascent}/${found.descent}`).toEqual('13/3');

      /* Thirteen and fourteen both come out sixteen pixels tall, and the
       * smaller is the one Windows settles on -- which shows up only in the
       * internal leading, since the extent is the same either way.
       */
      expect(found.ppem).toEqual(13);
    });

    it('will not overflow a cell anything fits in', function () {
      for (const height of [12, 16, 20, 24, 32, 48, 64, 100]) {
        const found = arial.sizeForHeight(height);

        if (found) {
          expect(`${height}: ${found.ascent + found.descent <= height}`).toEqual(`${height}: true`);
        }
      }
    });

    it('answers a cell too small for anything with the smallest it has', function () {
      /* Asked for less than the font fits in, Windows does not refuse and does
       * not fall back to a strike -- it overflows. Arial asked for a one pixel
       * cell reports a height of two and keeps the name Arial, and Courier New
       * reports three. **Recorded**, in `font.json`, across heights one to
       * fourteen.
       */
      const found = arial.sizeForHeight(1);

      expect(found.ascent + found.descent).toEqual(2);

      // And the same answer for every cell too small to hold it.
      expect(arial.sizeForHeight(2)).toEqual(found);
    });

    it("states each glyph's fitted advance where it was built for the size", function () {
      const glyph = arial.glyphFor('W'.charCodeAt(0));

      expect(arial.deviceAdvance(13, glyph)).toBeGreaterThan(0);

      // And says nothing where it was not.
      expect(arial.deviceAdvance(7, glyph)).toBeNull();
    });

    it('knows which file of a family is the plain one', async function () {
      expect(arial.regular).toEqual(true);
      expect((await installed('ARIALBD.TTF')).regular).toEqual(false);

      /* All four files of a family name themselves the same thing, so this is
       * the only thing separating them.
       */
      expect((await installed('ARIALBD.TTF')).faceName).toEqual('Arial');
    }, 60000);

    it('knows a symbol font from a text one', async function () {
      expect(arial.symbolic).toEqual(false);
      expect((await installed('WINGDING.TTF')).symbolic).toEqual(true);
    }, 60000);

    it('puts itself in a family a program can ask for', async function () {
      // FF_SWISS for the sans serifs, FF_ROMAN for the serifs.
      expect(arial.family).toEqual(0x20);
      expect((await installed('TIMES.TTF')).family).toEqual(0x10);
    }, 60000);
  });

  it('refuses bytes that are not a font', function () {
    const rubbish = new DataView(new Uint8Array([1, 2, 3, 4]).buffer);

    expect(TrueTypeFont.looksLikeFont(rubbish)).toEqual(false);
  });
});
