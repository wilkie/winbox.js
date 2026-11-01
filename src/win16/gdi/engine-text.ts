'use strict';

import { GlobalAlloc } from '../kernel/GlobalAlloc.js';
import { GlobalFree } from '../kernel/GlobalFree.js';
import { GlobalLock } from '../kernel/GlobalLock.js';
import { GlobalReAlloc } from '../kernel/GlobalReAlloc.js';
import { GlobalUnlock } from '../kernel/GlobalUnlock.js';
import { DWORD, UINT } from '../types.js';
import { CreatePen } from './CreatePen.js';
import { CreateSolidBrush } from './CreateSolidBrush.js';
import { DeleteObject } from './DeleteObject.js';
import { SelectObject } from './SelectObject.js';
import { GetBkColor, SetBkColor } from './SetBkColor.js';
import { GetTextColor, SetTextColor } from './SetTextColor.js';
import { engineGlyph, setContext, sineOf, widthsOf } from './engine-glyphs.js';
import { blitRects } from './printer-blits.js';
import { keptDeviceFont } from './printer-driver.js';
import { callDriver, drawingOf, drawMode, driverPolygon, onStackBytes } from './printer-output.js';

/**
 * GDI drawing a string of a TrueType font for a printer's driver:
 * `EngineExtTextOut` given a count of nought or more (`GDI.EXE` seg1
 * `669a`, into `6223`). The twin of
 * `crates/winbox-win16/src/gdi/engine_text.rs`; see
 * `kb/gdi/engineexttextout.md`.
 *
 * GDI keeps, for each `FONTINFO` the engine realized, a global block at
 * its 54h: a raster font file of version 3.0 whose glyphs are made by the
 * rasterizer as strings ask for them. That font, its `FONTINFO` at 42h of
 * the block, is what GDI hands back to the driver's own `ExtTextOut`; a
 * turned string's glyphs go to the driver's `BitBlt` one by one instead.
 */

/* The cache block's file header, as GDI lays it (seg3 `2f2a`, `2fd3`). */

/** `dfVersion` of the cache, a `FONTINFO` flagged 80h at 33h; 200h otherwise. */
const VERSION_3 = 0x300;
const VERSION_2 = 0x200;
/** The character table's start and an entry's size, by version. */
const TABLE_3 = 0x94;
const ENTRY_3 = 6;
const TABLE_2 = 0x76;
const ENTRY_2 = 4;
/** Where the `FONTINFO` sits in the file: after the version, size and copyright. */
const FONTINFO_AT = 0x42;
/** Where the size is kept, and where the copyright starts. */
const SIZE_AT = 2;
const COPYRIGHT_AT = 6;
/** The copyright GDI writes in every cache font, with its nought (seg3 `2f86`, 35h bytes). */
const ENGINE_COPYRIGHT = 'MicroSoft (c) 1990 - This is an awesome engine font!';
/** The `FONTINFO`'s bytes copied into the file, `dfType` to `dfWidthBytes` (`3118`). */
const FONTINFO_COPIED = 0x23;
/** `dfPitchAndFamily`, its bit 0 set in the copy (`311d`). */
const DF_PITCH = 0x18;
/** `dfFace`, `dfBitsPointer` and `dfBitsOffset` of a `FONTINFO`. */
const DF_FACE = 0x27;
const DF_BITS_POINTER = 0x2b;
const DF_BITS_OFFSET = 0x2f;
/** The face's name is given room of 20h bytes after the two tables (`2ff6`). */
const NAME_ROOM = 0x20;
/** The first character's width, and its A and C spaces, as the block starts (`3146`, `315c`). */
const FIRST_WIDTH = 8;
const FIRST_SPACES = 0x0800;
/**
 * The glyph area a new block is given: the average glyph's bytes times a
 * number by the size in points, at least 400h (seg3 `2fbb`, `3045`-`3066`).
 */
const GLYPH_AREA_BY_POINTS: [number, number][] = [
  [20, 20],
  [35, 15],
  [60, 10],
  [90, 5],
  [150, 3],
  [0xffff, 1],
];
const LEAST_GLYPH_AREA = 0x400;
/** `GlobalAlloc`'s flags for the block: moveable, zeroed, shared (`3082`). */
const CACHE_ALLOC = 0x2042;

/*
 * What GDI keeps of the block in the `FONTINFO`, past what the engine
 * realized (`30ae`-`30e3`, `3092`-`309f`). Windows writes the last four at
 * 66h to 6Ch of the `FONTINFO`'s segment, its `FONTINFO` at nought of a
 * block of its own.
 */
const FI_BLOCK = 0x54;
const FI_SCRATCH = 0x56;
const FI_SCRATCH_SIZE = 0x58;
const FI_WIDTHS = 0x5a;
const FI_SPACES = 0x5c;
const FI_SIZE = 0x5e;
const FI_GROWTH = 0x62;
const FI_NEXT = 0x66;
const FI_FREE = 0x6a;
const FI_FLAGS = 0x33;

const FLAG_TURNED = 0x10;
const FLAG_OUTLINE = 0x20;
const FLAG_FAILED = 0x40;
const FLAG_BIG = 0x80;

/** A turned glyph's header in the block, before its rows (seg1 `752d`). */
const TURNED_HEADER = 12;

/* The driver's `GDIINFO` and the context's `DRAWMODE`. */
const DP_TEXT = 0x22;
const DP_RASTER = 0x26;
const RC_GDI20_OUTPUT = 0x10;
const RC_OP_DX_OUTPUT = 0x4000;
const TC_EA_DOUBLE = 0x200;
const TEXTXFORM_ACCELERATOR = 0x0f;
const OPAQUE = 2;
const TRANSPARENT = 1;
const ETO_OPAQUE = 2;
const ETO_CLIPPED = 4;

/** The driver's table of entries GDI calls through (the context's 2Eh). */
const BIT_BLT = 1;
const STR_BLT = 11;
const EXT_TEXT_OUT = 14;

/** `PATCOPY`, the raster operation GDI fills a background with. */
const PATCOPY = 0x00f00021;
const PS_NULL = 5;

/**
 * The raster operation a turned glyph is drawn with, by the context's
 * `ROP2` less one (seg8 `020b`): the pattern -- a brush of the text colour
 * -- through the glyph, the destination kept where it is clear.
 */
const GLYPH_ROPS = [
  0x00220326, 0x00c806c9, 0x002a0c49, 0x002e064a, 0x00620786, 0x00660046, 0x006a01e9, 0x006e1e28,
  0x00a20e09, 0x00a60706, 0x00aa0029, 0x00ae0b06, 0x00e20746, 0x00e61ce8, 0x00ea02e9, 0x00ee0086,
];

function core(system: any) {
  return system.machine.cpu.core;
}

