'use strict';

import { D, W } from '../commdlg/api.js';
import {
  BM_BITMAP,
  BM_HEIGHT,
  BM_WIDTH,
  DEFAULT_PALETTE,
  DIB_DATA,
  DT_METAFILE,
  GMEM_MOVEABLE,
  type Kind,
  MF_METAFILE,
  MM_ANISOTROPIC,
  OBJ_CLIENT,
  OLE_ERROR_DRAW,
  OLE_ERROR_GENERIC,
  OLE_ERROR_MEMORY,
  OLE_OK,
  Ole,
  SCRATCH,
  SRCCOPY,
  TECHNOLOGY,
  plus,
  signed16,
} from './core.js';
import { exportAddress } from './objects.js';

/**
 * Drawing an object: `OleDraw`'s methods, `MFDRAW`, `BMDRAW`, `DIBDRAW`
 * (308, 408, 508), and `MFCALLBACKFUNC` (102), the procedure a picture's
 * records are enumerated through. Each call into GDI and USER as
 * `OLECLI.DLL` makes it, seen with its arguments as WinBox ran the file;
 * the metafiles it leaves **measured** by `olemem`'s `record`s, the pixels
 * **recorded** by `olestat`. As `crates/winbox-win16/src/olecli/draw.rs`.
 */

/** `OleIsDcMeta`: whether the device context's technology is `DT_METAFILE`. */
export async function isDcMeta(ole: Ole, dc: number) {
  return (await ole.deviceCaps(dc, TECHNOLOGY)) === DT_METAFILE ? 1 : 0;
}

/** A `RECT`'s four sides. */
function rect(ole: Ole, at: number): [number, number, number, number] {
  return [0, 2, 4, 6].map((step) => signed16(ole.r16(plus(at, step)))) as [
    number,
    number,
    number,
    number,
  ];
}

/** What a picture's records are played with, while they are enumerated. */
interface Playing {
  meta: boolean;
  bounds: [number, number, number, number];
  window: [number, number, number, number];
  org: [number, number];
}

/**
 * What a picture's object keeps of a drawing under way (**measured** by
 * `olemem`'s `drawstate` and `long draw` records, the words after its
 * picture's): whether it is drawn into a metafile, the error that stopped
 * it, and how many records are left before its client is asked whether to
 * go on.
 */
export const MF_INTO_METAFILE = 0x3e;
export const MF_DRAW_ERROR = 0x40;
export const MF_RECORDS_LEFT = 0x42;
/** Records played between askings: sixteen. */
export const RECORDS_PER_ASK = 16;
/** `OLE_QUERY_PAINT`, the notice a client is asked with (ole.h). */
const OLE_QUERY_PAINT = 4;
const OLE_ERROR_ABORT = 10;

/**
 * `MFDRAW` (308): the device context saved and clipped to the bounds; its
 * metafile's records enumerated through `MFCALLBACKFUNC` and played, the
 * object's pointer given it. Into a metafile the window's bounds are
 * wanted -- none is `OLE_ERROR_DRAW`, the context left saved -- and the
 * picture's window is mapped into them; into any other context the bounds
 * are made the viewport, in device units, `MM_ANISOTROPIC`, and the
 * picture's own window used as it is. The context restored, its answer the
 * error a client's no left, else `OLE_OK`.
 */
export async function drawPicture(
  ole: Ole,
  object: number,
  dc: number,
  boundsAt: number,
  windowAt: number
) {
  ole.w16(plus(object, MF_RECORDS_LEFT), RECORDS_PER_ASK);
  ole.w16(plus(object, MF_DRAW_ERROR), OLE_OK);

  const meta = (await isDcMeta(ole, dc)) === 1;

  if (meta) {
    ole.w16(plus(object, MF_INTO_METAFILE), 1);
  }

  const saved = signed16(await ole.gdi('SaveDC', [W(dc)]));
  const bounds = rect(ole, boundsAt);

  await ole.gdi('IntersectClipRect', [W(dc), ...bounds.map((side) => W(side))]);

  const playing: Playing = { meta, bounds, window: [0, 0, 0, 0], org: [0, 0] };

  if (meta) {
    if (!windowAt) {
      return OLE_ERROR_DRAW;
    }

    playing.window = rect(ole, windowAt);
  } else {
    const at = ole.near(SCRATCH + 0x80);

    bounds.forEach((side, i) => ole.w16(plus(at, i * 2), side));
    await ole.gdi('LPToDP', [W(dc), D(at), W(2)]);

    const device = rect(ole, at);

    await ole.gdi('SetMapMode', [W(dc), W(MM_ANISOTROPIC)]);
    await ole.gdi('SetViewportOrg', [W(dc), W(device[0]), W(device[1])]);
    await ole.gdi('SetViewportExt', [W(dc), W(device[2] - device[0]), W(device[3] - device[1])]);
  }

  const state = ole.state() as any;

  (state.playing ??= new Map<number, Playing>()).set(object, playing);

  try {
    await ole.gdi('EnumMetafile', [
      W(dc),
      W(ole.r16(plus(object, MF_METAFILE))),
      D(exportAddress(ole, 102)),
      D(object),
    ]);
  } finally {
    state.playing.delete(object);
  }

  if (meta) {
    ole.w16(plus(object, MF_INTO_METAFILE), 0);
  }

  await ole.gdi('RestoreDC', [W(dc), W(meta ? -1 : saved)]);
  return ole.r16(plus(object, MF_DRAW_ERROR));
}

