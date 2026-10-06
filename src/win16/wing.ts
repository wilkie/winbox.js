'use strict';

/** @namespace WinG */

import { DeviceBitmap } from '../raster/device-bitmap.js';
import { DevicePalette } from '../raster/device-palette.js';
import { BitBlt } from './gdi/BitBlt.js';
import { CreateCompatibleDC } from './gdi/CreateCompatibleDC.js';
import { LogicalPalette } from './gdi/gdi-objects.js';
import { StretchBlt } from './gdi/StretchBlt.js';
import { GlobalAlloc } from './kernel/GlobalAlloc.js';
import { globalPointer } from './kernel/GlobalLock.js';
import { Module } from './module.js';
import { indexFor } from './selectors.js';

import { BOOL, COLORREF, FARPTR, HANDLE, HBITMAP, HBRUSH, HDC, INT, UINT } from './types.js';

/**
 * WinG, Microsoft's 1994 library for drawing fast into device-independent
 * bitmaps, given away for Windows 3.1: a program draws into a bitmap's bits
 * itself and blits them to its window. winbox.js answers for `WING.DLL` here,
 * with no file of it on the disk.
 *
 * **Recorded** by `wingapi` and `wingprof` on the 256-colour display with
 * WinG installed (`install-wing.mjs`):
 *
 * * `WinGRecommendedDIBFormat` answers 1 and an 8-bit header, 1 by 1 and
 *   bottom-up (a height of 1), uncompressed.
 * * `WinGCreateDC` makes a device context of WinG's own DIB driver: its
 *   `GetDeviceCaps` answer 24 bits a pixel, one plane, `NUMCOLORS` 16 and
 *   `RASTERCAPS` `ee99`, and its first bitmap is 1 by 1.
 * * `WinGCreateBitmap` makes a bitmap of the header's size, 8 bits a pixel,
 *   and answers a pointer to its bits, rows a whole number of double words,
 *   the bottom row first where the height is above nought. The bits are the
 *   picture: plain memory, which the program writes and GDI draws on alike. `GetObject`
 *   answers its size, bytes a row, a plane and 8 bits. What the program
 *   writes there is the picture: `GetPixel` answers the colour table's own
 *   colour for each index, and black past the table's end.
 *   `WinGGetDIBPointer` answers the same pointer and the header.
 * * `WinGSetDIBColorTable` and `WinGGetDIBColorTable`, of the bitmap
 *   selected into a WinG device context, answer how many entries they took.
 * * `WinGBitBlt` and `WinGStretchBlt` copy, the colours as any bitmap's
 *   become the screen's: with no palette realized, the nearest static colour.
 * * `WinGCreateHalftonePalette` makes a palette of 256: the static colours
 *   at either end, and between them WinG's own, each `PC_NOCOLLAPSE`.
 *
 * Not followed: `WinGCreateHalftoneBrush`, whose dither is recorded but not
 * worked out; it makes no brush.
 */

/** The capabilities of WinG's device context, as `GetDeviceCaps` answers them. */
const WING_CAPS = { bitsPerPixel: 24, planes: 1, numColors: 16, rasterCaps: 0xee99 };

/** A bitmap of WinG's: its picture, and where its bits are in memory. */
class WinGBitmap {
  constructor(
    readonly bitmap: DeviceBitmap,
    readonly header: number[],
    readonly bits: number,
    readonly pointer: number
  ) {}
}

function core(system: any) {
  return system.machine.cpu.core;
}

function read8(system: any, far: number, at: number) {
  return core(system).read8((far >>> 16) & 0xffff, ((far & 0xffff) + at) & 0xffff);
}

function read32(system: any, far: number, at: number) {
  return (
    (read8(system, far, at) |
      (read8(system, far, at + 1) << 8) |
      (read8(system, far, at + 2) << 16) |
      (read8(system, far, at + 3) << 24)) >>>
    0
  );
}

function write8(system: any, far: number, at: number, value: number) {
  core(system).write8((far >>> 16) & 0xffff, ((far & 0xffff) + at) & 0xffff, value & 0xff);
}

function write32(system: any, far: number, at: number, value: number) {
  for (let k = 0; k < 4; k++) {
    write8(system, far, at + k, (value >>> (k * 8)) & 0xff);
  }
}

