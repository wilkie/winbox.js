'use strict';

import { herculesWhite, isHercules } from './driver-hercules.js';
import { DevicePalette } from '../../raster/device-palette.js';
import { matchedIndex } from '../../raster/colour-match.js';
import { ditheredIndex } from '../../raster/dither.js';
import { combine } from '../../raster/raster-op.js';

/**
 * The VGA's own drawing on a memory bitmap of its format, as `VGA.DRV`
 * draws one for GDI's helpers (`driver-helpers.ts`): `RealizeObject`,
 * `BitBlt`, `Output`, `ExtTextOut` and `StrBlt`, `GetCharWidth`,
 * `DeviceBitmapBits` and `DIBScreenBlt`. The twin of
 * `crates/winbox-win16/src/gdi/driver_bitmap.rs`.
 *
 * A bitmap is GDI's `BITMAP` for drivers in the program's memory: four
 * planes of a bit (the word at 8 is 104h), a plane's row after another's
 * in each row, or one plane. Everything is drawn into that memory as the
 * driver addresses it, a byte at a row's start, the plane's row and the
 * eighth of x, with no bound to the bitmap's width or height: **recorded**
 * by `gdidmdrw`, a block transfer past the right-hand edge goes on into
 * the next plane's row, and past the last row into whatever is beyond.
 *
 * **Recorded** by `gdidmdrw` on the VGA, the Super VGA (`SUPERVGA.DRV`,
 * every record the VGA's) and the EGA.
 */

/** The word at 8 of a bitmap of the display's four planes of a bit each. */
export const FOUR_PLANES = 0x0104;

/** A physical colour's flag of a colour a monochrome bitmap takes as white (seg1 `002c`). */
export const MONO_WHITE = 0x10;

/** A memory bitmap as a driver is handed it. */
export interface DriverBitmap {
  width: number;
  height: number;
  widthBytes: number;
  format: number;
  bits: number;
  segmentIndex: number;
  scanSegment: number;
}

function core(system: any) {
  return system.machine.cpu.core;
}

export function read8(system: any, far: number, at: number) {
  return core(system).read8((far >>> 16) & 0xffff, ((far & 0xffff) + at) & 0xffff);
}

export function read16(system: any, far: number, at: number) {
  return read8(system, far, at) | (read8(system, far, at + 1) << 8);
}

function read32(system: any, far: number, at: number) {
  return (read16(system, far, at) | (read16(system, far, at + 2) << 16)) >>> 0;
}

export function write8(system: any, far: number, at: number, value: number) {
  core(system).write8((far >>> 16) & 0xffff, ((far & 0xffff) + at) & 0xffff, value & 0xff);
}

function write16(system: any, far: number, at: number, value: number) {
  write8(system, far, at, value);
  write8(system, far, at + 1, value >> 8);
}

