'use strict';

import { DevicePalette } from '../../raster/device-palette.js';
import { nearestStatic } from '../../raster/colour-match.js';
import { ditheredIndex } from '../../raster/dither.js';
import { combine } from '../../raster/raster-op.js';
import { DeviceColorMatch } from './system-exports.js';
import { monoScan, ropBit } from './driver-hercules.js';
import { hugeRead8 } from '../huge.js';
import { walkRle } from './rle-runs.js';
import {
  STYLE_MASKS,
  entryOf,
  getCharWidth as vgaGetCharWidth,
  layOut,
  mix,
  polylinePixels,
  within,
} from './driver-bitmap.js';

/**
 * The 256-colour display's own routines on a memory bitmap, as
 * `SVGA256.DRV` makes and draws them for GDI's helpers
 * (`driver-helpers.ts`): its bitmaps a byte a pixel, each byte an index of
 * the palette, or one plane of a bit. The twin of
 * `crates/winbox-win16/src/gdi/driver_vga256.rs`.
 *
 * **Read out** of `SVGA256.DRV` (the generic Super VGA driver of 256
 * colours, as the oracle runs it on the ET4000); **recorded** by
 * `gdidmdrw` on that display.
 */

function core(system: any) {
  return system.machine.cpu.core;
}

export function read8(system: any, far: number, at: number) {
  return core(system).read8((far >>> 16) & 0xffff, ((far & 0xffff) + at) & 0xffff);
}

export function read16(system: any, far: number, at: number) {
  return read8(system, far, at) | (read8(system, far, at + 1) << 8);
}

export function read32(system: any, far: number, at: number) {
  return (read16(system, far, at) | (read16(system, far, at + 2) << 16)) >>> 0;
}

export function write8(system: any, far: number, at: number, value: number) {
  core(system).write8((far >>> 16) & 0xffff, ((far & 0xffff) + at) & 0xffff, value & 0xff);
}

export function write16(system: any, far: number, at: number, value: number) {
  write8(system, far, at, value);
  write8(system, far, at + 1, value >> 8);
}

/** Whether the display is the 256-colour one. */
export function isVga256(system: any) {
  return String(system.display?.driverFile ?? '').toUpperCase() === 'SVGA256.DRV';
}

/* Colours ------------------------------------------------------------------ */

/**
 * A static colour's flag beside its index (`SVGA256.DRV` data segment
 * `005e`, a word each, the index then the flag; the same flags for each
 * index in the table of 256 at `0784`, which no code writes): 1 a colour a
 * monochrome bitmap takes as white, 2 black; white is 3. Every index
 * between the statics is nought.
 */
const WHITE_ON_MONO = 0x01;
const BLACK = 0x02;
const WHITE_INDICES = new Set([0x07, 0x08, 0x09, 0xf6, 0xf7, 0xf8, 0xfa, 0xfb, 0xfe, 0xff]);

export function flagsOf(index: number) {
  return (
    (WHITE_INDICES.has(index & 0xff) ? WHITE_ON_MONO : 0) |
    ((index & 0xff) === 0 || (index & 0xff) === 0xff ? BLACK : 0)
  );
}

/** The flag of a colour matched exactly (seg1 `0a03`). */
const EXACT = 0x80;

/** A physical colour's top word: nought, then FFh (seg1 `0a18`). */
const PHYSICAL_HIGH = 0xff000000;

/**
 * The driver's match of a colour (seg1 `0990`): the nearest of the twenty
 * statics by the sum of the squares of the differences, the first on a tie
 * (`nearestStatic`), flagged `EXACT` where it is the colour. Answers the
 * physical colour: the index, its flag in the next byte, then nought and
 * FFh.
 */
export function matched(system: any, colour: number) {
  const red = colour & 0xff;
  const green = (colour >>> 8) & 0xff;
  const blue = (colour >>> 16) & 0xff;
  const palette = DevicePalette.forDisplay(system.display, 8);
  const index = nearestStatic(palette, red, green, blue);
  const [r, g, b] = palette.colours[index];
  const exact = r === red && g === green && b === blue ? EXACT : 0;

  return (index | ((flagsOf(index) | exact) << 8) | PHYSICAL_HIGH) >>> 0;
}

/** A colour made physical where it is not one already: its top byte negative or 1 (seg1 `1afe`, `061a`). */
function physicalOf(system: any, colour: number, passed: (top: number) => boolean) {
  return passed(colour >>> 24) ? colour >>> 0 : matched(system, colour);
}

/**
 * `ColorInfo` (`SVGA256.DRV` seg1 `1ae0`), whatever the bitmap. With a
 * buffer, the colour made physical -- left as it is where its top byte is
 * negative or 1 (a palette's index) -- its low word and FF00h written
 * there; the answer the static's red, green and blue (data `0022`, three
 * bytes each, the last ten for indices from F5h on). With none, the colour
 * taken as a physical one: an index between the statics answered as it is
 * with FF00h above, and a static's colour from the table of 256 at `0384`.
 */
export function colorInfo(system: any, colour: number, lpPhysical: number) {
  const palette = DevicePalette.forDisplay(system.display, 8);
  const rgbOf = (index: number) => {
    const [r, g, b] = palette.colours[index];

    return (r | (g << 8) | (b << 16)) >>> 0;
  };

  if (lpPhysical) {
    const physical = physicalOf(system, colour, (top) => (top & 0x80) !== 0 || top === 1);

    write16(system, lpPhysical, 0, physical);
    write16(system, lpPhysical, 2, 0xff00);
    return rgbOf(physical & 0xff);
  }

  const index = colour & 0xff;

  if (index >= 0x0a && index <= 0xf5) {
    return ((colour & 0xffff) | 0xff000000) >>> 0;
  }

  return rgbOf(index);
}

/* RealizeObject ----------------------------------------------------------- */

/** The size of each object, by style 1 to 3 (seg1 `098a`). */
const SIZES = [6, 0x53, 0];

/**
 * What a style of nought answers: the word before the table of sizes, the
 * last of the table of routines before it -- the font's, `094b` (seg1
 * `05ea`).
 */
const STYLE_NOUGHT = 0x094b;

/** The routine's offset in the driver's table, which `Brute` leaves in DX. */
const REALIZE_OBJECT = 0x24;

/** A brush: its 8 by 8 bytes, then its monochrome plane, its style and flags, and its hatch (seg1 `0641`, `0819`). */
export const BRUSH_MONO = 0x40;
export const BRUSH_STYLE = 0x48;
export const BRUSH_FLAGS = 0x4a;
export const BRUSH_HATCH = 0x4b;

/** The brush's styles. */
export const SOLID = 0;
export const HOLLOW = 1;
export const HATCHED = 2;
export const PATTERN = 3;

/** The brush's flags: one colour, no turning of its bytes (`06b5`); black, white or hollow (`06c6`); a monochrome pattern (`0770`). */
export const ONE_COLOUR = 0x08;
export const PLAIN = 0x0a;
export const MONO_PATTERN = 0x04;

