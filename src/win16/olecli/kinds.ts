'use strict';

import { B, D, W, buffer } from '../commdlg/api.js';
import {
  BM_BITMAP,
  BM_HEIGHT,
  BM_SIZE,
  BM_WIDTH,
  CF_BITMAP,
  CF_DIB,
  CF_METAFILEPICT,
  DIB_DATA,
  DIB_SIZE,
  FORMAT_NAME,
  FORMAT_NAME_SIZE,
  GEN_CLASS,
  GEN_DATA,
  GEN_FORMAT,
  GEN_SIZE,
  GMEM_MOVEABLE,
  type Kind,
  LOGPIXELSX,
  LOGPIXELSY,
  LE_BLOCK,
  MF_BLOCK,
  MF_METAFILE,
  MF_MM,
  MF_PICTURE,
  MF_SIZE,
  MF_XEXT,
  MF_YEXT,
  MM_ANISOTROPIC,
  OBJ_HEIGHT,
  OBJ_MAPPING,
  OBJ_WIDTH,
  OLE_ERROR_FORMAT,
  OLE_ERROR_GENERIC,
  OLE_ERROR_MEMORY,
  OLE_ERROR_NOT_EQUAL,
  OLE_ERROR_STREAM,
  OLE_OK,
  OT_STATIC,
  Ole,
  SCRATCH,
  SMALL_BLOCK,
  STREAM_VERSION,
  bytesOf,
  far,
  plus,
  signed16,
} from './core.js';
import { freeObject, newObject } from './objects.js';
import { get, getLong, put, putBytes, putLong, putName } from './streams.js';

/**
 * The static kinds -- a picture, a bitmap, a DIB -- and an object of another
 * class read from a stream: how each is made from the clipboard or a stream,
 * and its own methods, the 300s, 400s, 500s and 600s of `OLECLI`'s exports.
 * Their calls into GDI, USER and KERNEL are the ones `OLECLI.DLL` makes,
 * each seen with its arguments as WinBox ran the file (the probes' runs);
 * their answers **recorded** by `olestat` and **measured** by `olemem`. As
 * `crates/winbox-win16/src/olecli/kinds.rs`.
 */

/** Each kind's class, as a stream names it, and its clipboard format. */
export const CLASS_OF: Record<Exclude<Kind, 'gen' | 'le'>, string> = {
  mf: 'METAFILEPICT',
  bm: 'BITMAP',
  dib: 'DIB',
};
export const FORMAT_OF: Record<Exclude<Kind, 'gen' | 'le'>, number> = {
  mf: CF_METAFILEPICT,
  bm: CF_BITMAP,
  dib: CF_DIB,
};

/** A signed number as a doubleword, as the bounds are kept. */
const long = (value: number) => signed16(value) >>> 0;

/** The bounds kept: width, and height made negative. */
function setBounds(ole: Ole, object: number, width: number, height: number) {
  ole.w32(plus(object, OBJ_WIDTH), long(width));
  ole.w32(plus(object, OBJ_HEIGHT), long(height));
}

// A picture.

/**
 * A picture's own made from a `METAFILEPICT`'s fields: its metafile copied
 * with `CopyMetaFile` (the caller's copy, or the one given), its size its
 * bits' block's and the `METAFILEPICT`'s eight bytes, its bounds the
 * extents when the width is more than nought, else nought (**measured**
 * by `olemem`'s `mode` records). Only `MM_ANISOTROPIC` is taken: any other
 * mode is `OLE_ERROR_MEMORY`, the copy deleted.
 */
async function setPicture(
  ole: Ole,
  object: number,
  mm: number,
  xExt: number,
  yExt: number,
  metafile: number
): Promise<number> {
  if (mm !== MM_ANISOTROPIC) {
    await ole.gdi('DeleteMetafile', [W(metafile)]);
    return OLE_ERROR_MEMORY;
  }

  const bits = (await ole.gdi('GetMetafileBits', [W(metafile)])) & 0xffff;
  const size = await ole.globalSize(bits);
  const again = (await ole.gdi('SetMetafileBits', [W(bits)])) & 0xffff;

  ole.w32(plus(object, MF_SIZE), (size + 8) >>> 0);
  ole.w16(plus(object, MF_MM), mm);
  ole.w16(plus(object, MF_XEXT), xExt);
  ole.w16(plus(object, MF_YEXT), yExt);
  ole.w16(plus(object, MF_METAFILE), again);
  ole.w16(plus(object, OBJ_MAPPING), mm);

  const x = signed16(xExt);

  setBounds(ole, object, x > 0 ? x : 0, x > 0 ? -signed16(yExt) : 0);
  return OLE_OK;
}