export function readBitmap(system: any, far: number): DriverBitmap {
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

export const planesOf = (bitmap: DriverBitmap) => (bitmap.format === FOUR_PLANES ? 4 : 1);

/**
 * Where a row of a bitmap starts (`VGA.DRV` seg7 `00e2`-`011a`): past as
 * many segments as the rows before fill, each `bmSegmentIndex` selectors
 * on from the last, and in its segment four planes' rows a row for the
 * display's format, one for a monochrome bitmap. A row past the last is
 * as far on again.
 */
export function rowOf(bitmap: DriverBitmap, y: number) {
  let segment = bitmap.bits >>> 16;
  let row = y;

  if (bitmap.segmentIndex && bitmap.scanSegment) {
    const segments = Math.floor(row / bitmap.scanSegment);

    segment = (segment + segments * bitmap.segmentIndex) & 0xffff;
    row -= segments * bitmap.scanSegment;
  }

  const offset = ((bitmap.bits & 0xffff) + row * planesOf(bitmap) * bitmap.widthBytes) & 0xffff;

  return ((segment << 16) | offset) >>> 0;
}

/** The byte of a pixel in a plane, and its bit: no bound to the width. */
function placeOf(bitmap: DriverBitmap, x: number, y: number, plane: number) {
  return { row: rowOf(bitmap, y), at: plane * bitmap.widthBytes + (x >> 3), mask: 0x80 >> (x & 7) };
}

/** The bits of a pixel, one a plane. */
export function pixelOf(system: any, bitmap: DriverBitmap, x: number, y: number) {
  let value = 0;

  for (let plane = 0; plane < planesOf(bitmap); plane++) {
    const { row, at, mask } = placeOf(bitmap, x, y, plane);

    if (read8(system, row, at) & mask) {
      value |= 1 << plane;
    }
  }

  return value;
}

/** A pixel's bits set, one a plane. */
function putPixel(system: any, bitmap: DriverBitmap, x: number, y: number, value: number) {
  for (let plane = 0; plane < planesOf(bitmap); plane++) {
    const { row, at, mask } = placeOf(bitmap, x, y, plane);
    const byte = read8(system, row, at);

    write8(system, row, at, (value >> plane) & 1 ? byte | mask : byte & ~mask);
  }
}

/** What a physical colour is as a pixel's bits: its index, or its flag for white. */
export function bitsOfPhysical(bitmap: DriverBitmap, physical: number) {
  const top = physical >>> 24;

  return bitmap.format === FOUR_PLANES ? top & 0xf : top & MONO_WHITE ? 1 : 0;
}

/**
 * The display drivers whose routines on a memory bitmap WinBox has: the
 * VGA's, which the Super VGA's driver shares record for record, and the
 * EGA's, the same code with its own colours (`gdidmdrw`).
 */
export type Family = 'vga' | 'ega';

export function familyOf(system: any): Family | null {
  const file = String(system.display?.driverFile ?? 'VGA.DRV').toUpperCase();

  return file === 'VGA.DRV' || file === 'SUPERVGA.DRV' ? 'vga' : file === 'EGA.DRV' ? 'ega' : null;
}

/**
 * `VGA.DRV`'s colours, by index, as its `ColorInfo` gives them back (seg1
 * `003c`, three bytes each, red first): the sixteen of the VGA's palette.
 * `EGA.DRV`'s are the same but its ninth, 404040h for C0C0C0h (seg1
 * `003c`).
 */
export const VGA_COLOURS: [number, number, number][] = [
  [0x00, 0x00, 0x00],
  [0x80, 0x00, 0x00],
  [0x00, 0x80, 0x00],
  [0x80, 0x80, 0x00],
  [0x00, 0x00, 0x80],
  [0x80, 0x00, 0x80],
  [0x00, 0x80, 0x80],
  [0x80, 0x80, 0x80],
  [0xc0, 0xc0, 0xc0],
  [0xff, 0x00, 0x00],
  [0x00, 0xff, 0x00],
  [0xff, 0xff, 0x00],
  [0x00, 0x00, 0xff],
  [0xff, 0x00, 0xff],
  [0x00, 0xff, 0xff],
  [0xff, 0xff, 0xff],
];

/** The EGA's ninth colour. */
const EGA_DARK_GREY: [number, number, number] = [0x40, 0x40, 0x40];

/** A driver's colour of an index. */
export function colourOf(system: any, index: number): [number, number, number] {
  return index === 8 && familyOf(system) === 'ega' ? EGA_DARK_GREY : VGA_COLOURS[index];
}

/** The flag black and white carry besides (seg1 `002c`). */
const PURE = 0x20;

/**
 * The flags each driver keeps beside each colour, in the top byte of its
 * physical colour with the index (seg1 `002c`): white on a monochrome
 * bitmap for light grey (the VGA's alone), green, yellow, magenta, cyan
 * and white, and the second flag for black and white.
 */
export function flagsOf(system: any, index: number) {
  const whites = familyOf(system) === 'ega' ? [10, 11, 13, 14, 15] : [8, 10, 11, 13, 14, 15];

  return (whites.includes(index) ? MONO_WHITE : 0) | (index === 0 || index === 15 ? PURE : 0);
}

/**
 * A driver's physical colour for an index: red, green and blue in the low
 * three bytes, the index and its flags in the top one (seg1 `19f4`).
 */
export function physicalOf(system: any, index: number) {
  const [red, green, blue] = colourOf(system, index);

  return (red | (green << 8) | (blue << 16) | ((index | flagsOf(system, index)) << 24)) >>> 0;
}

/** The index the driver matches a colour to (seg1 `1956`). */
export function matchedOf(system: any, colour: number) {
  const palette = DevicePalette.forDisplay(system.display, 4);

  return matchedIndex(
    system.display,
    palette,
    colour & 0xff,
    (colour >>> 8) & 0xff,
    (colour >>> 16) & 0xff
  );
}

/* RealizeObject ----------------------------------------------------------- */

/** The size of each object as `RealizeObject` lays it out, by style 1 to 3 (seg1 `2bdc`). */
const PEN_SIZE = 6;
const BRUSH_SIZE = 0x36;
const FONT_SIZE = 0;

/**
 * What `RealizeObject` answers for style nought: the style taken as an
 * index of the table of sizes one before its start, the word there (seg1
 * `2bda`, the last of the table of routines before it: the font's routine,
 * `2b3b` in `VGA.DRV` and `2b1f` in `EGA.DRV`).
 */
const STYLE_NOUGHT: Record<Family, number> = { vga: 0x2b3b, ega: 0x2b1f };

/** Where a physical brush keeps its parts (seg1 `28ed`-`28f3`, `2af1`). */
const MONO_PLANE = 0x20;
const BRUSH_STYLE = 0x28;
const BRUSH_FLAGS = 0x2a;
const HATCH_MASK = 0x2e;

/**
 * Where a realized brush keeps the parts the drawing reads: the VGA's
 * and the EGA's, or the Hercules's 22 bytes -- its pattern first, its
 * style at 8 and its hatch's rows at 0Eh (`driver-hercules.ts`).
 */
function brushLayout(system: any) {
  return isHercules(system)
    ? { mono: 0, style: 8, hatch: 0x0e, pattern: true, hatchDrawn: true }
    : {
        mono: MONO_PLANE,
        style: BRUSH_STYLE,
        hatch: HATCH_MASK,
        pattern: false,
        hatchDrawn: false,
      };
}

/** The brush's style word: solid, hollow, hatched, and the two patterns. */
const SOLID = 0;
const HOLLOW = 1;
const HATCHED = 2;
const COLOUR_PATTERN = 3;
const MONO_PATTERN = 4;

/** The flag of a brush drawn in one colour, solid, whose planes need no turning (seg1 `2996`). */
const ONE_COLOUR = 0x80;

/**
 * The hatches, eight rows of a byte each (seg1 `2ba6`): horizontal,
 * vertical, the two diagonals, cross and diagonal cross.
 */
const HATCHES = [
  [0x00, 0x00, 0x00, 0x00, 0xff, 0x00, 0x00, 0x00],
  [0x08, 0x08, 0x08, 0x08, 0x08, 0x08, 0x08, 0x08],
  [0x80, 0x40, 0x20, 0x10, 0x08, 0x04, 0x02, 0x01],
  [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80],
  [0x08, 0x08, 0x08, 0x08, 0xff, 0x08, 0x08, 0x08],
  [0x81, 0x42, 0x24, 0x18, 0x18, 0x24, 0x42, 0x81],
];

/** The routine's offset in the display driver's table, which `Brute` leaves in DX (seg13 `0171`). */
const REALIZE_OBJECT = 0x24;

/**
 * A pen (seg1 `28b6`): its physical colour, then its style -- solid for a
 * pen wider than a pixel or of a style past `PS_NULL`. A null pen's colour
 * is not matched: AX nought, as the routine's start left it, and DX the
 * routine's offset, as `Brute` left it.
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
    physical = physicalOf(system, matchedOf(system, read32(system, input, 6)));
  }

  write16(system, out, 0, physical);
  write16(system, out, 2, physical >>> 16);
  write16(system, out, 4, kept);
}

/** A plane of eight rows, a byte each, laid at `at`. */
function writeRows(system: any, out: number, at: number, rows: number[]) {
  rows.forEach((row, index) => write8(system, out, at + index, row));
}

/**
 * The monochrome plane of a colour (seg1 `210e`): the colour's pattern on
 * a bitmap of one plane, as `dither.ts` has the VGA's.
 */
function monoRows(system: any, red: number, green: number, blue: number) {
  const palette = DevicePalette.forDisplay(system.display, 1);
  const rows: number[] = [];

  for (let y = 0; y < 8; y++) {
    let row = 0;

    for (let x = 0; x < 8; x++) {
      const bit = ditheredIndex(system.display, palette, red, green, blue, x, y);
      const white = bit === null ? palette.index(red, green, blue) : bit;

      row |= (white ? 1 : 0) << (7 - x);
    }

    rows.push(row);
  }

  return rows;
}

/**
 * A solid brush (seg1 `292a`). White and black are each one byte in every
 * plane, flagged FFh and E0h. Any other colour: the monochrome plane its
 * pattern, and the colour planes the colour's index where the device has
 * the colour -- flagged with its physical colour's top byte and 80h -- or
 * the VGA's pattern of it (`dither.ts`), flagged with the nearest colour's
 * top byte. A colour of 10E0E0E0h, flagged for the driver, is on the VGA
 * the checkerboard of light grey and white (`2957`-`2979`); the EGA's has
 * no such case (`EGA.DRV` seg1 `2938`). Answers the flags.
 */
function realizeSolid(system: any, colour: number, out: number) {
  const red = colour & 0xff;
  const green = (colour >>> 8) & 0xff;
  const blue = (colour >>> 16) & 0xff;

  if ((red & green & blue) === 0xff || (red | green | blue) === 0) {
    const byte = red ? 0xff : 0;

    for (let at = 0; at < 0x28; at++) {
      write8(system, out, at, byte);
    }

    return red ? 0xff : 0xe0;
  }

  let flags: number;

  if (
    familyOf(system) === 'vga' &&
    (colour >>> 24) & 0x10 &&
    red === 0xe0 &&
    green === 0xe0 &&
    blue === 0xe0
  ) {
    for (let at = 0; at < 0x18; at++) {
      write8(system, out, at, at & 1 ? 0xaa : 0x55);
    }

    for (let at = 0x18; at < 0x20; at++) {
      write8(system, out, at, 0xff);
    }

    flags = 0x3f;
  } else {
    const index = matchedOf(system, colour);
    const physical = physicalOf(system, index);

    flags = (physical >>> 24) & 0x7f;

    if ((physical & 0xffffff) === (colour & 0xffffff)) {
      flags |= ONE_COLOUR;

      for (let plane = 0; plane < 4; plane++) {
        writeRows(system, out, plane * 8, new Array(8).fill((index >> plane) & 1 ? 0xff : 0));
      }
    } else {
      const palette = DevicePalette.forDisplay(system.display, 4);

      for (let plane = 0; plane < 4; plane++) {
        const rows: number[] = [];

        for (let y = 0; y < 8; y++) {
          let row = 0;

          for (let x = 0; x < 8; x++) {
            const at = ditheredIndex(system.display, palette, red, green, blue, x, y) ?? index;

            row |= ((at >> plane) & 1) << (7 - x);
          }

          rows.push(row);
        }

        writeRows(system, out, plane * 8, rows);
      }
    }
  }

  writeRows(system, out, MONO_PLANE, monoRows(system, red, green, blue));
  return flags;
}

/**
 * A hatched brush (seg1 `2ab9`): each plane, and the monochrome one, the
 * hatch where the brush's colour and the background colour after the
 * logical brush (at 8) differ in it, else the bit they share; at 2Eh the
 * hatch as a plane whose colour is nought and background 1 would have it,
 * the background's pixels set (`2af1`). A hatch past the diagonal cross is a solid brush.
 */
function realizeHatched(system: any, input: number, out: number, hatch: number) {
  const fore = physicalOf(system, matchedOf(system, read32(system, input, 2))) >>> 24;
  const back = physicalOf(system, matchedOf(system, read32(system, input, 8))) >>> 24;
  const rows = HATCHES[hatch];

  for (let plane = 0; plane < 5; plane++) {
    const f = (fore >> plane) & 1;
    const b = (back >> plane) & 1;

    writeRows(
      system,
      out,
      plane * 8,
      rows.map((row) => (f === b ? (f ? 0xff : 0) : b ? ~row & 0xff : row))
    );
  }

  writeRows(
    system,
    out,
    HATCH_MASK,
    rows.map((row) => ~row & 0xff)
  );
}

/**
 * A pattern brush (seg1 `2a20`), its logical brush's colour a far pointer
 * to the bitmap: the first byte of each of its first eight rows. A bitmap
 * of four planes gives each plane, and the monochrome plane of each
 * pixel's colour; a monochrome one gives its rows to every plane, and is
 * drawn in the text and background colours.
 */
function realizePattern(system: any, input: number, out: number) {
  const bitmap = readBitmap(system, read32(system, input, 2));
  const colour = (bitmap.format & 0xff) === 4;
  const planes = colour ? 4 : 1;
  const stride = bitmap.widthBytes * planes;

  for (let plane = 0; plane < (colour ? 4 : 5); plane++) {
    const from = colour ? plane : 0;
    const rows: number[] = [];

    for (let y = 0; y < 8; y++) {
      rows.push(read8(system, bitmap.bits, y * stride + from * bitmap.widthBytes));
    }

    writeRows(system, out, plane * 8, rows);
  }

  if (colour) {
    for (let y = 0; y < 8; y++) {
      let row = 0;

      for (let x = 0; x < 8; x++) {
        let index = 0;

        for (let plane = 0; plane < 4; plane++) {
          index |= ((read8(system, out, plane * 8 + y) >> (7 - x)) & 1) << plane;
        }

        row |= (flagsOf(system, index) & MONO_WHITE ? 1 : 0) << (7 - x);
      }

      write8(system, out, MONO_PLANE + y, row);
    }
  }

  write8(system, out, 0x2b, 0xff);
  write8(system, out, 0x2c, 0xff);
  return colour ? COLOUR_PATTERN : MONO_PATTERN;
}

/**
 * A brush turned to its origin (seg1 `2b3c`, `2b63`), the low word of the
 * `TEXTXFORM`'s pointer its x and the high its y: each byte turned right
 * by x and each plane's rows down by y, modulo eight. A brush of one
 * colour has only its monochrome plane turned; white and black, none.
 */
function turnBrush(system: any, out: number, flags: number, x: number, y: number) {
  if ((flags & 0xe0) === 0xe0) {
    return;
  }

  const style = read16(system, out, BRUSH_STYLE);
  const blocks = flags & ONE_COLOUR ? [MONO_PLANE] : [0, 8, 16, 24, MONO_PLANE];

  if (style === HATCHED) {
    blocks.push(HATCH_MASK);
  }

  const by = x & 7;
  const down = y & 7;

  for (const at of blocks) {
    const rows: number[] = [];

    for (let row = 0; row < 8; row++) {
      const byte = read8(system, out, at + row);

      rows.push(((byte >> by) | (byte << (8 - by))) & 0xff);
    }

    for (let row = 0; row < 8; row++) {
      write8(system, out, at + ((row + down) & 7), rows[row]);
    }
  }
}

function realizeBrush(system: any, input: number, out: number, origin: number) {
  const style = read16(system, input, 0);
  let kept = style <= 3 ? style : SOLID;
  let flags: number;

  if (kept === HOLLOW) {
    flags = 0xe0;
  } else if (kept === HATCHED && read16(system, input, 6) <= 5) {
    realizeHatched(system, input, out, read16(system, input, 6));
    flags = 0;
  } else if (kept === COLOUR_PATTERN) {
    kept = realizePattern(system, input, out);
    flags = 0;
  } else {
    kept = SOLID;
    flags = realizeSolid(system, read32(system, input, 2), out);
  }

  write16(system, out, BRUSH_STYLE, kept);
  write8(system, out, BRUSH_FLAGS, flags);
  turnBrush(system, out, flags, origin & 0xffff, origin >>> 16);
}

/**
 * `RealizeObject` (`VGA.DRV` seg1 `286e`): a style below nought (deleting
 * an object) answers 1; nought answers the word before the table of sizes;
 * past 3, nought. With an object to fill, the pen, brush or font laid out;
 * the answer is the object's size, a font's nought.
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
    return STYLE_NOUGHT[familyOf(system) ?? 'vga'];
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

  return [PEN_SIZE, BRUSH_SIZE, FONT_SIZE][signed - 1];
}

/* BitBlt ------------------------------------------------------------------- */

/** A `DRAWMODE`'s colours. */
interface DrawMode {
  rop2: number;
  bkMode: number;
  bkColor: number;
  textColor: number;
  tBreakExtra: number;
  breakExtra: number;
  breakErr: number;
  breakRem: number;
  breakCount: number;
  characterExtra: number;
}

function readDrawMode(system: any, far: number): DrawMode {
  const signed = (at: number) => (read16(system, far, at) << 16) >> 16;

  return {
    rop2: read16(system, far, 0),
    bkMode: read16(system, far, 2),
    bkColor: read32(system, far, 4),
    textColor: read32(system, far, 8),
    tBreakExtra: signed(0x0c),
    breakExtra: signed(0x0e),
    breakErr: signed(0x10),
    breakRem: signed(0x12),
    breakCount: signed(0x14),
    characterExtra: signed(0x16),
  };
}

/**
 * The brush's bits at a pixel, by x and y modulo eight: each colour
 * plane's for a bitmap of four planes, the monochrome plane's for one; a
 * monochrome pattern's bit in the background colour where set and the
 * text colour where not.
 */
function brushPixel(
  system: any,
  brush: number,
  bitmap: DriverBitmap,
  mode: DrawMode | null,
  x: number,
  y: number
) {
  const mask = 0x80 >> (x & 7);
  const row = y & 7;

  if (bitmap.format !== FOUR_PLANES) {
    const layout = brushLayout(system);
    const set = read8(system, brush, layout.mono + row) & mask;

    /* The Hercules's pattern is drawn as a monochrome one, in the
     * `DRAWMODE`'s colours (**recorded** by `gdidmdrw`). */
    if (layout.pattern && mode && read16(system, brush, layout.style) === COLOUR_PATTERN) {
      return bitsOfPhysical(bitmap, set ? mode.bkColor : mode.textColor);
    }

    return set ? 1 : 0;
  }

  if (read16(system, brush, BRUSH_STYLE) === MONO_PATTERN && mode) {
    const set = read8(system, brush, row) & mask;

    return bitsOfPhysical(bitmap, set ? mode.bkColor : mode.textColor);
  }

  let value = 0;

  for (let plane = 0; plane < 4; plane++) {
    if (read8(system, brush, plane * 8 + row) & mask) {
      value |= 1 << plane;
    }
  }

  return value;
}

/**
 * A source's pixel carried to the destination's format: from a
 * monochrome source, white as the background colour and black as the text
 * colour; from a colour source to a monochrome destination, white where it
 * is the background colour.
 */
function carried(dest: DriverBitmap, source: DriverBitmap, value: number, mode: DrawMode | null) {
  const destColour = dest.format === FOUR_PLANES;
  const sourceColour = source.format === FOUR_PLANES;

  if (destColour === sourceColour || !mode) {
    return value;
  }

  if (destColour) {
    return bitsOfPhysical(dest, value ? mode.bkColor : mode.textColor);
  }

  return value === bitsOfPhysical(source, mode.bkColor) ? 1 : 0;
}

/**
 * `BitBlt` (`VGA.DRV` seg1 `0466`) on a memory bitmap: each pixel of the
 * rectangle combined from the brush, the source and itself by the raster
 * operation's table, plane by plane. Nothing is clipped. The source is read
 * whole before anything is written, as a copy within one bitmap reads it.
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
  const dest = readBitmap(system, destFar);
  const source = sourceFar ? readBitmap(system, sourceFar) : null;
  const mode = drawMode ? readDrawMode(system, drawMode) : null;
  const table = (rop >>> 16) & 0xff;
  const w = (width << 16) >> 16;
  const h = (height << 16) >> 16;
  const dx = (x << 16) >> 16;
  const dy = (y << 16) >> 16;
  const mask = dest.format === FOUR_PLANES ? 0xf : 1;
  const sources: number[] = [];

  if (w <= 0 || h <= 0) {
    return 1;
  }

  if (source) {
    for (let row = 0; row < h; row++) {
      for (let column = 0; column < w; column++) {
        sources.push(
          carried(
            dest,
            source,
            pixelOf(system, source, ((sx << 16) >> 16) + column, ((sy << 16) >> 16) + row),
            mode
          )
        );
      }
    }
  }

  for (let row = 0; row < h; row++) {
    for (let column = 0; column < w; column++) {
      const px = dx + column;
      const py = dy + row;
      const p = brush ? brushPixel(system, brush, dest, mode, px, py) : 0;
      const s = source ? sources[row * w + column] : 0;
      const d = pixelOf(system, dest, px, py);

      putPixel(system, dest, px, py, combine(table, p, s, d, mask));
    }
  }

  return 1;
}

/* Output ------------------------------------------------------------------- */

/** The styles of `Output` the VGA draws (seg1 `284e`). */
const OS_SCANLINES = 4;
const OS_POLYLINE = 18;

/**
 * The pen styles' masks, a bit for each stretch along the line from bit
 * nought (seg6 `0056`): solid, dash, dot, dash-dot and dash-dot-dot. The
 * driver keeps each beside its own reverse, for a line it draws from the
 * other end, which comes to the same bits.
 */
const STYLE_MASKS = [0xff, 0xe7, 0x55, 0x27, 0x57];

/**
 * How far along its style a pixel moves a line (seg6 `0350`-`038f`): 40h
 * a step along a line whose rise is no more than 40h/55h of its run, else
 * 55h; a bit of the mask is 100h.
 */
const FLAT_STEP = 0x40;
const STEEP_STEP = 0x55;

/** A pixel set by a `DRAWMODE`'s binary raster operation of a colour's bits and the pixel's. */
function mix(rop2: number, pen: number, there: number, planes: number) {
  const table = (rop2 - 1) & 0xf;
  let out = 0;

  for (let plane = 0; plane < planes; plane++) {
    const bit = (table >> ((((pen >> plane) & 1) << 1) | ((there >> plane) & 1))) & 1;

    out |= bit << plane;
  }

  return out;
}

/**
 * The pixels of a polyline a pixel wide as the VGA walks it: at each step
 * along the longer axis the pixel nearest the line, a tie to the smaller y,
 * each segment's last point left for the next; each with where it is along
 * the pen's style. The style goes on from one segment into the next (seg6
 * `03a8`-`03ad`), each segment moving it by its step times its longer
 * span.
 */
function polylinePixels(points: [number, number][]) {
  const out: [number, number, number][] = [];
  let style = 0;

  for (let index = 1; index < points.length; index++) {
    const [fromX, fromY] = points[index - 1];
    const [toX, toY] = points[index];
    const dx = toX - fromX;
    const dy = toY - fromY;
    const across = Math.abs(dx) >= Math.abs(dy);
    const steps = across ? Math.abs(dx) : Math.abs(dy);
    const along = STEEP_STEP * Math.abs(dy) <= FLAT_STEP * Math.abs(dx) ? FLAT_STEP : STEEP_STEP;

    if (!steps) {
      continue;
    }

    const major = (across ? dx : dy) > 0 ? 1 : -1;
    const minor = across ? dy : dx;
    const up = across ? 1 : dx * dy > 0 ? 1 : 0;

    for (let step = 0; step < steps; step++) {
      const offset = Math.floor((2 * minor * step + steps - up) / (2 * steps));
      const at = (style + along * step) & 0xffff;

      out.push(
        across
          ? [fromX + major * step, fromY + offset, at]
          : [fromX + offset, fromY + major * step, at]
      );
    }

    style = (style + along * steps) & 0xffff;
  }

  return out;
}

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

/**
 * `Output` (`VGA.DRV` seg1 `284e`): a polyline (`OS_POLYLINE`, seg6
 * `00a0`) and scanlines (`OS_SCANLINES`, seg8 `006e`); any other style
 * answers -1 and draws nothing, which leaves it to GDI.
 *
 * * A polyline: its pixels, inside the clipping rectangle, in the pen's
 *   colour under the `DRAWMODE`'s raster operation; a styled pen's gaps in
 *   the background colour where the background is opaque. Answers 1.
 * * Scanlines: the first point the count of them and the row, each after
 *   a pair of x, from the first to before the second, in the brush under
 *   the raster operation -- the pen's colour with no brush -- and a
 *   hatched brush's hatch alone where the background is transparent. Not
 *   clipped. Answers nought.
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
  const planes = planesOf(dest);

  if (style === OS_POLYLINE) {
    const path: [number, number][] = [];

    for (let index = 0; index < (count << 16) >> 16; index++) {
      path.push(readPoint(system, points, index));
    }

    const penStyle = read16(system, pen, 4);
    const bits = STYLE_MASKS[penStyle] ?? 0xff;
    const ink = bitsOfPhysical(dest, read32(system, pen, 0));
    const gap = mode.bkMode === 2 ? bitsOfPhysical(dest, mode.bkColor) : null;
    /* The Hercules's polyline is not cut to the rectangle (**recorded** by
     * `gdidmdrw`). */
    const box =
      clip && !isHercules(system)
        ? readRect(system, clip)
        : { left: 0, top: 0, right: dest.width, bottom: dest.height };

    if (penStyle === 5) {
      return 1;
    }

    for (const [px, py, at] of polylinePixels(path)) {
      if (px < box.left || px >= box.right || py < box.top || py >= box.bottom) {
        continue;
      }

      const on = !!((bits >> ((at >> 8) & 7)) & 1);

      if (!on && gap === null) {
        continue;
      }

      putPixel(
        system,
        dest,
        px,
        py,
        mix(mode.rop2, on ? ink : gap!, pixelOf(system, dest, px, py), planes)
      );
    }

    return 1;
  }

  if (style === OS_SCANLINES) {
    const [lines, y] = readPoint(system, points, 0);
    const ink = bitsOfPhysical(dest, read32(system, pen, 0));
    /* A hatched brush on a transparent background draws its hatch alone. */
    const layout = brushLayout(system);
    const seeThrough =
      brush && mode.bkMode === 1 && read16(system, brush, layout.style) === HATCHED;

    for (let index = 1; index < lines; index++) {
      const [from, to] = readPoint(system, points, index);

      for (let px = from; px < to; px++) {
        /* The VGA keeps its hatch's mask clear where the hatch is drawn; the
         * Hercules keeps the hatch's own rows (`driver-hercules.ts`). */
        if (
          seeThrough &&
          !!(read8(system, brush, layout.hatch + (y & 7)) & (0x80 >> (px & 7))) !==
            layout.hatchDrawn
        ) {
          continue;
        }

        const p = brush ? brushPixel(system, brush, dest, mode, px, y) : ink;

        putPixel(system, dest, px, y, mix(mode.rop2, p, pixelOf(system, dest, px, y), planes));
      }
    }

    return 0;
  }

  /* The Hercules answers nought for any other style (seg1 `2b02`). */
  return isHercules(system) ? 0 : 0xffff;
}

