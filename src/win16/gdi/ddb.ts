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
 * order.
 *
 * A sixteen-colour display keeps a colour bitmap in four planes of a bit a
 * pixel: each row is its four planes in turn, plane `p` bit `p` of each
 * pixel's colour index, and each plane's row padded to a word. Recorded by
 * `patmono` on the VGA, the EGA and the Super VGA, from `GetBitmapBits` of a
 * bitmap filled and `SetBitmapBits` read back a pixel at a time. A 256-colour
 * display's is taken as one plane of a byte a pixel, not recorded.
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
  bitmap.padding ??= new Uint8Array(bitsSize(bitmap));

  return bitmap.padding;
}

/** A bitmap's planes and bits a pixel, as `GetObject` tells them. */
export function formatOf(bitmap: any) {
  if (bitmap.shape) {
    return { planes: bitmap.shape.planes, bits: bitmap.shape.bits };
  }

  const depth = bitmap instanceof DeviceBitmap ? bitmap.depth : bitmap.bpp;

  return depth === 4 ? { planes: 4, bits: 1 } : { planes: 1, bits: depth };
}

/** How many bytes a bitmap's bits take, every plane of every row. */
export function bitsSize(bitmap: any) {
  const { planes, bits } = formatOf(bitmap);

  return rowBytes(bits, bitmap.width) * planes * bitmap.height;
}

/** Whether the bitmap is laid out in the display's four planes. */
function planar(bitmap: any): bitmap is DeviceBitmap {
  return bitmap instanceof DeviceBitmap && !bitmap.shape && bitmap.depth === 4;
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
  if (bitmap.shape) {
    return bitmap.shape.bytes[at] ?? 0;
  }

  if (planar(bitmap)) {
    const { row, plane, column } = planeByte(bitmap, at);
    let byte = paddingOf(bitmap)[at] & paddingMask(1, bitmap.width, column);

    for (let slot = 0; slot < 8; slot++) {
      const x = column * 8 + slot;

      if (x < bitmap.width) {
        byte |= ((bitmap.indices[row * bitmap.width + x] >> plane) & 1) << (7 - slot);
      }
    }

    return byte;
  }

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
  if (bitmap.shape) {
    if (at < bitmap.shape.bytes.length) {
      bitmap.shape.bytes[at] = value;
    }

    return;
  }

  if (planar(bitmap)) {
    const { row, plane, column } = planeByte(bitmap, at);

    paddingOf(bitmap)[at] = value & paddingMask(1, bitmap.width, column);
    bitmap.context.markRect(column * 8, row, (column + 1) * 8, row + 1);

    for (let slot = 0; slot < 8; slot++) {
      const x = column * 8 + slot;

      if (x < bitmap.width) {
        const pixel = row * bitmap.width + x;
        const bit = (value >> (7 - slot)) & 1;

        bitmap.indices[pixel] = (bitmap.indices[pixel] & ~(1 << plane)) | (bit << plane);
      }
    }

    return;
  }

  const perRow = rowBytes(bitmap.bpp, bitmap.width);
  const row = Math.floor(at / perRow);
  const column = at % perRow;

  if (bitmap instanceof DeviceBitmap) {
    const depth = bitmap.depth;
    const perByte = 8 / depth;

    paddingOf(bitmap)[at] = value & paddingMask(depth, bitmap.width, column);
    bitmap.context.markRect(column * perByte, row, (column + 1) * perByte, row + 1);

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

/** Which row, plane and byte of the plane's row byte `at` of a planar bitmap is. */
function planeByte(bitmap: DeviceBitmap, at: number) {
  const perPlane = rowBytes(1, bitmap.width);
  const line = perPlane * 4;
  const within = at % line;

  return {
    row: Math.floor(at / line),
    plane: Math.floor(within / perPlane),
    column: within % perPlane,
  };
}