async function pictureFrom(ole: Ole, object: number, handle: number) {
  const at = await ole.globalLock(handle);
  const mm = ole.r16(at);
  const xExt = ole.r16(plus(at, 2));
  const yExt = ole.r16(plus(at, 4));
  const metafile = ole.r16(plus(at, 6));

  await ole.globalUnlock(handle);

  const copy = (await ole.gdi('CopyMetafile', [W(metafile), D(0)])) & 0xffff;

  return setPicture(ole, object, mm, xExt, yExt, copy);
}

// A bitmap.

/** A bitmap's `BITMAP`, by `GetObject`: its fourteen bytes. */
async function bitmapInfo(ole: Ole, bitmap: number): Promise<number[]> {
  const called = await ole.callB('GDI', 'GetObject', [W(bitmap), W(14), buffer(14)]);

  return called.buffers[0];
}

const word = (bytes: number[], at: number) => bytes[at] | (bytes[at + 1] << 8);

/** A bitmap's bits' size, as `OLECLI` counts it: bytes to a row, rows, planes and bits to a pixel. */
const bitsSize = (info: number[]) => word(info, 6) * word(info, 4) * info[8] * info[9];

/** A bitmap copied, as `OLECLI` copies one: its bits through a block into a bitmap `CreateBitmap` made of its shape. */
async function copyBitmap(ole: Ole, bitmap: number): Promise<[number, number[]]> {
  const info = await bitmapInfo(ole, bitmap);
  const size = bitsSize(info);
  const block = await ole.globalAlloc(GMEM_MOVEABLE, size);
  const bits = await ole.globalLock(block);

  await ole.gdi('GetBitmapBits', [W(bitmap), D(size), D(bits)]);

  const copy =
    (await ole.gdi('CreateBitmap', [
      W(word(info, 2)),
      W(word(info, 4)),
      W(info[8]),
      W(info[9]),
      D(0),
    ])) & 0xffff;

  await ole.gdi('SetBitmapBits', [W(copy), D(size), D(bits)]);
  await ole.globalUnlock(block);
  await ole.globalFree(block);
  return [copy, info];
}

/**
 * A bitmap's own kept: its copy, its size (the `BITMAP` and the bits), and
 * its bounds -- its dimension's, ten to a unit, where the bitmap it came
 * from has one, else its pixels at the screen's resolution in `MM_HIMETRIC`
 * (**measured** by `olemem`'s `bounds`).
 */
async function setBitmap(ole: Ole, object: number, from: number, copy: number, info: number[]) {
  ole.w32(plus(object, BM_SIZE), 14 + bitsSize(info));
  ole.w16(plus(object, BM_WIDTH), word(info, 2));
  ole.w16(plus(object, BM_HEIGHT), word(info, 4));
  ole.w16(plus(object, BM_BITMAP), copy);

  const dimension = await ole.gdi('GetBitmapDimension', [W(from)]);

  if (dimension) {
    setBounds(ole, object, signed16(dimension) * 10, -signed16(dimension >>> 16) * 10);
    return;
  }

  const dc = await ole.getDC();
  const width = await ole.mulDiv(word(info, 2), 2540, await ole.deviceCaps(dc, LOGPIXELSX));
  const height = await ole.mulDiv(word(info, 4), 2540, await ole.deviceCaps(dc, LOGPIXELSY));

  await ole.releaseDC(dc);
  setBounds(ole, object, width, -height);
}

async function bitmapFrom(ole: Ole, object: number, bitmap: number) {
  const [copy, info] = await copyBitmap(ole, bitmap);

  await setBitmap(ole, object, bitmap, copy, info);
  return OLE_OK;
}

// A DIB.

/** A global block copied: a block `GMEM_MOVEABLE` its size, the bytes. */
export async function copyBlock(ole: Ole, handle: number): Promise<number> {
  const from = await ole.globalLock(handle);
  const size = await ole.globalSize(handle);
  const copy = await ole.globalAlloc(GMEM_MOVEABLE, size);

  if (copy) {
    const to = await ole.globalLock(copy);

    ole.copy(from, to, size);
    await ole.globalUnlock(handle);
    await ole.globalUnlock(copy);
  } else {
    await ole.globalUnlock(handle);
  }

  return copy;
}

/**
 * A DIB's bounds from its header: its pels to a metre, the screen's
 * resolution's where nought (and written so into the header), its width and
 * height in hundredths of a millimetre, as words (**measured** by
 * `olemem`'s `bounds`: 2000, nought, -5).
 */
async function dibBounds(ole: Ole, object: number, data: number) {
  const header = await ole.globalLock(data);
  const width = ole.r32(plus(header, 4)) | 0;
  const height = ole.r32(plus(header, 8)) | 0;
  let x = ole.r32(plus(header, 24)) | 0;
  let y = ole.r32(plus(header, 28)) | 0;

  if (!x || !y) {
    const dc = await ole.getDC();

    if (!x) {
      x = await ole.mulDiv(await ole.deviceCaps(dc, LOGPIXELSX), 10000, 254);
      ole.w32(plus(header, 24), x >>> 0);
    }

    if (!y) {
      y = await ole.mulDiv(await ole.deviceCaps(dc, LOGPIXELSY), 10000, 254);
      ole.w32(plus(header, 28), y >>> 0);
    }

    await ole.releaseDC(dc);
  }

  await ole.globalUnlock(data);
  setBounds(ole, object, Math.trunc((width * 100000) / x), -Math.trunc((height * 100000) / y));
}

