'use strict';

import { Brush } from '../../raster/brush.js';
import { Color } from '../../raster/color.js';
import { DeviceBitmap } from '../../raster/device-bitmap.js';
import { Pen } from '../../raster/pen.js';
import { clockOf } from '../../emulator/clock.js';
import { GlobalAlloc } from '../kernel/GlobalAlloc.js';
import { GlobalFree } from '../kernel/GlobalFree.js';
import { globalPointer } from '../kernel/GlobalLock.js';
import { GlobalSize } from '../kernel/GlobalSize.js';
import { Gdi } from '../gdi.js';
import { FARPTR, HDC, INT, LPARAM, Types } from '../types.js';
import { ClipRegion } from '../../raster/clip-region.js';
import { LogicalPalette, Region } from './gdi-objects.js';
import { packedDibOf } from './GetDIBits.js';
import { stockLogfont } from './GetObject.js';
import { GetStockObject } from './GetStockObject.js';
import { entriesOf } from './palettes.js';

/**
 * Metafiles: GDI calls kept as records to be played again. **Recorded** by
 * `metafile`, which records calls into a memory metafile, dumps its bytes,
 * and plays it back whole and a record at a time; and by `metarec`, which
 * makes every call GDI keeps, and some it does not, into a metafile of its
 * own and dumps it. **Read out** of `GDI.EXE` seg20, which keeps them.
 *
 * * A metafile is a header of nine words -- its kind, 1 for memory; 9, the
 *   header's own size; version 300h; its size in words; how many objects
 *   its handle table needs; its largest record in words; and nought -- then
 *   its records, and a record of three words that ends it.
 * * A record is its size in words, a doubleword; its function, a word; then
 *   what the call was given. For a call given only numbers, that is the
 *   call's own stack less the device context: its arguments last first, as
 *   they were pushed. The function's high byte is how many words those
 *   were, and its low byte the call's ordinal in GDI, less 300 from
 *   `SetTextAlign`'s on: `Rectangle` is 041Bh, `Chord` 0830h. `FloodFill`
 *   is kept as `ExtFloodFill` of `FLOODFILLBORDER`, and both answer nought.
 *   The `Ex` forms are kept as the call they are the form of, and give
 *   their pointer 1 and nought; the print calls are records of no words.
 * * Where a call is given a pointer, the record holds what it points at:
 *   `TextOut` its count, then the text padded to a word, then y and x;
 *   `Polygon` and `Polyline` the count, then the points; `PolyPolygon` the
 *   count of polygons, each one's count, then the points; `ExtTextOut` y,
 *   x, the count, the options, the rectangle where the options fill or clip
 *   to one, the text, and the widths where it is given them; `Escape` the
 *   escape, its count and its bytes (`StartDoc` is `STARTDOC` of the
 *   document's name). A blit from a memory context keeps its words but the
 *   source's, then the source's bitmap as a DIB; one from no context, its
 *   words. `SetDIBitsToDevice` and `StretchDIBits` keep their words and the
 *   program's DIB.
 * * An object selected is made first, in the lowest free place of the
 *   metafile's handle table: a pen by `CreatePenIndirect` (02FAh) with its
 *   `LOGPEN`, a brush by `CreateBrushIndirect` (02FCh) with its `LOGBRUSH` --
 *   a pattern brush by `DIBCreatePatternBrush` (0142h) with its DIB -- a
 *   font by `CreateFontIndirect` (02FBh) with its `LOGFONT`, the face name
 *   and its nought and two bytes more, to a word; a region by
 *   `CreateRegion` (06FFh), a palette by `CreatePalette` (00F7h). Then
 *   `SelectObject` (012Dh) names its place. A stock object is made so too.
 *   `SelectObject` answers the object of its kind selected before -- at
 *   first the black pen, the white brush and the device's default font --
 *   1 for a region, nought for a bitmap, which is not kept.
 *   `DeleteObject` of an object a metafile holds adds 01F0h with its place
 *   there, and frees it, but for one selected.
 * * `GetDeviceCaps` answers `DT_METAFILE` for `TECHNOLOGY` and nought for
 *   every other index; the calls that ask answer nought.
 * * A metafile's handle is the global block of its bytes: `GetMetaFileBits`
 *   and `SetMetaFileBits` give the same handle back. The block is nine words
 *   longer than the metafile.
 * * `EnumMetaFile` calls its procedure with each record but the last, a
 *   handle table of as many objects as the header says, and that count;
 *   `PlayMetaFileRecord` plays one, as `PlayMetaFile` plays them all --
 *   into a metafile's context, keeping each there.
 *
 * Not done: `AnimatePalette`, and `SetPaletteEntries` before
 * `RealizePalette`, in a metafile; playing the records of bitmaps, DIBs,
 * pattern brushes, palettes and escapes; a region's stamp, kept as
 * nought. A call into a metafile that is not kept answers nought.
 *
 * **On disk**, as `diskmeta` recorded them:
 *
 * * `CreateMetaFile` of a file's name writes the same records to the file,
 *   its header's kind 1 still; nought where the file cannot be made.
 * * The handle of one on disk is a block of 192 bytes: the header with its
 *   kind 2; six bytes; then the file's `OFSTRUCT` -- its length byte, eight
 *   more than the path's; 1, a fixed disk; no error; the file's date and
 *   time; and its path. `GetMetaFile` answers one so; `GetMetaFileBits` its
 *   same handle, still of kind 2; `DeleteMetaFile` leaves the file.
 * * `CopyMetaFile` to a file writes the same bytes and answers one on disk;
 *   to none, a copy in memory -- of one in memory, its whole block. A copy
 *   from memory to disk or disk to memory says three words more in its
 *   header's size than it holds; one to its own kind, what it holds.
 */

/** What each place of a metafile context's selected objects holds: pen, brush, font, palette, bitmap, region. */
const PEN = 0;
const BRUSH = 1;
const FONT = 2;
const PALETTE = 3;
const BITMAP = 4;
const REGION = 5;

/** A place of the handle table whose object was deleted while selected: never found again. */
const GONE = -1;

export class MetafileDC {
  /** The file it is kept in, for one on disk. */
  path: string | null = null;
  /** The records made so far, bytes. */
  readonly bytes: number[] = [];
  /** The handle table: each place's object's handle, nought, or `GONE`. */
  readonly slots: number[] = [];
  /** The largest record in words, the ending one's three at least. */
  largest = 3;
  /**
   * The object of each kind selected last: at first the black pen, the
   * white brush and the device's default font (seg20 `1d75`-`1d9d`).
   */
  readonly current: number[] = [0, 0, 0, 0, 0, 0];
}

/** The metafile device contexts open, which `DeleteObject` tells. */
function openMetafiles(system: any): Set<MetafileDC> {
  return (system._metafiles ??= new Set());
}

/**
 * Calls given only numbers, kept as their stack (seg20 `0000`, by way of
 * `2596`): measured, all of them, by `metarec`. `FloodFill` is kept as
 * `ExtFloodFill` (below); it is here to be played.
 */