function at(far: number, offset: number) {
  return ((far & 0xffff) + offset) & 0xffff;
}

function read8(system: any, far: number, offset: number) {
  return core(system).read8(far >>> 16, at(far, offset));
}

function read16(system: any, far: number, offset: number) {
  return core(system).read16(far >>> 16, at(far, offset)) & 0xffff;
}

function signed16(value: number) {
  return (value << 16) >> 16;
}

function write8(system: any, far: number, offset: number, value: number) {
  core(system).write8(far >>> 16, at(far, offset), value & 0xff);
}

function write16(system: any, far: number, offset: number, value: number) {
  core(system).write16(far >>> 16, at(far, offset), value & 0xffff);
}

function read32(system: any, far: number, offset: number) {
  return (read16(system, far, offset) | (read16(system, far, offset + 2) << 16)) >>> 0;
}

function write32(system: any, far: number, offset: number, value: number) {
  write16(system, far, offset, value);
  write16(system, far, offset + 2, value >>> 16);
}

/** The cache's layout for a `FONTINFO` (seg3 `2f2a`). */
function layoutOf(system: any, font: number) {
  const big = Boolean(read8(system, font, FI_FLAGS) & FLAG_BIG);

  return {
    version: big ? VERSION_3 : VERSION_2,
    table: big ? TABLE_3 : TABLE_2,
    entry: big ? ENTRY_3 : ENTRY_2,
    first: read8(system, font, 0x1d),
    last: read8(system, font, 0x1e),
  };
}

/**
 * The cache block made for a `FONTINFO` (seg3 `2f5e`, into `2fd3`): the
 * widths filled flags cleared (`2f55`); the character table for its
 * characters and one more, a word of each character's width after it, a
 * word of its A and C spaces after that, 20h bytes for the face's name,
 * and the rasterizer's scratch -- the widest glyph's bytes a row, less its
 * last two bits and with 3Fh more, times the cell, none for a turned font
 * -- before the glyphs. The block is that much and the glyph area more
 * (`GLYPH_AREA_BY_POINTS`), its file header the `FONTINFO`'s first 23h
 * bytes, the face named, and the first character's glyph the scratch.
 * The block's handle, or nought.
 */
function makeBlock(system: any, font: number) {
  const layout = layoutOf(system, font);

  write8(system, font, FI_FLAGS, read8(system, font, FI_FLAGS) & ~3);

  const count = layout.last - layout.first + 1;
  const widths = (count + 1) * layout.entry + layout.table;
  const spaces = widths + count * 2;
  const name = spaces + count * 2;
  const scratch = name + NAME_ROOM;
  const flags = read8(system, font, FI_FLAGS);
  const cell = read16(system, font, 0x16);
  let scratchSize = 0;
  let area = LEAST_GLYPH_AREA;

  if (!(flags & FLAG_OUTLINE)) {
    if (!(flags & FLAG_TURNED)) {
      scratchSize = (((read16(system, font, 0x1b) + 0x3f) >> 3) & 0xfc) * cell;
    }

    const glyph = ((read16(system, font, 0x19) + 7) >> 3) * cell;
    const points = read16(system, font, 2);
    const times = GLYPH_AREA_BY_POINTS.find(([below]) => points < below)?.[1] ?? 1;

    area = Math.max(glyph * times, LEAST_GLYPH_AREA);
  }

  const bits = scratch + scratchSize;
  let size = area + bits;

  if (size > 0xffff && layout.version < VERSION_3) {
    size = 0xffff;
  }

  write16(system, font, FI_NEXT, bits);
  write16(system, font, FI_NEXT + 2, 0);
  write32(system, font, FI_FREE, size - bits);

  const handle = GlobalAlloc.call(system, CACHE_ALLOC, size) & 0xffff;

  if (!handle) {
    return 0;
  }

  write16(system, font, FI_BLOCK, handle);
  write16(system, font, FI_SCRATCH, scratch);
  write16(system, font, FI_SCRATCH_SIZE, scratchSize);
  write16(system, font, FI_WIDTHS, widths);
  write16(system, font, FI_SPACES, spaces);
  write32(system, font, FI_SIZE, size);
  write32(system, font, FI_GROWTH, area);

  const file = GlobalLock.call(system, handle) >>> 0;

  write16(system, file, 0, layout.version);
  write32(system, file, SIZE_AT, size);

  for (let index = 0; index <= ENGINE_COPYRIGHT.length; index++) {
    write8(system, file, COPYRIGHT_AT + index, ENGINE_COPYRIGHT.charCodeAt(index) || 0);
  }

  for (let index = 0; index < FONTINFO_COPIED; index++) {
    write8(system, file, FONTINFO_AT + index, read8(system, font, index));
  }

  write8(system, file, FONTINFO_AT + DF_PITCH, read8(system, file, FONTINFO_AT + DF_PITCH) | 1);
  write16(system, file, FONTINFO_AT + DF_FACE, name);

  const face = read16(system, font, DF_FACE);

  for (let index = 0; ; index++) {
    const code = core(system).read8(font >>> 16, (face + index) & 0xffff);

    write8(system, file, name + index, code);

    if (!code) {
      break;
    }
  }

  write16(system, file, FONTINFO_AT + DF_BITS_OFFSET, bits);
  write16(system, file, widths, FIRST_WIDTH);

  /* The entry past the last, and the first character's: a width of 8 and
   * the scratch for a glyph. */
  write16(system, file, widths - layout.entry, FIRST_WIDTH);
  write16(system, file, widths - layout.entry + 2, scratch);
  write16(system, file, layout.table, FIRST_WIDTH);
  write16(system, file, layout.table + 2, scratch);
  write16(system, file, spaces, FIRST_SPACES);

  return handle;
}

/**
 * The block made again where it was discarded or never made (seg1
 * `6748`): its handle, or nought.
 */
export function readyBlock(system: any, font: number) {
  const handle = read16(system, font, FI_BLOCK);

  if (handle) {
    return handle;
  }

  const made = makeBlock(system, font);

  if (made) {
    GlobalUnlock.call(system, made);
  }

  return made;
}

/** A glyph as the engine's context makes it, its bitmap a row a line. */
interface Glyph {
  width: number;
  height: number;
  originX: number;
  originY: number;
  advanceX: number;
  rows: number[][];
}

/**
 * The block grown by its glyph area where a glyph does not fit (seg1
 * `71a6`): past 64K only for a font of version 3.0. The block's segment,
 * or nought.
 */