async function dibFrom(ole: Ole, object: number, handle: number) {
  const copy = await copyBlock(ole, handle);

  if (!copy) {
    return OLE_ERROR_MEMORY;
  }

  ole.w32(plus(object, DIB_SIZE), await ole.globalSize(copy));
  ole.w16(plus(object, DIB_DATA), copy);
  await dibBounds(ole, object, copy);
  return OLE_OK;
}

// Making one.

/** Each kind's block's size. */
export const BLOCK_OF: Record<Kind, number> = {
  le: LE_BLOCK,
  mf: MF_BLOCK,
  bm: SMALL_BLOCK,
  dib: SMALL_BLOCK,
  gen: SMALL_BLOCK,
};

/**
 * A static object made from what is on the clipboard in a format: its block,
 * then its own copy of the data. Its pointer written to `out`, or the error.
 */
export async function staticFromClipboard(
  ole: Ole,
  kind: Exclude<Kind, 'gen' | 'le'>,
  handle: number,
  client: number,
  doc: number,
  name: number,
  out: number
): Promise<number> {
  const object = await newObject(ole, kind, BLOCK_OF[kind], client, doc, name);

  if (!object) {
    return OLE_ERROR_MEMORY;
  }

  const made =
    kind === 'mf'
      ? await pictureFrom(ole, object, handle)
      : kind === 'bm'
        ? await bitmapFrom(ole, object, handle)
        : await dibFrom(ole, object, handle);

  if (made !== OLE_OK) {
    await freeObject(ole, object);
    return made;
  }

  ole.w32(out, object);
  return OLE_OK;
}

// The methods: release, get data, enumerate formats, bounds, size.

/** `MFRELEASE`, `BMRELEASE`, `DIBRELEASE`, `GENRELEASE` (300, 400, 500, 600), and `Delete`: its data let go, then its block. */
export async function release(ole: Ole, kind: Kind, object: number) {
  if (kind === 'mf') {
    await ole.gdi('DeleteMetafile', [W(ole.r16(plus(object, MF_METAFILE)))]);

    const picture = ole.r16(plus(object, MF_PICTURE));

    if (picture) {
      await ole.globalFree(picture);
    }
  } else if (kind === 'bm') {
    await ole.gdi('DeleteObject', [W(ole.r16(plus(object, BM_BITMAP)))]);
  } else if (kind === 'dib') {
    await ole.globalFree(ole.r16(plus(object, DIB_DATA)));
  } else {
    const data = ole.r16(plus(object, GEN_DATA));

    if (data) {
      await ole.globalFree(data);
    }

    await ole.deleteAtom(ole.r16(plus(object, GEN_CLASS)));
  }

  await freeObject(ole, object);
  return OLE_OK;
}

/** A kind's format: its clipboard format, or the format another class's stream gave. */
export function formatOf(ole: Ole, kind: Kind, object: number) {
  return kind === 'gen' ? ole.r16(plus(object, GEN_FORMAT)) : FORMAT_OF[kind];
}

/** `...ENUMFORMAT` (309, 409, 509, 610): its one format after nought, nought after it. */
export function enumFormat(ole: Ole, kind: Kind, object: number, format: number) {
  return format ? 0 : formatOf(ole, kind, object);
}

/**
 * `...GETDATA` (301, 401, 501, 601): in its format, its data's handle --
 * for a picture a `METAFILEPICT` made the first time it is asked for and
 * kept -- else `OLE_ERROR_FORMAT`.
 */
export async function getData(ole: Ole, kind: Kind, object: number, format: number, out: number) {
  if ((format & 0xffff) !== formatOf(ole, kind, object)) {
    return OLE_ERROR_FORMAT;
  }

  let handle: number;

  if (kind === 'mf') {
    handle = ole.r16(plus(object, MF_PICTURE));

    if (!handle) {
      handle = await ole.globalAlloc(GMEM_MOVEABLE, 8);

      const at = await ole.globalLock(handle);

      ole.w16(at, ole.r16(plus(object, MF_MM)));
      ole.w16(plus(at, 2), ole.r16(plus(object, MF_XEXT)));
      ole.w16(plus(at, 4), ole.r16(plus(object, MF_YEXT)));
      ole.w16(plus(at, 6), ole.r16(plus(object, MF_METAFILE)));
      await ole.globalUnlock(handle);
      ole.w16(plus(object, MF_PICTURE), handle);
    }
  } else if (kind === 'bm') {
    handle = ole.r16(plus(object, BM_BITMAP));
  } else if (kind === 'dib') {
    handle = ole.r16(plus(object, DIB_DATA));
  } else {
    handle = ole.r16(plus(object, GEN_DATA));
  }

  ole.w16(out, handle);
  return OLE_OK;
}