const BY_STACK = new Set([
  'SetBkMode',
  'SetTextColor',
  'SetPixel',
  'Rectangle',
  'Ellipse',
  'MoveTo',
  'LineTo',
  'PatBlt',
  'SaveDC',
  'IntersectClipRect',
  'RestoreDC',
  'SetRop2',
  'Arc',
  'RoundRect',
  'SetBkColor',
  'SetMapMode',
  'SetPolyFillMode',
  'SetStretchBltMode',
  'SetTextCharacterExtra',
  'SetTextJustification',
  'SetWindowOrg',
  'SetWindowExt',
  'SetViewportOrg',
  'SetViewportExt',
  'OffsetWindowOrg',
  'ScaleWindowExt',
  'OffsetViewportOrg',
  'ScaleViewportExt',
  'ExcludeClipRect',
  'OffsetClipRgn',
  'FloodFill',
  'Pie',
  'Chord',
  'SetRelAbs',
  'SetTextAlign',
  'SetMapperFlags',
  'ExtFloodFill',
]);

/**
 * The `Ex` forms, each kept as the call it makes with its arguments less
 * its pointer (seg1 `6043`, `6073`): the pointer given the answer, 1 and
 * nought.
 */
const EX_FORMS: Record<string, string> = {
  SetWindowOrgEx: 'SetWindowOrg',
  SetViewportOrgEx: 'SetViewportOrg',
  OffsetWindowOrgEx: 'OffsetWindowOrg',
  OffsetViewportOrgEx: 'OffsetViewportOrg',
  SetWindowExtEx: 'SetWindowExt',
  SetViewportExtEx: 'SetViewportExt',
  ScaleWindowExtEx: 'ScaleWindowExt',
  ScaleViewportExtEx: 'ScaleViewportExt',
  MoveToEx: 'MoveTo',
};

/**
 * Calls given a metafile's context that are made on it as on any, not kept:
 * `CloseMetaFile`, which ends it, and those that play a metafile into it,
 * whose records are kept as they are played (seg19 `0826`).
 */
export const MADE_ON_METAFILES = new Set([
  'CloseMetafile',
  'PlayMetafile',
  'PlayMetafileRecord',
  'EnumMetafile',
]);

/** The `Ex` forms that ask, which are made on a metafile's context as on any. */
const GET_EX = new Set([
  'GetBrushOrgEx',
  'GetCurrentPositionEx',
  'GetViewportExtEx',
  'GetViewportOrgEx',
  'GetWindowExtEx',
  'GetWindowOrgEx',
]);

/** The print calls, each kept as a record of no words (seg31 `0234`-`0302`). */
const PRINTING: Record<string, number> = {
  StartPage: 0x0051,
  EndPage: 0x0052,
  EndDoc: 0x0053,
  AbortDoc: 0x0054,
};

const META_REALIZEPALETTE = 0x0035;
const META_SELECTOBJECT = 0x012d;
const META_INVERTREGION = 0x012a;
const META_PAINTREGION = 0x012b;
const META_RESIZEPALETTE = 0x0139;
const META_DIBCREATEPATTERNBRUSH = 0x0142;
const META_DELETEOBJECT = 0x01f0;
const META_CREATEPALETTE = 0x00f7;
const META_FILLREGION = 0x0228;
const META_SELECTPALETTE = 0x0234;
const META_CREATEPENINDIRECT = 0x02fa;
const META_CREATEFONTINDIRECT = 0x02fb;
const META_CREATEBRUSHINDIRECT = 0x02fc;
const META_TEXTOUT = 0x0521;
const META_EXTFLOODFILL = 0x0548;
const META_POLYPOLYGON = 0x0538;
const META_ESCAPE = 0x0626;
const META_CREATEREGION = 0x06ff;
const META_DIBBITBLT = 0x0940;
const META_EXTTEXTOUT = 0x0a32;
const META_DIBSTRETCHBLT = 0x0b41;
const META_SETDIBTODEV = 0x0d33;
const META_STRETCHDIB = 0x0f43;
const META_POLYGON = 0x0324;
const META_POLYLINE = 0x0325;

const ETO_OPAQUE = 2;
const ETO_CLIPPED = 4;

const SETABORTPROC = 9;
const STARTDOC = 10;

const TECHNOLOGY = 2;
const DT_METAFILE = 5;

/**
 * A record's function: in its high byte the words of its arguments, in
 * its low the call's ordinal, less 300 from `SetTextAlign`'s (346) on --
 * as `PlayMetaFileRecord` takes it back (seg19 `098b`-`0996`).
 */
function functionOf(ordinal: number, words: number) {
  return ((words << 8) | ((ordinal < 300 ? ordinal : ordinal - 300) & 0xff)) & 0xffff;
}

/** The ordinal a record's function names (seg19 `096c`-`0996`). */
function ordinalOfFunction(fn: number) {
  const low = fn & 0xff;

  return low < 0x2e ? low : low + 300;
}

/** Words as bytes, low first. */
function wordsOf(...words: number[]) {
  return words.flatMap((word) => [word & 0xff, (word >> 8) & 0xff]);
}

function emit(meta: MetafileDC, fn: number, params: number[]) {
  const padded = params.length & 1 ? [...params, 0] : params;
  const size = 3 + padded.length / 2;

  meta.bytes.push(...wordsOf(size & 0xffff, size >>> 16, fn));

  /* A record of a bitmap's bits may be larger than a call's arguments can
   * be spread: its bytes added one by one. */
  for (const byte of padded) {
    meta.bytes.push(byte);
  }

  meta.largest = Math.max(meta.largest, size);
}

function colorrefOf(color: any) {
  if (!color) {
    return 0;
  }

  return (color.red | (color.green << 8) | (color.blue << 16)) >>> 0;
}

/** A word of a call's stack, from its lowest byte. */
function wordAt(stack: number[], at: number) {
  return (stack[at] ?? 0) | ((stack[at + 1] ?? 0) << 8);
}

function dwordAt(stack: number[], at: number) {
  return (wordAt(stack, at) | (wordAt(stack, at + 2) << 16)) >>> 0;
}

function bytesAt(system: any, far: number, count: number) {
  const core = system.machine.cpu.core;

  return Array.from({ length: Math.max(count, 0) }, (_, at) =>
    core.read8((far >>> 16) & 0xffff, ((far & 0xffff) + at) & 0xffff)
  );
}

/** Bytes at a far pointer read as a huge one, across a block's 64K pieces. */
function hugeBytesAt(system: any, far: number, count: number) {
  const core = system.machine.cpu.core;

  return Array.from({ length: Math.max(count, 0) }, (_, at) => {
    const from = farAt(far, at);

    return core.read8((from >>> 16) & 0xffff, from & 0xffff);
  });
}

function wordIn(system: any, far: number, at: number) {
  const [low, high] = bytesAt(system, ((far & 0xffff0000) | ((far + at) & 0xffff)) >>> 0, 2);

  return low | (high << 8);
}

function dwordIn(system: any, far: number, at: number) {
  return (wordIn(system, far, at) | (wordIn(system, far, at + 2) << 16)) >>> 0;
}