/** The hatches, eight rows of a byte each (seg1 `0954`). */
const HATCHES = [
  [0x00, 0x00, 0x00, 0x00, 0xff, 0x00, 0x00, 0x00],
  [0x08, 0x08, 0x08, 0x08, 0x08, 0x08, 0x08, 0x08],
  [0x80, 0x40, 0x20, 0x10, 0x08, 0x04, 0x02, 0x01],
  [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80],
  [0x08, 0x08, 0x08, 0x08, 0xff, 0x08, 0x08, 0x08],
  [0x81, 0x42, 0x24, 0x18, 0x18, 0x24, 0x42, 0x81],
];

/**
 * A pen (seg1 `05fb`): its physical colour, then its style -- solid for a
 * pen wider than a pixel or of a style past `PS_NULL`. A colour whose top
 * byte is FFh is kept as it is; a null pen's colour is not made at all, AX
 * nought and DX the routine's offset as `Brute` left it.
 */
function realizePen(system: any, input: number, out: number) {
  const style = read16(system, input, 0);
  const width = read16(system, input, 2);
  let physical: number;
  let kept = style;

  if (style === 5) {
    physical = (REALIZE_OBJECT << 16) >>> 0;
  } else {
    kept = width > 1 || style > 5 ? 0 : style;
    physical = physicalOf(system, read32(system, input, 6), (top) => top === 0xff);
  }

  write16(system, out, 0, physical);
  write16(system, out, 2, physical >>> 16);
  write16(system, out, 4, kept);
}

/** Each of the 64 bytes' flag of white, a row of bits for each row (seg1 `07f9`-`0816`, through the table at `0784`). */
function monoOfBytes(system: any, out: number) {
  for (let row = 0; row < 8; row++) {
    let bits = 0;

    for (let x = 0; x < 8; x++) {
      bits |= (flagsOf(read8(system, out, row * 8 + x)) & WHITE_ON_MONO) << (7 - x);
    }

    write8(system, out, BRUSH_MONO + row, bits);
  }
}

/**
 * The monochrome plane of a grey (seg1 `0406`): the level taken from 0 to
 * 64, `(ceil(grey / 2)) / 4`; its multiple of four's four rows (`048d`)
 * twice; for the rest of four a pixel or two more from the table at `046d`;
 * for a level of 16, 32 or 48 the two rows of `0707` instead.
 */
const MONO_GREYS = [
  [0x00, 0x00, 0x00, 0x00],
  [0x88, 0x00, 0x00, 0x00],
  [0x88, 0x00, 0x22, 0x00],
  [0xaa, 0x00, 0x22, 0x00],
  [0xaa, 0x00, 0xaa, 0x00],
  [0xaa, 0x44, 0xaa, 0x00],
  [0xaa, 0x44, 0xaa, 0x11],
  [0xaa, 0x55, 0xaa, 0x11],
  [0xaa, 0x55, 0xaa, 0x55],
  [0xee, 0x55, 0xaa, 0x55],
  [0xee, 0x55, 0xbb, 0x55],
  [0xff, 0x55, 0xbb, 0x55],
  [0xff, 0x55, 0xff, 0x55],
  [0xff, 0xdd, 0xff, 0x55],
  [0xff, 0xdd, 0xff, 0x77],
  [0xff, 0xff, 0xff, 0x77],
  [0xff, 0xff, 0xff, 0xff],
];

/** The row and the bit of the pixels more, for each multiple of four (seg1 `046d`). */
const MONO_MORE: [number, number][] = [
  [0, 0x80],
  [2, 0x20],
  [0, 0x20],
  [2, 0x80],
  [1, 0x40],
  [3, 0x10],
  [1, 0x10],
  [3, 0x40],
  [0, 0x40],
  [2, 0x10],
  [0, 0x10],
  [2, 0x40],
  [1, 0x80],
  [3, 0x20],
  [1, 0x20],
  [3, 0x80],
];

/** The rows for the levels of 16, 32 and 48, by `046d`'s byte at `0468` (seg1 `0436`, `06ef`). */
const MONO_HALVES: Record<number, [number, number]> = {
  1: [0x88, 0x22],
  2: [0xaa, 0x55],
  3: [0xdd, 0x77],
};
const MONO_HALF_OF = [4, 1, 2, 3, 5];

function monoOfGrey(grey: number) {
  const level = ((grey >> 1) + (grey & 1)) >> 1;
  const rows = [...MONO_GREYS[level >> 2], ...MONO_GREYS[level >> 2]];
  const rest = level & 3;

  if (rest) {
    const [row, bit] = MONO_MORE[level >> 2];
    const low = bit >> 4;

    if (rest === 3) {
      rows[row] |= low;
    }

    if (rest >= 2) {
      rows[row + 4] |= low;
    }

    rows[row] |= bit;
  } else if (!(level & 0xf)) {
    const half = MONO_HALVES[MONO_HALF_OF[level >> 4]];

    if (half) {
      for (let row = 0; row < 8; row++) {
        rows[row] = half[row & 1];
      }
    }
  }

  return rows;
}

/**
 * A solid brush (seg1 `0666`). A colour flagged in its top byte, but for
 * 10h, is a physical one: every byte its low byte, the monochrome plane
 * white by bit nought of the next (`070d`), flagged `PLAIN`. Black and
 * white: every byte, and the monochrome plane, nought or FFh, `PLAIN`
 * (`06c6`). Any other: matched (`0990`), every byte the index where it is
 * the colour, flagged `ONE_COLOUR`, else the driver's dither of it
 * (`1e02`), which is the dither its brushes on the screen are drawn with
 * (`dither.ts`); the monochrome plane the pattern of its grey, half of red
 * and blue's mean and half of green (`068e`-`06a2`, `0406`). Answers the
 * flags.
 */
function realizeSolid(system: any, colour: number, out: number) {
  const red = colour & 0xff;
  const green = (colour >>> 8) & 0xff;
  const blue = (colour >>> 16) & 0xff;

  if ((colour >>> 24) & 0xef) {
    for (let at = 0; at < 0x40; at++) {
      write8(system, out, at, colour);
    }

    const white = (colour >>> 8) & 1 ? 0xff : 0;

    for (let at = 0; at < 8; at++) {
      write8(system, out, BRUSH_MONO + at, white);
    }

    return ((colour >>> 8) & 0xff) | PLAIN;
  }

  if ((red | green | blue) === 0 || (red & green & blue) === 0xff) {
    const byte = red ? 0xff : 0;

    for (let at = 0; at < 0x48; at++) {
      write8(system, out, at, byte);
    }

    return PLAIN;
  }

  const grey = (((red + blue) >> 1) + green) >> 1;
  const physical = matched(system, colour & 0xffffff);
  let flags = (physical >>> 8) & 0xf7;

  if (flags & EXACT) {
    flags |= ONE_COLOUR;

    for (let at = 0; at < 0x40; at++) {
      write8(system, out, at, physical);
    }
  } else {
    const palette = DevicePalette.forDisplay(system.display, 8);

    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const at = ditheredIndex(system.display, palette, red, green, blue, x, y) ?? physical;

        write8(system, out, y * 8 + x, at);
      }
    }
  }

  monoOfGrey(grey).forEach((row, at) => write8(system, out, BRUSH_MONO + at, row));
  return flags;
}