function grow(system: any, font: number) {
  const handle = read16(system, font, FI_BLOCK);

  GlobalUnlock.call(system, handle);

  const growth = read32(system, font, FI_GROWTH);
  const size = read32(system, font, FI_SIZE) + growth;

  if (size > 0xffff && !(read8(system, font, FI_FLAGS) & FLAG_BIG)) {
    GlobalLock.call(system, handle);
    return 0;
  }

  const moved = GlobalReAlloc.call(system, handle, size, CACHE_ALLOC) & 0xffff;

  if (!moved) {
    GlobalLock.call(system, handle);
    return 0;
  }

  write16(system, font, FI_BLOCK, moved);
  write32(system, font, FI_SIZE, size);
  write32(system, font, FI_FREE, read32(system, font, FI_FREE) + growth);
  return GlobalLock.call(system, moved) >>> 16;
}

/**
 * A character's glyph made into the cache (seg1 `7222`): the engine's
 * context set to the font at its angle, once a string (`74d7`), and the
 * glyph asked of it. Upright, the character's entry has the glyph's width,
 * one at least, and the glyph's place, its bytes laid a column of the cell
 * at a time, the glyph's top row at the ascent less its top, what falls
 * outside the cell left off; its width the advance, its A space the
 * glyph's left and its C space what the advance leaves past it (`7300`).
 * Turned, the entry has the width and the place of the glyph as the
 * rasterizer made it, a row a line in doublewords, after 12 bytes of its
 * width, height and corner (`752d`). The block's segment, nought where the
 * block cannot grow, -1 where the rasterizer fails.
 */
function makeGlyph(
  system: any,
  font: number,
  segment: number,
  index: number,
  code: number,
  angle: number
): number {
  const turned = Boolean(read8(system, font, FI_FLAGS) & FLAG_TURNED);
  const glyph: Glyph | null = engineGlyph(system, code, angle);

  if (!glyph) {
    return -1;
  }

  const cell = read16(system, font, 0x16);
  const columns = turned
    ? ((glyph.width + 0x1f) & ~0x1f) >> 3
    : (Math.max(glyph.width, 1) + 7) >> 3;
  const size = turned ? columns * glyph.height + TURNED_HEADER : columns * cell;

  while (read32(system, font, FI_FREE) < size) {
    segment = grow(system, font);

    if (!segment) {
      return 0;
    }
  }

  const layout = layoutOf(system, font);
  const file = (segment << 16) >>> 0;
  const entry = layout.table + index * layout.entry;
  const place = read16(system, font, FI_NEXT);

  write32(system, font, FI_FREE, read32(system, font, FI_FREE) - size);
  write32(system, font, FI_NEXT, read32(system, font, FI_NEXT) + size);
  write16(system, file, entry, turned ? glyph.width : Math.max(glyph.width, 1));
  write16(system, file, entry + 2, place);

  if (layout.entry === ENTRY_3) {
    write16(system, file, entry + 4, 0);
  }

  const bit = (row: number, column: number) => glyph.rows[row]?.[column] ?? 0;
  const byteOf = (row: number, column: number) => {
    let value = 0;

    for (let step = 0; step < 8; step++) {
      value = (value << 1) | bit(row, column * 8 + step);
    }

    return value;
  };

  if (turned) {
    [glyph.width, glyph.height, glyph.originX, glyph.originY, 0, 0].forEach((value, step) =>
      write16(system, file, place + step * 2, value)
    );

    for (let row = 0; row < glyph.height; row++) {
      for (let column = 0; column < columns; column++) {
        write8(system, file, place + TURNED_HEADER + row * columns + column, byteOf(row, column));
      }
    }

    return segment;
  }

  const widths = read16(system, font, FI_WIDTHS) + index * 2;
  const spaces = read16(system, font, FI_SPACES) + index * 2;

  write16(system, file, widths, glyph.advanceX);
  write8(system, file, spaces, glyph.originX);
  write8(system, file, spaces + 1, glyph.advanceX - glyph.originX - glyph.width);

  const top = read16(system, font, 8) - glyph.originY;

  for (let column = 0; column < columns; column++) {
    for (let line = 0; line < cell; line++) {
      const row = line - top;

      write8(system, file, place + column * cell + line, row >= 0 ? byteOf(row, column) : 0);
    }
  }

  return segment;
}

/**
 * The string's glyphs made ready in the cache (seg1 `7010`): each
 * character's entry -- one outside the font the default's, the second --
 * found, and where it has no glyph one made (`70b3`). A block that cannot
 * grow is made again once and the rest of the string made into it
 * (`70c7`); a glyph the rasterizer fails is the default's, made where it
 * must be, with TrueType on (`70ec`). Then the file's `dfBitsPointer` set
 * from its `dfBitsOffset`, and the font answered as the block and 42h
 * (`7187`); nought for a `FONTINFO` that failed or no block.
 */
function readyGlyphs(system: any, font: number, string: number, count: number) {
  if (read8(system, font, FI_FLAGS) & FLAG_FAILED) {
    return 0;
  }

  let segment = GlobalLock.call(system, read16(system, font, FI_BLOCK)) >>> 16;

  if (!segment) {
    return 0;
  }

  const angle = read16(system, font, 0x48);
  const layout = layoutOf(system, font);
  const span = (layout.last - layout.first) & 0xff;
  const entryOf = (index: number) => layout.table + index * layout.entry;
  const has = (index: number) => {
    const file = (segment << 16) >>> 0;

    return (
      read16(system, file, entryOf(index) + 2) !== 0 ||
      (layout.entry === ENTRY_3 && read16(system, file, entryOf(index) + 4) !== 0)
    );
  };
  let contextSet = false;
  let remade = false;
  const make = (index: number, code: number) => {
    if (!contextSet) {
      contextSet = true;

      if (setContext(system, font, angle) === 0xffffffff) {
        return -1;
      }
    }

    return makeGlyph(system, font, segment, index, code, angle);
  };

  for (let step = 0; step < count; step++) {
    const code = read8(system, string, step);
    let index = (code - layout.first) & 0xff;
    let character = code;

    if (index > span) {
      index = 1;
      character = 0;
    }

    if (has(index)) {
      continue;
    }

    let made = make(index, character);

    if (made === 0) {
      if (remade) {
        break;
      }

      /* The block thrown away and made again (`71fd`). */
      remade = true;
      GlobalUnlock.call(system, read16(system, font, FI_BLOCK));
      GlobalFree.call(system, read16(system, font, FI_BLOCK));
      write16(system, font, FI_BLOCK, 0);

      const handle = makeBlock(system, font);

      if (!handle) {
        return 0;
      }

      segment = GlobalLock.call(system, handle) >>> 16;
      step--;
      continue;
    }

    if (made === -1) {
      if (!system.fonts || system.fonts.trueTypeOff) {
        GlobalUnlock.call(system, read16(system, font, FI_BLOCK));
        return 0;
      }

      /* The default's glyph, made where it has none, copied to this one. */
      const fallback = read8(system, (segment << 16) >>> 0, FONTINFO_AT + 0x1f);

      if (!has(fallback)) {
        made = make(fallback, 0);

        if (made <= 0) {
          break;
        }

        segment = made;
      }

      const file = (segment << 16) >>> 0;

      for (let offset = 0; offset < layout.entry; offset += 2) {
        write16(
          system,
          file,
          entryOf(index) + offset,
          read16(system, file, entryOf(fallback) + offset)
        );
      }

      const spaces = read16(system, font, FI_SPACES);
      const widths = read16(system, font, FI_WIDTHS);

      write16(system, file, spaces + index * 2, read16(system, file, spaces + fallback * 2));
      write16(system, file, widths + index * 2, read16(system, file, widths + fallback * 2));
      continue;
    }

    segment = made;
  }

  const file = (segment << 16) >>> 0;

  write16(
    system,
    file,
    FONTINFO_AT + DF_BITS_POINTER,
    read16(system, file, FONTINFO_AT + DF_BITS_OFFSET)
  );
  write16(system, file, FONTINFO_AT + DF_BITS_POINTER + 2, segment);
  return (file | FONTINFO_AT) >>> 0;
}

