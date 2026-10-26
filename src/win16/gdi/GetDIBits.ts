'use strict';

import { matchedIndex } from '../../raster/colour-match.js';
import { DeviceBitmap } from '../../raster/device-bitmap.js';
import { DevicePalette } from '../../raster/device-palette.js';

/**
 * A device-dependent bitmap's pixels read back as a DIB, as the header in
 * `lpbi` asks for them. **Recorded** by `getdib`, a colour bitmap and a
 * monochrome one on the VGA:
 *
 * * A bit count of 1, 4, 8 or 24 is read; any other, 0 among them, answers
 *   nought and leaves the header as it was.
 * * The header's image size is filled in, the stride times the bitmap's
 *   height, however many lines are asked for; the colour table follows it,
 *   and with no buffer for the bits that is all, answering the lines asked.
 * * A colour bitmap's table is the sixteen colours in the DIB's own order
 *   -- light and dark grey the other way round from the device's -- and at
 *   8 bits nought after them; at 1 bit black and white, a pixel white where
 *   the driver makes its colour white on a monochrome bitmap. At 24 bits
 *   there is no table, and each pixel is its colour, blue first.
 * * A monochrome bitmap's table at 4 bits is black but for its last entry,
 *   white, which its white pixels are.
 * * The lines are counted from the bottom, from `uStartScan`; the answer is
 *   how many were read. The bytes after a line's pixels, to its four-byte
 *   end, are left as they were.
 *
 * Not recorded: a monochrome bitmap at 8 bits, which is taken as at 4, its
 * white the last entry; `DIB_PAL_COLORS`, which is read as `DIB_RGB_COLORS`.
 */

/** The DIB's sixteen colours, as a 4-bit DIB of a 16-colour bitmap lists them. */
const DIB_COLOURS: [number, number, number][] = [
  [0, 0, 0],
  [128, 0, 0],
  [0, 128, 0],
  [128, 128, 0],
  [0, 0, 128],
  [128, 0, 128],
  [0, 128, 128],
  [128, 128, 128],
  [192, 192, 192],
  [255, 0, 0],
  [0, 255, 0],
  [255, 255, 0],
  [0, 0, 255],
  [255, 0, 255],
  [0, 255, 255],
  [255, 255, 255],
];

export function GetDIBits(
  this: any,
  hdc: number,
  hbmp: number,
  uStartScan: number,
  cScanLines: number,
  lpvBits: number,
  lpbi: number,
  fuColorUse: number
) {
  const given = this.handles.resolve(hdc);
  const target = this.handles.resolve(hbmp);

  /* With a printer's context, GDI gets them itself through the driver
   * (`printer-stretch.ts`). */
  if ((given?.driverDevice || given?.compatibleDevice) && target instanceof DeviceBitmap) {
    return import('./printer-stretch.js').then(
      async ({ getDIBitsFallback }) =>
        (await getDIBitsFallback(
          this,
          hdc,
          given,
          target,
          uStartScan & 0xffff,
          cScanLines & 0xffff,
          lpvBits,
          lpbi,
          fuColorUse
        )) ?? getOwnDIBits.call(this, hdc, hbmp, uStartScan, cScanLines, lpvBits, lpbi, fuColorUse)
    );
  }

  return getOwnDIBits.call(this, hdc, hbmp, uStartScan, cScanLines, lpvBits, lpbi, fuColorUse);
}

function getOwnDIBits(
  this: any,
  hdc: number,
  hbmp: number,
  uStartScan: number,
  cScanLines: number,
  lpvBits: number,
  lpbi: number,
  fuColorUse: number
) {
  const bitmap = this.handles.resolve(hbmp);

  void hdc;
  void fuColorUse;

  if (!(bitmap instanceof DeviceBitmap) || !lpbi) {
    return 0;
  }

  const core = this.machine.cpu.core;
  const segment = (lpbi >>> 16) & 0xffff;
  const offset = lpbi & 0xffff;
  const at = (n: number) => (offset + n) & 0xffff;
  const size = core.read16(segment, at(0));
  const count = core.read16(segment, at(14));

  if (![1, 4, 8, 24].includes(count)) {
    return 0;
  }

  const { width, height } = bitmap;
  const stride = ((width * count + 31) >> 5) << 2;
  const write32 = (n: number, value: number) => {
    core.write16(segment, at(n), value & 0xffff);
    core.write16(segment, at(n + 2), (value >>> 16) & 0xffff);
  };

  write32(4, width);
  write32(8, height);
  core.write16(segment, at(12), 1);
  write32(20, stride * height);

  const { table, row } = dibOf(this, bitmap, count);

  table.forEach(([red, green, blue], n) => {
    const entry = at(size + n * 4);

    core.write8(segment, entry, blue);
    core.write8(segment, (entry + 1) & 0xffff, green);
    core.write8(segment, (entry + 2) & 0xffff, red);
    core.write8(segment, (entry + 3) & 0xffff, 0);
  });

  const lines = Math.max(0, Math.min(cScanLines, height - uStartScan));

  if (!lpvBits) {
    return lines;
  }

  const bits = { segment: (lpvBits >>> 16) & 0xffff, offset: lpvBits & 0xffff };

  for (let line = 0; line < lines; line++) {
    const pixels = row(uStartScan + line);

    /* Through the selector's steps, as a huge pointer is; only the bytes the
     * pixels take, the padding after them left as it was. */
    for (let n = 0; n < (width * count + 7) >> 3; n++) {
      const linear = bits.offset + line * stride + n;

      core.write8(bits.segment + (linear >>> 16) * 8, linear & 0xffff, pixels[n]);
    }
  }

  return lines;
}