/**
 * A hatched brush (seg1 `0791`): each byte the colour where the hatch is
 * set and the background colour after the logical brush (at 8) where not
 * -- both made physical as a pen's -- the monochrome plane each byte's
 * flag of white, and the hatch's rows at `BRUSH_HATCH`. A hatch past the
 * diagonal cross is a solid brush.
 */
function realizeHatched(system: any, input: number, out: number, hatch: number) {
  const back = physicalOf(system, read32(system, input, 8), (top) => top === 0xff) & 0xff;
  const fore = physicalOf(system, read32(system, input, 2), (top) => top === 0xff) & 0xff;
  const rows = HATCHES[hatch];

  rows.forEach((row, y) => {
    for (let x = 0; x < 8; x++) {
      write8(system, out, y * 8 + x, (row << x) & 0x80 ? fore : back);
    }
  });

  monoOfBytes(system, out);
  rows.forEach((row, at) => write8(system, out, BRUSH_HATCH + at, row));
}

/**
 * A pattern brush (seg1 `0729`), its logical brush's colour a far pointer
 * to the bitmap. Of a byte a pixel, the first 8 bytes of each of its first
 * eight rows, and the monochrome plane their flags of white; of a bit a
 * pixel, the first byte of each row as the monochrome plane alone, flagged
 * `MONO_PATTERN`.
 */
function realizePattern(system: any, input: number, out: number) {
  const bitmap = read32(system, input, 2);
  const stride = read16(system, bitmap, 6);
  const bits = read32(system, bitmap, 0x0a);

  if (read8(system, bitmap, 9) === 8) {
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        write8(system, out, y * 8 + x, read8(system, bits, y * stride + x));
      }
    }

    monoOfBytes(system, out);
    return 0;
  }

  for (let y = 0; y < 8; y++) {
    write8(system, out, BRUSH_MONO + y, read8(system, bits, y * stride));
  }

  return MONO_PATTERN;
}

/**
 * A brush turned to its origin (seg1 `0833`, `08ab`), the low word of the
 * `TEXTXFORM`'s pointer its x and the high its y: each row of bytes, the
 * monochrome plane's and the hatch's rows turned right by x, and every row
 * down by y, modulo eight; a brush of one colour keeps its bytes, and
 * black, white and hollow are not turned at all.
 */
function turnBrush(system: any, out: number, flags: number, x: number, y: number) {
  if ((flags & PLAIN) === PLAIN) {
    return;
  }

  const by = x & 7;
  const down = y & 7;
  const blocks: [number, number][] = [
    [BRUSH_MONO, 1],
    [BRUSH_HATCH, 1],
  ];

  if (!(flags & ONE_COLOUR)) {
    blocks.unshift([0, 8]);
  }

  for (const [at, width] of blocks) {
    const rows: number[][] = [];

    for (let row = 0; row < 8; row++) {
      const bytes: number[] = [];

      for (let i = 0; i < width; i++) {
        bytes.push(read8(system, out, at + row * width + i));
      }

      rows.push(
        width === 8
          ? bytes.map((_, i) => bytes[(i - by + 8) & 7])
          : bytes.map((byte) => ((byte >> by) | (byte << (8 - by))) & 0xff)
      );
    }

    rows.forEach((bytes, row) =>
      bytes.forEach((byte, i) => write8(system, out, at + ((row + down) & 7) * width + i, byte))
    );
  }
}

function realizeBrush(system: any, input: number, out: number, origin: number) {
  const style = read16(system, input, 0);
  let kept = style <= 3 ? style : SOLID;
  let flags: number;

  if (kept === HOLLOW) {
    flags = PLAIN;
  } else if (kept === HATCHED && read16(system, input, 6) <= 5) {
    realizeHatched(system, input, out, read16(system, input, 6));
    flags = 0;
  } else if (kept === PATTERN) {
    flags = realizePattern(system, input, out);
  } else {
    kept = SOLID;
    flags = realizeSolid(system, read32(system, input, 2), out);
  }

  write16(system, out, BRUSH_STYLE, kept);
  write8(system, out, BRUSH_FLAGS, flags);
  turnBrush(system, out, flags, origin & 0xffff, origin >>> 16);
}

/**
 * `RealizeObject` (`SVGA256.DRV` seg1 `05b4`): a style below nought answers
 * 1; nought the word before the table of sizes; past 3, nought. With an
 * object to fill, the pen or brush laid out (a font's routine does
 * nothing); the answer the object's size.
 */
export function realizeObject(
  system: any,
  style: number,
  input: number,
  out: number,
  xform: number
) {
  const signed = (style << 16) >> 16;

  if (signed < 0) {
    return 1;
  }

  if (signed === 0) {
    return STYLE_NOUGHT;
  }

  if (signed > 3) {
    return 0;
  }

  if (out) {
    if (signed === 1) {
      realizePen(system, input, out);
    } else if (signed === 2) {
      realizeBrush(system, input, out, xform);
    }
  }

  return SIZES[signed - 1];
}

/* Bitmaps ------------------------------------------------------------------ */

/** The word at 8 of a bitmap of the display's format, a byte a pixel, and of one plane (seg1 `1fc3`-`1fcb`). */
export const BYTE_A_PIXEL = 0x0801;
export const ONE_BIT = 0x0101;

/** A memory bitmap as a driver is handed it. */
export interface Bitmap {
  width: number;
  height: number;
  widthBytes: number;
  format: number;
  bits: number;
  segmentIndex: number;
  scanSegment: number;
}

export function readBitmap(system: any, far: number): Bitmap {
  return {
    width: read16(system, far, 2),
    height: read16(system, far, 4),
    widthBytes: read16(system, far, 6),
    format: read16(system, far, 8),
    bits: read32(system, far, 0x0a),
    segmentIndex: read16(system, far, 0x16),
    scanSegment: read16(system, far, 0x18),
  };
}

export const isColour = (bitmap: Bitmap) => bitmap.format === BYTE_A_PIXEL;

/**
 * Where a row of a bitmap starts: past as many segments as the rows before
 * fill, each `bmSegmentIndex` selectors on, and a row's bytes a row in its
 * segment. Nothing is bounded to the bitmap.
 */
export function rowOf(bitmap: Bitmap, y: number) {
  let segment = bitmap.bits >>> 16;
  let row = y;

  if (bitmap.segmentIndex && bitmap.scanSegment) {
    const segments = Math.floor(row / bitmap.scanSegment);

    segment = (segment + segments * bitmap.segmentIndex) & 0xffff;
    row -= segments * bitmap.scanSegment;
  }

  return ((segment << 16) | (((bitmap.bits & 0xffff) + row * bitmap.widthBytes) & 0xffff)) >>> 0;
}

/** A pixel: its byte, or its bit of a monochrome bitmap. */
export function pixelOf(system: any, bitmap: Bitmap, x: number, y: number) {
  const row = rowOf(bitmap, y);

  return isColour(bitmap)
    ? read8(system, row, x)
    : (read8(system, row, x >> 3) >> (7 - (x & 7))) & 1;
}

