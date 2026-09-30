'use strict';

import { Brush } from '../../raster/brush.js';
import { Color } from '../../raster/color.js';
import { Pen } from '../../raster/pen.js';
import { GlobalAlloc } from '../kernel/GlobalAlloc.js';
import { GlobalFree } from '../kernel/GlobalFree.js';
import { GlobalLock } from '../kernel/GlobalLock.js';
import { GlobalSize } from '../kernel/GlobalSize.js';
import { GlobalUnlock } from '../kernel/GlobalUnlock.js';
import { Gdi } from '../gdi.js';
import { FARPTR, HDC, INT, LPARAM, Types } from '../types.js';

/**
 * Metafiles: GDI calls kept as records to be played again. **Recorded** by
 * `metafile`, which records calls into a memory metafile, dumps its bytes,
 * and plays it back whole and a record at a time.
 *
 * * A metafile is a header of nine words -- its kind, 1 for memory; 9, the
 *   header's own size; version 300h; its size in words; how many objects
 *   its handle table needs; its largest record in words; and nought -- then
 *   its records, and a record of three words that ends it.
 * * A record is its size in words, a doubleword; its function, a word; then
 *   what the call was given. For a call given only numbers, that is the
 *   call's own stack less the device context: its arguments last first, as
 *   they were pushed. The function's low byte is the call's ordinal in GDI
 *   and its high byte how many words those were: `Rectangle` is 041Bh.
 * * Where a call is given a pointer, the record holds what it points at:
 *   `TextOut` its count, then the text padded to a word, then y and x;
 *   `Polygon` and `Polyline` the count, then the points in order;
 *   `ExtTextOut` y, x, the count, the options, the rectangle, then the text.
 * * An object selected is made first, in the lowest free place of the
 *   metafile's handle table: a pen by `CreatePenIndirect` (02FAh) with its
 *   `LOGPEN`, a brush by `CreateBrushIndirect` (02FCh) with its `LOGBRUSH`, a
 *   font by `CreateFontIndirect` (02FBh) with its `LOGFONT`, the face name
 *   and its nought and two bytes more, to a word. Then `SelectObject`
 *   (012Dh) names its place. A stock object is made so too: the black pen
 *   with its width nought. `DeleteObject` of an object a metafile holds adds
 *   01F0h with its place there, and frees it.
 * * Every call made into a metafile's device context answers 1.
 * * A metafile's handle is the global block of its bytes: `GetMetaFileBits`
 *   and `SetMetaFileBits` give the same handle back. The block holds more
 *   than the metafile.
 * * `EnumMetaFile` calls its procedure with each record but the last, a
 *   handle table of as many objects as the header says, and that count;
 *   `PlayMetaFileRecord` plays one, as `PlayMetaFile` plays them all.
 *
 * Recorded only by the stack rule, not by `metafile` itself: `SetBkColor`,
 * `SetMapMode`, `SetPolyFillMode`, `SetStretchBltMode`,
 * `SetTextCharacterExtra`, `SetTextJustification`, the window and viewport
 * calls, `ExcludeClipRect`, `OffsetClipRgn`, `FloodFill`, `Pie` and `Chord`.
 * Not done: metafiles on disk, bitmaps, regions and palettes in a metafile,
 * and `PolyPolygon`; a call into a metafile that is not kept answers
 * nought.
 */

export class MetafileDC {
  /** The records made so far, bytes. */
  readonly bytes: number[] = [];
  /** The handle table: each place's object's handle, or nought. */
  readonly slots: number[] = [];
  /** The largest record in words, the ending one's three at least. */
  largest = 3;
}

/** The metafile device contexts open, which `DeleteObject` tells. */
function openMetafiles(system: any): Set<MetafileDC> {
  return (system._metafiles ??= new Set());
}

/** Calls given only numbers, kept as their stack: measured, and by the same rule. */
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
]);

const META_SELECTOBJECT = 0x012d;
const META_DELETEOBJECT = 0x01f0;
const META_CREATEPENINDIRECT = 0x02fa;
const META_CREATEFONTINDIRECT = 0x02fb;
const META_CREATEBRUSHINDIRECT = 0x02fc;
const META_TEXTOUT = 0x0521;
const META_EXTTEXTOUT = 0x0a32;
const META_POLYGON = 0x0324;
const META_POLYLINE = 0x0325;

const ETO_OPAQUE = 2;
const ETO_CLIPPED = 4;

/** Words as bytes, low first. */
function wordsOf(...words: number[]) {
  return words.flatMap((word) => [word & 0xff, (word >> 8) & 0xff]);
}

function emit(meta: MetafileDC, fn: number, params: number[]) {
  const padded = params.length & 1 ? [...params, 0] : params;
  const size = 3 + padded.length / 2;

  meta.bytes.push(...wordsOf(size & 0xffff, size >>> 16, fn), ...padded);
  meta.largest = Math.max(meta.largest, size);
}

function colorrefOf(color: any) {
  if (!color) {
    return 0;
  }

  return (color.red | (color.green << 8) | (color.blue << 16)) >>> 0;
}

/** The record that makes an object, or null for one a metafile does not keep. */
function makingOf(item: any): [number, number[]] | null {
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
    if ((item as any).pattern) {
      return null;
    }

    const logbrush = (item as any).logbrush ?? {
      style: item.color?.alpha === 0 ? 1 : 0,
      color: item.color?.alpha === 0 ? 0 : colorrefOf(item.color),
      hatch: 0,
    };

    return [
      META_CREATEBRUSHINDIRECT,
      wordsOf(logbrush.style, logbrush.color & 0xffff, logbrush.color >>> 16, logbrush.hatch),
    ];
  }

  const logfont = item?.logfont;

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

