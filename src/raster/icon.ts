'use strict';

import { DevicePalette } from './device-palette.js';
import { matchedIndex, nearestStatic } from './colour-match.js';
import { type IconData } from '../run/group-icon.js';

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
export type { IconData } from '../run/group-icon.js';

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
 * The icon of a group for a display, as USER chooses one -- `GetIconID`'s
 * choice, which `LoadIcon` and SHELL's `ExtractIcon` make too (**read out**
 * of `USER.EXE` seg12 `040c`-`04f4`; **recorded** by `iconid`): the
 * display's colours, 7D00h from 16 bits up; of `size` square, one of that
 * many colours at once, else the one of most colours below; else, of any
 * size, the one of most colours not more than the display's; else the
 * first. A count of colours is the entry's own byte, nought for 256. As
 * `cursor-make.ts`'s `iconIndex`, which reads the directory in memory.
 */
export function pickIcon(entries: IconEntry[], size: number, displayColours: number) {
  const most = displayColours >= 0x10000 ? 0x7d00 : displayColours;
  let fit = 0;
  let fitAt = 0;
  let any = 0;
  let anyAt = 0;

  for (let at = 0; at < entries.length; at++) {
    const entry = entries[at];
    const colours = entry.colours;

    if (colours <= most && any < colours) {
      any = colours;
      anyAt = at;
    }

    if (entry.width !== size || entry.height !== size) {
      continue;
    }

    if (colours === most) {
      return entry;
    }

    /* Among those with more colours than the display's USER keeps the
     * fewest, but starts from nought and so never takes one (`04b6`). */
    if (colours < most && fit < colours) {
      fit = colours;
      fitAt = at;
    }
  }

  return entries[fit ? fitAt : any ? anyAt : 0];
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

  /* On a display of sixteen colours each colour of the table is the one the
   * driver draws it as, by its own matching, not the nearest: on the EGA a
   * light grey, `c0c0c0`, is its grey `82`, index 7, not white (`pmbare` on
   * the EGA: Program Manager's own icon in a group file). On one of 256, so
   * too: the static colour nearest (`nearestStatic`), not one of the
   * driver's own between them -- SimTown's demo's icon of 256 colours, in
   * the group Widget Workshop's installer made, holds 3, `808000`, where
   * the nearest of all is 51 (`widget-windows.json`). */
  const ega = palette.colours.every((colour, index) =>
    colour.every((value, at) => value === DevicePalette.EGA.colours[index]?.[at])
  );
  const display = { colors: 16, palette: ega ? 'ega' : undefined };

  for (let at = 0; at < count; at++) {
    const entry = size + at * 4;
    const [red, green, blue] = [bytes[entry + 2], bytes[entry + 1], bytes[entry]];

    map.push(
      palette.size === 16
        ? matchedIndex(display, palette, red, green, blue)
        : palette.size === 256
          ? nearestStatic(palette, red, green, blue)
          : palette.index(red, green, blue)
    );
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

/** A cursor: its picture and mask, as an icon's, and its hotspot. */
export interface CursorImage extends IconData {
  hotspot: { x: number; y: number };
}

/**
 * A cursor resource: its hotspot, two words, then a bitmap laid out as an
 * icon's, its picture and its mask.
 */
export function decodeCursor(bytes: Uint8Array, palette: DevicePalette): CursorImage {
  const hotspot = { x: bytes[0] | (bytes[1] << 8), y: bytes[2] | (bytes[3] << 8) };

  return { ...decodeIcon(bytes.subarray(4), palette), hotspot };
}