export function putPixel(system: any, bitmap: Bitmap, x: number, y: number, value: number) {
  const row = rowOf(bitmap, y);

  if (isColour(bitmap)) {
    write8(system, row, x, value);
    return;
  }

  const byte = read8(system, row, x >> 3);
  const mask = 0x80 >> (x & 7);

  write8(system, row, x >> 3, value & 1 ? byte | mask : byte & ~mask);
}

/** What a physical colour is as a pixel: its index, or on a monochrome bitmap its flag of white. */
export function pixelOfPhysical(bitmap: Bitmap, physical: number) {
  return isColour(bitmap) ? physical & 0xff : (physical >>> 8) & WHITE_ON_MONO;
}

/* BitBlt ------------------------------------------------------------------- */

/** A `DRAWMODE`. */
export interface DrawMode {
  rop2: number;
  bkMode: number;
  bkColor: number;
  textColor: number;
  breakExtra: number;
  breakErr: number;
  breakRem: number;
  breakCount: number;
  characterExtra: number;
}

export function readDrawMode(system: any, far: number): DrawMode {
  const signed = (at: number) => (read16(system, far, at) << 16) >> 16;

  return {
    rop2: read16(system, far, 0),
    bkMode: read16(system, far, 2),
    bkColor: read32(system, far, 4),
    textColor: read32(system, far, 8),
    breakExtra: signed(0x0e),
    breakErr: signed(0x10),
    breakRem: signed(0x12),
    breakCount: signed(0x14),
    characterExtra: signed(0x16),
  };
}

/**
 * The brush at a pixel, as BitBlt takes its copy of it (seg1 `1eb1`): on
 * a bitmap of the display's format its byte, a monochrome pattern's bit
 * the background colour where set and the text colour where not; on a
 * monochrome bitmap its monochrome plane's bit, a monochrome pattern's
 * the background's or the text's flag of white.
 */
export function brushPixel(
  system: any,
  brush: number,
  bitmap: Bitmap,
  mode: DrawMode,
  x: number,
  y: number
) {
  const monoPattern =
    read16(system, brush, BRUSH_STYLE) === PATTERN &&
    read8(system, brush, BRUSH_FLAGS) & MONO_PATTERN;
  const set = (read8(system, brush, BRUSH_MONO + (y & 7)) >> (7 - (x & 7))) & 1;

  if (monoPattern) {
    return pixelOfPhysical(bitmap, set ? mode.bkColor : mode.textColor);
  }

  return isColour(bitmap) ? read8(system, brush, (y & 7) * 8 + (x & 7)) : set;
}

/**
 * The operations' need of a source and of a brush (seg1 `1316`, flags 40h
 * and 80h of each), which is whether their truth tables read them.
 */
const usesSource = (rop: number) => (((rop >> 2) ^ rop) & 0x33) !== 0;
const usesBrush = (rop: number) => (((rop >> 4) ^ rop) & 0x0f) !== 0;

/**
 * `BitBlt` (`SVGA256.DRV` seg1 `16a0`) on a memory bitmap. A raster
 * operation whose high byte is not nought, or a bitmap of neither format
 * (seg1 `1fb8`), answers nought; so does a hollow brush where the
 * operation reads one (`1eb1`). The rectangle is cut to the source's
 * bitmap, moving the destination with it (`1784`-`17ca`); the destination
 * is not cut. Each pixel combined from the brush, the source and itself
 * by the operation's table, bit by bit of the byte. A monochrome source
 * on a bitmap of the display's format is white as the background colour
 * and black as the text colour; a source of the display's format on a
 * monochrome bitmap is white where it is the background colour (`1f9e`).
 * Answers 1.
 */
export function bitBlt(
  system: any,
  destFar: number,
  x: number,
  y: number,
  sourceFar: number,
  sx: number,
  sy: number,
  width: number,
  height: number,
  rop: number,
  brush: number,
  drawMode: number
) {
  const table = (rop >>> 16) & 0xffff;

  if (table > 0xff) {
    return 0;
  }

  const readsSource = usesSource(table);
  const readsBrush = usesBrush(table);
  const formats = [BYTE_A_PIXEL, ONE_BIT];
  const source = readsSource && sourceFar ? readBitmap(system, sourceFar) : null;
  const dest = readBitmap(system, destFar);

  if ((source && !formats.includes(source.format)) || !formats.includes(dest.format)) {
    return 0;
  }

  if (readsBrush) {
    if (!brush || read16(system, brush, BRUSH_STYLE) === HOLLOW) {
      return 0;
    }
  }

  const mode = readDrawMode(system, drawMode);
  let w = (width << 16) >> 16;
  let h = (height << 16) >> 16;
  let dx = (x << 16) >> 16;
  let dy = (y << 16) >> 16;
  let fromX = (sx << 16) >> 16;
  let fromY = (sy << 16) >> 16;

  if (source) {
    if (fromX < 0) {
      w += fromX;
      dx -= fromX;
      fromX = 0;
    }

    w -= Math.max(0, fromX + w - source.width);

    if (fromY < 0) {
      h += fromY;
      dy -= fromY;
      fromY = 0;
    }

    h -= Math.max(0, fromY + h - source.height);
  }

  if (w <= 0 || h <= 0) {
    return 1;
  }

  /* A copy within one bitmap whose rectangles overlap goes from the last
   * row and the last byte back (`1816`-`1862`) -- unsigned, after the cut. */
  const backward =
    source !== null &&
    sourceFar === destFar &&
    (fromX + w) >>> 0 > dx >>> 0 &&
    (dx + w) >>> 0 > fromX >>> 0 &&
    (fromY + h) >>> 0 > dy >>> 0 &&
    (dy + h) >>> 0 > fromY >>> 0 &&
    (dy !== fromY ? dy >>> 0 > fromY >>> 0 : dx >>> 0 > fromX >>> 0);

  if (backward && source && !isColour(dest) && !isColour(source)) {
    monoBackward(system, dest, dx, dy, fromX, fromY, w, h, table, brush, mode, readsBrush);
    return 1;
  }

  const mask = isColour(dest) ? 0xff : 1;
  const sources: number[] = [];

  if (source) {
    for (let row = 0; row < h; row++) {
      for (let column = 0; column < w; column++) {
        let value = pixelOf(system, source, fromX + column, fromY + row);

        if (isColour(source) !== isColour(dest)) {
          value = isColour(dest)
            ? (value ? mode.bkColor : mode.textColor) & 0xff
            : value === (mode.bkColor & 0xff)
              ? 1
              : 0;
        }

        sources.push(value);
      }
    }
  }

  for (let row = 0; row < h; row++) {
    for (let column = 0; column < w; column++) {
      const px = dx + column;
      const py = dy + row;
      const p = readsBrush ? brushPixel(system, brush, dest, mode, px, py) : 0;
      const s = source ? sources[row * w + column] : 0;

      putPixel(system, dest, px, py, combine(table, p, s, pixelOf(system, dest, px, py), mask));
    }
  }

  return 1;
}

/** A byte turned left. */
const rol8 = (value: number, by: number) => ((value << by) | (value >> (8 - by))) & 0xff;