/** A metafile record's function and its first words. */
const SET_WINDOW_ORG = 0x020b;
const SET_WINDOW_EXT = 0x020c;

/**
 * `MFCALLBACKFUNC` (102), `EnumMetaFile`'s procedure for a picture being
 * drawn, given the object: every sixteenth record its client asked
 * `OLE_QUERY_PAINT`, a no stopping the enumeration with `OLE_ERROR_ABORT`
 * kept in the object (**measured** by `olemem`: 41 records, two askings,
 * seven left); each record played with `PlayMetaFileRecord`, but into a
 * metafile its `SetWindowOrg` kept and its `SetWindowExt` made the
 * window's bounds' extents scaled to the picture's -- the extent
 * `MulDiv(right, extent, width)` and the origin the picture's less
 * `MulDiv(left - window's left, extent, width)`, each way (**measured** by
 * `olemem`'s `windowed` records). One to go on.
 */
export async function mfCallback(
  ole: Ole,
  dc: number,
  table: number,
  record: number,
  objects: number,
  object: number
) {
  const playing: Playing | undefined = (ole.state() as any).playing?.get(object);
  const remaining = (ole.r16(plus(object, MF_RECORDS_LEFT)) - 1) & 0xffff;

  ole.w16(plus(object, MF_RECORDS_LEFT), remaining);

  if (!remaining) {
    ole.w16(plus(object, MF_RECORDS_LEFT), RECORDS_PER_ASK);

    const client = ole.r32(plus(object, OBJ_CLIENT));
    const callback = ole.r32(ole.r32(client));
    const answer = await ole.callFarTyped(callback, [
      [client, 7],
      [OLE_QUERY_PAINT, 3],
      [object, 7],
    ]);

    if (!(answer & 0xffff)) {
      ole.w16(plus(object, MF_DRAW_ERROR), OLE_ERROR_ABORT);
      return 0;
    }
  }

  const fn = ole.r16(plus(record, 4));

  if (playing?.meta && (fn === SET_WINDOW_ORG || fn === SET_WINDOW_EXT)) {
    const y = signed16(ole.r16(plus(record, 6)));
    const x = signed16(ole.r16(plus(record, 8)));

    if (fn === SET_WINDOW_ORG) {
      playing.org = [x, y];
      return 1;
    }

    const [left, top, right, bottom] = playing.bounds;
    const [wLeft, wTop, wRight, wBottom] = playing.window;
    const width = right - left;
    const height = bottom - top;

    await ole.gdi('SetWindowExt', [
      W(dc),
      W(await ole.mulDiv(wRight, x, width)),
      W(await ole.mulDiv(wBottom, y, height)),
    ]);
    await ole.gdi('SetWindowOrg', [
      W(dc),
      W(playing.org[0] - (await ole.mulDiv(left - wLeft, x, width))),
      W(playing.org[1] - (await ole.mulDiv(top - wTop, y, height))),
    ]);
    return 1;
  }

  await ole.gdi('PlayMetafileRecord', [W(dc), D(table), D(record), W(objects)]);
  return 1;
}

/**
 * `BMDRAW` (408): the bitmap selected into a context compatible with the
 * one drawn into and stretched onto the bounds, `SRCCOPY`. A metafile's
 * context has none compatible with it: `OLE_ERROR_MEMORY` (**recorded**
 * by `olestat`, **measured** by `olemem`).
 */