/**
 * `...CHANGEDATA` (310, 410, 510, 611): an object's data made again from a
 * handle of its format, as from the clipboard, the old let go, and the
 * handle let go too where the caller says so; no handle `OLE_ERROR_MEMORY`
 * (**measured** by `olemem`'s `other` records, NULL given). The rest
 * follows the OLE 1.0 reference's object handlers' `ChangeData`.
 */
export async function changeData(
  ole: Ole,
  kind: Kind,
  object: number,
  handle: number,
  _client: number,
  release: number
) {
  /* A picture's `METAFILEPICT` locked first: none to lock, the error. */
  if (kind === 'mf' && !(await ole.globalLock(handle))) {
    return OLE_ERROR_MEMORY;
  }

  if (kind === 'mf') {
    await ole.globalUnlock(handle);
  }

  if (!handle) {
    return OLE_ERROR_MEMORY;
  }

  if (kind === 'gen') {
    const answer = await genSetData(ole, object, ole.r16(plus(object, GEN_FORMAT)), handle);

    return answer;
  }

  if (kind === 'mf') {
    await ole.gdi('DeleteMetafile', [W(ole.r16(plus(object, MF_METAFILE)))]);

    const picture = ole.r16(plus(object, MF_PICTURE));

    if (picture) {
      await ole.globalFree(picture);
      ole.w16(plus(object, MF_PICTURE), 0);
    }
  } else if (kind === 'bm') {
    await ole.gdi('DeleteObject', [W(ole.r16(plus(object, BM_BITMAP)))]);
  } else {
    await ole.globalFree(ole.r16(plus(object, DIB_DATA)));
  }

  const answer =
    kind === 'mf'
      ? await pictureFrom(ole, object, handle)
      : kind === 'bm'
        ? await bitmapFrom(ole, object, handle)
        : await dibFrom(ole, object, handle);

  if (release & 0xffff) {
    if (kind === 'bm') {
      await ole.gdi('DeleteObject', [W(handle)]);
    } else {
      await ole.globalFree(handle);
    }
  }

  return answer;
}

/** `GENSETDATA` (602): another class's data replaced, in its format; another `OLE_ERROR_FORMAT`. */
export async function genSetData(ole: Ole, object: number, format: number, handle: number) {
  if ((format & 0xffff) !== ole.r16(plus(object, GEN_FORMAT))) {
    return OLE_ERROR_FORMAT;
  }

  const old = ole.r16(plus(object, GEN_DATA));

  if (old) {
    await ole.globalFree(old);
  }

  ole.w16(plus(object, GEN_DATA), handle);
  ole.w32(plus(object, GEN_SIZE), await ole.globalSize(handle));
  return OLE_OK;
}

/** `...QUERYBOUNDS` (307, 407, 507): nought, nought, the width and the height; another class's (608) noughts and `OLE_ERROR_GENERIC`. */
export function queryBounds(ole: Ole, kind: Kind, object: number, rect: number) {
  const width = kind === 'gen' ? 0 : ole.r32(plus(object, OBJ_WIDTH));
  const height = kind === 'gen' ? 0 : ole.r32(plus(object, OBJ_HEIGHT));

  ole.w16(rect, 0);
  ole.w16(plus(rect, 2), 0);
  ole.w16(plus(rect, 4), width);
  ole.w16(plus(rect, 6), height);
  return kind === 'gen' ? OLE_ERROR_GENERIC : OLE_OK;
}

/** A class's name's bytes: a static kind's, or another class's atom's. */
async function className(ole: Ole, kind: Kind, object: number): Promise<number[]> {
  if (kind !== 'gen') {
    return bytesOf(CLASS_OF[kind]);
  }

  const at = ole.near(SCRATCH);

  await ole.atomName(ole.r16(plus(object, GEN_CLASS)), at, 0x100);
  return ole.string(at);
}

/** Another class's format's name, as `GetClipboardFormatName` gives it; none for a format below C000h. */
async function formatName(ole: Ole, format: number): Promise<number[] | null> {
  if (format < 0xc000) {
    return null;
  }

  const at = ole.near(SCRATCH);

  await ole.user('GetClipboardFormatName', [W(format), D(at), W(0x100)]);
  return ole.string(at);
}

/** The data's size as a stream holds it. */
function dataSize(ole: Ole, kind: Kind, object: number) {
  return ole.r32(plus(object, kind === 'gen' ? GEN_SIZE : MF_SIZE));
}

/**
 * `OBJQUERYSIZE` (913): what `OleSaveToStream` would write -- the version,
 * the type, the class's name, then the bounds and the data's size and
 * data, or another class's format and its name, its data's size and data
 * (**recorded** by `olestat`; **measured** by `olemem`'s `noname`).
 */
