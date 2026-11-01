'use strict';

/**
 * The Hercules's own `ColorInfo` and `RealizeObject` on a memory bitmap,
 * as `HERCULES.DRV` makes them for GDI's helpers (`driver-helpers.ts`).
 * The twin of `crates/winbox-win16/src/gdi/driver_hercules.rs`. Its
 * display has one plane of a bit, so every bitmap of its format is
 * monochrome; a colour is black or white, and a brush a dither of grey.
 *
 * **Read out** of `HERCULES.DRV` seg1; **recorded** by `gdidmdrw` on the
 * Hercules.
 */

/** Whether the display is the Hercules's. */
export function isHercules(system: any) {
  return String(system.display?.driverFile ?? '').toUpperCase() === 'HERCULES.DRV';
}

function core(system: any) {
  return system.machine.cpu.core;
}

function read8(system: any, far: number, at: number) {
  return core(system).read8(far >>> 16, ((far & 0xffff) + at) & 0xffff);
}

function read16(system: any, far: number, at: number) {
  return core(system).read16(far >>> 16, ((far & 0xffff) + at) & 0xffff) & 0xffff;
}

function read32(system: any, far: number, at: number) {
  return (read16(system, far, at) | (read16(system, far, at + 2) << 16)) >>> 0;
}

function write8(system: any, far: number, at: number, value: number) {
  core(system).write8(far >>> 16, ((far & 0xffff) + at) & 0xffff, value & 0xff);
}

function write16(system: any, far: number, at: number, value: number) {
  write8(system, far, at, value);
  write8(system, far, at + 1, value >> 8);
}

/** The flags of a physical colour's top byte (seg1 `2bb6`): red, green, blue, white, and black or white itself. */
const RED = 0x01;
const GREEN = 0x02;
const BLUE = 0x04;
const WHITE = 0x10;
const PURE = 0x20;
/** A colour whose red, green and blue come to this much or more is white (`2bc5`). */
const WHITE_SUM = 0x17e;

/**
 * A colour made physical (seg1 `2bb6`): each of its red, green and blue
 * FFh at 80h or more, else nought -- the byte shifted right by 8, its sign
 * filling it (`2bd2`-`2bdc`); its top byte a bit for each of the three so
 * made, white where the three come to 17Eh or more, and `PURE` for black
 * and for white with all three bits. The sum is answered with it, for the
 * dither.
 */
function physicalOf(colour: number) {
  const red = colour & 0xff;
  const green = (colour >>> 8) & 0xff;
  const blue = (colour >>> 16) & 0xff;
  const sum = red + green + blue;
  let flags =
    (sum >= WHITE_SUM ? WHITE : 0) |
    (blue & 0x80 ? BLUE : 0) |
    (green & 0x80 ? GREEN : 0) |
    (red & 0x80 ? RED : 0) |
    PURE;

  if (flags !== PURE && flags !== (PURE | WHITE | BLUE | GREEN | RED)) {
    flags &= ~PURE;
  }

  const channels =
    (flags & RED ? 0xff : 0) | (flags & GREEN ? 0xff00 : 0) | (flags & BLUE ? 0xff0000 : 0);

  return { physical: (channels | (flags << 24)) >>> 0, sum };
}

/**
 * `ColorInfo` (seg1 `2d44`): with a buffer, the colour's physical colour
 * written there; the answer white or black by its flag -- with no buffer
 * the colour given taken as the physical one -- whatever the bitmap.
 */
export function herculesColorInfo(system: any, colour: number, lpPhysical: number) {
  let top = colour >>> 24;

  if (lpPhysical) {
    const { physical } = physicalOf(colour);

    write16(system, lpPhysical, 0, physical);
    write16(system, lpPhysical, 2, physical >>> 16);
    top = physical >>> 24;
  }

  return top & WHITE ? 0x00ffffff : 0;
}

/** The size of each object as `RealizeObject` lays it out, by style 1 to 3 (seg1 `2d3d`). */
const PEN_SIZE = 6;
const BRUSH_SIZE = 0x16;
const FONT_SIZE = 0;

/**
 * What `RealizeObject` answers for style nought: the word before the
 * table of sizes, the last of the table of routines before it (seg1
 * `2d3b`, the font's routine `2cc1`).
 */
const STYLE_NOUGHT = 0x2cc1;

/** The routine's offset in the display driver's table, which `Brute` leaves in DX. */
const REALIZE_OBJECT = 0x24;

