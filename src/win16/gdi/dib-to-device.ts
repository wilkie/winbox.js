'use strict';

import { hugeRead8 } from '../huge.js';

import { decodeDib, dibToDevice } from '../../raster/dib.js';
import { DeviceBitmap } from '../../raster/device-bitmap.js';
import { DevicePalette } from '../../raster/device-palette.js';
import { rasterOp } from '../../raster/raster-op.js';
import { deviceBox, devicePoint, mapped } from './mapping.js';
import { stretchDevice } from './StretchBlt.js';

const SRCCOPY = 0x00cc0020;

/**
 * Device-independent bits drawn straight to a device context, without a
 * bitmap of the program's own between. **Recorded** by `dibdev`, with a
 * four-bit DIB whose every pixel is a digit of the display's palette, and a
 * one-bit and an eight-bit one; see each function.
 */

/**
 * A DIB in the program's memory as a bitmap of the destination's format:
 * `rows` of its scan lines from the bits, with the header and colour table
 * from `info`. `null` when it cannot be read.
 */
export function dibAt(system: any, surface: any, info: number, bits: number, rows?: number) {
  const core = system.machine.cpu.core;
  /* The bits may be more than a segment: a huge pointer's. */
  const read = (far: number, count: number) =>
    Array.from({ length: count }, (_, at) => hugeRead8(core, far, at));
  const word = (far: number, at: number) =>
    core.read16((far >>> 16) & 0xffff, ((far & 0xffff) + at) & 0xffff);
  const dword = (far: number, at: number) => (word(far, at) | (word(far, at + 2) << 16)) >>> 0;

  if (!info || !bits) {
    return null;
  }

  const infoSize = dword(info, 0);
  const coreHeader = infoSize === 12;
  const width = coreHeader ? word(info, 4) : dword(info, 4) | 0;
  const height = Math.abs(coreHeader ? (word(info, 6) << 16) >> 16 : dword(info, 8) | 0);
  const bitCount = coreHeader ? word(info, 10) : word(info, 14);
  const compression = coreHeader ? 0 : dword(info, 16);
  const used = coreHeader ? 0 : dword(info, 32);
  const colours = bitCount <= 8 ? used || 1 << bitCount : 0;
  const entry = coreHeader ? 3 : 4;
  const stride = ((width * bitCount + 31) >> 5) << 2;
  const lines = compression ? height : (rows ?? height);
  const header = read(info, infoSize + colours * entry);

  /* The scan lines handed over are all the DIB there is, as far as they go. */
  if (lines !== height) {
    if (coreHeader) {
      header[6] = lines & 0xff;
      header[7] = (lines >> 8) & 0xff;
    } else {
      header[8] = lines & 0xff;
      header[9] = (lines >> 8) & 0xff;
      header[10] = 0;
      header[11] = 0;
    }
  }

  const size = compression ? dword(info, 20) : stride * lines;
  const like = surface.bitmap instanceof DeviceBitmap ? surface.bitmap : null;
  const depth = like ? like.depth : DevicePalette.depthOf(system.display);
  const palette = like ? like.devicePalette : DevicePalette.forDisplay(system.display, depth);

  try {
    const bitmap = dibToDevice(
      decodeDib(new Uint8Array([...header, ...read(bits, size)])),
      depth,
      palette,
      /* Matched by the display driver's rule, as `CreateDIBitmap` matches
       * (`dibmap`: all 256 colours, onto the screen and stretched). */
      system.display
    );

    return { bitmap, width, height: lines };
  } catch {
    return null;
  }
}

/**
 * Draws some of a DIB's scan lines at their place in a rectangle of it.
 *
 * * The source rectangle is counted from the DIB's bottom row, as its rows
 *   are stored, and its bottom row is drawn at the bottom of the
 *   destination: scan line `s` at `yDest + ySrc + cy - 1 - s`. A rectangle
 *   larger than the DIB draws the DIB at its bottom left.
 * * The bits are `cScanLines` scan lines from `uStartScan`, and only those
 *   are drawn: a DIB can be handed over in bands.
 * * It answers how many scan lines it drew, those clipped off not counted.
 * * Into a memory device context it draws nothing and answers -1: the
 *   display driver takes only the screen.
 *
 * Not measured: a mapping mode, where only the place is mapped here, and
 * `DIB_PAL_COLORS`.
 *
 * @returns {Types.INT} The scan lines drawn, or -1.
 */
export function SetDIBitsToDevice(
  this: any,
  hdc: number,
  xDest: number,
  yDest: number,
  cx: number,
  cy: number,
  xSrc: number,
  ySrc: number,
  uStartScan: number,
  cScanLines: number,
  lpvBits: number,
  lpbmi: number,
  _fuColorUse: number
) {
  const surface = this.handles.resolve(hdc);

  if (!surface) {
    return 0;
  }

  if (surface.memoryContext) {
    return -1;
  }

  const dib = dibAt(this, surface, lpbmi, lpvBits, cScanLines);

  if (!dib) {
    return 0;
  }

  if (mapped(surface)) {
    [xDest, yDest] = devicePoint(surface, xDest, yDest);
  }

  const first = Math.max(uStartScan, ySrc);
  const end = Math.min(uStartScan + cScanLines, ySrc + cy);
  const width = Math.min(cx, dib.width - xSrc);

  if (end <= first || width <= 0) {
    return 0;
  }

  /* Scan lines `first` to `end` are rows `top` down of the destination, and
   * rows `from` down of the bits, which are stored bottom up. */
  const top = yDest + ySrc + cy - end;
  const from = dib.height - (end - uStartScan);
  const height = end - first;

  rasterOp(this.display, surface, xDest, top, width, height, SRCCOPY, dib, xSrc, from);

  const limit = surface.height ?? Infinity;

  return Math.max(0, Math.min(top + height, limit) - Math.max(top, 0));
}

/**
 * Draws a rectangle of a DIB stretched into a rectangle of a device
 * context, as `StretchBlt` does from a bitmap made of the DIB, in its
 * stretch mode and with its raster operation.
 *
 * * The source rectangle is counted from the DIB's bottom row.
 * * A negative destination width or height turns it over.
 * * It answers the source rectangle's height.
 * * Into a memory device context, unlike `SetDIBitsToDevice`, it draws.
 *
 * @returns {Types.INT} The source's height.
 */
export function StretchDIBits(
  this: any,
  hdc: number,
  xDest: number,
  yDest: number,
  cxDest: number,
  cyDest: number,
  xSrc: number,
  ySrc: number,
  cxSrc: number,
  cySrc: number,
  lpvBits: number,
  lpbmi: number,
  _fuColorUse: number,
  dwRop: number
) {
  const surface = this.handles.resolve(hdc);

  if (!surface) {
    return 0;
  }

  const dib = dibAt(this, surface, lpbmi, lpvBits);

  if (!dib) {
    return 0;
  }

  if (mapped(surface)) {
    ({
      x: xDest,
      y: yDest,
      width: cxDest,
      height: cyDest,
    } = deviceBox(surface, xDest, yDest, cxDest, cyDest));
  }

  stretchDevice(
    this,
    surface,
    xDest,
    yDest,
    cxDest,
    cyDest,
    dib,
    xSrc,
    dib.height - ySrc - cySrc,
    cxSrc,
    cySrc,
    dwRop >>> 0
  );

  return cySrc;
}
