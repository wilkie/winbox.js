'use strict';

import { type DevicePalette } from './device-palette.js';

/**
 * An icon as Windows 3.1 keeps one in a resource, and draws it.
 *
 * A group icon resource lists the icons made of one picture, each a size and
 * a number of colours, and names each by the icon resource that holds it; the
 * one drawn is the one that fits the display. An icon resource is a DIB whose
 * height is doubled: its colours, bottom row first, then a monochrome mask of
 * the same size, where a set bit keeps what is beneath.
 *
 * Drawn, each pixel is what was there ANDed with the mask and XORed with the
 * picture -- the mask's set bits leave the screen, and a picture pixel of
 * black under a set bit leaves it too.
 */
export interface IconData {
  width: number;
  height: number;

  /** The picture, a palette index a pixel, top row first. */
  xor: Uint8Array;

  /** The mask, a byte a pixel: 1 keeps what is beneath. */
  and: Uint8Array;
}

/** What a group icon resource says of each icon in it. */
export interface IconEntry {
  width: number;
  height: number;
  colours: number;
  bitCount: number;
  id: number;
}

/** The icons a group icon resource lists. */
export function iconEntries(group: Uint8Array): IconEntry[] {
  const view = new DataView(group.buffer, group.byteOffset, group.byteLength);
  const count = view.getUint16(4, true);
  const entries: IconEntry[] = [];

  for (let at = 0; at < count; at++) {
    const offset = 6 + at * 14;

    entries.push({
      width: group[offset] || 256,
      height: group[offset + 1] || 256,
      colours: group[offset + 2],
      bitCount: view.getUint16(offset + 6, true),
      id: view.getUint16(offset + 12, true),
    });
  }

  return entries;
}

/**
 * The icon of a group for a display: its size, and as many colours as the
 * display has or the most below that. Not measured: which a display takes
 * when a group has none of its size.
 */
export function pickIcon(entries: IconEntry[], size: number, displayColours: number) {
  const colours = (entry: IconEntry) => entry.colours || 1 << (entry.bitCount || 4);
  const sized = entries.filter((entry) => entry.width === size && entry.height === size);
  const candidates = sized.length ? sized : entries;
  const fitting = candidates.filter((entry) => colours(entry) <= displayColours);

  return (fitting.length ? fitting : candidates).reduce(
    (best, entry) => (colours(entry) > colours(best) ? entry : best),
    (fitting.length ? fitting : candidates)[0]
  );
}

/** An icon resource, its colours matched to a display's palette. */
export function decodeIcon(bytes: Uint8Array, palette: DevicePalette): IconData {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size = view.getUint32(0, true);
  const width = view.getInt32(4, true);
  const height = view.getInt32(8, true) / 2;
  const bitCount = view.getUint16(14, true);
  const used = view.getUint32(32, true);
  const count = bitCount <= 8 ? used || 1 << bitCount : 0;
  const map: number[] = [];

  for (let at = 0; at < count; at++) {
    const entry = size + at * 4;

    map.push(palette.index(bytes[entry + 2], bytes[entry + 1], bytes[entry]));
  }

  const xorStride = ((width * bitCount + 31) >> 5) << 2;
  const andStride = ((width + 31) >> 5) << 2;
  const xorStart = size + count * 4;
  const andStart = xorStart + xorStride * height;
  const xor = new Uint8Array(width * height);
  const and = new Uint8Array(width * height);
  const perByte = 8 / bitCount;
  const mask = (1 << bitCount) - 1;

  for (let row = 0; row < height; row++) {
    /* Bottom row first, in both halves. */
    const from = height - 1 - row;

    for (let x = 0; x < width; x++) {
      const byte = bytes[xorStart + from * xorStride + Math.floor(x / perByte)];
      const shift = 8 - bitCount * ((x % perByte) + 1);

      xor[row * width + x] = map[(byte >> shift) & mask] ?? 0;
      and[row * width + x] = (bytes[andStart + from * andStride + (x >> 3)] >> (7 - (x & 7))) & 1;
    }
  }

  return { width, height, xor, and };
}
