'use strict';

import { DeviceBitmap } from './device-bitmap.js';
import { DevicePalette } from './device-palette.js';

/**
 * A device-independent bitmap, as a resource holds one: a header, a colour
 * table and rows of pixels, bottom row first, each padded to four bytes.
 *
 * Both documented headers are read, because Windows 3.1's own files use both:
 * the 12-byte core header, whose colour table has three bytes an entry, and the
 * 40-byte info header, with four. The display drivers keep their OEM bitmaps
 * in each. Only uncompressed pixels of 1, 4 and 8 bits are read; anything else
 * is refused by name.
 */
export interface Dib {
  width: number;
  height: number;
  bitCount: number;

  /** The colour table, as red, green and blue. */
  colours: [number, number, number][];

  /** Each pixel's colour table index, top row first. */
  pixels: Uint8Array;
}

export function decodeDib(bytes: Uint8Array): Dib {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size = view.getUint32(0, true);
  const core = size === 12;

  if (!core && size < 40) {
    throw new Error(`a bitmap header of ${size} bytes is not one this reads`);
  }

  const width = core ? view.getUint16(4, true) : view.getInt32(4, true);
  const rawHeight = core ? view.getInt16(6, true) : view.getInt32(8, true);
  const bitCount = core ? view.getUint16(10, true) : view.getUint16(14, true);
  const compression = core ? 0 : view.getUint32(16, true);
  const used = core ? 0 : view.getUint32(32, true);

  if (compression !== 0) {
    throw new Error(`a bitmap compressed with method ${compression} is not read here`);
  }

  if (bitCount !== 1 && bitCount !== 4 && bitCount !== 8) {
    throw new Error(`a bitmap of ${bitCount} bits a pixel is not read here`);
  }

  const height = Math.abs(rawHeight);
  const count = used || 1 << bitCount;
  const entry = core ? 3 : 4;
  const colours: [number, number, number][] = [];

  for (let index = 0; index < count; index++) {
    const at = size + index * entry;
    colours.push([bytes[at + 2], bytes[at + 1], bytes[at]]);
  }

  const start = size + count * entry;
  const stride = ((width * bitCount + 31) >> 5) << 2;
  const pixels = new Uint8Array(width * height);
  const perByte = 8 / bitCount;
  const mask = (1 << bitCount) - 1;

  for (let row = 0; row < height; row++) {
    /* Bottom row first, unless the height says the rows run top down. */
    const from = start + (rawHeight > 0 ? height - 1 - row : row) * stride;

    for (let x = 0; x < width; x++) {
      const byte = bytes[from + Math.floor(x / perByte)];
      const shift = 8 - bitCount * ((x % perByte) + 1);

      pixels[row * width + x] = (byte >> shift) & mask;
    }
  }

  return { width, height, bitCount, colours, pixels };
}

/**
 * A DIB as a device-dependent bitmap at a depth: each colour matched to the
 * palette of that depth, as a bitmap is realised for a display.
 */
export function dibToDevice(dib: Dib, depth: number, palette = DevicePalette.forDepth(depth)) {
  const bitmap = new DeviceBitmap(dib.width, dib.height, depth, undefined, palette);
  const map = dib.colours.map(([red, green, blue]) => palette.index(red, green, blue));

  for (let at = 0; at < dib.pixels.length; at++) {
    bitmap.indices[at] = map[dib.pixels[at]] ?? 0;
  }

  return bitmap;
}
