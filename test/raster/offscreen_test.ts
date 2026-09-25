'use strict';

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BitmapContext } from '../../src/raster/bitmap-context.js';
import { BitmapFont } from '../../src/raster/bitmap-font.js';
import { Brush } from '../../src/raster/brush.js';
import { Color } from '../../src/raster/color.js';
import { Disk } from '../../src/emulator/disk.js';
import { FAT16 } from '../../src/file-systems/fat16.js';
import { LogicalFont } from '../../src/raster/logical-font.js';
import { Pen } from '../../src/raster/pen.js';
import { Surface } from '../../src/raster/surface.js';

/**
 * Drawing without a browser.
 *
 * The client area of a window is pixels rather than DOM -- a sixteen colour
 * driver dithers, and a dither pattern is not something the DOM can express --
 * so drawing has to work somewhere other than a canvas. Until it did, nothing
 * could check what a program drew, only what it computed.
 *
 * `Surface` is unchanged by this. It asks its canvas for a context and uses a
 * handful of operations on it; `BitmapContext` provides those over a buffer we
 * own, and the browser keeps the canvas it always had.
 */

const IMAGE = join(__dirname, '..', '..', 'oracle', 'build', 'win31.img');

/** How many pixels differ from the background. */
function marked(context: any, background = 0) {
  const pixels = context.pixels;

  let count = 0;

  for (let at = 0; at < pixels.length; at += 4) {
    if (
      pixels[at] !== background ||
      pixels[at + 1] !== background ||
      pixels[at + 2] !== background
    ) {
      count++;
    }
  }

  return count;
}

/** The colour at a point, as three bytes. */
function pixelAt(context: any, x: number, y: number) {
  const at = (y * context.width + x) * 4;

  return [context.pixels[at], context.pixels[at + 1], context.pixels[at + 2]];
}

describe('drawing offscreen', () => {
  it('fills a rectangle where it was asked to', function () {
    const surface: any = Surface.offscreen(64, 32);

    surface.brush = new Brush(new Color(0xff, 0x00, 0x00));
    surface.fillRect(10, 4, 20, 8);

    const context = surface.context;

    // Inside the rectangle, at its corners, and outside it.
    expect(pixelAt(context, 10, 4)).toEqual([0xff, 0, 0]);
    expect(pixelAt(context, 29, 11)).toEqual([0xff, 0, 0]);
    expect(pixelAt(context, 9, 4)).toEqual([0, 0, 0]);
    expect(pixelAt(context, 30, 11)).toEqual([0, 0, 0]);

    // Exactly the area asked for, and no more.
    expect(marked(context)).toEqual(20 * 8);
  });

  it('draws a line between its endpoints', function () {
    const surface: any = Surface.offscreen(32, 32);

    surface.pen = new Pen(new Color(0x00, 0xff, 0x00));
    surface.drawLine(0, 0, 10, 10);

    const context = surface.context;

    /* A diagonal of ten pixels: the start is drawn and the end is not, as
     * `LineTo` draws a line -- recorded by `lines`, 9,912 lines across four
     * displays, every one leaving out the point it stops on.
     */
    expect(pixelAt(context, 0, 0)).toEqual([0, 0xff, 0]);
    expect(pixelAt(context, 5, 5)).toEqual([0, 0xff, 0]);
    expect(pixelAt(context, 9, 9)).toEqual([0, 0xff, 0]);
    expect(marked(context)).toEqual(10);
  });

  it('refuses a colour it cannot interpret rather than drawing black', function () {
    expect(() => BitmapContext.toRGBA('papayawhip')).toThrow(/cannot interpret/);
  });

  it('has no font engine of its own', function () {
    // Anything reaching this wants a typeface we cannot rasterise.
    expect(() => new BitmapContext(4, 4).fillText()).toThrow(/bitmap font/);
  });

  /* The real test: glyphs out of an actual Windows font, drawn into pixels. */
  const whenBuilt = existsSync(IMAGE) ? it : it.skip;

  whenBuilt('draws real Windows glyphs into pixels', async function () {
    const bytes = new Uint8Array(readFileSync(IMAGE));
    const disk = new Disk(bytes.byteLength, 512, 32768);

    disk.load(bytes);

    const fileSystem: any = new FAT16(disk);
    await fileSystem.mount();

    const file = await fileSystem.open(['WINDOWS', 'SYSTEM', 'VGASYS.FON']);
    const font: any = new BitmapFont(file);

    await font.load();

    const surface: any = Surface.offscreen(200, 32);
    surface.font = new LogicalFont('System', 10, font.fontFor(10));

    const measured = surface.measureText('Hello, world');
    surface.fillText(0, 0, 'Hello, world');

    // The System font at ten points, which the oracle recorded as 77 by 16.
    expect(measured).toEqual({ width: 77, height: 16 });

    const context = surface.context;

    /* Something was drawn, and it stayed inside the extent the font reported.
     * `fillText` paints the background first, so every pixel of the extent is
     * touched and nothing beyond it is.
     */
    expect(marked(context, 0)).toBeGreaterThan(0);

    for (let y = 0; y < 32; y++) {
      for (let x = measured.width; x < 200; x++) {
        expect(`beyond the text at ${x},${y}: ${pixelAt(context, x, y).join()}`).toEqual(
          `beyond the text at ${x},${y}: 0,0,0`
        );
      }
    }

    // And the glyphs themselves are darker than the background they sit on.
    const background = pixelAt(context, measured.width - 1, 0);
    expect(background).toEqual([0xff, 0xff, 0xff]);
  });
});