/** A row of a DIB, `bits` to a pixel, `width` wide, in bytes: to a doubleword. */
function strideOf(width: number, bits: number) {
  return (((width * bits + 31) >>> 0) & ~31) >>> 3;
}

/**
 * A DIB a program gives `SetDIBitsToDevice` or `StretchDIBits`, as the
 * record keeps it (seg20 `0d30`, `10b4`): a `BITMAPINFOHEADER` of 40 bytes
 * -- one made of a `BITMAPCOREHEADER`, its size, width, height, planes and
 * bits, the rest nought -- its colours, four bytes each for
 * `DIB_RGB_COLORS` (a core table's three and a nought) and two for
 * `DIB_PAL_COLORS`, as many as it uses or its bits can name, none at 24;
 * then its bits: the image's size where it gives one and all its lines are
 * asked for, else a row's bytes for each line.
 */
function programDib(
  system: any,
  lpbmi: number,
  lpBits: number,
  usage: number,
  lines: number | null
) {
  const size = dwordIn(system, lpbmi, 0);
  const each = usage ? 2 : 4;
  const bytes: number[] = [];
  let bitsSize: number;

  if (size === 12) {
    const width = wordIn(system, lpbmi, 4);
    const height = wordIn(system, lpbmi, 6);
    const planes = wordIn(system, lpbmi, 8);
    const count = wordIn(system, lpbmi, 10);
    const colours = count === 24 ? 0 : (each << count) & 0xffff;

    bytes.push(...wordsOf(40, 0, width, 0, height, 0, planes, count), ...new Array(24).fill(0));

    if (!usage) {
      for (let entry = 0; entry < colours >> 2; entry++) {
        bytes.push(
          ...bytesAt(system, ((lpbmi & 0xffff0000) | ((lpbmi + 12 + entry * 3) & 0xffff)) >>> 0, 3),
          0
        );
      }
    } else {
      bytes.push(
        ...bytesAt(system, ((lpbmi & 0xffff0000) | ((lpbmi + 12) & 0xffff)) >>> 0, colours)
      );
    }

    bitsSize = strideOf(width, count) * (lines ?? height);
  } else {
    const used = dwordIn(system, lpbmi, 0x20);
    const count = wordIn(system, lpbmi, 0x0e);
    const colours = used ? (each * used) & 0xffff : count === 24 ? 0 : (each << count) & 0xffff;
    const image = dwordIn(system, lpbmi, 0x14);
    const height = dwordIn(system, lpbmi, 8);

    bytes.push(...bytesAt(system, lpbmi, 40));
    bytes.push(...bytesAt(system, ((lpbmi & 0xffff0000) | ((lpbmi + 40) & 0xffff)) >>> 0, colours));

    if (image && (lines === null || lines === height)) {
      bitsSize = image;
    } else {
      bitsSize = strideOf(dwordIn(system, lpbmi, 4), count) * (lines ?? height);
    }
  }

  /* The bits are copied a word at a time; added one by one, as a large
   * DIB's are more than a call's arguments can be spread. */
  for (const byte of hugeBytesAt(system, lpBits, bitsSize & ~1)) {
    bytes.push(byte);
  }

  return bytes;
}

/** The kind of object a handle names, by where a metafile context keeps it selected; -1 for none. */
function kindOf(system: any, handle: number) {
  const item = system.handles.resolve(handle);

  if (item instanceof Pen) {
    return PEN;
  }

  if (item instanceof Brush) {
    return BRUSH;
  }

  if (item instanceof LogicalPalette) {
    return PALETTE;
  }

  if (item instanceof DeviceBitmap) {
    return BITMAP;
  }

  if (item instanceof Region) {
    return REGION;
  }

  if (item?.logfont || stockLogfont(system, handle)) {
    return FONT;
  }

  return -1;
}

/**
 * The record that makes an object in a metafile (seg20 `1755`-`1a54`), or
 * null for one it does not keep -- a bitmap.
 */
function makingOf(system: any, handle: number): [number, number[]] | null {
  const item = system.handles.resolve(handle);

  if (item instanceof Pen) {
    const logpen = (item as any).logpen ?? {
      style: item.color?.alpha === 0 ? 5 : 0,
      width: 0,
      y: 0,
      color: colorrefOf(item.color),
    };

    return [
      META_CREATEPENINDIRECT,
      wordsOf(logpen.style, logpen.width, logpen.y, logpen.color & 0xffff, logpen.color >>> 16),
    ];
  }

  if (item instanceof Brush) {
    const brush: any = item;

    /* A DIB's pattern: 5, how its colours are given, and the DIB's block
     * as the brush copied it, every byte (`1792`-`184a`). */
    if (brush.packedDib) {
      return [META_DIBCREATEPATTERNBRUSH, [...wordsOf(5, brush.dibUsage ?? 0), ...brush.packedDib]];
    }

    /* A bitmap's: 3, nought, and the bitmap made a DIB (`184d`-`1932`). */
    if (brush.patternDib) {
      return [META_DIBCREATEPATTERNBRUSH, [...wordsOf(3, 0), ...brush.patternDib]];
    }

    if (brush.pattern) {
      return null;
    }

    const logbrush = brush.logbrush ?? {
      style: item.color?.alpha === 0 ? 1 : 0,
      color: item.color?.alpha === 0 ? 0 : colorrefOf(item.color),
      hatch: 0,
    };

    return [
      META_CREATEBRUSHINDIRECT,
      wordsOf(logbrush.style, logbrush.color & 0xffff, logbrush.color >>> 16, logbrush.hatch),
    ];
  }

  /* A region: its object's first four words, the second made 6, and the
   * rest of it from its size on (`198c`-`1a3d`) -- its size in bytes, its
   * scans, the most sides a scan has, its box, then each scan: its count of
   * sides, its top and bottom, the sides, the count again. The third and
   * fourth words are GDI's stamp of the object, which this engine does not
   * count: nought. */
  if (item instanceof Region) {
    const bands = item.shape.bands;
    const scans = bands.flatMap(({ top, bottom, spans }) => [
      spans.length * 2,
      top,
      bottom,
      ...spans.flat(),
      spans.length * 2,
    ]);
    const most = bands.reduce((max, { spans }) => Math.max(max, spans.length * 2), 0);
    const box = bands.length ? item.shape.box : { left: 0, top: 0, right: 0, bottom: 0 };

    return [
      META_CREATEREGION,
      wordsOf(
        0,
        6,
        0,
        0,
        24 + scans.length * 2,
        bands.length,
        most,
        box.left,
        box.top,
        box.right,
        box.bottom,
        ...scans
      ),
    ];
  }

  /* A palette: its version, its count and its entries (`1971`, `0477`). */
  if (item instanceof LogicalPalette) {
    const entries = entriesOf(item);

    return [META_CREATEPALETTE, [...wordsOf(0x300, entries.length), ...entries.flat()]];
  }

  const logfont = item?.logfont ?? stockLogfont(system, handle);

  if (logfont) {
    const face = String(logfont.face ?? '').slice(0, 31);
    const name = Array.from(face, (char) => char.charCodeAt(0) & 0xff);
    const length = (name.length + 3) & ~1;

    while (name.length < length) {
      name.push(0);
    }

    return [
      META_CREATEFONTINDIRECT,
      [
        ...wordsOf(
          logfont.height,
          logfont.width,
          logfont.escapement,
          logfont.orientation,
          logfont.weight
        ),
        logfont.italic ? 1 : 0,
        logfont.underline ? 1 : 0,
        logfont.strikeout ? 1 : 0,
        logfont.charset & 0xff,
        logfont.outPrecision & 0xff,
        logfont.clipPrecision & 0xff,
        logfont.quality & 0xff,
        logfont.pitchAndFamily & 0xff,
        ...name,
      ],
    ];
  }

  return null;
}