/* ExtTextOut, StrBlt and GetCharWidth ------------------------------------ */

/** Where a font's `FONTINFO` lies in its segment, the file's header before it, and its version. */
const FONTINFO_AT = 0x42;
const VERSION_3 = 0x300;

/** The fields of a font the text routines read, by their place in the segment. */
const DF_WEIGHT = 0x53;
const DF_PIX_WIDTH = 0x56;
const DF_PIX_HEIGHT = 0x58;
const DF_FIRST_CHAR = 0x5f;
const DF_LAST_CHAR = 0x60;
const DF_DEFAULT_CHAR = 0x61;
const DF_BREAK_CHAR = 0x62;
const DF_BITS_POINTER = 0x6d;

/** A character's entry, by its index from the first: six bytes in a font of 3.0, four before. */
function entryOf(system: any, segment: number, index: number) {
  return read16(system, segment, 0) >= VERSION_3 ? 0x94 + index * 6 : 0x76 + index * 4;
}

/** What `ExtTextOut` answers where it draws nothing it can: AX nought and DX 8000h (seg2 `089b`). */
const CANNOT = 0x80000000;

/** A font emboldened by the `TEXTXFORM`: asked for 700 or more of one lighter (seg2 `0862`-`087a`). */
function emboldened(system: any, segment: number, xform: number) {
  return read16(system, xform, 8) >= 700 && read16(system, segment, DF_WEIGHT) < 700;
}