/** A `BITMAPINFOHEADER` written: size, width, height, planes and bits, compression. */
function writeHeader(system: any, far: number, fields: number[]) {
  for (let at = 0; at < 40; at++) {
    write8(system, far, at, 0);
  }

  const [size, width, height, planes, bits, compression, used] = fields;

  write32(system, far, 0, size);
  write32(system, far, 4, width);
  write32(system, far, 8, height);
  write8(system, far, 12, planes);
  write8(system, far, 14, bits);
  write32(system, far, 16, compression);
  write32(system, far, 32, used ?? 0);
}

/** The WinG bitmap selected into a device context, if it is one. */
function selectedIn(system: any, hdc: number): WinGBitmap | null {
  const surface = system.handles.resolve(hdc);

  return (surface?.bitmap && system._wingBitmaps?.get(surface.bitmap)) ?? null;
}

function WinGCreateDC(this: any) {
  const hdc = CreateCompatibleDC.call(this, 0);
  const surface = this.handles.resolve(hdc);

  if (surface) {
    surface.device = { ...this.display, ...WING_CAPS };
  }

  return hdc;
}

function WinGRecommendedDIBFormat(this: any, lpbmi: number) {
  if (!lpbmi) {
    return 0;
  }

  writeHeader(this, lpbmi, [40, 1, 1, 1, 8, 0]);

  return 1;
}

function WinGCreateBitmap(this: any, hdc: number, lpbmi: number, lplpvBits: number) {
  if (!lpbmi) {
    return 0;
  }

  const width = read32(this, lpbmi, 4) | 0;
  const height = read32(this, lpbmi, 8) | 0;
  const bitCount = read8(this, lpbmi, 14);
  const used = read32(this, lpbmi, 32) || 256;

  if (width <= 0 || height === 0 || bitCount !== 8) {
    return 0;
  }

  const rows = Math.abs(height);
  const stride = (width + 3) & ~3;
  const size = stride * rows;

  /* Its colours, the table's, black past its end. */
  const colours: [number, number, number][] = [];

  for (let index = 0; index < 256; index++) {
    colours.push(
      index < used
        ? [
            read8(this, lpbmi, 40 + index * 4 + 2),
            read8(this, lpbmi, 40 + index * 4 + 1),
            read8(this, lpbmi, 40 + index * 4),
          ]
        : [0, 0, 0]
    );
  }

  const bits = GlobalAlloc.call(this, 0x0002, size) as number;

  if (!bits) {
    return 0;
  }

  /* The pixels are the bits themselves, kept in one piece of memory: rows
   * `stride` apart, the bottom one first for a height above nought. Nought,
   * as a new bitmap is. */
  const span = this.machine.memory.span(indexFor(bits) * 0x10000, size);
  const bitmap = new DeviceBitmap(
    width,
    rows,
    8,
    span.bytes,
    new DevicePalette(colours, Math.min(used, 256))
  );
  const place = () =>
    height > 0
      ? bitmap.rebind(span.bytes, (rows - 1) * stride, -stride)
      : bitmap.rebind(span.bytes, 0, stride);

  span.bytes.fill(0);
  place();
  span.onMove = place;

  const pointer = globalPointer.call(this, bits) as number;
  const handle = this.handles.allocate(bitmap);

  (this._wingBitmaps ??= new Map()).set(
    bitmap,
    new WinGBitmap(bitmap, [40, width, height, 1, 8, 0, read32(this, lpbmi, 32)], bits, pointer)
  );

  if (lplpvBits) {
    write32(this, lplpvBits, 0, pointer);
  }

  void hdc;

  return handle;
}

function WinGGetDIBPointer(this: any, hbm: number, lpbmi: number) {
  const bitmap = this.handles.resolve(hbm);
  const wing: WinGBitmap | undefined = this._wingBitmaps?.get(bitmap);

  if (!wing) {
    return 0;
  }

  if (lpbmi) {
    writeHeader(this, lpbmi, wing.header);
  }

  return wing.pointer;
}

function WinGGetDIBColorTable(this: any, hdc: number, start: number, count: number, lprgb: number) {
  const wing = selectedIn(this, hdc);

  if (!wing) {
    return 0;
  }

  const colours = wing.bitmap.devicePalette.colours;
  const taken = Math.max(0, Math.min(count, colours.length - start));

  for (let k = 0; k < taken; k++) {
    const [red, green, blue] = colours[start + k];

    write8(this, lprgb, k * 4, blue);
    write8(this, lprgb, k * 4 + 1, green);
    write8(this, lprgb, k * 4 + 2, red);
    write8(this, lprgb, k * 4 + 3, 0);
  }

  return taken;
}