function selectInto(system: any, meta: MetafileDC, handle: number) {
  let slot = meta.slots.indexOf(handle);

  if (slot < 0) {
    const making = makingOf(system.handles.resolve(handle));

    if (!making) {
      return 0;
    }

    slot = meta.slots.indexOf(0);
    slot = slot < 0 ? meta.slots.length : slot;
    meta.slots[slot] = handle;
    emit(meta, making[0], making[1]);
  }

  emit(meta, META_SELECTOBJECT, wordsOf(slot));

  return 1;
}

/** An object deleted: taken out of every metafile being recorded that holds it. */
export function forgetInMetafiles(system: any, handle: number) {
  for (const meta of openMetafiles(system)) {
    const slot = meta.slots.indexOf(handle);

    if (slot >= 0) {
      emit(meta, META_DELETEOBJECT, wordsOf(slot));
      meta.slots[slot] = 0;
    }
  }
}

function bytesAt(system: any, far: number, count: number) {
  const core = system.machine.cpu.core;

  return Array.from({ length: Math.max(count, 0) }, (_, at) =>
    core.read8((far >>> 16) & 0xffff, ((far & 0xffff) + at) & 0xffff)
  );
}

/**
 * A GDI call made into a metafile's device context, kept as a record.
 * Answers what the call answers there: 1 kept, nought not.
 */
export function recordCall(
  system: any,
  meta: MetafileDC,
  ordinal: number,
  name: string,
  args: any[],
  stack: number[]
) {
  const fn = ((stack.length / 2) << 8) | (ordinal & 0xff);

  if (BY_STACK.has(name) && ordinal < 0x100) {
    emit(meta, fn, stack);
    return 1;
  }

  switch (name) {
    case 'SelectObject':
      return selectInto(system, meta, args[1]);

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

    case 'ExtTextOut': {
      const [, x, y, options, lprc, text, count] = args;
      const rect = lprc ? bytesAt(system, lprc, 8) : [];
      const bytes = Array.from(
        String(text ?? '').slice(0, count),
        (char) => char.charCodeAt(0) & 0xff
      );

      emit(meta, META_EXTTEXTOUT, [
        ...wordsOf(y, x, count, options),
        ...rect,
        ...bytes,
        ...(count & 1 ? [0] : []),
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
  }

  return 0;
}

export function CreateMetaFile(this: any, lpszFile: any) {
  /* A metafile on disk is not kept yet. */
  if (lpszFile) {
    return 0;
  }

  const meta = new MetafileDC();

  openMetafiles(this).add(meta);

  return this.handles.allocate(meta);
}

/** A far pointer `offset` bytes into a block, across its 64K pieces. */
function farAt(far: number, offset: number) {
  const segment = ((far >>> 16) + ((offset >>> 16) << 3)) & 0xffff;

  return ((segment << 16) | (((far & 0xffff) + (offset & 0xffff)) & 0xffff)) >>> 0;
}

function writeBlock(system: any, bytes: number[]) {
  const block = GlobalAlloc.call(system, 0x0002, bytes.length);
  const far = GlobalLock.call(system, block) >>> 0;
  const core = system.machine.cpu.core;

  bytes.forEach((byte, at) => {
    const to = farAt(far, at);

    core.write8((to >>> 16) & 0xffff, to & 0xffff, byte);
  });

  GlobalUnlock.call(system, block);

  return block;
}

export function CloseMetaFile(this: any, hdc: number) {
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

  return writeBlock(this, [...header, ...meta.bytes, ...end]);
}

/** A metafile's bytes, from its block. */
function metafileOf(system: any, hmf: number) {
  const far = hmf ? GlobalLock.call(system, hmf) >>> 0 : 0;

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
    GlobalUnlock.call(system, hmf);
    return null;
  }

  return {
    far,
    byte,
    word,
    dword,
    header: word(2),
    objects: word(10),
    done: () => GlobalUnlock.call(system, hmf),
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
  const call = (name: string, ...args: any[]) => gdiCall(system, name, args);
  const text = (at: number, count: number) =>
    String.fromCharCode(...Array.from({ length: count }, (_, index) => byte(at + index)));
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
  }

  /* A call given only numbers: its words are its stack, less the device
   * context. */
  const entry = exports[fn & 0xff];

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

  await entry[0].apply(system, [hdc, ...values.reverse()]);
}

/** Plays a metafile into a device context; the objects it made are deleted after. */
export async function PlayMetaFile(this: any, hdc: number, hmf: number) {
  const file = metafileOf(this, hmf);

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
  const file = metafileOf(this, hmf);

  if (!file) {
    return 0;
  }

  const block = GlobalAlloc.call(this, 0x0042, Math.max(file.objects * 2, 2));
  const table = GlobalLock.call(this, block) >>> 0;

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

  GlobalUnlock.call(this, block);
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
  return metafileOf(this, hmf) ? (GlobalUnlock.call(this, hmf), hmf) : 0;
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

/** A copy in memory; one on disk is not made yet. */
export function CopyMetaFile(this: any, hmf: number, lpszFile: any) {
  const file = metafileOf(this, hmf);

  if (!file || lpszFile) {
    file?.done();
    return 0;
  }

  const bytes = Array.from({ length: file.dword(6) * 2 }, (_, at) => file.byte(at));

  file.done();

  return writeBlock(this, bytes);
}

export function GetMetaFile(this: any, _lpszFile: any) {
  return 0;
}