/**
 * An object's place in a metafile's handle table: where it is, or else the
 * lowest free place, taken for it (seg20 `1b5e`, `1c40`-`1ca5`) and its
 * making recorded there (`16c8`). -1 for one a metafile does not keep -- a
 * bitmap -- whose place stays taken, though nothing made it: found again,
 * it is selected by it.
 */
function placeOf(system: any, meta: MetafileDC, handle: number) {
  let slot = meta.slots.indexOf(handle);

  if (slot >= 0) {
    return slot;
  }

  slot = meta.slots.indexOf(0);
  slot = slot < 0 ? meta.slots.length : slot;
  meta.slots[slot] = handle;

  const making = makingOf(system, handle);

  if (!making) {
    return -1;
  }

  emit(meta, making[0], making[1]);

  return slot;
}

/**
 * An object selected (seg20 `15a3`-`1622`): made in its place if it is not
 * there, then `SelectObject` of the place. The answer is the object of its
 * kind selected before; 1 for a region; nought for a bitmap the first
 * time, which a metafile does not keep.
 */
function selectInto(system: any, meta: MetafileDC, handle: number) {
  const kind = kindOf(system, handle);

  if (kind < 0) {
    return 0;
  }

  const slot = placeOf(system, meta, handle);

  if (slot < 0) {
    return 0;
  }

  emit(meta, META_SELECTOBJECT, wordsOf(slot));

  const before = meta.current[kind];

  meta.current[kind] = handle;

  return kind === REGION ? 1 : before;
}

/** A palette selected (seg20 `1568`-`15a0`): made, then `SelectPalette` of its place; 1. */
function selectPaletteInto(system: any, meta: MetafileDC, handle: number) {
  if (kindOf(system, handle) !== PALETTE) {
    return 0;
  }

  const slot = placeOf(system, meta, handle);

  if (slot < 0) {
    return 0;
  }

  meta.current[PALETTE] = handle;
  emit(meta, META_SELECTPALETTE, wordsOf(slot));

  return 1;
}

/**
 * An object deleted (seg20 `26a7`): taken out of every metafile being
 * recorded that holds it, by a record of its own -- but where it is the
 * one of its kind selected, which is kept no record of, and whose place is
 * never found again.
 */
export function forgetInMetafiles(system: any, handle: number) {
  for (const meta of openMetafiles(system)) {
    const slot = meta.slots.indexOf(handle);

    if (slot < 0) {
      continue;
    }

    if (meta.current.includes(handle)) {
      meta.slots[slot] = GONE;
    } else {
      emit(meta, META_DELETEOBJECT, wordsOf(slot));
      meta.slots[slot] = 0;
    }
  }
}

/** A palette made shorter or longer: `ResizePalette` kept in each metafile that holds it (seg20 `14fd`). */
export function resizeInMetafiles(system: any, handle: number, entries: number) {
  for (const meta of openMetafiles(system)) {
    if (meta.slots.includes(handle)) {
      emit(meta, META_RESIZEPALETTE, wordsOf(entries));
    }
  }
}

/** Kept from `metafile`'s own context: the `SelectPalette` of USER's `SelectPalette`. */
export function selectPaletteInMetafile(system: any, hdc: number, hpal: number) {
  const meta = system.handles.resolve(hdc);

  return meta instanceof MetafileDC ? selectPaletteInto(system, meta, hpal) : null;
}

/** Kept likewise: `RealizePalette` (seg20 `150a`-`1547`), a record of no words; 1. */
export function realizePaletteInMetafile(system: any, hdc: number) {
  const meta = system.handles.resolve(hdc);

  if (!(meta instanceof MetafileDC)) {
    return null;
  }

  emit(meta, META_REALIZEPALETTE, []);

  return 1;
}

/** A region and the objects a region call names, by their places; null where one is not kept. */
function placesOf(system: any, meta: MetafileDC, handles: number[]) {
  const places: number[] = [];

  for (const handle of handles) {
    if (kindOf(system, handle) < 0) {
      return null;
    }

    const slot = placeOf(system, meta, handle);

    if (slot < 0) {
      return null;
    }

    places.push(slot);
  }

  return places;
}

/**
 * A GDI call made into a metafile's device context, kept as a record.
 * Answers what the call answers there (`metarec`).
 */