/**
 * A monochrome copy within one bitmap going back (seg1 `0a2c` and the
 * code it makes): each row from the last up, each byte from the one
 * holding the last pixel back to the first, through the code made for a
 * copy going forward. The masks are the forward ones -- the first's,
 * `FFh >> (x & 7)`, on the byte the walk starts at, the right-hand one --
 * (`1897`-`18ef`), and the source's bytes are merged as going forward
 * (`0a95`-`0abe`): each byte turned left by the phase, its low part
 * joined to the high part kept from the byte before it in the walk, which
 * is now the one to its right. So the bits move by the phase in the wrong
 * direction. **Recorded** by `gdidmdrw`'s copy of a monochrome bitmap onto
 * itself, three pixels right and a row down.
 */
function monoBackward(
  system: any,
  bitmap: Bitmap,
  dx: number,
  dy: number,
  sx: number,
  sy: number,
  w: number,
  h: number,
  table: number,
  brush: number,
  mode: DrawMode,
  readsBrush: boolean
) {
  const phase = ((sx & 7) - (dx & 7)) & 7;
  /* A source whose first pixel is further into its byte is fetched once
   * before the first byte is written (`18fb`-`190d`, `0abf`). */
  const prefetch = (sx & 7) > (dx & 7);
  const end = (dx + w) & 7;
  let first = 0xff >> (dx & 7);
  let last = end ? (0xff00 >> end) & 0xff : 0xff;
  let inner = ((dx + w - 1) >> 3) - (dx >> 3) - 1;

  if (inner > 0) {
    if (last === 0xff) {
      last = 0;
      inner++;
    }
  } else if (inner < 0) {
    first &= last;
    last = 0;
    inner = 0;
  }

  /* The last byte's fetch is left out where its pixels all come from the
   * byte before (`0bc0`-`0bd0`). */
  const skipLast = phase !== 0 && phase + ((end - 1) & 7) <= 7;
  const keep = ((0xff00 << phase) | (0xff00 >>> (16 - phase))) & 0xffff;

  for (let r = h - 1; r >= 0; r--) {
    const from = rowOf(bitmap, sy + r);
    const to = rowOf(bitmap, dy + r);
    let si = (sx + w - 1) >> 3;
    let di = (dx + w - 1) >> 3;
    let carried = 0;
    const fetch = () => {
      const byte = read8(system, from, si--);

      if (!phase) {
        return byte;
      }

      const turned = rol8(byte, phase);
      const out = (turned & keep & 0xff) | carried;

      carried = turned & (keep >> 8);
      return out;
    };
    const store = (mask: number, s: number) => {
      const d = read8(system, to, di);
      let p = 0;

      if (readsBrush) {
        for (let bit = 0; bit < 8; bit++) {
          p |= brushPixel(system, brush, bitmap, mode, di * 8 + bit, dy + r) << (7 - bit);
        }
      }

      write8(system, to, di--, (d & ~mask) | (combine(table, p, s, d, 0xff) & mask));
    };

    if (prefetch) {
      fetch();
    }

    store(first, fetch());

    for (let i = 0; i < inner; i++) {
      store(0xff, fetch());
    }

    if (last) {
      store(last, skipLast ? carried : fetch());
    }
  }
}

/* Output ------------------------------------------------------------------- */

/** The styles of `Output` the driver draws (seg1 `12e2`). */
const OS_SCANLINES = 4;
const OS_POLYLINE = 18;

function readPoint(system: any, far: number, index: number): [number, number] {
  return [
    (read16(system, far, index * 4) << 16) >> 16,
    (read16(system, far, index * 4 + 2) << 16) >> 16,
  ];
}

function readRect(system: any, far: number) {
  const signed = (at: number) => (read16(system, far, at) << 16) >> 16;

  return { left: signed(0), top: signed(2), right: signed(4), bottom: signed(6) };
}

/** `Output`'s styles that begin and end a run of scanlines (seg1 `12f2`-`12fa`). */
const OS_BEGIN_SCANS = 0x50;
const OS_END_SCANS = 0x51;

/**
 * `Output` (`SVGA256.DRV` seg1 `12e2`): a polyline (`OS_POLYLINE`, seg6
 * `010c`) and scanlines (`OS_SCANLINES`, seg8 `00c9`); 50h answers 1 and
 * 51h nought, drawing nothing (seg8 `01b2`, `0222`); any other style
 * answers nought and draws nothing.
 *
 * Not followed: between 50h and 51h the driver keeps what it set up for
 * the device given at 50h (seg8 `01d5`, its flag at 86h) and scanlines
 * skip setting up their own (seg8 `00e1`); WinBox sets up each.
 * **Recorded** by `gdidmpx`, the scanlines between drawn on their device.
 */
export function output(
  system: any,
  destFar: number,
  style: number,
  count: number,
  points: number,
  pen: number,
  brush: number,
  drawMode: number,
  clip: number
) {
  const dest = readBitmap(system, destFar);
  const mode = readDrawMode(system, drawMode);
  const bits = isColour(dest) ? 8 : 1;

  if (style === OS_BEGIN_SCANS) {
    return 1;
  }

  if (style === OS_END_SCANS) {
    return 0;
  }

  if (style === OS_POLYLINE) {
    const path: [number, number][] = [];

    for (let index = 0; index < (count << 16) >> 16; index++) {
      path.push(readPoint(system, points, index));
    }

    const penStyle = read16(system, pen, 4);

    if (penStyle === 5) {
      return 1;
    }

    const masks = STYLE_MASKS[penStyle] ?? 0xff;
    const ink = pixelOfPhysical(dest, read32(system, pen, 0));
    const gap = mode.bkMode === 2 ? pixelOfPhysical(dest, mode.bkColor) : null;
    const box = clip ? readRect(system, clip) : null;

    for (const [px, py, at] of polylinePixels(path)) {
      if (box && (px < box.left || px >= box.right || py < box.top || py >= box.bottom)) {
        continue;
      }

      const on = !!((masks >> ((at >> 8) & 7)) & 1);

      if (!on && gap === null) {
        continue;
      }

      putPixel(
        system,
        dest,
        px,
        py,
        mix(mode.rop2, on ? ink : gap!, pixelOf(system, dest, px, py), bits)
      );
    }

    return 1;
  }

  if (style === OS_SCANLINES) {
    const [lines, y] = readPoint(system, points, 0);
    /* The pen read only where there is no brush: **recorded** by
     * `gdidmpx`, a brush and no pen. */
    const ink = brush ? 0 : pixelOfPhysical(dest, read32(system, pen, 0));
    const seeThrough = brush && mode.bkMode === 1 && read16(system, brush, BRUSH_STYLE) === HATCHED;

    for (let index = 1; index < lines; index++) {
      const [from, to] = readPoint(system, points, index);

      for (let px = from; px < to; px++) {
        if (seeThrough && !(read8(system, brush, BRUSH_HATCH + (y & 7)) & (0x80 >> (px & 7)))) {
          continue;
        }

        const p = brush ? brushPixel(system, brush, dest, mode, px, y) : ink;

        putPixel(system, dest, px, y, mix(mode.rop2, p, pixelOf(system, dest, px, y), bits));
      }
    }

    return 1;
  }

  return 0;
}