/** Where a physical brush keeps its parts (seg1 `2b88`-`2b8b`, `2c92`). */
const BRUSH_STYLE = 8;
const BRUSH_FLAGS = 0x0a;
const PATTERN_END = 0x0b;
const SECOND = 0x0e;

const SOLID = 0;
const HOLLOW = 1;
const HATCHED = 2;
const PATTERN = 3;
/** The flag of a brush of black or white alone (`2c18`). */
const ONE_COLOUR = 0x80;

/**
 * The hatches, eight rows of a byte each (seg1 `2d07`): horizontal,
 * vertical, the two diagonals, cross and diagonal cross, as the VGA's.
 */
const HATCHES = [
  [0x00, 0x00, 0x00, 0x00, 0xff, 0x00, 0x00, 0x00],
  [0x08, 0x08, 0x08, 0x08, 0x08, 0x08, 0x08, 0x08],
  [0x80, 0x40, 0x20, 0x10, 0x08, 0x04, 0x02, 0x01],
  [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80],
  [0x08, 0x08, 0x08, 0x08, 0xff, 0x08, 0x08, 0x08],
  [0x81, 0x42, 0x24, 0x18, 0x18, 0x24, 0x42, 0x81],
];

/*
 * The dither (seg1 `2ff8`). A colour's grey -- its red, green and blue a
 * third each -- is taken to a level of 0 to 64 (`3005`-`3009`); four rows
 * of the pattern are the level's group of four (`GROUPS`, seg1 `307f`),
 * laid twice for eight, and a level past its group's start sets one, two
 * or three more pixels (`STEPS`, `305f`). The first of each group of
 * sixteen is a pattern of its own (`EVEN`, `2c34`), or for black and white
 * a brush of one colour.
 */