/**
 * A string's characters as the driver lays them (seg2 `0c4b`-`0ce6`):
 * each one's index from the first character -- the default character's for
 * one outside the font -- its glyph's width and where it starts. Each moves
 * the next on by its width, or the width given for it but the last, then
 * the character extra; the break character by the break extra too, and by
 * one more each time the break error, less the remainder, falls to nought,
 * the break count then added back. Answers the characters and how far the
 * farthest of their glyphs and advances reach.
 */
function layOut(
  system: any,
  segment: number,
  string: number,
  count: number,
  mode: DrawMode,
  extra: number,
  widths: number
) {
  const first = read8(system, segment, DF_FIRST_CHAR);
  const span = (read8(system, segment, DF_LAST_CHAR) - first) & 0xff;
  const fallback = read8(system, segment, DF_DEFAULT_CHAR);
  const breakChar = read8(system, segment, DF_BREAK_CHAR);
  const out: { index: number; width: number; at: number }[] = [];
  let at = 0;
  let reach = 0;

  for (let i = 0; i < count; i++) {
    let index = (read8(system, string, i) - first) & 0xff;

    if (index > span) {
      index = fallback;
    }

    let advance = extra;

    if (index === breakChar && (mode.breakExtra || mode.breakRem)) {
      advance += mode.breakExtra;

      if (mode.breakRem > 0) {
        mode.breakErr -= mode.breakRem;

        if (mode.breakErr <= 0) {
          mode.breakErr += mode.breakCount;
          advance++;
        }
      } else if (mode.breakRem < 0) {
        mode.breakErr -= mode.breakRem;

        if (mode.breakErr >= 0) {
          mode.breakErr -= mode.breakCount;
          advance--;
        }
      }
    }

    const width = read16(system, segment, entryOf(system, segment, index));

    if (widths && i !== count - 1) {
      advance += ((read16(system, widths, i * 2) << 16) >> 16) - width;
    }

    out.push({ index, width, at });
    at += width;
    reach = Math.max(reach, at);
    at += advance;
    reach = Math.max(reach, at);
  }

  return { characters: out, reach };
}

