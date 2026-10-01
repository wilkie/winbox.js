'use strict';

import { DeviceBitmap } from './device-bitmap.js';
import { matchedIndex } from './colour-match.js';
import { DevicePalette } from './device-palette.js';

/**
 * A device-independent bitmap, as a resource holds one: a header, a colour
 * table and rows of pixels, bottom row first, each padded to four bytes.
 *
 * Both documented headers are read, because Windows 3.1's own files use both:
 * the 12-byte core header, whose colour table has three bytes an entry, and the
 * 40-byte info header, with four. The display drivers keep their OEM bitmaps
 * in each. Pixels of 1, 4 and 8 bits are read, uncompressed, or run-length
 * encoded at 4 or 8 bits (`BI_RLE4`, `BI_RLE8`), as the solitaire games of
 * the corpus keep all their cards; anything else is refused by name.
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

  const rle =
    (compression === BI_RLE8 && bitCount === 8) || (compression === BI_RLE4 && bitCount === 4);

  if (compression !== 0 && !rle) {
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

  if (rle) {
    return {
      width,
      height,
      bitCount,
      colours,
      pixels: decodeRle(bytes, start, width, height, rawHeight > 0, bitCount),
    };
  }

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

const BI_RLE8 = 1;
const BI_RLE4 = 2;

/**
 * Run-length encoded pixels (documented): pairs of a count and a value --
 * the value's index repeated, or for 4 bits its two indices in turn -- or a
 * nought and an escape: 0 ends a line, 1 ends the bitmap, 2 moves on by the
 * two bytes after it, across and up, and 3 or more is that many indices
 * given as they are, padded to a word. Lines run bottom first. What is not
 * reached stays index 0.
 */
function decodeRle(
  bytes: Uint8Array,
  start: number,
  width: number,
  height: number,
  bottomUp: boolean,
  bitCount: number
) {
  const pixels = new Uint8Array(width * height);
  const four = bitCount === 4;
  let at = start;
  let x = 0;
  let line = 0;
  const put = (index: number) => {
    if (x < width && line < height) {
      pixels[(bottomUp ? height - 1 - line : line) * width + x] = index;
    }

    x++;
  };

  while (at + 1 < bytes.length && line < height) {
    const count = bytes[at];
    const value = bytes[at + 1];

    at += 2;

    if (count > 0) {
      for (let n = 0; n < count; n++) {
        put(four ? (n & 1 ? value & 0x0f : value >> 4) : value);
      }

      continue;
    }

    if (value === 0) {
      x = 0;
      line++;
    } else if (value === 1) {
      break;
    } else if (value === 2) {
      x += bytes[at];
      line += bytes[at + 1];
      at += 2;
    } else {
      const length = four ? (value + 1) >> 1 : value;

      for (let n = 0; n < value; n++) {
        const byte = bytes[at + (four ? n >> 1 : n)];

        put(four ? (n & 1 ? byte & 0x0f : byte >> 4) : byte);
      }

      at += (length + 1) & ~1;
    }
  }

  return pixels;
}

/**
 * A DIB as a device-dependent bitmap at a depth: each colour matched to the
 * palette of that depth, as a bitmap is realised for a display -- by the
 * display's driver's rule when the display is given, which is how
 * `CreateDIBitmap` matches a colour table (`dibmap`: all 256 colours as
 * `GetNearestColor` answers them), and otherwise the nearest.
 */
export function dibToDevice(
  dib: Dib,
  depth: number,
  palette = DevicePalette.forDepth(depth),
  display?: any,
  realized: ((red: number, green: number, blue: number) => number) | null = null
) {
  const bitmap = new DeviceBitmap(dib.width, dib.height, depth, undefined, palette);
  /* With a palette realized where it is drawn, its nearest entries' slots
   * (`paldib`). */
  const map = dib.colours.map(([red, green, blue]) =>
    realized
      ? realized(red, green, blue)
      : display
        ? matchedIndex(display, palette, red, green, blue)
        : palette.index(red, green, blue)
  );

  for (let at = 0; at < dib.pixels.length; at++) {
    bitmap.indices[at] = map[dib.pixels[at]] ?? 0;
  }

  return bitmap;
}