/* ExtTextOut --------------------------------------------------------------- */

/** Where a font's `FONTINFO` lies in its segment, and its version (seg2 `04a5`-`04b1`). */
const FONTINFO_AT = 0x42;
const VERSION_3 = 0x300;
const DF_PIX_HEIGHT = 0x58;
const DF_BITS_POINTER = 0x6d;

/** What `ExtTextOut` answers for a font it cannot draw: AX nought and DX 8000h (seg2 `03c7`). */
const CANNOT = 0x80000000;

/**
 * `ExtTextOut` (`SVGA256.DRV` seg2 `0375`; `StrBlt`, `036a`, the same with
 * five words of nought) on a memory bitmap. Only a font of version 3.0 at
 * 42h of its segment (`049b`); any other answers 80000000h.
 *
 * * A negative count answers the string's extent, its height in the high
 *   word: the characters' widths, the character extra for each and the
 *   break extra for each break character (`083a`).
 * * Otherwise as the VGA's draws it (`driver-bitmap.ts`): the clip, cut to
 *   the opaque rectangle with `ETO_CLIPPED` (`04f4`); the opaque rectangle
 *   filled in the background colour with `ETO_OPAQUE`; each glyph's set
 *   pixels in the text colour, the rest of the string's cell in the
 *   background colour where the background is opaque. No emboldening.
 *   Answers nought.
 */
export function extTextOut(
  system: any,
  destFar: number,
  x: number,
  y: number,
  clip: number,
  string: number,
  count: number,
  font: number,
  drawMode: number,
  _xform: number,
  widths: number,
  opaque: number,
  options: number
) {
  const segment = (font & 0xffff0000) >>> 0;

  if ((font & 0xffff) !== FONTINFO_AT || read16(system, segment, 0) !== VERSION_3) {
    return CANNOT;
  }

  const dest = readBitmap(system, destFar);
  const mode = readDrawMode(system, drawMode);
  const vgaMode = { ...mode, tBreakExtra: 0 };
  const extra = mode.characterExtra;
  const height = read16(system, segment, DF_PIX_HEIGHT);
  const n = (count << 16) >> 16;

  if (n < 0) {
    const { reach } = layOut(system, segment, string, -n, vgaMode, extra, 0);

    write16(system, drawMode, 0x10, vgaMode.breakErr);
    return ((height << 16) | (Math.min(reach, 0x7fff) & 0xffff)) >>> 0;
  }

  const clipBox = readRect(system, clip);
  const opaqueBox = opaque ? readRect(system, opaque) : null;
  let textBox: ReturnType<typeof within> = clipBox;

  if (options & 4 && opaqueBox) {
    textBox = within(clipBox, opaqueBox);

    if (!textBox) {
      return 0;
    }
  }

  const back = pixelOfPhysical(dest, mode.bkColor);
  const fore = pixelOfPhysical(dest, mode.textColor);

  if (options & 2 && opaqueBox) {
    const fill = within(clipBox, opaqueBox);

    if (fill) {
      for (let py = fill.top; py < fill.bottom; py++) {
        for (let px = fill.left; px < fill.right; px++) {
          putPixel(system, dest, px, py, back);
        }
      }
    }
  }

  if (!n) {
    return 0;
  }

  const dx = (x << 16) >> 16;
  const dy = (y << 16) >> 16;
  const { characters, reach } = layOut(system, segment, string, n, vgaMode, extra, widths);
  const ink = new Uint8Array(Math.max(reach, 0) * height);
  const bits = (read32(system, segment, DF_BITS_POINTER) & 0xffff0000) >>> 0;

  for (const { index, width, at } of characters) {
    const glyph =
      (bits | (read32(system, segment, entryOf(system, segment, index) + 2) & 0xffff)) >>> 0;

    for (let column = 0; column < width; column++) {
      for (let row = 0; row < height; row++) {
        const px = at + column;

        if (read8(system, glyph, (column >> 3) * height + row) & (0x80 >> (column & 7))) {
          if (px >= 0 && px < reach) {
            ink[row * reach + px] = 1;
          }
        }
      }
    }
  }

  const cell =
    textBox && within(textBox, { left: dx, top: dy, right: dx + reach, bottom: dy + height });

  if (cell) {
    for (let py = cell.top; py < cell.bottom; py++) {
      for (let px = cell.left; px < cell.right; px++) {
        if (ink[(py - dy) * reach + (px - dx)]) {
          putPixel(system, dest, px, py, fore);
        } else if (mode.bkMode === 2) {
          putPixel(system, dest, px, py, back);
        }
      }
    }
  }

  write16(system, drawMode, 0x10, vgaMode.breakErr);
  return 0;
}

/** `GetCharWidth` (`SVGA256.DRV` seg1 `0358`): the VGA's, without emboldening. */
export function getCharWidth(
  system: any,
  buffer: number,
  first: number,
  last: number,
  font: number
) {
  return vgaGetCharWidth(system, buffer, first, last, font, 0, false);
}

/* DeviceBitmapBits and DIBToDevice --------------------------------------- */

/**
 * A run-length encoded DIB's colour table as `SVGA256.DRV` takes it
 * (seg9 `176f`-`179e`): `biClrUsed` words, or as many as its bits give, a
 * palette's index the low byte of each; and whether it is other than the
 * indices in order -- the sum of each low byte less its place and each
 * high byte, as words, not nought (flag 8, which an eight-bit DIB needs
 * to go through the table at all: `157c`, `159c`).
 */
export function rleTable(system: any, info: number) {
  const used = read16(system, info, 0x20);
  const count = used || (1 << (read8(system, info, 0x0e) & 0x1f)) & 0xffff;
  const at = (info & 0xffff0000) | ((info + read16(system, info, 0)) & 0xffff);
  const table: number[] = [];
  let sum = 0;

  for (let entry = 0; entry < count; entry++) {
    const word = read16(system, at, entry * 2);

    table.push(word & 0xff);
    sum = (sum + ((word & 0xff00) | (((word & 0xff) - entry) & 0xff))) & 0xffff;
  }

  return { table, translated: sum !== 0 };
}

/**
 * An index through `rleTable`'s table: four bits' always, eight bits' only
 * where the table is not the indices in order, and the index as it is
 * where it is (`SVGA256.DRV` `1861`, `18c2`; `19a7`, `19a5`; `19d3`,
 * `1941`). An index past the table is taken as nought: the driver's table
 * is 256 bytes of its stack, the rest left as they were.
 */
export function rleIndex(
  rle: { table: number[]; translated: boolean },
  eight: boolean,
  index: number
) {
  return eight && !rle.translated ? index : (rle.table[index] ?? 0);
}

/**
 * A run-length encoded DIB set into a memory bitmap by `SVGA256.DRV` seg9
 * `15ac`, which `DeviceBitmapBits` hands it with no clipping rectangle
 * (`0041`-`0051`): the DIB's own rectangle at the bitmap's corner instead
 * (`17e3`-`17fc`). The first line is the DIB's height less one, whatever
 * the start and the count (`1691`-`1697`); a line above the bitmap ends
 * the walk (`walkRle`), and each index's byte goes at its column of its
 * row, with no bound to the width (`1738`-`1763`, `19a7`). A compression
 * past 2 (`169d`) or a monochrome bitmap (`16d9`) answers -1, a bitmap of
 * neither format nought; else 1 (`166c`). **Recorded** by `gdidmrle`.
 */