/** A rectangle's intersection, or null where it is empty. */
function within(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number }
) {
  const box = {
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  };

  return box.right > box.left && box.bottom > box.top ? box : null;
}

/**
 * `ExtTextOut` (`VGA.DRV` seg2 `0837`, the 386's) on a memory bitmap. Only
 * a font of version 3.0 laid out as GDI loads one, its `FONTINFO` at 42h
 * of its segment; any other answers 80000000h and draws nothing.
 *
 * * A negative count answers the string's extent, its height in the high
 *   word: the characters' widths, the character extra for each and the
 *   break extra for each break character, and one more for an emboldened
 *   font (seg2 `0b8a`-`0c40`).
 * * Otherwise the string is drawn at x and y, its cell the font's height:
 *   the clipping rectangle, cut to the opaque rectangle with
 *   `ETO_CLIPPED`; the opaque rectangle filled with the background colour,
 *   inside the clip, with `ETO_OPAQUE`; and each glyph set in the text
 *   colour where its bit is set, the rest of the string's cell in the
 *   background colour where the background is opaque. An emboldened font's
 *   glyphs are each set again a pixel to the right, and each character is a
 *   pixel wider. Answers nought.
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
  xform: number,
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
  const bold = emboldened(system, segment, xform) ? 1 : 0;
  const extra = mode.characterExtra + (widths ? 0 : bold);
  const height = read16(system, segment, DF_PIX_HEIGHT);
  const n = (count << 16) >> 16;

  if (n < 0) {
    const { reach } = layOut(system, segment, string, -n, mode, extra, 0);

    write16(system, drawMode, 0x10, mode.breakErr);
    return ((height << 16) | (Math.min(reach + bold, 0x7fff) & 0xffff)) >>> 0;
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

  const back = bitsOfPhysical(dest, mode.bkColor);
  const fore = bitsOfPhysical(dest, mode.textColor);

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
  const { characters, reach } = layOut(system, segment, string, n, mode, extra, widths);
  const extent = reach + bold;
  const ink = new Uint8Array(Math.max(extent, 0) * height);
  const bits = (read32(system, segment, DF_BITS_POINTER) & 0xffff0000) >>> 0;

  for (const { index, width, at } of characters) {
    const glyph =
      (bits | (read32(system, segment, entryOf(system, segment, index) + 2) & 0xffff)) >>> 0;

    for (let column = 0; column < width; column++) {
      for (let row = 0; row < height; row++) {
        const byte = read8(system, glyph, (column >> 3) * height + row);

        if (byte & (0x80 >> (column & 7))) {
          for (let smear = 0; smear <= bold; smear++) {
            const px = at + column + smear;

            if (px >= 0 && px < extent) {
              ink[row * extent + px] = 1;
            }
          }
        }
      }
    }
  }

  const cell =
    textBox && within(textBox, { left: dx, top: dy, right: dx + extent, bottom: dy + height });

  if (!cell) {
    return 0;
  }

  for (let py = cell.top; py < cell.bottom; py++) {
    for (let px = cell.left; px < cell.right; px++) {
      if (ink[(py - dy) * extent + (px - dx)]) {
        putPixel(system, dest, px, py, fore);
      } else if (mode.bkMode === 2) {
        putPixel(system, dest, px, py, back);
      }
    }
  }

  write16(system, drawMode, 0x10, mode.breakErr);
  return 0;
}

/**
 * `GetCharWidth` (`VGA.DRV` seg1 `17dc`): from the first character asked
 * to the last, each width into the buffer, two more each for an emboldened
 * font; a fixed font's width for every one. Below the font's first
 * character, the default character's width. From there, the font's table
 * read on for as many as the font's last character -- its code, not its
 * index -- less the index allows, past the table's end where the request
 * goes beyond the font; and the last width read for any left. Answers 1,
 * and nought for a last below the first.
 */