function WinGSetDIBColorTable(this: any, hdc: number, start: number, count: number, lprgb: number) {
  const wing = selectedIn(this, hdc);

  if (!wing) {
    return 0;
  }

  const palette = wing.bitmap.devicePalette;
  const taken = Math.max(0, Math.min(count, palette.size - start));

  for (let k = 0; k < taken; k++) {
    palette.recolour(
      start + k,
      read8(this, lprgb, k * 4 + 2),
      read8(this, lprgb, k * 4 + 1),
      read8(this, lprgb, k * 4)
    );
  }

  return taken;
}

/** WinG's halftone palette, as `wingapi` reads it back: the static colours at either end. */
function WinGCreateHalftonePalette(this: any) {
  const palette = new LogicalPalette();

  palette.entries = HALFTONE.map((rgb, index) => [
    (rgb >> 16) & 0xff,
    (rgb >> 8) & 0xff,
    rgb & 0xff,
    index < 10 || index >= 246 ? 0 : 0x04,
  ]);

  return this.handles.allocate(palette);
}

function WinGBitBlt(this: any, hdcDest, xDest, yDest, width, height, hdcSrc, xSrc, ySrc) {
  return BitBlt.call(this, hdcDest, xDest, yDest, width, height, hdcSrc, xSrc, ySrc, 0x00cc0020);
}

function WinGStretchBlt(
  this: any,
  hdcDest,
  xDest,
  yDest,
  widthDest,
  heightDest,
  hdcSrc,
  xSrc,
  ySrc,
  widthSrc,
  heightSrc
) {
  return StretchBlt.call(
    this,
    hdcDest,
    xDest,
    yDest,
    widthDest,
    heightDest,
    hdcSrc,
    xSrc,
    ySrc,
    widthSrc,
    heightSrc,
    0x00cc0020
  );
}

/**
 * The Win16 High Performance Graphics API
 *
 * @memberof Win16
 */
export class WinG extends Module {
  declare static _exports: any;
  static get name(): string {
    return 'WING';
  }

  static get path() {
    return 'C:\\WINDOWS\\SYSTEM\\WING.DLL';
  }

  static get exports() {
    if (!WinG._exports) {
      const ret = new Array(1011).fill(null);
      ret[0] = null; // 0 // "WinG High Performance Graphics APIs"
      ret[1001] = [WinGCreateDC, 'WinGCreateDC', 0, [], HDC];
      ret[1002] = [WinGRecommendedDIBFormat, 'WinGRecommendedDIBFormat', 4, [FARPTR], BOOL];
      ret[1003] = [WinGCreateBitmap, 'WinGCreateBitmap', 10, [HDC, FARPTR, FARPTR], HBITMAP];
      ret[1004] = [WinGGetDIBPointer, 'WinGGetDIBPointer', 6, [HBITMAP, FARPTR], FARPTR];
      ret[1005] = [
        WinGGetDIBColorTable,
        'WinGGetDIBColorTable',
        10,
        [HDC, UINT, UINT, FARPTR],
        UINT,
      ];
      ret[1006] = [
        WinGSetDIBColorTable,
        'WinGSetDIBColorTable',
        10,
        [HDC, UINT, UINT, FARPTR],
        UINT,
      ];
      ret[1007] = [WinGCreateHalftonePalette, 'WinGCreateHalftonePalette', 0, [], HANDLE];
      ret[1008] = [() => 0, 'WinGCreateHalftoneBrush', 8, [HDC, COLORREF, INT], HBRUSH];
      ret[1009] = [
        WinGStretchBlt,
        'WinGStretchBlt',
        20,
        [HDC, INT, INT, INT, INT, HDC, INT, INT, INT, INT],
        BOOL,
      ];
      ret[1010] = [WinGBitBlt, 'WinGBitBlt', 16, [HDC, INT, INT, INT, INT, HDC, INT, INT], BOOL];
      WinG._exports = ret;
    }

    return WinG._exports;
  }
}

