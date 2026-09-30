'use strict';

import { Brush } from '../../raster/brush.js';
import { Color } from '../../raster/color.js';
import { DeviceBitmap } from '../../raster/device-bitmap.js';

import { NULL, TRUE } from '../consts.js';
import { GlobalLock } from '../kernel/GlobalLock.js';
import { GlobalUnlock } from '../kernel/GlobalUnlock.js';
import { dibAt } from './dib-to-device.js';

/**
 * A brush that paints a bitmap's pixels over and over, eight by eight.
 *
 * **Recorded** by `patbrush` on the VGA:
 *
 * * Only the bitmap's top-left eight by eight is used: one sixteen square
 *   paints as its corner does. The brush keeps its own copy; the bitmap can
 *   be deleted.
 * * A monochrome pattern's set bits paint the device context's background
 *   colour and its clear bits the text colour, those the device context has
 *   when it paints, not when the brush was selected.
 * * The pattern starts at the device context's origin, whatever rectangle is
 *   painted, or at its brush origin (`SetBrushOrg`) as it was when the brush
 *   was first selected. Selecting it again keeps that, until
 *   `UnrealizeObject`.
 * * `GetObject` answers a `LOGBRUSH` of 8 bytes: `BS_PATTERN`, colour
 *   nought, and the bitmap's handle.
 *
 * Not followed: `Rectangle`, `Ellipse` and `Polygon` fill with the first
 * pixel's colour, not the pattern.
 *
 * @param {Types.HBITMAP} hbmp - The bitmap.
 *
 * @returns {Types.HBRUSH} The brush, or nought for no bitmap.
 */
export function CreatePatternBrush(hbmp) {
  const bitmap = this.handles.resolve(hbmp);

  if (!(bitmap instanceof DeviceBitmap) || !bitmap.width || !bitmap.height) {
    return NULL;
  }

  const indices = new Uint8Array(64);

  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      indices[y * 8 + x] = bitmap.indexAt(x % bitmap.width, y % bitmap.height) ?? 0;
    }
  }

  const [red, green, blue] = bitmap.devicePalette.colours[indices[0]] ?? [0, 0, 0];
  const brush = new Brush(new Color(red, green, blue));

  brush.pattern = { depth: bitmap.depth, palette: bitmap.devicePalette, indices };
  brush.bitmap = hbmp;

  return this.handles.allocate(brush);
}

/**
 * A pattern brush from a packed DIB in a global block: its header, its
 * colour table, and its bits after them, matched to the display's colours.
 * **Recorded** by `gdidraw`: a four-bit DIB 8 by 8 and a one-bit one, red
 * and white, paint their pixels from the device context's origin as a
 * bitmap's pattern brush does.
 *
 * @param {Types.HGLOBAL} hPackedDIB - The packed DIB.
 * @param {Types.UINT} _fuColorUse - `DIB_RGB_COLORS`; `DIB_PAL_COLORS` is not recorded.
 *
 * @returns {Types.HBRUSH} The brush, or nought.
 */
export function CreateDIBPatternBrush(hPackedDIB, _fuColorUse) {
  const far = GlobalLock.call(this, hPackedDIB) >>> 0;

  if (!far) {
    return NULL;
  }

  const core = this.machine.cpu.core;
  const word = (at: number) => core.read16((far >>> 16) & 0xffff, ((far & 0xffff) + at) & 0xffff);
  const dword = (at: number) => (word(at) | (word(at + 2) << 16)) >>> 0;
  const size = dword(0);
  const coreHeader = size === 12;
  const bitCount = coreHeader ? word(10) : word(14);
  const used = coreHeader ? 0 : dword(32);
  const colours = bitCount <= 8 ? used || 1 << bitCount : 0;
  const bits =
    (far & 0xffff0000) | (((far & 0xffff) + size + colours * (coreHeader ? 3 : 4)) & 0xffff);
  const found = dibAt(this, { bitmap: null }, far, bits >>> 0);

  GlobalUnlock.call(this, hPackedDIB);

  if (!found) {
    return NULL;
  }

  const bitmap = found.bitmap;
  const indices = new Uint8Array(64);

  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      indices[y * 8 + x] = bitmap.indexAt(x % bitmap.width, y % bitmap.height) ?? 0;
    }
  }

  const [red, green, blue] = bitmap.devicePalette.colours[indices[0]] ?? [0, 0, 0];
  const brush = new Brush(new Color(red, green, blue));

  brush.pattern = { depth: bitmap.depth, palette: bitmap.devicePalette, indices };

  return this.handles.allocate(brush);
}

/**
 * Where a device context's pattern brushes start, from its origin, for
 * brushes realised from now on: see `CreatePatternBrush`.
 *
 * @param {Types.HDC} hdc - The device context.
 * @param {Types.INT} x - The column.
 * @param {Types.INT} y - The row.
 *
 * @returns {Types.DWORD} The origin it had, the column in the low word.
 */
export function SetBrushOrg(hdc, x, y) {
  const surface = this.handles.resolve(hdc);

  if (!surface) {
    return 0;
  }

  const old = surface.brushOrg ?? { x: 0, y: 0 };

  surface.brushOrg = { x, y };

  return ((old.x & 0xffff) | ((old.y & 0xffff) << 16)) >>> 0;
}

/**
 * The origin `SetBrushOrg` set.
 *
 * @param {Types.HDC} hdc - The device context.
 *
 * @returns {Types.DWORD} The origin, the column in the low word.
 */
export function GetBrushOrg(hdc) {
  const surface = this.handles.resolve(hdc);
  const origin = surface?.brushOrg ?? { x: 0, y: 0 };

  return ((origin.x & 0xffff) | ((origin.y & 0xffff) << 16)) >>> 0;
}

/**
 * Has a brush take its origin again when it is next selected.
 *
 * @param {Types.HGDIOBJ} hgdiobj - The brush.
 *
 * @returns {Types.BOOL} Whether there was such an object.
 */
export function UnrealizeObject(hgdiobj) {
  const item = this.handles.resolve(hgdiobj);

  if (!item) {
    return 0;
  }

  if (item instanceof Brush) {
    item.origin = null;
  }

  return TRUE;
}

/** Realises a brush for a device context as it is selected. */
export function realiseBrush(surface: any, brush: any) {
  if (brush instanceof Brush && brush.pattern && !brush.origin) {
    brush.origin = { ...(surface.brushOrg ?? { x: 0, y: 0 }) };
  }
}