export function recordCall(
  system: any,
  meta: MetafileDC,
  ordinal: number,
  name: string,
  args: any[],
  stack: number[]
) {
  const hdc = args[0] & 0xffff;
  const words = stack.length / 2;

  if (EX_FORMS[name]) {
    const base = EX_FORMS[name];
    const far = args[args.length - 1] >>> 0;

    emit(meta, functionOf(ordinalOf(base), words - 2), stack.slice(4));

    if (far) {
      const core = system.machine.cpu.core;

      core.write16(far >>> 16, far & 0xffff, 1);
      core.write16(far >>> 16, ((far & 0xffff) + 2) & 0xffff, 0);
    }

    return 1;
  }

  /* `FloodFill` is `ExtFloodFill` of `FLOODFILLBORDER` (seg15 `0172`); both
   * answer nought (`0026`-`0168`). */
  if (name === 'FloodFill') {
    emit(meta, META_EXTFLOODFILL, [0, 0, ...stack]);
    return 0;
  }

  if (BY_STACK.has(name)) {
    emit(meta, functionOf(ordinal, words), stack);
    return name === 'ExtFloodFill' ? 0 : 1;
  }

  /* Each asks the call it is the `Ex` form of, which answers nought here,
   * and gives its pointer that: nought and nought; 1 (seg1 `5eb5`-`5fb0`). */
  if (GET_EX.has(name)) {
    const far = args[1] >>> 0;

    if (far) {
      const core = system.machine.cpu.core;

      core.write16(far >>> 16, far & 0xffff, 0);
      core.write16(far >>> 16, ((far & 0xffff) + 2) & 0xffff, 0);
    }

    return 1;
  }

  if (PRINTING[name]) {
    emit(meta, PRINTING[name], []);
    return 1;
  }

  switch (name) {
    /* Nought for every index but `TECHNOLOGY`, which is `DT_METAFILE`
     * (seg1 `44c3`-`44cf`). */
    case 'GetDeviceCaps':
      return (args[1] & 0xffff) === TECHNOLOGY ? DT_METAFILE : 0;

    case 'SelectObject':
      return selectInto(system, meta, args[1] & 0xffff);

    /* A region selected as `SelectObject` selects one; no region, nought. */
    case 'SelectClipRgn':
      return kindOf(system, args[1] & 0xffff) === REGION
        ? selectInto(system, meta, args[1] & 0xffff)
        : 0;

    case 'GDISelectPalette':
      return selectPaletteInto(system, meta, args[1] & 0xffff);

    case 'GDIRealizePalette':
      return realizePaletteInMetafile(system, hdc);

    /* The region's place, then the brush's (seg20 `063a`-`06a6`). */
    case 'FillRgn':
    case 'InvertRgn':
    case 'PaintRgn': {
      const places = placesOf(system, meta, args.slice(1, name === 'FillRgn' ? 3 : 2));

      if (!places) {
        return 0;
      }

      emit(
        meta,
        name === 'FillRgn'
          ? META_FILLREGION
          : name === 'InvertRgn'
            ? META_INVERTREGION
            : META_PAINTREGION,
        wordsOf(...places)
      );
      return 1;
    }

    case 'TextOut': {
      const [, x, y, text, count] = args;
      const bytes = Array.from(
        String(text ?? '').slice(0, count),
        (char) => char.charCodeAt(0) & 0xff
      );

      emit(meta, META_TEXTOUT, [
        ...wordsOf(count),
        ...bytes,
        ...(count & 1 ? [0] : []),
        ...wordsOf(y, x),
      ]);
      return 1;
    }

    /* y, x, the count, the options; the rectangle where the options are to
     * fill or clip to one; the text; each character's width where it is
     * given them (seg20 `0935`-`0aaf`). */
    case 'ExtTextOut': {
      const [, x, y, options, lprc, text, count, lpDx] = args;
      const rect = options & (ETO_OPAQUE | ETO_CLIPPED) ? bytesAt(system, lprc, 8) : [];
      const bytes = Array.from(
        String(text ?? '').slice(0, count),
        (char) => char.charCodeAt(0) & 0xff
      );

      emit(meta, META_EXTTEXTOUT, [
        ...wordsOf(y, x, count, options),
        ...rect,
        ...bytes,
        ...(count & 1 ? [0] : []),
        ...(lpDx ? bytesAt(system, lpDx, count * 2) : []),
      ]);
      return 1;
    }

    case 'Polygon':
    case 'Polyline': {
      const [, points, count] = args;

      emit(meta, name === 'Polygon' ? META_POLYGON : META_POLYLINE, [
        ...wordsOf(count),
        ...bytesAt(system, points, count * 4),
      ]);
      return 1;
    }

    /* The count of polygons, each one's count of points, then the points
     * (seg20 `0857`-`0932`). */
    case 'PolyPolygon': {
      const polygons = wordAt(stack, 0);
      const counts = bytesAt(system, dwordAt(stack, 2), polygons * 2);
      let points = 0;

      for (let at = 0; at < polygons; at++) {
        points += wordAt(counts, at * 2);
      }

      emit(meta, META_POLYPOLYGON, [
        ...wordsOf(polygons),
        ...counts,
        ...bytesAt(system, dwordAt(stack, 6), (points & 0xffff) * 4),
      ]);
      return 1;
    }

    /* The escape, its count, and what it was given; but `SETABORTPROC`,
     * which is made on the context (seg7 `0067`-`0080`, seg20 `06d5`). */
    case 'Escape': {
      const escape = wordAt(stack, 10);
      const count = wordAt(stack, 8);

      if (escape === SETABORTPROC) {
        return 0;
      }

      emit(meta, META_ESCAPE, [
        ...wordsOf(escape, count),
        ...bytesAt(system, dwordAt(stack, 4), count),
      ]);
      return 1;
    }

    /* `STARTDOC` with the document's name (seg31 `01b1`-`01d4`). */
    case 'StartDoc': {
      const info = dwordAt(stack, 0);
      const name = info ? dwordIn(system, info, 2) : 0;
      const text: number[] = [];

      for (let at = 0; name && at < 0x8000; at++) {
        const [byte] = bytesAt(system, ((name & 0xffff0000) | ((name + at) & 0xffff)) >>> 0, 1);

        if (!byte) {
          break;
        }

        text.push(byte);
      }

      emit(meta, META_ESCAPE, [...wordsOf(STARTDOC, text.length), ...text]);
      return 1;
    }

    case 'BitBlt':
    case 'StretchBlt':
      return recordBlt(system, meta, hdc, name === 'BitBlt', stack);

    /* The colours' use and the eight words after the pointers, then the
     * DIB, its lines those asked for (seg20 `0d30`-`10a3`). */
    case 'SetDIBitsToDevice': {
      const usage = wordAt(stack, 0);
      const lines = wordAt(stack, 10);

      emit(meta, META_SETDIBTODEV, [
        ...wordsOf(usage),
        ...stack.slice(10, 26),
        ...programDib(system, dwordAt(stack, 2), dwordAt(stack, 6), usage, lines),
      ]);
      return 1;
    }

    /* The raster operation, the colours' use and the eight words after the
     * pointers, then the DIB (seg20 `10b4`-`1252`). */
    case 'StretchDIBits': {
      const usage = wordAt(stack, 4);

      emit(meta, META_STRETCHDIB, [
        ...stack.slice(0, 4),
        ...wordsOf(usage),
        ...stack.slice(14, 30),
        ...programDib(system, dwordAt(stack, 6), dwordAt(stack, 10), usage, null),
      ]);
      return 1;
    }
  }

  return 0;
}

/**
 * `BitBlt` and `StretchBlt` (seg1 `2f9a`, `3002`; seg20 `0b91`-`0d2d`).
 * From no context, or from the metafile's own, the call's own words,
 * the source context's among them. From a memory context, its words but
 * the source context's, then the bitmap it holds made a DIB. From any
 * other, nought. `StretchBlt` from no context is turned away before it is
 * kept (`metarec`).
 */
function recordBlt(system: any, meta: MetafileDC, hdc: number, bit: boolean, stack: number[]) {
  const fn = bit ? META_DIBBITBLT : META_DIBSTRETCHBLT;
  const at = bit ? 8 : 12;
  const source = wordAt(stack, at);

  if (!source && !bit) {
    return 0;
  }

  if (!source || source === hdc) {
    emit(meta, fn, stack);
    return 1;
  }

  const surface = system.handles.resolve(source);

  if (!surface?.memoryContext || !(surface.bitmap instanceof DeviceBitmap)) {
    return 0;
  }

  emit(meta, fn, [
    ...stack.slice(0, at),
    ...stack.slice(at + 2),
    ...packedDibOf(system, surface.bitmap),
  ]);
  return 1;
}