/** Each group's four rows, every fourth level from nought (seg1 `307f`). */
const GROUPS = [
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

/**
 * For each group, the row and the pixel a level past its start sets
 * (seg1 `305f`): the pixel at the row, and for the second and third steps
 * the pixel four to its right at the row and four rows down (`3043`).
 */
const STEPS: [number, number][] = [
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

/** What the first level of each group of sixteen is (seg1 `305a`): black, the three greys, white. */
const BLACK = 4;
const WHITE_LEVEL = 5;
const EVEN_CODES = [BLACK, 1, 2, 3, WHITE_LEVEL];

/** The patterns of the greys at 16, 32 and 48, a word laid four times (seg1 `2c34`). */
const EVEN: Record<number, [number, number]> = {
  1: [0x88, 0x22],
  2: [0xaa, 0x55],
  3: [0xdd, 0x77],
};

/**
 * A solid brush (seg1 `2bf0`): its colour's white flag, and the dither of
 * its grey -- a brush of one colour flagged for black and white.
 */
function realizeSolid(system: any, colour: number, out: number) {
  const { physical, sum } = physicalOf(colour);
  let flags = (physical >>> 24) & WHITE;
  const grey = Math.floor(sum / 3);
  const level = ((grey >> 1) + (grey & 1)) >> 1;
  const group = level >> 2;
  const rows = [...GROUPS[group], ...GROUPS[group]];
  const step = level & 3;

  if (step) {
    const [row, pixel] = STEPS[group];
    const right = pixel >> 4;

    if (step === 3) {
      rows[row] |= right;
    }

    if (step >= 2) {
      rows[row + 4] |= right;
    }

    rows[row] |= pixel;
  } else if (!(level & 0x0f)) {
    const code = EVEN_CODES[level >> 4];

    if (code === BLACK || code === WHITE_LEVEL) {
      flags |= ONE_COLOUR;
    } else {
      const [even, odd] = EVEN[code];

      for (let at = 0; at < 8; at++) {
        rows[at] = at & 1 ? odd : even;
      }
    }
  }

  rows.forEach((value, at) => write8(system, out, at, value));
  return { kept: SOLID, flags };
}

/**
 * A hatched brush (seg1 `2c68`): the hatch's rows kept after the pattern;
 * the pattern the hatch in the colour against the background where one
 * is white and the other not, else all the background.
 */
function realizeHatched(system: any, input: number, out: number, hatch: number) {
  const fore = physicalOf(read32(system, input, 2)).physical >>> 24;
  const back = physicalOf(read32(system, input, 8)).physical >>> 24;
  const rows = HATCHES[hatch];
  const ground = back & WHITE ? 0xff : 0;

  rows.forEach((value, at) => {
    write8(system, out, SECOND + at, value);
    write8(system, out, at, (fore ^ back) & WHITE ? value ^ ground : ground);
  });

  return { kept: HATCHED, flags: 0 };
}

/**
 * A pattern brush (seg1 `2c3c`): the eight rows of its bitmap's first
 * byte, laid twice, and FFFFh after the first.
 */
function realizePattern(system: any, input: number, out: number) {
  const bitmap = read32(system, input, 2);
  const widthBytes = read16(system, bitmap, 6);
  const bits = read32(system, bitmap, 0x0a);

  for (let row = 0; row < 8; row++) {
    const value = read8(system, bits, row * widthBytes);

    write8(system, out, row, value);
    write8(system, out, SECOND + row, value);
  }

  write16(system, out, PATTERN_END, 0xffff);
  return { kept: PATTERN, flags: 0 };
}

/**
 * A brush turned to its origin (seg1 `2b8e`-`2ba9`, `2cc2`, `2cd9`): both
 * blocks of eight rows, each row turned right by the origin's x and the
 * rows down by its y, but for a hollow brush.
 */
function turnBrush(system: any, out: number, flags: number, x: number, y: number) {
  if ((flags & 0xe0) === 0xe0) {
    return;
  }

  const by = x & 7;
  const down = y & 7;

  for (const at of [0, SECOND]) {
    const rows: number[] = [];

    for (let row = 0; row < 8; row++) {
      const value = read8(system, out, at + row);

      rows.push(((value >> by) | (value << (8 - by))) & 0xff);
    }

    rows.forEach((value, row) => write8(system, out, at + ((row + down) & 7), value));
  }
}

/**
 * A brush (seg1 `2b73`): a style past 3 is solid; a hatch past 5 solid
 * too. Its style word and flags after its pattern.
 */
function realizeBrush(system: any, input: number, out: number, origin: number) {
  const style = read16(system, input, 0);
  let made: { kept: number; flags: number };

  if (style === HOLLOW) {
    made = { kept: HOLLOW, flags: 0xe0 };
  } else if (style === HATCHED && read16(system, input, 6) <= 5) {
    made = realizeHatched(system, input, out, read16(system, input, 6));
  } else if (style === PATTERN) {
    made = realizePattern(system, input, out);
  } else {
    made = realizeSolid(system, read32(system, input, 2), out);
  }

  write16(system, out, BRUSH_STYLE, made.kept);
  write8(system, out, BRUSH_FLAGS, made.flags);
  turnBrush(system, out, made.flags, origin & 0xffff, origin >>> 16);
}

/**
 * A pen (seg1 `2b4e`): its physical colour, then its style -- solid for a
 * pen wider than a pixel or of a style past `PS_NULL`. A null pen's colour
 * is not made: AX nought and DX the routine's offset, as `Brute` left
 * them.
 */
function realizePen(system: any, input: number, out: number) {
  const style = read16(system, input, 0);
  const width = read16(system, input, 2);
  let physical = (REALIZE_OBJECT << 16) >>> 0;
  let kept = style;

  if (style !== 5) {
    kept = width > 1 || style > 5 ? 0 : style;
    physical = physicalOf(read32(system, input, 6)).physical;
  }

  write16(system, out, 0, physical);
  write16(system, out, 2, physical >>> 16);
  write16(system, out, 4, kept);
}

/**
 * `RealizeObject` (seg1 `2b08`): a style below nought answers 1; nought
 * the word before the table of sizes; past 3, nought. With an object to
 * fill, the pen or brush laid out; the answer the object's size.
 */
export function herculesRealizeObject(
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

  return [PEN_SIZE, BRUSH_SIZE, FONT_SIZE][signed - 1];
}

/** What `ExtTextOut` answers where it cannot draw: AX nought, DX 8000h (seg1 `10cc`). */
export const CANNOT = 0x80000000;

/**
 * `ExtTextOut` and `StrBlt` (seg1 `1097`, `108c`) on a memory bitmap: a
 * font must be of version 2.0, its `FONTINFO` at 42h of its segment
 * (`11f8`-`1204`); any other answers 80000000h and draws nothing --
 * **recorded** for a font of 3.0, extent and drawing alike.
 *
 * Not followed: a font of 2.0, which the Hercules draws; WinBox answers it
 * the same.
 */
export function herculesExtTextOut() {
  return CANNOT;
}

/** A font of 2.0's fields (seg1 `30f2`): its `FONTINFO` at 42h, its character table at 76h, four bytes an entry. */
const DF_PIX_WIDTH = 0x56;
const DF_FIRST_CHAR = 0x5f;
const DF_LAST_CHAR = 0x60;
const DF_DEFAULT_CHAR = 0x61;
const TABLE_2 = 0x76;

/**
 * `GetCharWidth` (seg1 `30f2`): each width from the first character to
 * the last, the font read as one of version 2.0 whatever it is -- a font
 * of fixed pitch all its `dfPixWidth`; else each character's entry's width
 * at 76h, four bytes an entry, and a character outside the font the
 * default character's, before the first and past the last alike. No
 * emboldening. 1, or nought for a last before the first.
 */
export function herculesGetCharWidth(
  system: any,
  buffer: number,
  firstAsked: number,
  lastAsked: number,
  font: number
) {
  const segment = (font & 0xffff0000) >>> 0;
  let count = (lastAsked & 0xffff) - (firstAsked & 0xffff);

  if ((count << 16) >> 16 < 0) {
    return 0;
  }

  count++;

  const out: number[] = [];
  const fixed = read16(system, segment, DF_PIX_WIDTH);

  if (fixed) {
    for (let i = 0; i < count; i++) {
      out.push(fixed);
    }
  } else {
    const entry = (index: number) => read16(system, segment, TABLE_2 + index * 4);
    const fallback = entry(read8(system, segment, DF_DEFAULT_CHAR));
    let index = (firstAsked & 0xffff) - read8(system, segment, DF_FIRST_CHAR);

    if (index < 0) {
      const below = Math.min(-index, count);

      for (let i = 0; i < below; i++) {
        out.push(fallback);
      }

      count -= below;
      index = 0;
    }

    const known = read8(system, segment, DF_LAST_CHAR) - index + 1;

    if (known > 0) {
      const read = Math.min(known, count);

      for (let i = 0; i < read; i++) {
        out.push(entry(index + i));
      }

      count -= read;
    }

    for (let i = 0; i < count; i++) {
      out.push(fallback);
    }
  }

  out.forEach((width, i) => write16(system, buffer, i * 2, width));
  return 1;
}

/** Whether the Hercules takes a colour as white, as its `ColorInfo` makes it (seg1 `2bb6`). */
export function herculesWhite(colour: number) {
  return ((physicalOf(colour).physical >>> 24) & WHITE) !== 0;
}

/** The pen styles' masks, taken from bit 7 (seg4 `001a`): solid, dash, dot, dash-dot and dash-dot-dot. */
const HERCULES_STYLE_MASKS = [0xff, 0xe7, 0xaa, 0xe4, 0xea];

/**
 * How far along its style each move takes a line (seg4 `0257`-`026b`):
 * 0Bh across, 10h down and 13h on the diagonal -- the Hercules's pixels
 * taller than wide -- and 26h a bit of the mask (`016a`, `0b4f`).
 */
const ACROSS = 0x0b;
const DOWN = 0x10;
const DIAGONAL = 0x13;
const STRETCH = 0x26;

/**
 * Whether each pixel of a styled polyline is drawn as the Hercules walks
 * its style (seg4 `0b41`): a count from 26h, the move to the next pixel
 * taken off it after each pixel (the run routines from `0975`, each run's
 * pixels by one move and its end by what makes the diagonal); where it has
 * fallen below nought, the mask turned left a bit and 26h added back
 * before the pixel is drawn; the pixel a dash where the mask's top bit is
 * set. The count and the mask go on from one segment into the next.
 * `points` are the pixels in order, `end` the polyline's last point.
 */
export function herculesDashes(points: [number, number][], end: [number, number], style: number) {
  let mask = HERCULES_STYLE_MASKS[style] ?? 0xff;
  let count = STRETCH;

  return points.map(([x, y], index) => {
    if (count < 0) {
      mask = ((mask << 1) | (mask >> 7)) & 0xff;
      count += STRETCH;
    }

    const [nx, ny] = points[index + 1] ?? end;
    const across = nx !== x;
    const down = ny !== y;

    count -= across && down ? DIAGONAL : across ? ACROSS : down ? DOWN : 0;
    return (mask & 0x80) !== 0;
  });
}