export function getCharWidth(
  system: any,
  buffer: number,
  firstAsked: number,
  lastAsked: number,
  font: number,
  xform: number
) {
  const segment = (font & 0xffff0000) >>> 0;
  const bold = emboldened(system, segment, xform) ? 2 : 0;
  let count = lastAsked - firstAsked;

  if (count < 0) {
    return 0;
  }

  count++;

  const out: number[] = [];
  const fixed = read16(system, segment, DF_PIX_WIDTH);

  if (fixed) {
    for (let i = 0; i < count; i++) {
      out.push(fixed + bold);
    }
  } else {
    const fallback =
      read16(system, segment, entryOf(system, segment, read8(system, segment, DF_DEFAULT_CHAR))) +
      bold;
    let index = firstAsked - read8(system, segment, DF_FIRST_CHAR);
    let last = fallback;

    if (index < 0) {
      const below = Math.min(-index, count);

      for (let i = 0; i < below; i++) {
        out.push(fallback);
      }

      count -= below;
      index = 0;
    }

    const known = read8(system, segment, DF_LAST_CHAR) - index;

    if (known >= 0) {
      const read = Math.min(known + 1, count);

      for (let i = 0; i < read; i++) {
        last = (read16(system, segment, entryOf(system, segment, index + i)) + bold) & 0xffff;
        out.push(last);
      }

      count -= read;
    }

    for (let i = 0; i < count; i++) {
      out.push(last);
    }
  }

  out.forEach((width, i) => write16(system, buffer, i * 2, width));
  return 1;
}

