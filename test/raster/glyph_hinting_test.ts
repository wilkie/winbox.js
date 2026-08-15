'use strict';

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Disk } from '../../src/emulator/disk.js';
import { FAT16 } from '../../src/file-systems/fat16.js';
import { Hinter, Unsupported } from '../../src/raster/glyph-hinting.js';
import { TrueTypeFont } from '../../src/raster/truetype-font.js';

/**
 * The hinting interpreter, as far as it is verified.
 *
 * What these check is that the machine runs: that the font's own programs
 * execute to completion, that the functions they define are found and called,
 * that the control values are scaled, and that a program using something we do
 * not implement is refused outright rather than half-run.
 *
 * What they do not check is that the result is what Windows produces, because
 * it is not yet. `oracle/fixtures/glyphs.json` holds the pixels and the
 * interpreter does not reproduce them: it executes every instruction of
 * Arial's `A` -- some two thousand of them, across a hundred function calls --
 * and moves the outline by only a fraction of what Windows moves it. There is
 * a semantic error somewhere in the graphics state that running the programs
 * without error does not expose. See `oracle/README.md`.
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

whenBuilt('the hinting interpreter', () => {
  let font: any;

  beforeAll(async function () {
    font = await installed('ARIAL.TTF');
  }, 60000);

  it('runs the programs that set a size up', function () {
    const hinter: any = new Hinter(font, 13);

    hinter.prepare();

    /* `fpgm` is nothing but function definitions, and `prep` calls them. If
     * either had stopped early there would be fewer of them, or none.
     */
    expect(hinter.functions.size).toBeGreaterThan(50);
  });

  it('scales the control values to the size', function () {
    const small: any = new Hinter(font, 13);
    const large: any = new Hinter(font, 26);

    expect(small.cvt.length).toBeGreaterThan(100);

    /* The same table at twice the size is about twice the numbers. Taken over
     * the whole table rather than one entry, since any single one may be zero
     * or too small for the ratio to mean anything.
     */
    let smallTotal = 0;
    let largeTotal = 0;

    for (let index = 0; index < small.cvt.length; index++) {
      smallTotal += Math.abs(small.cvt[index]);
      largeTotal += Math.abs(large.cvt[index]);
    }

    const ratio = largeTotal / (smallTotal || 1);

    expect(ratio).toBeGreaterThan(1.8);
    expect(ratio).toBeLessThan(2.2);
  });

  it('runs a glyph program to the end', function () {
    const hinter: any = new Hinter(font, 13);
    const glyph = font.glyphFor('A'.charCodeAt(0));
    const range = font.glyphRange(glyph);

    const contours = font._view.getInt16(range.start, false);
    const instructions = range.start + 10 + contours * 2;
    const length = font._view.getUint16(instructions, false);

    expect(length).toBeGreaterThan(0);

    const fitted = hinter.hint(
      font.outlineOf(glyph),
      font.advanceOf(glyph),
      font.bearingOf(glyph),
      font._view.getInt16(range.start + 2, false),
      font._view,
      instructions + 2,
      length
    );

    // The same shape comes back, in pixels rather than font units.
    expect(fitted.length).toEqual(2);
    expect(fitted[0].length).toEqual(font.outlineOf(glyph)[0].length);
  });

  it('refuses a program it cannot run rather than half-running it', function () {
    const hinter: any = new Hinter(font, 13);

    // 0x89 is IDEF, which redefines an instruction; nothing here does that.
    const program = new DataView(new Uint8Array([0x89]).buffer);

    expect(() => hinter.run(program, 0, 1)).toThrow(Unsupported);
  });

  it('falls back to the unhinted outline when it cannot hint', function () {
    const glyph = font.glyphFor('A'.charCodeAt(0));

    /* A size of zero is not something to hint at, and the answer is the
     * outline as it stands rather than an exception -- which is what keeps a
     * gap in the interpreter from stopping anything being drawn.
     */
    const fitted = font.hintedOutline(glyph, 0);

    expect(fitted.hinted).toEqual(false);
    expect(fitted.contours.length).toEqual(2);
  });
});

/**
 * The interpreter checked against the font's own answers.
 *
 * `hdmx` tabulates what each glyph advances by, in whole pixels, at two dozen
 * sizes -- and those numbers are the output of running the hinting programs,
 * computed offline by whoever built the font. So the table is an oracle for
 * the interpreter that ships inside the font, and a far larger one than the
 * recording: 3,720 answers for Arial where `glyphs.json` holds ninety.
 *
 * It only checks the horizontal, since an advance is all it holds. But it
 * checks it across every glyph and every tabulated size, which is enough to
 * say whether the machine is right rather than whether it runs.
 */
describe('hinted advances against the tables the font ships', () => {
  const present = existsSync(IMAGE) ? it : it.skip;

  /** Every `(ppem, glyph, advance)` the table states. */
  function tabulated(font: any) {
    const view = font._view;
    const base = font._tables['hdmx'].offset;

    const count = view.getInt16(base + 2, false);
    const stride = view.getInt32(base + 4, false);

    const rows: { ppem: number; glyph: number; advance: number }[] = [];

    for (let index = 0; index < count; index++) {
      const record = base + 8 + index * stride;
      const ppem = view.getUint8(record);

      for (let glyph = 0; glyph < stride - 2; glyph++) {
        rows.push({ ppem, glyph, advance: view.getUint8(record + 2 + glyph) });
      }
    }

    return rows;
  }

  present(
    'reproduces every advance Arial tabulates',
    async function () {
      const arial: any = await installed('ARIAL.TTF');

      let checked = 0;

      for (const row of tabulated(arial)) {
        const advance = arial.hintedAdvance(row.glyph, row.ppem);

        // A glyph with no program of its own has nothing to check.
        if (advance === null) {
          continue;
        }

        expect(`${row.ppem}/${row.glyph}: ${advance}`).toEqual(
          `${row.ppem}/${row.glyph}: ${row.advance}`
        );

        checked++;
      }

      // Every glyph that has a program, at all twenty-four tabulated sizes.
      expect(checked).toEqual(3720);
    },
    120000
  );

  present(
    'reproduces all but fourteen of the advances Times New Roman tabulates',
    async function () {
      const times: any = await installed('TIMES.TTF');

      let agreed = 0;
      let differed = 0;

      for (const row of tabulated(times)) {
        const advance = times.hintedAdvance(row.glyph, row.ppem);

        if (advance === null) {
          continue;
        }

        if (advance === row.advance) {
          agreed++;
        } else {
          differed++;
        }
      }

      /* Pinned rather than asserted to be zero, because it is not: fourteen
       * advances out of 3,696 come out a pixel from what the font says. They
       * are the same gap the recorded glyphs show, measured somewhere much
       * easier to look at. Lowering this number is progress; raising it is a
       * regression.
       */
      expect(`${agreed} agreed, ${differed} differed`).toEqual('3682 agreed, 14 differed');
    },
    120000
  );
});
