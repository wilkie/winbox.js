'use strict';

import { DeviceBitmap } from '../../raster/device-bitmap.js';

/**
 * A device-dependent bitmap's bits, in the shape a program sees them.
 *
 * `CreateBitmap`, `SetBitmapBits` and `GetBitmapBits` hand bits across in rows
 * padded to a whole number of 16-bit words, each pixel `depth` bits, the
 * leftmost in the most significant. Recorded by `bitbits` for monochrome
 * bitmaps: at widths of 8, 16, 24, 32 and 40 pixels a row is 2, 2, 4, 4 and 6
 * bytes, a set bit is white, and bits made that way come back in the same
 * order. For deeper bitmaps the layout is the same rule carried over, and not
 * recorded: a display driver is free to keep its own bitmaps in planes.
 *
 * winbox.js keeps a device bitmap as one palette index a pixel (see
 * `DeviceBitmap`), so the bits are packed and unpacked here, at the edge.
 *
 * The bits past the last pixel of a row are kept as well, apart from the
 * pixels: `bitbits` made bitmaps whose padding held a counting pattern, and
 * `GetBitmapBits` gave the padding back as it was given. Drawing never
 * touches it.
 */

/** The bits of byte `column` of a row that lie past its last pixel. */
function paddingMask(depth: number, width: number, column: number) {
  const first = width * depth - column * 8;

  return first <= 0 ? 0xff : first >= 8 ? 0 : 0xff >> first;
}

/** Where a device bitmap keeps its rows' padding, made when first needed. */
function paddingOf(bitmap: any) {
  bitmap.padding ??= new Uint8Array(rowBytes(bitmap.depth, bitmap.width) * bitmap.height);

  return bitmap.padding;
}

/** How many bytes a program's row of the bitmap takes: words, not doublewords. */
export function rowBytes(bpp: number, width: number) {
  return ((bpp * width + 15) >> 4) << 1;
}

/** How many bytes a row takes in an older bitmap's own storage. */
function storedRowBytes(bitmap: any) {
  return ((((bitmap.bpp * bitmap.width + 7) & ~7) >> 3) + 3) & ~3;
}

/** The byte at `at` of the bitmap as a program would read it. */
export function readByte(bitmap: any, at: number) {
  const perRow = rowBytes(bitmap.bpp, bitmap.width);
  const row = Math.floor(at / perRow);
  const column = at % perRow;

  if (bitmap instanceof DeviceBitmap) {
    const depth = bitmap.depth;
    const perByte = 8 / depth;
    let byte = paddingOf(bitmap)[at] & paddingMask(depth, bitmap.width, column);

    for (let slot = 0; slot < perByte; slot++) {
      const x = column * perByte + slot;
      const index = x < bitmap.width ? bitmap.indices[row * bitmap.width + x] : 0;

      byte |= (index & ((1 << depth) - 1)) << (8 - depth * (slot + 1));
    }

    return byte;
  }

  const stored = storedRowBytes(bitmap);

  return column < stored && bitmap.view ? bitmap.view.getUint8(row * stored + column) : 0;
}

/** Stores the byte at `at` of the bitmap as a program wrote it. */
export function writeByte(bitmap: any, at: number, value: number) {
  const perRow = rowBytes(bitmap.bpp, bitmap.width);
  const row = Math.floor(at / perRow);
  const column = at % perRow;

  if (bitmap instanceof DeviceBitmap) {
    const depth = bitmap.depth;
    const perByte = 8 / depth;

    paddingOf(bitmap)[at] = value & paddingMask(depth, bitmap.width, column);

    for (let slot = 0; slot < perByte; slot++) {
      const x = column * perByte + slot;

      if (x < bitmap.width) {
        bitmap.indices[row * bitmap.width + x] =
          (value >> (8 - depth * (slot + 1))) & ((1 << depth) - 1);
      }
    }

    return;
  }

  const stored = storedRowBytes(bitmap);

  if (column < stored) {
    bitmap.view.setUint8(row * stored + column, value);
  }
}