function rleSet(system: any, bitmapFar: number, bits: number, info: number) {
  const dest = readBitmap(system, bitmapFar);
  const compression = read16(system, info, 0x10);

  if (compression > 2) {
    return 0xffff;
  }

  const bitsPixel = read8(system, bitmapFar, 9);

  if (bitsPixel === 1) {
    return 0xffff;
  }

  if (bitsPixel !== 8) {
    return 0;
  }

  const rle = rleTable(system, info);
  const eight = (compression & 3) === 1;

  walkRle({
    eight,
    read: (at) => hugeRead8(core(system), bits, at),
    odd: (at) => (((bits & 0xffff) + at) & 1) !== 0,
    x: 0,
    y: read16(system, info, 8) - 1,
    top: 0,
    plot: (x, y, index) => write8(system, rowOf(dest, y), x, rleIndex(rle, eight, index)),
  });

  return 1;
}

/** A DIB's formats the driver takes (seg9 `01c1`, `07eb`), each its routine's number. */
const DIB_BITS = [1, 4, 8, 24];

/**
 * `DeviceBitmapBits` (`SVGA256.DRV` seg9 `0000`) on a memory bitmap: scans
 * got as a DIB or set from one. A compressed DIB goes to the driver's own
 * run lengths (`15ac`, `1a38`), its set as `rleSet` and its get not
 * followed here (answers nought). With
 * no buffer for the bits, a get answers the scans asked and sets
 * `biSizeImage` to their bytes (`0061`-`0090`); a set answers nought. A DIB
 * of another format, or of planes but one, answers nought (`01b9`).
 *
 * The scans are the DIB's, from its bottom: from `start`, as many as asked
 * that its height leaves, and none at or past it (`0122`-`012d`) -- each a
 * row of the bitmap counted, and laid out, by the DIB's own width and
 * height (`00c9`-`00f4`). Answers how many.
 *
 * * Set (`018c`): the DIB's colour table is taken as words, a palette's
 *   index each, as GDI hands a palette device one (`0473`): on the
 *   display's format each pixel the low byte of its word (`064d`, `0698`,
 *   `06d4`); on a monochrome bitmap bit nought of the low byte of a DIB of
 *   a bit (`0494`) and of the high byte of the others (`050b`, `056e`). A
 *   DIB of 24 bits is matched by GDI's `DeviceColorMatch` with the
 *   translation table for its device, the colour's red and blue swapped
 *   (`03e1`, `05ac`, `070a`); on a monochrome bitmap white where the index
 *   is not nought.
 * * Get (`07b6`): through the translation table GDI hands it (its last
 *   argument), 256 bytes (`0a1a`) -- of the display's format, a DIB of a
 *   bit set where an index's byte is not nought (`0c61`), of 4 bits its low
 *   four bits (`0c9c`), of 8 the index itself (`0cf4`), of 24 the first
 *   three bytes of the table's four at the index (`0d26`); of a monochrome
 *   bitmap the table's bytes nought and 1 (`0a3e`, `0ac7`, `0b43`), and for
 *   24 its four bytes at nought and FFh (`0b99`). The colour table is not
 *   written.
 */
export function deviceBitmapBits(
  system: any,
  bitmapFar: number,
  get: number,
  start: number,
  scans: number,
  bits: number,
  info: number,
  _drawMode: number,
  translate: number
) {
  const dest = readBitmap(system, bitmapFar);
  const colour = !(read8(system, bitmapFar, 8) === 1 && read8(system, bitmapFar, 9) === 1);
  const width = read16(system, info, 4);
  const height = read16(system, info, 8);
  const bitCount = read16(system, info, 0x0e);

  /* A compressed DIB to the routines of run lengths (`0034`-`005c`), whose
   * get is not followed here. */
  if (read8(system, info, 0x10) & 3) {
    return get === 0 && bits ? rleSet(system, bitmapFar, bits, info) : 0;
  }

  if (!bits) {
    if (!get) {
      return 0;
    }

    const size = ((((width * bitCount + 0x1f) & 0xffe0) >> 3) * scans) >>> 0;

    write16(system, info, 0x14, size);
    write16(system, info, 0x16, size >>> 16);
    return scans & 0xffff;
  }

  if (get !== 0 && get !== 1) {
    return 0;
  }

  if (read16(system, info, 0x0c) !== 1 || !DIB_BITS.includes(bitCount)) {
    return 0;
  }

  const left = height - start;

  if (left <= 0) {
    return 0;
  }

  const count = Math.min(scans, left);
  const stride = (((width * bitCount + 31) >> 5) << 2) >>> 0;
  const rowBytes = colour ? (width + 1) & ~1 : ((width + 15) & ~15) >> 3;
  const table = (info & 0xffff0000) | ((info + read16(system, info, 0)) & 0xffff);
  const word = (n: number) => read16(system, table, n * 2);
  /* A null translation table -- `gdidmdrw` hands one -- Windows would
   * fault on, and DOSBox, where it was recorded, reads at linear nought,
   * its real-mode vectors: WinBox takes every byte of it as nought. */
  const translated = (n: number) => (translate >>> 16 ? read8(system, translate, n) : 0);
  const layout = { ...dest, widthBytes: rowBytes, format: colour ? BYTE_A_PIXEL : ONE_BIT };

  for (let scan = 0; scan < count; scan++) {
    const y = height - 1 - (start + scan);
    const row = (bits + scan * stride) >>> 0;
    const at = (offset: number) => ((row & 0xffff0000) | ((row + offset) & 0xffff)) >>> 0;

    for (let x = 0; x < width; x++) {
      if (get) {
        const index = pixelOf(system, layout, x, y);

        if (bitCount === 24) {
          const entry = colour ? index * 4 : index ? 0x3fc : 0;

          for (let k = 0; k < 3; k++) {
            write8(system, at(x * 3 + k), 0, translated(entry + k));
          }
        } else if (bitCount === 8) {
          write8(system, at(x), 0, colour ? index : translated(index));
        } else if (bitCount === 4) {
          const value = translated(index) & 0xf;
          const byte = read8(system, at(x >> 1), 0);
          const shift = x & 1 ? 0 : 4;

          write8(system, at(x >> 1), 0, (byte & ~(0xf << shift)) | (value << shift));
        } else {
          const set = colour ? translated(index) !== 0 : translated(index) & 1;
          const byte = read8(system, at(x >> 3), 0);
          const mask = 0x80 >> (x & 7);

          write8(system, at(x >> 3), 0, set ? byte | mask : byte & ~mask);
        }

        continue;
      }

      let value: number;

      if (bitCount === 24) {
        const blue = read8(system, at(x * 3), 0);
        const green = read8(system, at(x * 3 + 1), 0);
        const red = read8(system, at(x * 3 + 2), 0);
        const index =
          translate >>> 16
            ? (DeviceColorMatch.call(
                system,
                (red << 16) | (green << 8) | blue,
                translate
              ) as number) & 0xff
            : 0;

        value = colour ? index : index ? 1 : 0;
      } else {
        const n =
          bitCount === 8
            ? read8(system, at(x), 0)
            : bitCount === 4
              ? (read8(system, at(x >> 1), 0) >> (x & 1 ? 0 : 4)) & 0xf
              : (read8(system, at(x >> 3), 0) >> (7 - (x & 7))) & 1;

        value = colour ? word(n) & 0xff : bitCount === 1 ? word(n) & 1 : (word(n) >> 8) & 1;
      }

      putPixel(system, layout, x, y, value);
    }
  }

  return count;
}