/** The context's `DRAWMODE` fields `textWidths` reads. */
interface Justification {
  breakExtra: number;
  breakErr: number;
  breakRem: number;
  breakCount: number;
  totalBreak: number;
  charExtra: number;
}

/**
 * Each character's width as GDI spaces a string (seg1 `6874`): a font of
 * fixed pitch with nothing more its pitch; the widths given, where there
 * is nothing else; the cache's widths with the character extra -- and a
 * pixel more where the font asks for a bold the device makes
 * (`TC_EA_DOUBLE` in both, `6b73`) -- where there are no widths, breaks or
 * negative spacing; else each character's own (`6ba7`): the extra, a
 * break's share of the justification -- its remainder spread by the error
 * term, which is kept in the context -- and the width given in place of
 * the cache's, a width brought up to nought but the last. Upright, each
 * width then moves the next glyph by the difference of their A spaces
 * (`6986`), and the first and the last A spaces are answered; turned, the
 * count given negative, they are not.
 */
function textWidths(
  system: any,
  font: number,
  file: number,
  string: number,
  count: number,
  turned: boolean,
  given: number,
  justification: Justification,
  bold: number,
  widthOf: (code: number) => number
) {
  const pitch = read16(system, font, 0x14);
  const first = read8(system, font, 0x1d);
  const span = (read8(system, font, 0x1e) - first) & 0xff;
  const fallback = read8(system, font, 0x1f);
  const breakIndex = read8(system, font, 0x20);
  const indexOf = (code: number) => {
    const index = (code - first) & 0xff;

    return index > span ? fallback : index;
  };
  const codes = Array.from({ length: count }, (_, step) => read8(system, string, step));
  const givenWidth = (step: number) => signed16(read16(system, given, step * 2));
  const extra = justification.charExtra + bold;
  let flags = given >>> 16 ? 0x20 : 0;

  if (justification.totalBreak) {
    flags |= justification.breakExtra ? 0x08 : 0;
    flags |= justification.breakRem ? 0x04 : 0;
  }

  if ((justification.totalBreak | justification.charExtra) & 0x8000) {
    flags |= 0x10;
  }

  flags |= justification.charExtra ? 0x02 : 0;
  flags |= pitch ? 0x40 : 0;

  let widths: number[];

  if (!((flags ^ 0x40) & 0x7e)) {
    widths = codes.map(() => pitch);
  } else if ((flags & 0x3e) === 0x20) {
    widths = codes.map((_, step) => givenWidth(step));
  } else if (!(flags & 0x3c)) {
    widths = codes.map((code) => widthOf(indexOf(code)) + extra);
  } else {
    let err = signed16(justification.breakErr);

    widths = codes.map((code, step) => {
      const index = indexOf(code);
      const width = widthOf(index);
      let more = extra;

      if (index === breakIndex && flags & 0x0c) {
        more += justification.breakExtra;

        if (flags & 0x04) {
          const rem = signed16(justification.breakRem);

          if (rem >= 0) {
            err -= rem;

            if (err <= 0) {
              err += justification.breakCount;
              more++;
            }
          } else {
            err += rem;

            if (err <= 0) {
              err += justification.breakCount;
              more--;
            }
          }
        }
      }

      if (flags & 0x20) {
        more += givenWidth(step) - width;
      }

      if (more < 0 && step < count - 1) {
        more = Math.max(more, -width);
      }

      return width + more;
    });
    justification.breakErr = err & 0xffff;
  }

  let firstSpace = 0;
  let lastSpace = 0;

  if (!turned && count) {
    const spaces = read16(system, font, FI_SPACES);
    const space = (code: number) => (read8(system, file, spaces + indexOf(code) * 2) << 24) >> 24;

    let before = space(codes[0]);

    firstSpace = before;

    for (let step = 1; step < count; step++) {
      const next = space(codes[step]);

      widths[step - 1] = (widths[step - 1] - before + next) & 0xffff;
      before = next;
      lastSpace = next;
    }
  }

  return { widths: widths.map((width) => width & 0xffff), firstSpace, lastSpace };
}

/** What `drawEngineText` is given: `EngineExtTextOut`'s arguments. */
export interface EngineTextArgs {
  hdc: number;
  device: number;
  x: number;
  y: number;
  clip: number;
  string: number;
  count: number;
  font: number;
  drawMode: number;
  xform: number;
  widths: number;
  opaque: number;
  options: number;
  /** The context itself, where GDI draws for it without the driver. */
  surface?: any;
}