export async function CreateMetaFile(this: any, lpszFile: any) {
  const meta = new MetafileDC();

  if (lpszFile) {
    const path = fullPath(this, String(lpszFile));

    if (!(await writeFile(this, path, []))) {
      return 0;
    }

    meta.path = path;
  }

  /* The black pen, the white brush and the device's default font
   * (seg20 `1d75`-`1d9d`). */
  meta.current[PEN] = GetStockObject.call(this, 7);
  meta.current[BRUSH] = GetStockObject.call(this, 0);
  meta.current[FONT] = GetStockObject.call(this, 14);
  openMetafiles(this).add(meta);

  return this.handles.allocate(meta);
}

/** A far pointer `offset` bytes into a block, across its 64K pieces. */
function farAt(far: number, offset: number) {
  const segment = ((far >>> 16) + ((offset >>> 16) << 3)) & 0xffff;

  return ((segment << 16) | (((far & 0xffff) + (offset & 0xffff)) & 0xffff)) >>> 0;
}

function writeBlock(system: any, bytes: number[], extra = 0) {
  const block = GlobalAlloc.call(system, 0x0002, bytes.length + extra);
  const far = globalPointer.call(system, block) >>> 0;
  const core = system.machine.cpu.core;

  bytes.forEach((byte, at) => {
    const to = farAt(far, at);

    core.write8((to >>> 16) & 0xffff, to & 0xffff, byte);
  });

  return block;
}

export async function CloseMetaFile(this: any, hdc: number) {
  const meta = this.handles.resolve(hdc);

  if (!(meta instanceof MetafileDC)) {
    return 0;
  }

  const end = [...wordsOf(3, 0, 0)];
  const size = 9 + meta.bytes.length / 2 + 3;
  const header = wordsOf(
    1,
    9,
    0x300,
    size & 0xffff,
    size >>> 16,
    meta.slots.length,
    meta.largest & 0xffff,
    meta.largest >>> 16,
    0
  );

  openMetafiles(this).delete(meta);
  this.handles.free(hdc);

  const bytes = [...header, ...meta.bytes, ...end];

  if (meta.path) {
    await writeFile(this, meta.path, bytes);

    return diskHandle(this, bytes, meta.path);
  }

  /* The block is nine words longer than the metafile: GDI makes it its
   * size in words and nine more (seg20 `1e42`-`1e5c`). */
  return writeBlock(this, bytes, 18);
}

/** A file's name as `OpenFile` gives it back: from the drive, in capitals. */
function fullPath(system: any, path: string) {
  const files = system.dos?.files;
  const full = path.includes(':') ? path : `${files?.path ?? 'C:\\'}${path}`;

  return full.toUpperCase();
}

/** Writes a file whole; whether it could be made. */
async function writeFile(system: any, path: string, bytes: number[]) {
  const files = system.dos?.files;
  const handle = files ? await files.create(path) : null;
  const file = handle !== null && handle >= 0 ? files.resolve(handle) : null;

  if (!file) {
    return false;
  }

  try {
    if (bytes.length) {
      await file.write(0, Uint8Array.from(bytes));
    }
  } finally {
    files.close(handle);
  }

  return true;
}

/** A file's bytes, or null where there is none. */
async function readFile(system: any, path: string): Promise<number[] | null> {
  const files = system.dos?.files;
  const handle = files ? await files.open(path) : null;
  const file = handle !== null && handle >= 0 ? files.resolve(handle) : null;

  if (!file) {
    return null;
  }

  try {
    return Array.from(new Uint8Array(await file.read(0, file.size)));
  } finally {
    files.close(handle);
  }
}

/** A DOS date and time, as a file's `OFSTRUCT` keeps them. */
function dosStamp(system: any) {
  const now: Date = clockOf(system?.machine).date();
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);

  return [...wordsOf(date), ...wordsOf(time)];
}

/**
 * The handle of a metafile on disk: its header of kind 2, six bytes, the
 * file's `OFSTRUCT`, in a block of 192 bytes (`diskmeta`).
 */
function diskHandle(system: any, bytes: number[], path: string) {
  const name = Array.from(path, (char) => char.charCodeAt(0) & 0xff);
  const block = new Array(192).fill(0);

  bytes.slice(0, 18).forEach((byte, at) => {
    block[at] = byte;
  });
  block[0] = 2;
  block[1] = 0;
  [8 + name.length, 1, 0, 0, ...dosStamp(system), ...name, 0].forEach((byte, at) => {
    block[24 + at] = byte;
  });

  return writeBlock(system, block);
}

/** The path a metafile on disk's handle names. */
function pathOf(system: any, far: number) {
  const core = system.machine.cpu.core;
  let path = '';

  for (let at = 32; at < 32 + 128; at++) {
    const from = farAt(far, at);
    const byte = core.read8((from >>> 16) & 0xffff, from & 0xffff);

    if (!byte) {
      break;
    }

    path += String.fromCharCode(byte);
  }

  return path;
}

/**
 * A metafile's bytes and its kind: in memory, its block's, as many as its
 * header says; on disk, its file's.
 */
async function contentOf(system: any, hmf: number) {
  const file = metafileOf(system, hmf);

  if (!file) {
    return null;
  }

  if (file.word(0) === 2) {
    const path = pathOf(system, file.far);

    file.done();

    const bytes = await readFile(system, path);

    return bytes ? { bytes, disk: true } : null;
  }

  const bytes = Array.from({ length: file.dword(6) * 2 }, (_, at) => file.byte(at));

  file.done();

  return { bytes, disk: false };
}

/**
 * A metafile to play: in memory, its own block; on disk, its file read into
 * a block of its own, freed when done.
 */
async function openMetafile(system: any, hmf: number) {
  const file = metafileOf(system, hmf);

  if (!file || file.word(0) !== 2) {
    return file;
  }

  const content = await contentOf(system, hmf);

  if (!content) {
    return null;
  }

  const block = writeBlock(system, content.bytes);
  const loaded = metafileOf(system, block);

  if (!loaded) {
    GlobalFree.call(system, block);
    return null;
  }

  return {
    ...loaded,
    done: () => {
      loaded.done();
      GlobalFree.call(system, block);
    },
  };
}

/** A metafile's bytes, from its block. */
function metafileOf(system: any, hmf: number) {
  const far = hmf ? globalPointer.call(system, hmf) >>> 0 : 0;

  if (!far) {
    return null;
  }

  const core = system.machine.cpu.core;
  const byte = (at: number) => {
    const from = farAt(far, at);

    return core.read8((from >>> 16) & 0xffff, from & 0xffff);
  };
  const word = (at: number) => byte(at) | (byte(at + 1) << 8);
  const dword = (at: number) => (word(at) | (word(at + 2) << 16)) >>> 0;

  if (word(0) !== 1 && word(0) !== 2) {
    return null;
  }

  return {
    far,
    byte,
    word,
    dword,
    header: word(2),
    objects: word(10),
    done: () => {},
  };
}

/** Each record's offset and function, the ending one left out. */
function recordsOf(file: NonNullable<ReturnType<typeof metafileOf>>) {
  const records: { at: number; size: number; fn: number }[] = [];
  const total = file.dword(6) * 2;
  let at = file.header * 2;

  while (at + 6 <= total) {
    const size = file.dword(at);
    const fn = file.word(at + 4);

    if (!fn || size < 3) {
      break;
    }

    records.push({ at, size, fn });
    at += size * 2;
  }

  return records;
}