export async function querySize(ole: Ole, kind: Kind, object: number, out: number) {
  const klass = await className(ole, kind, object);
  let size = 8 + 4 + klass.length + 1;

  if (kind === 'gen') {
    const name = await formatName(ole, ole.r16(plus(object, GEN_FORMAT)));

    size += 4 + (name ? 4 + name.length + 1 : 0) + 4;
  } else {
    size += 12;
  }

  if (kind === 'mf') {
    /* Its bits looked at, as for its stream. */
    const bits =
      (await ole.gdi('GetMetafileBits', [W(ole.r16(plus(object, MF_METAFILE)))])) & 0xffff;

    await ole.globalLock(bits);
    await ole.globalUnlock(bits);
    ole.w16(plus(object, MF_METAFILE), (await ole.gdi('SetMetafileBits', [W(bits)])) & 0xffff);
  } else if (kind === 'dib') {
    const data = ole.r16(plus(object, DIB_DATA));

    await ole.globalSize(data);
    await ole.globalLock(data);
    await ole.globalUnlock(data);
  } else if (kind === 'bm') {
    /* A bitmap's bits and its `BITMAP` fetched, as for its stream, into a
     * block let go again: what a later block of the same size holds before
     * it is written. */
    const bitmap = ole.r16(plus(object, BM_BITMAP));
    const count = ole.r32(plus(object, BM_SIZE)) - 14;
    const block = await ole.globalAlloc(GMEM_MOVEABLE, count);
    const at = await ole.globalLock(block);

    await ole.gdi('GetBitmapBits', [W(bitmap), D(count), D(at)]);
    await bitmapInfo(ole, bitmap);
    await ole.globalUnlock(block);
    await ole.globalFree(block);
  }

  ole.w32(out, (size + dataSize(ole, kind, object)) >>> 0);
  return OLE_OK;
}

// Streams.

/**
 * `...SAVETOSTREAM` (302, 402, 502, 603): the version, the type (static),
 * the class's name, then for a static kind its width, its height, its
 * data's size and its data -- a picture's `METAFILEPICT` and its bits, a
 * bitmap's `BITMAP` and its bits, a DIB's block -- and for another class
 * its format, the format's name where it is registered, its data's size
 * and its data. Each field a `Put` of its own (**recorded** by `olestat`).
 */
export async function saveToStream(
  ole: Ole,
  kind: Kind,
  object: number,
  stream: number,
  type = OT_STATIC
) {
  const ok =
    (await putLong(ole, stream, STREAM_VERSION)) &&
    (await putLong(ole, stream, type)) &&
    (await putName(ole, stream, await className(ole, kind, object)));

  if (!ok) {
    return OLE_ERROR_STREAM;
  }

  if (kind === 'gen') {
    const format = ole.r16(plus(object, GEN_FORMAT));
    const name = await formatName(ole, format);

    if (!(await putLong(ole, stream, name ? 0 : format))) {
      return OLE_ERROR_STREAM;
    }

    if (name && !(await putName(ole, stream, name))) {
      return OLE_ERROR_STREAM;
    }
  } else if (
    !(await putLong(ole, stream, ole.r32(plus(object, OBJ_WIDTH)))) ||
    !(await putLong(ole, stream, ole.r32(plus(object, OBJ_HEIGHT))))
  ) {
    return OLE_ERROR_STREAM;
  }

  const size = dataSize(ole, kind, object);

  if (!(await putLong(ole, stream, size))) {
    return OLE_ERROR_STREAM;
  }

  return (await putData(ole, kind, object, stream, size)) ? OLE_OK : OLE_ERROR_STREAM;
}

async function putData(ole: Ole, kind: Kind, object: number, stream: number, size: number) {
  if (kind === 'mf') {
    const header = [MF_MM, MF_XEXT, MF_YEXT, MF_METAFILE].flatMap((field) => {
      const value = ole.r16(plus(object, field));

      return [value & 0xff, value >> 8];
    });

    if (!(await putBytes(ole, stream, header))) {
      return false;
    }

    const bits =
      (await ole.gdi('GetMetafileBits', [W(ole.r16(plus(object, MF_METAFILE)))])) & 0xffff;
    const at = await ole.globalLock(bits);
    const ok = await put(ole, stream, at, size - 8);

    await ole.globalUnlock(bits);
    ole.w16(plus(object, MF_METAFILE), (await ole.gdi('SetMetafileBits', [W(bits)])) & 0xffff);
    return ok;
  }

  if (kind === 'bm') {
    const bitmap = ole.r16(plus(object, BM_BITMAP));
    const count = size - 14;
    const block = await ole.globalAlloc(GMEM_MOVEABLE, count);
    const at = await ole.globalLock(block);

    await ole.gdi('GetBitmapBits', [W(bitmap), D(count), D(at)]);

    const info = await bitmapInfo(ole, bitmap);
    const ok = (await putBytes(ole, stream, info)) && (await put(ole, stream, at, count));

    await ole.globalUnlock(block);
    await ole.globalFree(block);
    return ok;
  }

  const data = ole.r16(plus(object, kind === 'dib' ? DIB_DATA : GEN_DATA));
  const at = await ole.globalLock(data);
  const ok = await put(ole, stream, at, size);

  await ole.globalUnlock(data);
  return ok;
}