/**
 * The string drawn (seg1 `669a`, `6223`). GDI first makes the given
 * `FONTINFO`'s block where it has none, nought answered where it cannot;
 * then sets the context's device, its word 2Ah, to the one given while it
 * draws, and puts it back -- and answers it, the context's device as it
 * was, whatever the drawing came to (`66d4`-`6740`), which is DX 2927h,
 * AX nought in every record: the `PDEVICE`'s selector.
 *
 * The drawing, with the context's own realized `FONTINFO` (its 3Ah): none
 * with TrueType off or a font flagged 40h. The string's glyphs made ready
 * in the cache (`readyGlyphs`); each character's width (`textWidths`) into
 * GDI's copy of the `DRAWMODE`, its justification and character extra
 * nought (`6342`-`635d`). With a `dpRaster` of `RC_GDI20_OUTPUT` (an
 * outline font's taken off), the driver's own `ExtTextOut` is called back
 * (`65be`-`663a`) with the device, the place, the clip and the string as
 * given, the cache's font, GDI's `DRAWMODE`, the `TEXTXFORM`, and by the
 * call: the count or nought, GDI's widths or none, the opaque rectangle
 * given or the text's own box, and the options, the given with or without
 * `ETO_OPAQUE` or 6:
 *
 * * No characters: one call with what was given.
 * * An opaque background, upright: with `RC_OP_DX_OUTPUT` one call, the
 *   text's box the opaque rectangle and `ETO_OPAQUE` the options. Else,
 *   for `ETO_OPAQUE` and a rectangle, a call of nought characters filling
 *   it, the options 6 (`6521`); where it does not hold the text's box, a
 *   call of nought characters filling the box, cut to the rectangle for
 *   `ETO_CLIPPED` (`6548`); then the string, the background transparent
 *   and `ETO_OPAQUE` taken off.
 * * Otherwise the string once, transparent, the options as given.
 *
 * The string starts at the first glyph's A space past the place
 * (`6565`). A turned font goes glyph by glyph (`turnedGlyphs`), on an
 * opaque background first filled as a polygon of the turned box
 * (`turnedGround`, `63ea`-`64be`). A driver without `RC_GDI20_OUTPUT` is
 * given each call through `byStrBlt` instead of its `ExtTextOut` (seg8
 * `00e4`). The driver's answers are not kept.
 *
 * Not followed: the count cut to what GDI's stack holds (`62a5`), which
 * hangs on how deep GDI's own frames are; the context's flag 40h at 0Bh,
 * which counts the string turned, and which only a context of the display
 * has (`CreateDC`, seg1 `0249`-`024f`); and the `DRAWMODE` GDI hands on for
 * no characters, which is what its stack held.
 */
export async function drawEngineText(system: any, args: EngineTextArgs) {
  const surface = args.surface ?? system.handles.resolve(args.hdc);
  const pdevice = surface?.driverDevice ?? null;
  const answer = pdevice ? pdevice.lpPDevice >>> 0 : 0;

  if (!readyBlock(system, args.font)) {
    return 0;
  }

  const font = keptDeviceFont(system, surface)?.kept?.realized.far ?? args.font;

  if (!system.fonts || system.fonts.trueTypeOff || !pdevice) {
    return answer;
  }

  const flags = read8(system, font, FI_FLAGS);

  if (flags & FLAG_FAILED) {
    return answer;
  }

  const info: Uint8Array = pdevice.info;
  const capsWord = (offset: number) => info[offset] | (info[offset + 1] << 8);
  let raster = capsWord(DP_RASTER);
  const turned = Boolean(flags & FLAG_TURNED);
  const outline = Boolean(flags & FLAG_OUTLINE);

  if (outline) {
    raster &= ~(RC_GDI20_OUTPUT | RC_OP_DX_OUTPUT);
  }

  /* A font GDI draws as an outline itself (seg8 `01a4`, into `042a`),
   * which no font WinBox realizes is. */
  if (outline) {
    return answer;
  }

  const count = signed16(args.count);
  const cacheFont = readyGlyphs(system, font, args.string, count);
  const handle = read16(system, font, FI_BLOCK);

  if (!cacheFont) {
    return answer;
  }

  try {
    await drawString(system, surface, args, font, cacheFont, raster, turned && !outline, count);
  } finally {
    GlobalUnlock.call(system, handle);
  }

  return answer;
}