let exportsMade: any[] | null = null;

/** GDI's own functions, by ordinal. */
function gdiExports(): any[] {
  exportsMade ??= Gdi.exports;

  return exportsMade;
}

/** A function's ordinal in GDI, by its name; nought for none. */
function ordinalOf(name: string) {
  return Math.max(
    gdiExports().findIndex((one: any) => one && one[1] === name),
    0
  );
}

/**
 * The stack a call's arguments make, less its device context: the last
 * pushed lowest, each as its type is wide; a string at its address.
 */
function stackOf(name: string, args: any[]) {
  const types = (gdiExports()[ordinalOf(name)]?.[3] ?? []).slice(1);
  const bytes: number[] = [];

  for (let at = types.length - 1; at >= 0; at--) {
    const value = args[at + 1];
    const number =
      typeof value === 'object' && value !== null && 'segment' in value
        ? ((value.segment << 16) | value.offset) >>> 0
        : Number(value ?? 0) >>> 0;

    bytes.push(...wordsOf(number & 0xffff));

    if (Types.sizeof(types[at]) === 4) {
      bytes.push(...wordsOf(number >>> 16));
    }
  }

  return bytes;
}

/** One of GDI's own functions, by name. */
function gdiCall(system: any, name: string, args: any[]) {
  const entry = gdiExports().find((one: any) => one && one[1] === name);

  return entry ? entry[0].apply(system, args) : 0;
}

/** A handle table: the places a record's objects are made into and found in. */
interface Table {
  get(slot: number): number;
  set(slot: number, handle: number): void;
  size: number;
}

/**
 * Plays one record at `far` into a device context, its objects in `table`.
 * Calls given only numbers are made again from the record's words, as
 * their stack was; the rest are taken apart as `recordCall` put them
 * together.
 */
async function playRecord(system: any, hdc: number, far: number, table: Table) {
  const core = system.machine.cpu.core;
  const byte = (at: number) => {
    const from = farAt(far, at);

    return core.read8((from >>> 16) & 0xffff, from & 0xffff);
  };
  const word = (at: number) => byte(at) | (byte(at + 1) << 8);
  const signed = (at: number) => (word(at) << 16) >> 16;
  const size = (word(0) | (word(2) << 16)) >>> 0;
  const fn = word(4);
  const exports = gdiExports();
  /* Played into a metafile's context, each call is kept there, as a
   * program's call is: GDI plays a record through the function itself
   * (seg19 `0826`), which keeps it. */
  const into = system.handles.resolve(hdc);
  const recording = into instanceof MetafileDC ? into : null;
  const call = (name: string, ...args: any[]) =>
    recording && args[0] === hdc
      ? recordCall(system, recording, ordinalOf(name), name, args, stackOf(name, args))
      : gdiCall(system, name, args);
  /* The record's text, where it is as well, as a program's string is given
   * (`read-arguments.ts`): a printer driver's context hands the driver its
   * address (`printer-output.ts`, `farOf`). */
  const text = (at: number, count: number) => {
    const from = farAt(far, at);
    const string: any = new String(
      String.fromCharCode(...Array.from({ length: count }, (_, index) => byte(at + index)))
    );

    string.segment = (from >>> 16) & 0xffff;
    string.offset = from & 0xffff;
    return string;
  };
  const place = (handle: number) => {
    let slot = 0;

    while (slot < table.size && table.get(slot)) {
      slot++;
    }

    if (slot < table.size) {
      table.set(slot, handle);
    }
  };

  switch (fn) {
    case META_CREATEPENINDIRECT:
      place(await call('CreatePen', signed(6), signed(8), (word(12) | (word(14) << 16)) >>> 0));
      return;

    case META_CREATEBRUSHINDIRECT: {
      const style = word(6);
      const color = (word(8) | (word(10) << 16)) >>> 0;

      if (style === 2) {
        place(await call('CreateHatchBrush', signed(12), color));
      } else if (style === 1) {
        const brush: any = new Brush(new Color(0, 0, 0, 0));

        brush.logbrush = { style: 1, color: 0, hatch: 0 };
        place(system.handles.allocate(brush));
      } else {
        place(await call('CreateSolidBrush', color));
      }

      return;
    }

    case META_CREATEFONTINDIRECT: {
      let face = '';

      for (let at = 24; at < size * 2 && byte(at); at++) {
        face += String.fromCharCode(byte(at));
      }

      place(
        await call('CreateFontIndirect', {
          lfHeight: signed(6),
          lfWidth: signed(8),
          lfEscapement: signed(10),
          lfOrientation: signed(12),
          lfWeight: signed(14),
          lfItalic: byte(16),
          lfUnderline: byte(17),
          lfStrikeOut: byte(18),
          lfCharSet: byte(19),
          lfOutPrecision: byte(20),
          lfClipPrecision: byte(21),
          lfQuality: byte(22),
          lfPitchAndFamily: byte(23),
          lfFaceName: face,
        })
      );
      return;
    }

    case META_SELECTOBJECT:
      await call('SelectObject', hdc, table.get(word(6)));
      return;

    case META_DELETEOBJECT:
      await call('DeleteObject', table.get(word(6)));
      table.set(word(6), 0);
      return;

    case META_TEXTOUT: {
      const count = word(6);
      const after = 8 + ((count + 1) & ~1);

      await call('TextOut', hdc, signed(after + 2), signed(after), text(8, count), count);
      return;
    }

    case META_EXTTEXTOUT: {
      const count = word(10);
      const options = word(12);
      const hasRect = (options & (ETO_OPAQUE | ETO_CLIPPED)) !== 0;
      const start = 14 + (hasRect ? 8 : 0);

      await call(
        'ExtTextOut',
        hdc,
        signed(8),
        signed(6),
        options,
        hasRect ? farAt(far, 14) : 0,
        text(start, count),
        count,
        0
      );
      return;
    }

    case META_POLYGON:
    case META_POLYLINE:
      await call(fn === META_POLYGON ? 'Polygon' : 'Polyline', hdc, farAt(far, 8), word(6));
      return;

    /* The points after the counts (seg19 `0ef5`). */
    case META_POLYPOLYGON:
      await call('PolyPolygon', hdc, farAt(far, 8 + word(6) * 2), farAt(far, 8), word(6));
      return;

    /* A region made of the record's scans (seg19 `10d7`). */
    case META_CREATEREGION: {
      const rows: [number, number, number][] = [];
      let at = 28;

      for (let scan = 0; scan < word(16) && at < size * 2; scan++) {
        const sides = word(at);
        const top = signed(at + 2);
        const bottom = signed(at + 4);

        for (let y = top; y < bottom; y++) {
          for (let side = 0; side + 1 < sides; side += 2) {
            rows.push([y, signed(at + 6 + side * 2), signed(at + 8 + side * 2)]);
          }
        }

        at += 8 + sides * 2;
      }

      place(system.handles.allocate(new Region(ClipRegion.fromSpans(rows))) ?? 0);
      return;
    }

    /* The region by its place, and the brush (seg19 `109b`, `1057`, `1079`). */
    case META_FILLREGION:
      if (table.get(word(6)) && table.get(word(8))) {
        await call('FillRgn', hdc, table.get(word(6)), table.get(word(8)));
      }
      return;

    case META_PAINTREGION:
    case META_INVERTREGION:
      if (table.get(word(6))) {
        await call(fn === META_PAINTREGION ? 'PaintRgn' : 'InvertRgn', hdc, table.get(word(6)));
      }
      return;
  }

  /* A call given only numbers: its words are its stack, less the device
   * context. */
  const entry = exports[ordinalOfFunction(fn)];

  if (!entry || !BY_STACK.has(entry[1])) {
    return;
  }

  const types = (entry[3] ?? []).slice(1);
  const values: number[] = [];
  let at = 6;

  for (const type of [...types].reverse()) {
    if (Types.sizeof(type) === 4) {
      values.push((word(at) | (word(at + 2) << 16)) >>> 0);
      at += 4;
    } else {
      values.push(Types.signed(type) ? signed(at) : word(at));
      at += 2;
    }
  }

  if (recording) {
    recordCall(
      system,
      recording,
      ordinalOfFunction(fn),
      entry[1],
      [hdc, ...[...values].reverse()],
      Array.from({ length: at - 6 }, (_, n) => byte(6 + n))
    );
    return;
  }

  await entry[0].apply(system, [hdc, ...values.reverse()]);
}