/* DeviceBitmapBits and DIBScreenBlt -------------------------------------- */

/** A DIB's pixel formats the driver takes (seg9 `078d`-`07ad`). */
const DIB_BITS = [1, 4, 8, 24];

/**
 * `DeviceBitmapBits` (`VGA.DRV` seg9 `0d1e`) on a memory bitmap: scans of
 * it got as a DIB or set from one, of 1, 4, 8 or 24 bits a pixel and
 * uncompressed; a compressed one is handed to the driver's own reading of
 * run lengths, not followed here (answers nought). The scans are counted
 * from the DIB's bottom, as its header's height has them: from `start`, as
 * many as asked that the height leaves. Answers how many, nought for a
 * start at or past the height or another format.
 *
 * * Got (seg9 `0764`): each pixel its index, or for a DIB of a bit its
 *   flag of white (`flagsOf`); the colours the VGA's sixteen (seg9 `0000`)
 *   and nought after them, or for a monochrome bitmap or a DIB of a bit,
 *   black but the last, white. The header's `biSizeImage` is made the
 *   whole DIB's size and `biClrUsed` nought. With no buffer for the bits,
 *   only the count.
 * * Set (seg9 `0048`): each pixel's colour, the DIB's own or its colour
 *   table's, matched to the VGA's (`matchedOf`), and on a monochrome bitmap
 *   white where that colour is.
 */