/**
 * A static stream's object read, the version and type already read and the
 * class's name given: its block made, then its fields. Its pointer, or the
 * error; what was made let go on an error.
 */
export async function loadStatic(
  ole: Ole,
  stream: number,
  klass: number[],
  client: number,
  doc: number,
  name: number,
  out: number
): Promise<number> {
  const text = String.fromCharCode(...klass);
  const kind = (Object.keys(CLASS_OF) as Exclude<Kind, 'gen' | 'le'>[]).find(
    (each) => CLASS_OF[each] === text
  );
  const classAtom = await ole.addAtomText(klass);
  const object = await newObject(ole, kind ?? 'gen', BLOCK_OF[kind ?? 'gen'], client, doc, name);

  if (!object) {
    await ole.deleteAtom(classAtom);
    return OLE_ERROR_MEMORY;
  }

  const read = kind
    ? await readStatic(ole, kind, object, stream)
    : await readOther(ole, object, stream, classAtom);

  if (kind || read !== OLE_OK) {
    await ole.deleteAtom(classAtom);
  }

  if (read !== OLE_OK) {
    if (!kind) {
      ole.w16(plus(object, GEN_CLASS), 0);
    }

    await freeObject(ole, object);
    return read;
  }

  ole.w32(out, object);
  return OLE_OK;
}

/** A block of `size` bytes read from the stream: its handle, or nought. */
export async function readBlock(ole: Ole, stream: number, size: number): Promise<number> {
  const block = await ole.globalAlloc(GMEM_MOVEABLE, size);

  if (!block) {
    return 0;
  }

  const at = await ole.globalLock(block);
  const ok = await get(ole, stream, at, size);

  await ole.globalUnlock(block);

  if (!ok) {
    await ole.globalFree(block);
    return 0;
  }

  return block;
}

export async function readStatic(
  ole: Ole,
  kind: Exclude<Kind, 'gen' | 'le'>,
  object: number,
  stream: number
) {
  const width = await getLong(ole, stream);
  const height = width === null ? null : await getLong(ole, stream);
  const size = height === null ? null : await getLong(ole, stream);

  if (width === null || height === null || size === null) {
    return OLE_ERROR_STREAM;
  }

  ole.w32(plus(object, OBJ_WIDTH), width);
  ole.w32(plus(object, OBJ_HEIGHT), height);

  if (kind === 'mf') {
    const at = ole.near(SCRATCH + 0x40);

    if (!(await get(ole, stream, at, 8))) {
      return OLE_ERROR_STREAM;
    }

    const mm = ole.r16(at);
    const xExt = ole.r16(plus(at, 2));
    const yExt = ole.r16(plus(at, 4));
    const bits = await readBlock(ole, stream, size - 8);

    if (!bits) {
      return OLE_ERROR_STREAM;
    }

    const metafile = (await ole.gdi('SetMetafileBits', [W(bits)])) & 0xffff;

    ole.w32(plus(object, MF_SIZE), size);
    ole.w16(plus(object, MF_MM), mm);
    ole.w16(plus(object, MF_XEXT), xExt);
    ole.w16(plus(object, MF_YEXT), yExt);
    ole.w16(plus(object, MF_METAFILE), metafile);
    ole.w16(plus(object, OBJ_MAPPING), mm);
    return OLE_OK;
  }

  if (kind === 'bm') {
    const at = ole.near(SCRATCH + 0x40);

    if (!(await get(ole, stream, at, 14))) {
      return OLE_ERROR_STREAM;
    }

    const info = ole.read(at, 14);
    const block = await readBlock(ole, stream, size - 14);

    if (!block) {
      return OLE_ERROR_STREAM;
    }

    const bits = await ole.globalLock(block);
    const bitmap =
      (await ole.gdi('CreateBitmap', [
        W(word(info, 2)),
        W(word(info, 4)),
        W(info[8]),
        W(info[9]),
        D(bits),
      ])) & 0xffff;

    await ole.globalUnlock(block);
    await ole.globalFree(block);
    ole.w32(plus(object, BM_SIZE), size);
    ole.w16(plus(object, BM_WIDTH), word(info, 2));
    ole.w16(plus(object, BM_HEIGHT), word(info, 4));
    ole.w16(plus(object, BM_BITMAP), bitmap);
    return OLE_OK;
  }

  const data = await readBlock(ole, stream, size);

  if (!data) {
    return OLE_ERROR_STREAM;
  }

  ole.w32(plus(object, DIB_SIZE), size);
  ole.w16(plus(object, DIB_DATA), data);
  return OLE_OK;
}

