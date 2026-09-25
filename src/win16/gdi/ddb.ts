'use strict';

import { BitmapContext } from '../../raster/bitmap-context.js';

/**
 * A device-dependent bitmap's bits, in the shape a program sees them.
 *
 * `CreateBitmap`, `SetBitmapBits` and `GetBitmapBits` hand bits across in rows
 * padded to a whole number of 16-bit words. Recorded by `bitbits`: at widths
 * of 8, 16, 24, 32 and 40 pixels a monochrome row is 2, 2, 4, 4 and 6 bytes,
 * and bits made that way come back in the same order. winbox.js keeps a
 * bitmap in rows padded to four bytes, which is right for a device-independent
 * bitmap and is what the raster code reads, so the bits are re-rowed here, at
 * the edge.
 */

/** How many bytes a program's row of the bitmap takes: words, not doublewords. */
export function rowBytes(bpp: number, width: number) {
  return ((bpp * width + 15) >> 4) << 1;
}

/** How many bytes a row takes in winbox.js's own storage. */
function storedRowBytes(bitmap: any) {
  return ((((bitmap.bpp * bitmap.width + 7) & ~7) >> 3) + 3) & ~3;
}

/**
 * The byte at `at` of the bitmap as a program would read it.
 *
 * A monochrome bitmap selected into a surface is read from the surface's
 * pixels, because that is where drawing goes: a set bit is white, as the
 * probes' bitmaps and the replay's reading of them have it. Anything else is
 * read from the bitmap's own storage. A byte past the pixels of a row -- the
 * padding -- comes from the storage as well; `bitbits` shows Windows leaves
 * whatever the memory held there, which is not something to reproduce.
 */
export function readByte(bitmap: any, at: number) {
  const perRow = rowBytes(bitmap.bpp, bitmap.width);
  const row = Math.floor(at / perRow);
  const column = at % perRow;
  const stored = storedRowBytes(bitmap);
  const fromStorage = () =>
    column < stored && bitmap.view ? bitmap.view.getUint8(row * stored + column) : 0;

  const surface = bitmap.surface;

  if (bitmap.bpp !== 1 || !surface || column * 8 >= bitmap.width) {
    return fromStorage();
  }

  const width = surface.width;
  const pixels =
    surface.context instanceof BitmapContext
      ? surface.context.pixels
      : surface.context.getImageData(0, 0, width, surface.height).data;

  let byte = fromStorage();

  for (let bit = 0; bit < 8; bit++) {
    const x = column * 8 + bit;

    if (x >= bitmap.width) {
      continue;
    }

    const index = (row * width + x) * 4;
    const inked = pixels[index] < 0x80 && pixels[index + 3] !== 0;
    const mask = 0x80 >> bit;

    byte = inked ? byte & ~mask : byte | mask;
  }

  return byte;
}

/** Stores the byte at `at` of the bitmap as a program wrote it. */
export function writeByte(bitmap: any, at: number, value: number) {
  const perRow = rowBytes(bitmap.bpp, bitmap.width);
  const row = Math.floor(at / perRow);
  const column = at % perRow;
  const stored = storedRowBytes(bitmap);

  if (column < stored) {
    bitmap.view.setUint8(row * stored + column, value);
  }
}
