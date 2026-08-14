'use strict';

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Disk } from '../../src/emulator/disk.js';
import { FAT16 } from '../../src/file-systems/fat16.js';
import { TrueTypeFont } from '../../src/raster/truetype-font.js';
import { fill, flatten } from '../../src/raster/glyph-raster.js';

/**
 * Filling an outline.
 *
 * The shapes here are made by hand, because the properties worth checking are
 * ones a real glyph would only obscure: that a contour wound the other way
 * cuts a hole rather than filling twice, that a curve bulges the way its
 * control point says, and that a pixel is filled when the shape covers its
 * centre rather than when it touches the pixel at all.
 *
 * What this does *not* check is agreement with Windows. That comparison is in
 * the oracle -- `oracle/fixtures/glyphs.json` holds what Windows actually drew
 * -- and it does not agree, because this does not hint. The measurement is in
 * `oracle/README.md`: about half the ink of an unhinted glyph lands somewhere
 * other than where Windows put it, at the sizes text is read at.
 */

const IMAGE = join(__dirname, '..', '..', 'oracle', 'build', 'win31.img');

/** A square, wound clockwise in the font's y-up coordinates. */
function square(size: number) {
  return [
    { x: 0, y: 0, on: true },
    { x: 0, y: size, on: true },
    { x: size, y: size, on: true },
    { x: size, y: 0, on: true },
  ];
}

/** How many pixels a fill inked. */
function inked(pixels: Uint8Array) {
  let count = 0;

  for (const pixel of pixels) {
    if (pixel) {
      count++;
    }
  }

  return count;
}

describe('filling an outline', () => {
  it('fills what a contour encloses', function () {
    const pixels = fill([square(10)], {
      scale: 1,
      originX: 0,
      originY: 10,
      width: 16,
      height: 16,
    });

    // Ten by ten, sampled at pixel centres.
    expect(inked(pixels)).toEqual(100);
  });

  it('scales to the size asked for', function () {
    const pixels = fill([square(10)], {
      scale: 0.5,
      originX: 0,
      originY: 5,
      width: 16,
      height: 16,
    });

    expect(inked(pixels)).toEqual(25);
  });

  it('cuts a hole where a contour winds the other way', function () {
    /* The counter of an `o` is not a special case in TrueType: it is a
     * contour wound against the outer one, and the non-zero rule leaves it
     * empty. Winding it the same way would fill it in.
     */
    const outer = square(10);
    const inner = [
      { x: 3, y: 3, on: true },
      { x: 7, y: 3, on: true },
      { x: 7, y: 7, on: true },
      { x: 3, y: 7, on: true },
    ];

    const pixels = fill([outer, inner], {
      scale: 1,
      originX: 0,
      originY: 10,
      width: 16,
      height: 16,
    });

    expect(inked(pixels)).toEqual(100 - 16);
  });

  it('bends a curve towards its control point', function () {
    const contour = [
      { x: 0, y: 0, on: true },
      { x: 10, y: 10, on: false },
      { x: 20, y: 0, on: true },
    ];

    const polygon = flatten(contour);

    // The midpoint of the flattened curve sits above the chord, not on it.
    const middle = polygon[Math.floor(polygon.length / 2)];

    expect(middle[1]).toBeGreaterThan(0);
    expect(middle[1]).toBeLessThan(10);
  });

  it('starts a contour correctly when it begins on a control point', function () {
    /* The format allows a contour to start mid-curve, in which case the real
     * start is halfway to the last point. Getting this wrong rotates the
     * outline by a segment, which shows as a glyph with one corner sheared.
     */
    // Where the contour closes on a real point, that point is the start.
    const onCurve = flatten([
      { x: 10, y: 10, on: false },
      { x: 20, y: 0, on: true },
      { x: 0, y: 0, on: true },
    ]);

    expect(onCurve[0]).toEqual([0, 0]);

    /* Where it closes on another control point, neither is on the curve and
     * the start is the point halfway between them -- which is the same rule
     * that puts an implied point between any two controls in a row.
     */
    const offCurve = flatten([
      { x: 10, y: 10, on: false },
      { x: 20, y: 0, on: true },
      { x: 0, y: 20, on: false },
    ]);

    expect(offCurve[0]).toEqual([5, 15]);
  });

  it('has nothing to fill for an empty contour', function () {
    expect(flatten([])).toEqual([]);
    expect(inked(fill([], { scale: 1, width: 8, height: 8 }))).toEqual(0);
  });

  /* The real thing, to the extent it can be checked without the oracle: a
   * glyph out of an installed font has the shape its own bounding box claims.
   */
  const whenBuilt = existsSync(IMAGE) ? it : it.skip;

  whenBuilt(
    'fills a glyph from an installed font',
    async function () {
      const bytes = new Uint8Array(readFileSync(IMAGE));
      const disk = new Disk(bytes.byteLength, 512, 32768);

      disk.load(bytes);

      const fileSystem: any = new FAT16(disk);
      await fileSystem.mount();

      const file = await fileSystem.open(['WINDOWS', 'SYSTEM', 'ARIAL.TTF']);
      const font: any = new TrueTypeFont(new Uint8Array(await file.read(0, file.size)));

      const contours = font.outlineOf(font.glyphFor('A'.charCodeAt(0)));

      // A capital A is two contours: the letter and the counter inside it.
      expect(contours.length).toEqual(2);

      const pixels = fill(contours, {
        scale: 32 / font.unitsPerEm,
        originX: 2,
        originY: 32,
        width: 48,
        height: 48,
      });

      expect(inked(pixels)).toBeGreaterThan(50);
    },
    60000
  );
});