/**
 * Another class's object read: its format, or for nought a name's length
 * and that many bytes read over the name the last such stream left in
 * `OLECLI`'s buffer, the format registered by what the buffer then holds
 * (**measured** by `olemem`'s `noname`, whose stream gives a length of
 * nought and whose format is named as the stream before it named one);
 * then its data's size and data.
 */
export async function readOther(ole: Ole, object: number, stream: number, classAtom: number) {
  ole.w16(plus(object, GEN_CLASS), classAtom);

  let format = await getLong(ole, stream);

  if (format === null) {
    return OLE_ERROR_STREAM;
  }

  if (!format) {
    const length = await getLong(ole, stream);

    if (length === null) {
      return OLE_ERROR_STREAM;
    }

    const at = ole.near(FORMAT_NAME);

    if (length && !(await get(ole, stream, at, Math.min(length, FORMAT_NAME_SIZE)))) {
      return OLE_ERROR_STREAM;
    }

    format = (await ole.user('RegisterClipboardFormat', [D(at)])) & 0xffff;
  }

  ole.w16(plus(object, GEN_FORMAT), format);

  const size = await getLong(ole, stream);

  if (size === null) {
    return OLE_ERROR_STREAM;
  }

  const data = await readBlock(ole, stream, size);

  if (!data) {
    return OLE_ERROR_STREAM;
  }

  ole.w32(plus(object, GEN_SIZE), size);
  ole.w16(plus(object, GEN_DATA), data);
  return OLE_OK;
}

// Clone, equal, copy to the clipboard.

/** `...CLONE` (303, 403, 503, 604): another of its kind in the document given, its data copied. */
export async function clone(
  ole: Ole,
  kind: Kind,
  object: number,
  client: number,
  doc: number,
  name: number,
  out: number
) {
  let metafile = 0;

  if (kind === 'mf') {
    metafile =
      (await ole.gdi('CopyMetafile', [W(ole.r16(plus(object, MF_METAFILE))), D(0)])) & 0xffff;
  }

  const copy = await newObject(ole, kind, BLOCK_OF[kind], client, doc, name);

  if (!copy) {
    return OLE_ERROR_MEMORY;
  }

  ole.w32(plus(copy, OBJ_WIDTH), ole.r32(plus(object, OBJ_WIDTH)));
  ole.w32(plus(copy, OBJ_HEIGHT), ole.r32(plus(object, OBJ_HEIGHT)));
  ole.w16(plus(copy, OBJ_MAPPING), ole.r16(plus(object, OBJ_MAPPING)));

  if (kind === 'mf') {
    for (const field of [MF_SIZE, MF_SIZE + 2, MF_MM, MF_XEXT, MF_YEXT]) {
      ole.w16(plus(copy, field), ole.r16(plus(object, field)));
    }

    ole.w16(plus(copy, MF_METAFILE), metafile);
  } else if (kind === 'bm') {
    const bitmap = ole.r16(plus(object, BM_BITMAP));
    const [made, info] = await copyBitmap(ole, bitmap);

    await setBitmap(ole, copy, bitmap, made, info);
  } else {
    const field = kind === 'dib' ? DIB_DATA : GEN_DATA;
    const data = await copyBlock(ole, ole.r16(plus(object, field)));

    ole.w32(plus(copy, kind === 'dib' ? DIB_SIZE : GEN_SIZE), dataSize(ole, kind, object));
    ole.w16(plus(copy, field), data);

    if (kind === 'gen') {
      const at = ole.near(SCRATCH);

      ole.w16(plus(copy, GEN_FORMAT), ole.r16(plus(object, GEN_FORMAT)));
      await ole.atomName(ole.r16(plus(object, GEN_CLASS)), at, 0x100);
      ole.w16(plus(copy, GEN_CLASS), await ole.addAtom(at));
    }
  }

  ole.w32(out, copy);
  return OLE_OK;
}

/** Two blocks' bytes compared, `count` of them. */
function same(ole: Ole, a: number, b: number, count: number) {
  for (let i = 0; i < count; i++) {
    if (ole.r8(ole.huge(a, i)) !== ole.r8(ole.huge(b, i))) {
      return false;
    }
  }

  return true;
}

/**
 * `...EQUAL` (304, 404, 504, 605): a picture's bits, by `GetMetafileBits`,
 * their blocks' sizes and bytes; a DIB's blocks; another class's format and
 * block (**measured** by `olemem`'s `equal` and `other` records).
 *
 * A bitmap's (`BMEQUAL`, **read out** of `OLECLI.DLL` seg11 `00e4`): the
 * sizes first, `OLE_ERROR_NOT_EQUAL` where they differ; then each one's
 * bits by `GetBitmapBits` into a block of its size, the two counts
 * compared (`OLE_ERROR_NOT_EQUAL` where they differ) and the bytes by its
 * entry 1031 (seg3 `38a6`), which answers 1 for the same and nought for
 * not -- and `BMEQUAL` makes 1 `OLE_ERROR_NOT_EQUAL` and nought `OLE_OK`.
 * So bitmaps alike answer not equal and bitmaps that differ equal
 * (**recorded** by `olestat`, a bitmap and itself; **measured** by
 * `olemem`, two that differ). A block not had is `OLE_ERROR_MEMORY`.
 */