export async function drawBitmap(ole: Ole, object: number, dc: number, boundsAt: number) {
  const screen = await ole.getDC();
  const memory = (await ole.gdi('CreateCompatibleDC', [W(dc)])) & 0xffff;

  if (!memory) {
    await ole.releaseDC(screen);
    return OLE_ERROR_MEMORY;
  }

  const [left, top, right, bottom] = rect(ole, boundsAt);
  const old =
    (await ole.gdi('SelectObject', [W(memory), W(ole.r16(plus(object, BM_BITMAP)))])) & 0xffff;

  await ole.gdi('StretchBlt', [
    W(dc),
    W(left),
    W(top),
    W(right - left),
    W(bottom - top),
    W(memory),
    W(0),
    W(0),
    W(ole.r16(plus(object, BM_WIDTH))),
    W(ole.r16(plus(object, BM_HEIGHT))),
    D(SRCCOPY),
  ]);
  await ole.gdi('SelectObject', [W(memory), W(old)]);
  await ole.gdi('DeleteDC', [W(memory)]);
  await ole.releaseDC(screen);
  return OLE_OK;
}

/**
 * `DIBDRAW` (508): a palette made of the DIB's colours selected and
 * realized, the DIB stretched onto the bounds with `StretchDIBits`, then the
 * default palette selected and realized again and the DIB's deleted
 * (**measured** by `olemem`'s `dib` records). The window's bounds are not
 * used.
 */
export async function drawDib(ole: Ole, object: number, dc: number, boundsAt: number) {
  const data = ole.r16(plus(object, DIB_DATA));
  const info = await ole.globalLock(data);
  const headerSize = ole.r32(info);
  const width = ole.r32(plus(info, 4)) | 0;
  const height = ole.r32(plus(info, 8)) | 0;
  const bitCount = ole.r16(plus(info, 14));
  const used = ole.r32(plus(info, 32));
  const colours = used || (bitCount <= 8 ? 1 << bitCount : 0);
  const block = await ole.globalAlloc(GMEM_MOVEABLE, 4 + colours * 4);
  const logical = await ole.globalLock(block);

  ole.w16(logical, 0x300);
  ole.w16(plus(logical, 2), colours);

  for (let i = 0; i < colours; i++) {
    const quad = plus(info, headerSize + i * 4);
    const entry = plus(logical, 4 + i * 4);

    ole.w8(entry, ole.r8(plus(quad, 2)));
    ole.w8(plus(entry, 1), ole.r8(plus(quad, 1)));
    ole.w8(plus(entry, 2), ole.r8(quad));
    ole.w8(plus(entry, 3), 0);
  }

  await ole.globalUnlock(block);

  const palette = (await ole.gdi('CreatePalette', [D(logical)])) & 0xffff;

  await ole.user('SelectPalette', [W(dc), W(palette), W(1)]);
  await ole.user('RealizePalette', [W(dc)]);

  const [left, top, right, bottom] = rect(ole, boundsAt);

  await ole.gdi('StretchDIBits', [
    W(dc),
    W(left),
    W(top),
    W(right - left),
    W(bottom - top),
    W(0),
    W(0),
    W(width),
    W(height),
    D(plus(info, headerSize + colours * 4)),
    D(info),
    W(0),
    D(SRCCOPY),
  ]);

  const state = ole.state();

  if (!state.defaultPalette) {
    state.defaultPalette = (await ole.gdi('GetStockObject', [W(DEFAULT_PALETTE)])) & 0xffff;
  }

  await ole.user('SelectPalette', [W(dc), W(state.defaultPalette), W(1)]);
  await ole.user('RealizePalette', [W(dc)]);
  await ole.gdi('DeleteObject', [W(palette)]);
  await ole.globalFree(block);
  await ole.globalUnlock(data);
  return OLE_OK;
}

/** `GENDRAW` (609): another class's data cannot be drawn: `OLE_ERROR_GENERIC`. */
export function drawOther() {
  return OLE_ERROR_GENERIC;
}

/** An object drawn by its kind. */
export async function draw(
  ole: Ole,
  kind: Kind,
  object: number,
  dc: number,
  bounds: number,
  window: number
) {
  if (kind === 'mf') {
    return drawPicture(ole, object, dc, bounds, window);
  }

  if (kind === 'bm') {
    return drawBitmap(ole, object, dc, bounds);
  }

  if (kind === 'dib') {
    return drawDib(ole, object, dc, bounds);
  }

  return drawOther();
}