/** WinG's halftone palette, `0xRRGGBB` each, as `WinGCreateHalftonePalette` makes it (`wingapi`). */
const HALFTONE = [
  0x000000, 0x800000, 0x008000, 0x808000, 0x000080, 0x800080, 0x008080, 0xc0c0c0, 0xc0dcc0,
  0xa6caf0, 0x040404, 0x080808, 0x0c0c0c, 0x111111, 0x161616, 0x1c1c1c, 0x222222, 0x292929,
  0x555555, 0x4d4d4d, 0x424242, 0x393939, 0x818181, 0x810000, 0x008100, 0x818100, 0x000081,
  0x810081, 0x008181, 0x330000, 0x660000, 0x990000, 0xcc0000, 0x003300, 0x333300, 0x663300,
  0x993300, 0xcc3300, 0xff3300, 0x006600, 0x336600, 0x666600, 0x996600, 0xcc6600, 0xff6600,
  0x009900, 0x339900, 0x669900, 0x999900, 0xcc9900, 0xff9900, 0x00cc00, 0x33cc00, 0x66cc00,
  0x99cc00, 0xcccc00, 0xffcc00, 0x66ff00, 0x99ff00, 0xccff00, 0x000033, 0x330033, 0x660033,
  0x990033, 0xcc0033, 0xff0033, 0x003333, 0x333333, 0x663333, 0x993333, 0xcc3333, 0xff3333,
  0x006633, 0x336633, 0x666633, 0x996633, 0xcc6633, 0xff6633, 0x009933, 0x339933, 0x669933,
  0x999933, 0xcc9933, 0xff9933, 0x00cc33, 0x33cc33, 0x66cc33, 0x99cc33, 0xcccc33, 0xffcc33,
  0x33ff33, 0x66ff33, 0x99ff33, 0xccff33, 0xffff33, 0x000066, 0x330066, 0x660066, 0x990066,
  0xcc0066, 0xff0066, 0x003366, 0x333366, 0x663366, 0x993366, 0xcc3366, 0xff3366, 0x006666,
  0x336666, 0x666666, 0x996666, 0xcc6666, 0x009966, 0x339966, 0x669966, 0x999966, 0xcc9966,
  0xff9966, 0x00cc66, 0x33cc66, 0x99cc66, 0xcccc66, 0xffcc66, 0x00ff66, 0x33ff66, 0x99ff66,
  0xccff66, 0xff00cc, 0xcc00ff, 0x009999, 0x993399, 0x990099, 0xcc0099, 0x000099, 0x333399,
  0x660099, 0xcc3399, 0xff0099, 0x006699, 0x336699, 0x663399, 0x996699, 0xcc6699, 0xff3399,
  0x339999, 0x669999, 0x999999, 0xcc9999, 0xff9999, 0x00cc99, 0x33cc99, 0x66cc66, 0x99cc99,
  0xcccc99, 0xffcc99, 0x00ff99, 0x33ff99, 0x66cc99, 0x99ff99, 0xccff99, 0xffff99, 0x0000cc,
  0x330099, 0x6600cc, 0x9900cc, 0xcc00cc, 0x003399, 0x3333cc, 0x6633cc, 0x9933cc, 0xcc33cc,
  0xff33cc, 0x0066cc, 0x3366cc, 0x666699, 0x9966cc, 0xcc66cc, 0xff6699, 0x0099cc, 0x3399cc,
  0x6699cc, 0x9999cc, 0xcc99cc, 0xff99cc, 0x00cccc, 0x33cccc, 0x66cccc, 0x99cccc, 0xcccccc,
  0xffcccc, 0x00ffcc, 0x33ffcc, 0x66ff99, 0x99ffcc, 0xccffcc, 0xffffcc, 0x3300cc, 0x6600ff,
  0x9900ff, 0x0033cc, 0x3333ff, 0x6633ff, 0x9933ff, 0xcc33ff, 0xff33ff, 0x0066ff, 0x3366ff,
  0x6666cc, 0x9966ff, 0xcc66ff, 0xff66cc, 0x0099ff, 0x3399ff, 0x6699ff, 0x9999ff, 0xcc99ff,
  0xff99ff, 0x00ccff, 0x33ccff, 0x66ccff, 0x99ccff, 0xccccff, 0xffccff, 0x33ffff, 0x66ffcc,
  0x99ffff, 0xccffff, 0xff6666, 0x66ff66, 0xffff66, 0x6666ff, 0xff66ff, 0x66ffff, 0xc1c1c1,
  0x5f5f5f, 0x777777, 0x868686, 0x969696, 0xcbcbcb, 0xb2b2b2, 0xd7d7d7, 0xdddddd, 0xe3e3e3,
  0xeaeaea, 0xf1f1f1, 0xf8f8f8, 0xfffbf0, 0xa0a0a4, 0x808080, 0xff0000, 0x00ff00, 0xffff00,
  0x0000ff, 0xff00ff, 0x00ffff, 0xffffff,
];