/**
 * `DIBToDevice` (`SVGA256.DRV` seg9 `0dba`, into `0e1d`): onto a memory
 * bitmap -- a device whose first word is nought -- nothing, and -1
 * (`0eae`-`0eb4`).
 */
export function dibToDevice() {
  return 0xffff;
}

/* Pixel, ScanLR and EnumObj ------------------------------------------- */

/** A pixel or a scan off the bitmap (seg7 `00d1`, seg4 `01b8`). */
const OFF_PIXEL = 0x80000000;
const OFF_SCAN = 0x8000;

/** What `Pixel` answers for a pixel got: FF00h in DX (seg7 `01da`, `01e7`). */
const GOT = 0xff000000;

/**
 * `Pixel` (`SVGA256.DRV` seg7 `0048`) on a memory bitmap: a point at or
 * past the width or the height, taken unsigned, answers 80000000h. A
 * bitmap a byte a pixel (`bmPlanes` and `bmBitsPixel` 801h) has the
 * pixel's byte, a monochrome one its bit, at `x / 8`; but one whose
 * `bmWidthBytes` is odd is taken a byte at a time too, its byte at `x / 8`
 * and its pen 1 (`00f8`-`012f`, the test at `0149`). With no `DRAWMODE`
 * the answer is FF00h and the byte, or for a bit FFh where it is set
 * (`01d5`-`01ec`). With one, the byte is made by the raster operation of
 * the pen -- the physical colour's low byte -- and the byte there (its
 * tables at `0000`-`003f`), or the bit by the operation of the low byte's
 * bit nought and the bit there (`0204`); nought is answered.
 */
export function pixel(
  system: any,
  device: number,
  x: number,
  y: number,
  physical: number,
  lpDrawMode: number
) {
  const bitmap = readBitmap(system, device);

  if ((x & 0xffff) >= bitmap.width || (y & 0xffff) >= bitmap.height) {
    return OFF_PIXEL;
  }

  const bytes = bitmap.format === BYTE_A_PIXEL;
  const byteWise = bytes || (bitmap.widthBytes & 1) !== 0;
  const row = rowOf(bitmap, y & 0xffff);
  const at = bytes ? x & 0xffff : (x & 0xffff) >> 3;
  const there = read8(system, row, at);

  if (!(lpDrawMode >>> 0)) {
    if (byteWise) {
      return (GOT | there) >>> 0;
    }

    const set = (there & (0x80 >> (x & 7))) !== 0;

    return (GOT | (set ? 0xff : 0)) >>> 0;
  }

  const rop2 = read16(system, lpDrawMode, 0);

  if (byteWise) {
    const pen = bytes ? physical & 0xff : 1;
    let value = 0;

    for (let bit = 0; bit < 8; bit++) {
      value |= ropBit(rop2, (pen >> bit) & 1, (there >> bit) & 1) << bit;
    }

    write8(system, row, at, value);
    return 0;
  }

  const mask = 0x80 >> (x & 7);
  const bit = ropBit(rop2, physical & 1, there & mask ? 1 : 0);

  write8(system, row, at, bit ? there | mask : there & ~mask);
  return 0;
}

/**
 * `ScanLR` (`SVGA256.DRV` seg4 `0154`) on a memory bitmap: a point at or
 * past the width or the height, taken unsigned, answers 8000h. A bitmap a
 * byte a pixel is scanned a byte at a time from the point for the first
 * byte that is not the colour's low byte -- with style bit 0, the first
 * that is (`0231`, `023a`) -- to the left (style bit 1) as far as the row's
 * start, to the right for `bmWidthBytes` less the point less one bytes,
 * the row's last byte never reached (`0224`-`0229`): its x, or -1. A
 * monochrome one as the Hercules scans it (`monoScan`), the colour white
 * where bit nought of the physical colour's second byte is set
 * (`027a`-`027f`).
 */
export function scanLR(
  system: any,
  device: number,
  x: number,
  y: number,
  physical: number,
  style: number
) {
  const bitmap = readBitmap(system, device);

  if ((y & 0xffff) >= bitmap.height || (x & 0xffff) >= bitmap.width) {
    return OFF_SCAN;
  }

  if (bitmap.format !== BYTE_A_PIXEL) {
    return monoScan(system, device, x, y, ((physical >>> 8) & 1) !== 0, style);
  }

  const row = rowOf(bitmap, y & 0xffff);
  const colour = physical & 0xff;
  const left = (style & 2) !== 0;
  const equal = (style & 1) !== 0;
  const start = x & 0xffff;
  const count = (left ? start + 1 : bitmap.widthBytes - start - 1) & 0xffff;

  for (let step = 0, at = start; step < count; step++, at += left ? -1 : 1) {
    if ((read8(system, row, at) === colour) === equal) {
      return at & 0xffff;
    }
  }

  return 0xffff;
}

/** Where `SVGA256.DRV`'s `EnumObj` lays each object, up the stack from the procedure's entry (seg4 `0086`-`00c3`). */
export const ENUMERATED_AT = 0x1c;

/** The driver's twenty colours, red, green and blue a colour (its data segment at 22h). */
const STATIC_COLOURS: [number, number, number][] = [
  [0x00, 0x00, 0x00],
  [0x80, 0x00, 0x00],
  [0x00, 0x80, 0x00],
  [0x80, 0x80, 0x00],
  [0x00, 0x00, 0x80],
  [0x80, 0x00, 0x80],
  [0x00, 0x80, 0x80],
  [0xc0, 0xc0, 0xc0],
  [0xc0, 0xdc, 0xc0],
  [0xa6, 0xca, 0xf0],
  [0xff, 0xfb, 0xf0],
  [0xa0, 0xa0, 0xa4],
  [0x80, 0x80, 0x80],
  [0xff, 0x00, 0x00],
  [0x00, 0xff, 0x00],
  [0xff, 0xff, 0x00],
  [0x00, 0x00, 0xff],
  [0xff, 0x00, 0xff],
  [0x00, 0xff, 0xff],
  [0xff, 0xff, 0xff],
];

/**
 * The colours `EnumObj` hands out, in its order (seg4 `00fa`-`0149`): the
 * last seven of the twenty, then the first thirteen.
 */
export function enumeratedColours() {
  return [...STATIC_COLOURS.slice(13), ...STATIC_COLOURS.slice(0, 13)].map(
    ([red, green, blue]) => (red | (green << 8) | (blue << 16)) >>> 0
  );
}