/** Plays a metafile into a device context; the objects it made are deleted after. */
export async function PlayMetaFile(this: any, hdc: number, hmf: number) {
  const file = await openMetafile(this, hmf);

  if (!file) {
    return 0;
  }

  const handles = new Array(file.objects).fill(0);
  const table: Table = {
    get: (slot) => handles[slot] ?? 0,
    set: (slot, handle) => {
      handles[slot] = handle;
    },
    size: file.objects,
  };

  for (const record of recordsOf(file)) {
    await playRecord(this, hdc, farAt(file.far, record.at), table);
  }

  file.done();

  for (const handle of handles) {
    if (handle) {
      await gdiCall(this, 'DeleteObject', [handle]);
    }
  }

  return 1;
}

/**
 * Calls a procedure with each record of a metafile but the last, a handle
 * table of as many objects as its header says, and that count; stops when
 * it answers nought.
 */
export async function EnumMetaFile(
  this: any,
  hdc: number,
  hmf: number,
  lpMFFunc: number,
  lParam: number
) {
  const file = await openMetafile(this, hmf);

  if (!file) {
    return 0;
  }

  const block = GlobalAlloc.call(this, 0x0042, Math.max(file.objects * 2, 2));
  const table = globalPointer.call(this, block) >>> 0;

  for (const record of recordsOf(file)) {
    const answer = await this.scheduler.callProc(
      lpMFFunc,
      [
        [hdc, HDC],
        [table, FARPTR],
        [farAt(file.far, record.at), FARPTR],
        [file.objects, INT],
        [lParam >>> 0, LPARAM],
      ],
      this.scheduler.stackRegisters()
    );

    if (!(answer & 0xffff)) {
      break;
    }
  }

  file.done();

  /* The objects the records made, deleted as `PlayMetaFile` deletes them. */
  const core = this.machine.cpu.core;

  for (let slot = 0; slot < file.objects; slot++) {
    const handle = core.read16((table >>> 16) & 0xffff, ((table & 0xffff) + slot * 2) & 0xffff);

    if (handle) {
      await gdiCall(this, 'DeleteObject', [handle]);
    }
  }

  GlobalFree.call(this, block);

  return 1;
}

/** Plays one record, its objects in a program's handle table. */
export async function PlayMetaFileRecord(
  this: any,
  hdc: number,
  lpHandletable: number,
  lpMetaRecord: number,
  cHandles: number
) {
  const core = this.machine.cpu.core;
  const segment = (lpHandletable >>> 16) & 0xffff;
  const offset = lpHandletable & 0xffff;
  const table: Table = {
    get: (slot) => core.read16(segment, (offset + slot * 2) & 0xffff),
    set: (slot, handle) => core.write16(segment, (offset + slot * 2) & 0xffff, handle & 0xffff),
    size: cHandles,
  };

  await playRecord(this, hdc, lpMetaRecord >>> 0, table);
}

/** A metafile's handle is its bits' block: the same handle. */
export function GetMetaFileBits(this: any, hmf: number) {
  return metafileOf(this, hmf) ? hmf : 0;
}

export function SetMetaFileBits(this: any, hMem: number) {
  const file = metafileOf(this, hMem);

  if (!file) {
    return 0;
  }

  file.done();

  return hMem;
}

export function IsValidMetaFile(this: any, hmf: number) {
  const file = metafileOf(this, hmf);

  if (!file) {
    return 0;
  }

  file.done();

  return 1;
}

export function DeleteMetaFile(this: any, hmf: number) {
  if (!hmf || !GlobalSize.call(this, hmf)) {
    return 0;
  }

  GlobalFree.call(this, hmf);

  return 1;
}

/**
 * A copy: to a file, one on disk; to none, one in memory. A copy from one
 * kind to the other says three words more in its size (`diskmeta`).
 */
export async function CopyMetaFile(this: any, hmf: number, lpszFile: any) {
  const content = await contentOf(this, hmf);

  if (!content) {
    return 0;
  }

  const bytes = [...content.bytes];

  if (content.disk !== !!lpszFile) {
    const size = (bytes[6] | (bytes[7] << 8) | (bytes[8] << 16) | (bytes[9] << 24)) + 3;

    bytes.splice(6, 4, ...wordsOf(size & 0xffff, size >>> 16));
  }

  /* One in memory to memory is its block, every byte of it (seg20
   * `207d`-`20ad`). */
  if (!lpszFile && !content.disk) {
    const far = globalPointer.call(this, hmf) >>> 0;
    const core = this.machine.cpu.core;
    const block = Array.from({ length: GlobalSize.call(this, hmf) >>> 0 }, (_, at) => {
      const from = farAt(far, at);

      return core.read8((from >>> 16) & 0xffff, from & 0xffff);
    });

    return writeBlock(this, block);
  }

  if (!lpszFile) {
    return writeBlock(this, bytes);
  }

  const path = fullPath(this, String(lpszFile));

  if (!(await writeFile(this, path, bytes))) {
    return 0;
  }

  return diskHandle(this, bytes, path);
}

/** A metafile on disk, by its file's name: nought where there is none. */
export async function GetMetaFile(this: any, lpszFile: any) {
  if (!lpszFile) {
    return 0;
  }

  const path = fullPath(this, String(lpszFile));
  const bytes = await readFile(this, path);

  if (!bytes || bytes.length < 18 || (bytes[0] | (bytes[1] << 8)) !== 1) {
    return 0;
  }

  return diskHandle(this, bytes, path);
}