export async function equal(ole: Ole, kind: Kind, a: number, b: number) {
  if (kind === 'mf') {
    const first = (await ole.gdi('GetMetafileBits', [W(ole.r16(plus(a, MF_METAFILE)))])) & 0xffff;
    const second = (await ole.gdi('GetMetafileBits', [W(ole.r16(plus(b, MF_METAFILE)))])) & 0xffff;
    const answer = await sameBlocks(ole, first, second);

    ole.w16(plus(a, MF_METAFILE), (await ole.gdi('SetMetafileBits', [W(first)])) & 0xffff);
    ole.w16(plus(b, MF_METAFILE), (await ole.gdi('SetMetafileBits', [W(second)])) & 0xffff);
    return answer;
  }

  if (kind === 'bm') {
    const size = ole.r32(plus(a, BM_SIZE));

    if (size !== ole.r32(plus(b, BM_SIZE))) {
      return OLE_ERROR_NOT_EQUAL;
    }

    const first = await ole.globalAlloc(GMEM_MOVEABLE, size);
    const pa = first ? await ole.globalLock(first) : 0;
    const second = pa ? await ole.globalAlloc(GMEM_MOVEABLE, size) : 0;
    const pb = second ? await ole.globalLock(second) : 0;
    let answer = OLE_ERROR_MEMORY;

    if (pa && pb) {
      const bitmapA = ole.r16(plus(a, BM_BITMAP));
      const bitmapB = ole.r16(plus(b, BM_BITMAP));
      const countA = await ole.gdi('GetBitmapBits', [W(bitmapA), D(size), D(pa)]);
      const countB = await ole.gdi('GetBitmapBits', [W(bitmapB), D(size), D(pb)]);

      answer = countA !== countB || same(ole, pa, pb, countA) ? OLE_ERROR_NOT_EQUAL : OLE_OK;
    }

    for (const [handle, locked] of [
      [first, pa],
      [second, pb],
    ]) {
      if (locked) {
        await ole.globalUnlock(handle);
      }
    }

    for (const handle of [first, second]) {
      if (handle) {
        await ole.globalFree(handle);
      }
    }

    return answer;
  }

  if (kind === 'gen' && ole.r16(plus(a, GEN_FORMAT)) !== ole.r16(plus(b, GEN_FORMAT))) {
    return OLE_ERROR_NOT_EQUAL;
  }

  const field = kind === 'dib' ? DIB_DATA : GEN_DATA;

  return sameBlocks(ole, ole.r16(plus(a, field)), ole.r16(plus(b, field)));
}

/** Two global blocks: equal where their sizes and bytes are. */
export async function sameBlocks(ole: Ole, first: number, second: number) {
  const size = await ole.globalSize(first);

  if (size !== (await ole.globalSize(second))) {
    return OLE_ERROR_NOT_EQUAL;
  }

  const pa = await ole.globalLock(first);
  const pb = await ole.globalLock(second);
  const answer = same(ole, pa, pb, size) ? OLE_OK : OLE_ERROR_NOT_EQUAL;

  await ole.globalUnlock(first);
  await ole.globalUnlock(second);
  return answer;
}

/**
 * `...COPY` (305, 405, 505, 606): a copy of its data put on the clipboard
 * the program has open, in its format: a picture's metafile copied into a
 * new `METAFILEPICT`, a bitmap copied, a block copied.
 */
export async function copyToClipboard(ole: Ole, kind: Kind, object: number) {
  let handle: number;

  if (kind === 'mf') {
    const metafile =
      (await ole.gdi('CopyMetafile', [W(ole.r16(plus(object, MF_METAFILE))), D(0)])) & 0xffff;

    handle = await ole.globalAlloc(GMEM_MOVEABLE, 8);

    const at = await ole.globalLock(handle);

    ole.w16(at, ole.r16(plus(object, MF_MM)));
    ole.w16(plus(at, 2), ole.r16(plus(object, MF_XEXT)));
    ole.w16(plus(at, 4), ole.r16(plus(object, MF_YEXT)));
    ole.w16(plus(at, 6), metafile);
    await ole.globalUnlock(handle);
  } else if (kind === 'bm') {
    [handle] = await copyBitmap(ole, ole.r16(plus(object, BM_BITMAP)));
  } else {
    handle = await copyBlock(ole, ole.r16(plus(object, kind === 'dib' ? DIB_DATA : GEN_DATA)));
  }

  await ole.user('SetClipboardData', [W(formatOf(ole, kind, object)), W(handle)]);
  return OLE_OK;
}

export { B, far };