async function drawString(
  system: any,
  surface: any,
  args: EngineTextArgs,
  font: number,
  cacheFont: number,
  raster: number,
  turned: boolean,
  count: number
) {
  const pdevice = surface.driverDevice;
  const file = (cacheFont & 0xffff0000) >>> 0;
  const mode = drawMode(system, surface);
  const realizedXform = keptDeviceFont(system, surface)?.kept?.realized.xform;
  const accelerator = realizedXform
    ? realizedXform[TEXTXFORM_ACCELERATOR] | (realizedXform[TEXTXFORM_ACCELERATOR + 1] << 8)
    : 0;
  const dpText = pdevice.info[DP_TEXT] | (pdevice.info[DP_TEXT + 1] << 8);
  const bold = accelerator & TC_EA_DOUBLE && dpText & TC_EA_DOUBLE ? 1 : 0;
  const justified = surface.justification;
  const justification: Justification = {
    breakExtra: read16(system, mode, 0x0e),
    breakErr: read16(system, mode, 0x10),
    breakRem: read16(system, mode, 0x12),
    breakCount: read16(system, mode, 0x14),
    totalBreak: read16(system, mode, 0x0c),
    charExtra: signed16(read16(system, mode, 0x16)),
  };
  const widthsTable = read16(system, font, FI_WIDTHS);
  const filled = turned ? widthsOf(system, font) : null;
  const firstCode = read8(system, font, 0x1d);
  const widthOf = turned
    ? (index: number) => filled?.(firstCode + index) ?? 0
    : (index: number) => read16(system, file, widthsTable + index * 2);
  const spaced = count
    ? textWidths(
        system,
        font,
        file,
        args.string,
        count,
        turned,
        args.widths >>> 0,
        justification,
        bold,
        widthOf
      )
    : { widths: [], firstSpace: 0, lastSpace: 0 };

  if (justified && spaced.widths.length) {
    justified.err = signed16(justification.breakErr);
  }

  /* GDI's copy of the `DRAWMODE`: its first 12 bytes, its justification
   * and character extra nought, its logical colours (`6342`). */
  const given = args.drawMode >>> 0;
  const modeBytes = new Uint8Array(0x20);

  for (let offset = 0; offset < 0x20; offset++) {
    modeBytes[offset] = offset < 0x0c || offset >= 0x18 ? read8(system, given, offset) : 0;
  }

  const bkMode = modeBytes[2] | (modeBytes[3] << 8);
  const cell = read16(system, font, 0x16);
  const x = signed16(args.x);
  const y = signed16(args.y);
  let options = args.options & 0xffff;
  const opaque = args.opaque >>> 0;
  let opaqueIsBox = false;
  let box: [number, number, number, number] | null = null;
  let state = 2;
  let shift = spaced.firstSpace;
  const calls: number[] = [];
  const plan = { transparent: false, ground: false };

  if (!count) {
    shift = 0;
    calls.push(0xc2);
  } else if (bkMode === OPAQUE) {
    if (!turned && raster & RC_OP_DX_OUTPUT && options & (ETO_OPAQUE | ETO_CLIPPED)) {
      calls.push(0xca);
    } else if (!turned) {
      state = 1;

      let extent = spaced.firstSpace - spaced.lastSpace;

      for (const width of spaced.widths) {
        extent += signed16(width);
      }

      if (extent > 0x7fff || extent + x > 0x7fff) {
        extent = 0x7fff - x;
      }

      box = [x, y, x + extent, y + cell];

      if (raster & RC_OP_DX_OUTPUT) {
        opaqueIsBox = true;
        options = ETO_OPAQUE;
        calls.push(0xca);
      } else {
        if (options & ETO_OPAQUE && opaque >>> 16) {
          const [l, t, r, b] = [0, 2, 4, 6].map((offset) =>
            signed16(read16(system, opaque, offset))
          );

          if (l <= box[0] && t <= box[1] && r >= box[2] && b >= box[3]) {
            state = 0;
          }

          calls.push(state | 0x80);
        }

        if (state & 1) {
          let empty = false;

          if (options & ETO_CLIPPED && opaque >>> 16) {
            const [l, t, r, b] = [0, 2, 4, 6].map((offset) =>
              signed16(read16(system, opaque, offset))
            );
            const cut: [number, number, number, number] = [
              Math.max(box[0], l),
              Math.max(box[1], t),
              Math.min(box[2], r),
              Math.min(box[3], b),
            ];

            empty = cut[0] >= cut[2] || cut[1] >= cut[3];

            if (!empty) {
              box = cut;
            }
          }

          if (!empty) {
            calls.push(state);
          }
        }

        plan.transparent = true;
      }
    } else {
      plan.transparent = true;
      plan.ground = true;
    }
  } else {
    plan.transparent = true;
  }

  if (plan.ground) {
    await turnedGround(system, surface, args, font, spaced, options, opaque);
  }

  /* A driver without `RC_GDI20_OUTPUT` has each call made through its
   * `StrBlt` (`62e1`-`62f2`: the procedure at `621f` rather than `6221`). */
  if (!(raster & RC_GDI20_OUTPUT)) {
    const strings = { device: args.device >>> 0, cacheFont, modeBytes, spaced, font, options };

    for (const call of calls) {
      await byStrBlt(system, surface, args, strings, call, box, x + (call === 0xc2 ? shift : 0));
    }

    if (plan.transparent && turned) {
      await turnedGlyphs(system, surface, args, font, file, spaced.widths, modeBytes);
    } else if (plan.transparent) {
      modeBytes[2] = TRANSPARENT;
      modeBytes[3] = 0;
      await byStrBlt(system, surface, args, strings, state | 0xf8, box, x + shift);
    }

    return;
  }

  const procedure = pdevice.driver.procs[EXT_TEXT_OUT - 1] ?? 0;
  const widthBytes = new Uint8Array(spaced.widths.length * 2);

  spaced.widths.forEach((width, step) => {
    widthBytes[step * 2] = width & 0xff;
    widthBytes[step * 2 + 1] = width >> 8;
  });

  const boxBytes = new Uint8Array(8);
  const callBack = async (call: number, xAt: number) => {
    const local = box ?? [0, 0, 0, 0];

    local.forEach((value, step) => {
      boxBytes[step * 2] = value & 0xff;
      boxBytes[step * 2 + 1] = (value >> 8) & 0xff;
    });

    const stack = new Uint8Array([...modeBytes, ...widthBytes, ...boxBytes]);

    await onStackBytes(system, stack, async (far) => {
      const modeFar = far;
      const widthsFar = (far + 0x20) >>> 0;
      const boxFar = (far + 0x20 + widthBytes.length) >>> 0;
      const opaqueArg = call & 0x80 && !opaqueIsBox ? opaque : boxFar;
      const optionsArg = call & 0x02 ? options : call & 0x10 ? options & ~ETO_OPAQUE & 0xffff : 6;

      if (!procedure) {
        return 0;
      }

      return callDriver(system, procedure, [
        [args.device >>> 0, DWORD],
        [xAt & 0xffff, UINT],
        [y & 0xffff, UINT],
        [args.clip >>> 0, DWORD],
        [args.string >>> 0, DWORD],
        [call & 0x40 ? count & 0xffff : 0, UINT],
        [cacheFont >>> 0, DWORD],
        [modeFar >>> 0, DWORD],
        [args.xform >>> 0, DWORD],
        [call & 0x08 && widthBytes.length ? widthsFar : 0, DWORD],
        [opaqueArg >>> 0, DWORD],
        [optionsArg & 0xffff, UINT],
      ]);
    });
  };

  for (const call of calls) {
    /* The single calls (`6565`) start at the first glyph's A space. */
    const single = call === 0xc2 || call === 0xca;

    await callBack(call, single ? x + shift : x);
  }

  if (!plan.transparent) {
    return;
  }

  if (turned) {
    await turnedGlyphs(system, surface, args, font, file, spaced.widths, modeBytes);
    return;
  }

  modeBytes[2] = TRANSPARENT;
  modeBytes[3] = 0;
  await callBack(state | 0xf8, x + shift);
}

/**
 * A brush of the context's background colour selected (seg8 `0023`-`0061`),
 * and with `pen` a null pen (`0004`-`001b`), for `body`; then both put back
 * and deleted (seg1 `6585`).
 */
async function withGround(system: any, hdc: number, pen: boolean, body: () => Promise<void>) {
  const brush = CreateSolidBrush.call(system, GetBkColor.call(system, hdc));
  const oldBrush = await SelectObject.call(system, hdc, brush);
  const nullPen = pen ? CreatePen.call(system, PS_NULL, 0, 0) : 0;
  const oldPen = pen ? await SelectObject.call(system, hdc, nullPen) : 0;

  try {
    await body();
  } finally {
    await SelectObject.call(system, hdc, oldBrush);
    await DeleteObject.call(system, brush);

    if (pen) {
      await SelectObject.call(system, hdc, oldPen);
      await DeleteObject.call(system, nullPen);
    }
  }
}

/**
 * A turned string's opaque background (seg1 `63ea`-`64be`): with a brush of
 * the background colour and a null pen, a polygon of the turned box filled
 * through GDI's own `Polygon` in the device's terms, `WINDING` (seg24
 * `0396`) -- the place, carried along the baseline by the string's extent
 * (its widths and its two A spaces, past 7FFFh cut to 7FFFh less the place,
 * `63bd`-`63d5`) and down by the font's cell, each carry through GDI's own
 * sines (seg33) with the resolutions' ratio taken across (`625b`); then,
 * with options and an opaque rectangle given, the rectangle filled with
 * `PATCOPY` through the driver's `BitBlt` for each of the clip's
 * rectangles within it (`2ef2`).
 *
 * **Recorded** by `prttx2`: Arial at an em of 24 turned 90 degrees, `Ab` at
 * 30,40 is the polygon 30,40 30,11 57,11 57,40, `OS_WINDPOLYGON`; at 30
 * degrees 30,40 55,25 69,48 44,63.
 */