export function deviceBitmapBits(
  system: any,
  bitmapFar: number,
  get: number,
  start: number,
  scans: number,
  bits: number,
  info: number,
  _drawMode: number
) {
  const dest = readBitmap(system, bitmapFar);
  const colour = dest.format === FOUR_PLANES;
  const width = read32(system, info, 4);
  const height = read32(system, info, 8);
  const bitCount = read16(system, info, 0x0e);

  if (read8(system, info, 0x10)) {
    return 0;
  }

  if (get !== 0 && get !== 1) {
    return 0;
  }

  if (get === 0 && !bits) {
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
  const table = (info & 0xffff0000) | ((info + read16(system, info, 0)) & 0xffff);
  const entries = bitCount === 24 ? 0 : 1 << bitCount;

  if (get) {
    write16(system, info, 0x20, 0);
    write16(system, info, 0x22, 0);

    for (let entry = 0; entry < entries; entry++) {
      let rgb = [0, 0, 0];

      if (bitCount === 1 || !colour) {
        rgb = entry === entries - 1 ? [0xff, 0xff, 0xff] : [0, 0, 0];
      } else if (entry < 16) {
        rgb = colourOf(system, entry);
      }

      write8(system, table, entry * 4, rgb[2]);
      write8(system, table, entry * 4 + 1, rgb[1]);
      write8(system, table, entry * 4 + 2, rgb[0]);
      write8(system, table, entry * 4 + 3, 0);
    }
  }

  if (bits) {
    for (let scan = 0; scan < count; scan++) {
      const y = height - 1 - (start + scan);
      const row = (bits + scan * stride) >>> 0;
      const at = (offset: number) => ((row & 0xffff0000) | ((row + offset) & 0xffff)) >>> 0;

      for (let x = 0; x < width; x++) {
        if (get) {
          const index = pixelOf(system, dest, x, y);
          const value = colour ? index : index ? 0xf : 0;

          if (bitCount === 24) {
            const [red, green, blue] = colour
              ? colourOf(system, index)
              : index
                ? [255, 255, 255]
                : [0, 0, 0];

            write8(system, at(x * 3), 0, blue);
            write8(system, at(x * 3 + 1), 0, green);
            write8(system, at(x * 3 + 2), 0, red);
          } else if (bitCount === 8) {
            write8(system, at(x), 0, colour ? index : index ? 0xff : 0);
          } else if (bitCount === 4) {
            const byte = read8(system, at(x >> 1), 0);
            const shift = x & 1 ? 0 : 4;

            write8(system, at(x >> 1), 0, (byte & ~(0xf << shift)) | (value << shift));
          } else {
            const white = colour ? flagsOf(system, index) & MONO_WHITE : index;
            const byte = read8(system, at(x >> 3), 0);
            const mask = 0x80 >> (x & 7);

            write8(system, at(x >> 3), 0, white ? byte | mask : byte & ~mask);
          }
        } else {
          let rgb: number;

          if (bitCount === 24) {
            rgb =
              read8(system, at(x * 3 + 2), 0) |
              (read8(system, at(x * 3 + 1), 0) << 8) |
              (read8(system, at(x * 3), 0) << 16);
          } else {
            const index =
              bitCount === 8
                ? read8(system, at(x), 0)
                : bitCount === 4
                  ? (read8(system, at(x >> 1), 0) >> (x & 1 ? 0 : 4)) & 0xf
                  : (read8(system, at(x >> 3), 0) >> (7 - (x & 7))) & 1;

            rgb =
              read8(system, table, index * 4 + 2) |
              (read8(system, table, index * 4 + 1) << 8) |
              (read8(system, table, index * 4) << 16);
          }

          if (isHercules(system)) {
            putPixel(system, dest, x, y, herculesWhite(rgb) ? 1 : 0);
            continue;
          }

          const index = matchedOf(system, rgb);

          putPixel(
            system,
            dest,
            x,
            y,
            colour ? index : flagsOf(system, index) & MONO_WHITE ? 1 : 0
          );
        }
      }
    }
  }

  if (get) {
    const size = ((((bitCount * width + 0x1f) & 0xffe0) >> 3) * height) >>> 0;

    write16(system, info, 0x14, size);
    write16(system, info, 0x16, size >>> 16);
  }

  return count;
}

/**
 * `DIBScreenBlt` (`VGA.DRV` seg9 `0e2a`) on a memory bitmap: nothing drawn,
 * nought answered. **Recorded** by `gdidmdrw`.
 */
export function dibToDevice() {
  return 0;
}