/**
 * A bitmap's pixels as a DIB of `count` bits to a pixel: its colour table,
 * and each line, counted from the bottom, as the DIB's bytes, the padding
 * after its pixels nought. What `GetDIBits` writes, and what a metafile
 * keeps of a bitmap (`metafile.ts`).
 */
export function dibOf(system: any, bitmap: DeviceBitmap, count: number) {
  const { width, height } = bitmap;
  const stride = ((width * count + 31) >> 5) << 2;

  /* The colour table, and each device index's entry in it. */
  const mono = bitmap.depth === 1;
  const entries = count === 24 ? 0 : 1 << count;
  const table: [number, number, number][] = [];
  let entryOf: (index: number) => number;

  if (count === 1) {
    table.push([0, 0, 0], [255, 255, 255]);

    const white = DevicePalette.forDepth(1);

    entryOf = (index) => {
      const [red, green, blue] = bitmap.devicePalette.colours[index] ?? [0, 0, 0];

      return mono ? index : matchedIndex(system.display, white, red, green, blue);
    };
  } else if (mono) {
    for (let n = 0; n < entries; n++) {
      table.push(n === entries - 1 ? [255, 255, 255] : [0, 0, 0]);
    }

    entryOf = (index) => (index ? entries - 1 : 0);
  } else {
    for (let n = 0; n < entries; n++) {
      table.push(DIB_COLOURS[n] ?? [0, 0, 0]);
    }

    entryOf = (index) => {
      const [red, green, blue] = bitmap.devicePalette.colours[index] ?? [0, 0, 0];
      const found = DIB_COLOURS.findIndex(([r, g, b]) => r === red && g === green && b === blue);

      return found < 0 ? 0 : found;
    };
  }

  const row = (scan: number) => {
    const y = height - 1 - scan;
    const pixels = new Uint8Array(stride);

    for (let x = 0; x < width; x++) {
      const index = bitmap.indexAt(x, y) ?? 0;

      if (count === 24) {
        const [red, green, blue] = mono
          ? index
            ? [255, 255, 255]
            : [0, 0, 0]
          : (bitmap.devicePalette.colours[index] ?? [0, 0, 0]);

        pixels.set([blue, green, red], x * 3);
      } else if (count === 8) {
        pixels[x] = entryOf(index);
      } else if (count === 4) {
        pixels[x >> 1] |= entryOf(index) << (x & 1 ? 0 : 4);
      } else {
        pixels[x >> 3] |= entryOf(index) << (7 - (x & 7));
      }
    }

    return pixels;
  };

  return { table, row, stride };
}

/**
 * A bitmap as a packed DIB, as GDI makes one of it for a metafile (seg20
 * `231c`, `23da`, then `GetDIBits`): 1, 4, 8 or 24 bits to a pixel for
 * planes times bits of 1, to 4, to 8 and more; its header's size, width,
 * height, one plane, bits and image size, the rest nought; its colours;
 * its rows from the bottom.
 */
export function packedDibOf(system: any, bitmap: DeviceBitmap) {
  const depth = bitmap.depth;
  const count = depth === 1 ? 1 : depth <= 4 ? 4 : depth <= 8 ? 8 : 24;
  const { table, row, stride } = dibOf(system, bitmap, count);
  const words = [40, 0, bitmap.width, 0, bitmap.height, 0, 1, count, 0, 0];
  const image = stride * bitmap.height;
  const bytes = [...words, image & 0xffff, image >>> 16].flatMap((word) => [
    word & 0xff,
    (word >>> 8) & 0xff,
  ]);

  bytes.push(...new Array(16).fill(0));

  for (const [red, green, blue] of table) {
    bytes.push(blue, green, red, 0);
  }

  for (let scan = 0; scan < bitmap.height; scan++) {
    bytes.push(...row(scan));
  }

  return bytes;
}