async function turnedGround(
  system: any,
  surface: any,
  args: EngineTextArgs,
  font: number,
  spaced: { widths: number[]; firstSpace: number; lastSpace: number },
  options: number,
  opaque: number
) {
  const x = signed16(args.x);
  const y = signed16(args.y);
  const resY = read16(system, font, 4);
  const resX = read16(system, font, 6);
  const across = Math.floor((0x100 * resX + (resY >> 1)) / resY) & 0xffff;
  const down = Math.floor((0x100 * resY + (resX >> 1)) / resX) & 0xffff;
  const angle = read16(system, font, 0x48);
  const cell = signed16(read16(system, font, 0x16));
  const scaled = (value: number, ratio: number) =>
    signed16(Math.floor((signed16(value) * ratio) / 0x100) & 0xffff);
  let extent = spaced.firstSpace - spaced.lastSpace;

  for (const width of spaced.widths) {
    extent += signed16(width);
  }

  if (extent > 0x7fff || extent + x > 0x7fff) {
    extent = 0x7fff - x;
  }

  const alongX = x + sineOf(extent, angle, true);
  const alongY = y - sineOf(scaled(extent, down), angle, false);
  const acrossX = sineOf(scaled(cell, across), angle, false);
  const acrossY = sineOf(cell, angle, true);

  await withGround(system, args.hdc, true, async () => {
    await driverPolygon(
      system,
      surface,
      [
        [x, y],
        [alongX, alongY],
        [alongX + acrossX, alongY + acrossY],
        [x + acrossX, y + acrossY],
      ],
      { winding: true }
    );

    if (options && opaque >>> 16) {
      const [l, t, r, b] = [0, 2, 4, 6].map((offset) => signed16(read16(system, opaque, offset)));

      await fillRects(
        system,
        surface,
        args.device >>> 0,
        blitRects(surface, [l, t, r, b], true, true)
      );
    }
  });
}

/** The driver's `BitBlt` filling each rectangle with `PATCOPY`, no source. */
async function fillRects(system: any, surface: any, device: number, rects: number[][]) {
  const procedure = surface.driverDevice.driver.procs[BIT_BLT - 1] ?? 0;

  if (!procedure) {
    return;
  }

  for (const rect of rects) {
    await callDriver(system, procedure, [
      [device, DWORD],
      [rect[0] & 0xffff, UINT],
      [rect[1] & 0xffff, UINT],
      [0, DWORD],
      [0, UINT],
      [0, UINT],
      [(rect[2] - rect[0]) & 0xffff, UINT],
      [(rect[3] - rect[1]) & 0xffff, UINT],
      [PATCOPY, DWORD],
      [drawingOf(surface).brush?.far ?? 0, DWORD],
      [drawMode(system, surface), DWORD],
    ]);
  }
}

/** What `byStrBlt` draws with, the same for each call of a string. */
interface Strings {
  device: number;
  cacheFont: number;
  modeBytes: Uint8Array;
  spaced: { widths: number[]; firstSpace: number; lastSpace: number };
  font: number;
  options: number;
}

/**
 * One of the calls `drawString` plans, for a driver without
 * `RC_GDI20_OUTPUT` (seg8 `00e4`-`020a`), `call` its flag byte:
 *
 * * A call of no string (its bits 78h not all set) fills: the opaque
 *   rectangle given where bit 80h is set, else the text's box, cut to the
 *   clip (`663e`), with `PATCOPY` through the driver's `BitBlt`, a brush of
 *   the background colour selected (`0065`-`00c8`).
 * * The string's call fills the opaque rectangle the same way where
 *   `ETO_OPAQUE` is among the options (`00fa`); cuts the clip to the
 *   rectangle for `ETO_CLIPPED`, drawing nothing where nothing is left
 *   (`0118`); and hands the driver's `StrBlt` each character on its own --
 *   the place moved by the ascent turned, each character at the widths
 *   before it carried along the baseline, through GDI's sines with the
 *   resolutions' ratio taken across (`0138`-`0205`) -- with the clip, the
 *   cache's font, GDI's copy of the `DRAWMODE` and the `TEXTXFORM`.
 *
 * **Recorded** by `prttx2`'s device "Plain": `xAy` of Arial at 24 at 10,10
 * is `StrBlt` at 10, 21 and 37, a character each, the font at 42h of the
 * cache's segment; given `ETO_OPAQUE` and a rectangle, the rectangle is
 * filled twice before them, once by the call that fills it and once by the
 * string's.
 */
async function byStrBlt(
  system: any,
  surface: any,
  args: EngineTextArgs,
  strings: Strings,
  call: number,
  box: [number, number, number, number] | null,
  xAt: number
) {
  const opaque = args.opaque >>> 0;
  const rectOf = (far: number) =>
    [0, 2, 4, 6].map((offset) => signed16(read16(system, far, offset)));
  const clip = args.clip >>> 16 ? rectOf(args.clip >>> 0) : [-0x8000, -0x8000, 0x7fff, 0x7fff];
  const cut = (a: number[], b: number[]) => {
    const r = [
      Math.max(a[0], b[0]),
      Math.max(a[1], b[1]),
      Math.min(a[2], b[2]),
      Math.min(a[3], b[3]),
    ];

    return r[0] < r[2] && r[1] < r[3] ? r : null;
  };
  const fill = async (rect: number[] | null) => {
    const within = rect && cut(rect, clip);

    if (within) {
      await withGround(system, args.hdc, false, () =>
        fillRects(system, surface, strings.device, [within])
      );
    }
  };
  const given = call & 0x80 && opaque >>> 16 ? rectOf(opaque) : null;

  if ((call & 0x78) !== 0x78) {
    await fill(call & 0x80 ? given : box);
    return;
  }

  if (strings.options & ETO_OPAQUE) {
    await fill(given);
  }

  let bounds: number[] | null = clip;

  if (strings.options & ETO_CLIPPED && opaque >>> 16) {
    bounds = cut(clip, rectOf(opaque));
  }

  const procedure = surface.driverDevice.driver.procs[STR_BLT - 1] ?? 0;

  if (!bounds || !procedure) {
    return;
  }

  const font = strings.font;
  const resY = read16(system, font, 4);
  const resX = read16(system, font, 6);
  const across = Math.floor((0x100 * resX + (resY >> 1)) / resY) & 0xffff;
  const down = Math.floor((0x100 * resY + (resX >> 1)) / resX) & 0xffff;
  const angle = read16(system, font, 0x48);
  const ascent = read16(system, font, 8);
  const scaled = (value: number, ratio: number) =>
    signed16(Math.floor(((value & 0xffff) * ratio) / 0x100) & 0xffff);
  const x0 = signed16(sineOf(scaled(ascent, across), angle, false) + xAt);
  const y0 = signed16(signed16(args.y) - (ascent - sineOf(ascent, angle, true)));
  const clipBytes = new Uint8Array(8);

  bounds.forEach((value, step) => {
    clipBytes[step * 2] = value & 0xff;
    clipBytes[step * 2 + 1] = (value >> 8) & 0xff;
  });

  await onStackBytes(system, new Uint8Array([...strings.modeBytes, ...clipBytes]), async (far) => {
    let before = 0;

    for (let step = 0; step < strings.spaced.widths.length; step++) {
      const along = before;

      before = (before + signed16(strings.spaced.widths[step])) & 0xffff;

      const sx = sineOf(signed16(along), angle, true) + x0;
      const sy = -sineOf(scaled(along, down), angle, false) + y0;

      await callDriver(system, procedure, [
        [strings.device, DWORD],
        [sx & 0xffff, UINT],
        [sy & 0xffff, UINT],
        [(far + 0x20) >>> 0, DWORD],
        [((args.string & 0xffff0000) | ((args.string + step) & 0xffff)) >>> 0, DWORD],
        [1, UINT],
        [strings.cacheFont >>> 0, DWORD],
        [far >>> 0, DWORD],
        [args.xform >>> 0, DWORD],
      ]);
    }

    return 0;
  });
}

