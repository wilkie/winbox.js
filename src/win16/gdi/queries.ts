'use strict';

import { Bitmap } from '../../raster/bitmap.js';
import { Brush } from '../../raster/brush.js';
import { Font } from '../../raster/font.js';
import { Pen } from '../../raster/pen.js';
import { Surface } from '../../raster/surface.js';
import { CreateBitmap } from './CreateBitmap.js';
import { LogicalPalette, Region } from './gdi-objects.js';

/**
 * Small questions a program asks GDI, and the settings they read back.
 * **Recorded** by `queries`.
 */

/** A far pointer's segment and offset. */
function far(pointer: number) {
  return { segment: (pointer >>> 16) & 0xffff, offset: pointer & 0xffff };
}

const pack = (low: number, high: number) => ((low & 0xffff) | ((high & 0xffff) << 16)) >>> 0;

/** `OPAQUE`, 2, for a new device context; what `SetBkMode` set after. */
export function GetBkMode(this: any, hdc: number) {
  const surface = this.handles.resolve(hdc);

  return surface instanceof Surface ? (surface.backMode ?? 2) : 0;
}

/** Nought for a new device context; what `SetTextAlign` set after. */
export function GetTextAlign(this: any, hdc: number) {
  const surface = this.handles.resolve(hdc);

  return surface instanceof Surface ? (surface.textAlign ?? 0) : 0;
}

/** Nought for a new device context; what `SetTextCharacterExtra` set after. */
export function GetTextCharacterExtra(this: any, hdc: number) {
  const surface = this.handles.resolve(hdc);

  return surface instanceof Surface ? (surface.charExtra ?? 0) : 0;
}

/**
 * Where a device context's origin is on the screen, the column in the low
 * word: a window's client area's corner, the screen's nought (`queries`).
 */
export function GetDCOrg(this: any, hdc: number) {
  const surface = this.handles.resolve(hdc);
  const context = surface instanceof Surface ? (surface.bitmap as any)?.context : null;

  return context ? pack(context.ownerX ?? 0, context.ownerY ?? 0) : 0;
}

/**
 * What kind of GDI object a handle is, or nought: 1 a pen, 2 a brush, 3 a
 * font, 4 a palette, 5 a bitmap, 6 a region, 7 a device context. A window,
 * nought and a deleted object are nought (`queries`).
 */
export function IsGDIObject(this: any, hobj: number) {
  const item = hobj ? this.handles.resolve(hobj) : null;

  if (item instanceof Pen) return 1;
  if (item instanceof Brush) return 2;
  if (item instanceof Font) return 3;
  if (item instanceof LogicalPalette) return 4;
  if (item instanceof Bitmap) return 5;
  if (item instanceof Region) return 6;
  if (item instanceof Surface) return 7;

  return 0;
}

/**
 * A bitmap from a `BITMAP`: its width, height, planes, bits a pixel and
 * bits, as `CreateBitmap` takes them (`queries`).
 */
export function CreateBitmapIndirect(this: any, lpbm: number) {
  const core = this.machine.cpu.core;
  const { segment, offset } = far(lpbm);
  const at = (delta: number) => (offset + delta) & 0xffff;
  const signed = (value: number) => (value << 16) >> 16;

  return CreateBitmap.call(
    this,
    signed(core.read16(segment, at(2))),
    signed(core.read16(segment, at(4))),
    core.read8(segment, at(8)),
    core.read8(segment, at(9)),
    (core.read16(segment, at(10)) | (core.read16(segment, at(12)) << 16)) >>> 0
  );
}

/** A bitmap's dimension in tenths of a millimetre, nought until set. */
function dimensionOf(bitmap: any) {
  return bitmap.dimension ?? { x: 0, y: 0 };
}

export function GetBitmapDimension(this: any, hbm: number) {
  const bitmap = this.handles.resolve(hbm);

  if (!(bitmap instanceof Bitmap)) {
    return 0;
  }

  const { x, y } = dimensionOf(bitmap);

  return pack(x, y);
}

/** Sets a bitmap's dimension, answering the one it had. */
export function SetBitmapDimension(this: any, hbm: number, x: number, y: number) {
  const bitmap: any = this.handles.resolve(hbm);

  if (!(bitmap instanceof Bitmap)) {
    return 0;
  }

  const old = dimensionOf(bitmap);

  (bitmap as any).dimension = { x, y };

  return pack(old.x, old.y);
}

function writeSize(system: any, pointer: number, x: number, y: number) {
  if (!pointer) {
    return;
  }

  const core = system.machine.cpu.core;
  const { segment, offset } = far(pointer);

  core.write16(segment, offset, x & 0xffff);
  core.write16(segment, (offset + 2) & 0xffff, y & 0xffff);
}

export function GetBitmapDimensionEx(this: any, hbm: number, lpSize: number) {
  const bitmap = this.handles.resolve(hbm);

  if (!(bitmap instanceof Bitmap)) {
    return 0;
  }

  const { x, y } = dimensionOf(bitmap);

  writeSize(this, lpSize, x, y);

  return 1;
}

/** Sets a bitmap's dimension, the one it had written to `lpSize`. */
export function SetBitmapDimensionEx(this: any, hbm: number, x: number, y: number, lpSize: number) {
  const bitmap: any = this.handles.resolve(hbm);

  if (!(bitmap instanceof Bitmap)) {
    return 0;
  }

  const old = dimensionOf(bitmap);

  writeSize(this, lpSize, old.x, old.y);
  (bitmap as any).dimension = { x, y };

  return 1;
}

/** The font mapper's flags, answering the ones it had: nought for a new device context. */
export function SetMapperFlags(this: any, hdc: number, dwFlag: number) {
  const surface: any = this.handles.resolve(hdc);

  if (!(surface instanceof Surface)) {
    return 0;
  }

  const old = (surface as any).mapperFlags ?? 0;

  (surface as any).mapperFlags = dwFlag >>> 0;

  return old;
}

/**
 * The aspect ratio the font mapper keeps to: nothing until `SetMapperFlags`
 * sets bit 1, and then the display's, 96 by 96 on the VGA (`queries`). That
 * it is the display's logical pixels an inch is taken from the documentation;
 * on the VGA they and the recording agree.
 */
function filterOf(system: any, surface: any) {
  if (!(surface instanceof Surface) || !((surface as any).mapperFlags & 1)) {
    return { x: 0, y: 0 };
  }

  return { x: system.display.logicalPixelsX, y: system.display.logicalPixelsY };
}

export function GetAspectRatioFilter(this: any, hdc: number) {
  const { x, y } = filterOf(this, this.handles.resolve(hdc));

  return pack(x, y);
}

export function GetAspectRatioFilterEx(this: any, hdc: number, lpAspectRatio: number) {
  const surface = this.handles.resolve(hdc);

  if (!(surface instanceof Surface)) {
    return 0;
  }

  const { x, y } = filterOf(this, surface);

  writeSize(this, lpAspectRatio, x, y);

  return 1;
}