/**
 * A turned string, glyph by glyph (seg1 `6693`, seg8 `024b`): a brush of
 * the text colour selected, the text white and the background black
 * (`002d`, `0268`-`028a`); the string's first baseline point the place
 * moved by the ascent turned, the resolutions' ratio taken across; each
 * glyph at the baseline point of the widths before it, turned, moved by
 * its corner, drawn through `blitGlyph` with the raster operation of the
 * context's `ROP2` (`GLYPH_ROPS`). A character whose glyph is not in the
 * cache, or is empty, is passed over. Then the colours and the brush put
 * back, the brush deleted.
 */
async function turnedGlyphs(
  system: any,
  surface: any,
  args: EngineTextArgs,
  font: number,
  file: number,
  widths: number[],
  modeBytes: Uint8Array
) {
  const rop2 = modeBytes[0] | (modeBytes[1] << 8);
  const rop = GLYPH_ROPS[(rop2 - 1) & 0x0f];
  const resY = read16(system, font, 4);
  const resX = read16(system, font, 6);
  const across = Math.floor((0x100 * resX + (resY >> 1)) / resY) & 0xffff;
  const down = Math.floor((0x100 * resY + (resX >> 1)) / resX) & 0xffff;
  const angle = read16(system, font, 0x48);
  const ascent = signed16(read16(system, font, 8));
  const brush = CreateSolidBrush.call(system, GetTextColor.call(system, args.hdc));
  const oldBrush = await SelectObject.call(system, args.hdc, brush);
  const oldText = await SetTextColor.call(system, args.hdc, 0xffffff);
  const oldBk = await SetBkColor.call(system, args.hdc, 0);
  const scaled = (value: number, ratio: number) =>
    signed16(Math.floor(((value & 0xffff) * ratio) / 0x100) & 0xffff);
  const x0 = signed16(args.x) + sineOf(scaled(ascent, across), angle, false);
  const y0 = signed16(args.y) + sineOf(ascent, angle, true);
  const layout = layoutOf(system, font);
  const fallback = read8(system, font, 0x1f);
  let position = 0;

  try {
    for (let step = 0; step < widths.length; step++) {
      const at = position;

      position = (position + signed16(widths[step])) & 0xffff;

      let code = read8(system, args.string, step);

      if (code < layout.first || code > layout.last) {
        code = layout.first + fallback;
      }

      const entry = layout.table + (code - layout.first) * layout.entry;
      const place = read16(system, file, entry + 2);

      if (!place && !(layout.entry === ENTRY_3 && read16(system, file, entry + 4))) {
        continue;
      }

      const glyph = (file | place) >>> 0;
      const width = read16(system, glyph, 0);

      if (!(((width + 0x1f) & ~0x1f) >> 3)) {
        continue;
      }

      const height = read16(system, glyph, 2);
      const along = signed16(at);
      const gx = sineOf(along, angle, true) + x0 + signed16(read16(system, glyph, 4));
      const gy =
        -sineOf(scaled(along, down), angle, false) + y0 - signed16(read16(system, glyph, 6));

      await blitGlyph(system, surface, args.device >>> 0, gx, gy, glyph, width, height, rop);
    }
  } finally {
    await SetTextColor.call(system, args.hdc, oldText);
    await SetBkColor.call(system, args.hdc, oldBk);
    await SelectObject.call(system, args.hdc, oldBrush);
    await DeleteObject.call(system, brush);
  }
}

/**
 * A glyph drawn through the driver's `BitBlt` (seg1 `2ed4`, `2ef2`): its
 * box at the point, the glyph's width and height; the source a monochrome
 * `BITMAP` of the glyph's rows, its width taken up to 32; the driver's
 * `BitBlt` once for each of the visible region's rectangles within the
 * box, top down and from the left (`2b62`, flags 183h), with the
 * rectangle's corner, the source's corner as far into the glyph, the
 * extent, the raster operation, the context's brush and its `DRAWMODE`.
 */
async function blitGlyph(
  system: any,
  surface: any,
  device: number,
  gx: number,
  gy: number,
  glyph: number,
  width: number,
  height: number,
  rop: number
) {
  const procedure = surface.driverDevice.driver.procs[BIT_BLT - 1] ?? 0;
  const rowBytes = ((width + 0x1f) & ~0x1f) >> 3;
  const box: [number, number, number, number] = [gx, gy, gx + width, gy + height];
  const rects = blitRects(surface, box, true, true);

  if (!procedure || !rects.length) {
    return;
  }

  const bits = (glyph + TURNED_HEADER) >>> 0;
  const plane = rowBytes * height;
  const bitmap = new Uint8Array(0x1a);
  const put = (offset: number, value: number) => {
    bitmap[offset] = value & 0xff;
    bitmap[offset + 1] = (value >> 8) & 0xff;
  };

  put(0, 0);
  put(2, (width + 0x1f) & ~0x1f);
  put(4, height);
  put(6, rowBytes);
  bitmap[8] = 1;
  bitmap[9] = 1;
  put(0x0a, bits);
  put(0x0c, bits >>> 16);
  put(0x0e, plane);
  put(0x10, plane >>> 16);
  put(0x12, surface.driverDevice.lpPDevice);
  put(0x14, surface.driverDevice.lpPDevice >>> 16);
  put(0x16, 0);
  put(0x18, 0xffff);

  await onStackBytes(system, bitmap, async (far) => {
    for (const rect of rects) {
      await callDriver(system, procedure, [
        [device, DWORD],
        [rect[0] & 0xffff, UINT],
        [rect[1] & 0xffff, UINT],
        [far >>> 0, DWORD],
        [(rect[0] - gx) & 0xffff, UINT],
        [(rect[1] - gy) & 0xffff, UINT],
        [(rect[2] - rect[0]) & 0xffff, UINT],
        [(rect[3] - rect[1]) & 0xffff, UINT],
        [rop >>> 0, DWORD],
        [drawingOf(surface).brush?.far ?? 0, DWORD],
        [drawMode(system, surface), DWORD],
      ]);
    }

    return 0;
  });
}
