'use strict';

import { DeviceBitmap } from '../../raster/device-bitmap.js';
import { DevicePalette } from '../../raster/device-palette.js';

import { rowBytes, writeByte } from './ddb.js';

/**
 * Makes a device-dependent bitmap, optionally from bits the caller gives, in
 * rows padded to 16-bit words: recorded by `bitbits` for monochrome bitmaps at
 * widths of 8 to 40 pixels. The pixels are kept as palette indices; see
 * `DeviceBitmap` and `ddb.ts`.
 *
 * The planes and the bits per pixel are read as bytes: SkiFree passes `0xab01`
 * for the bits per pixel and gets a monochrome bitmap. One plane of one bit is
 * monochrome, four planes of one bit or one plane of four bits the sixteen
 * colours, and eight bits the 256; any other shape is taken at the display's
 * depth, which is not recorded.
 *
 * @param {Types.INT} nWidth - The width in pixels.
 * @param {Types.INT} nHeight - The height in pixels.
 * @param {Types.UINT} cbPlanes - Colour planes.
 * @param {Types.UINT} cbBits - Bits per pixel in each plane.
 * @param {Types.FARPTR} lpvBits - The initial bits, or null for none.
 *
 * @returns {Types.HBITMAP} The bitmap.
 */
export function CreateBitmap(nWidth, nHeight, cbPlanes, cbBits, lpvBits) {
  const bits = (cbBits & 0xff) * (cbPlanes & 0xff);
  const depth = bits === 1 || bits === 4 || bits === 8 ? bits : DevicePalette.depthOf(this.display);

  const bitmap = new DeviceBitmap(nWidth, nHeight, depth);

  if (lpvBits) {
    const core = this.machine.cpu.core;
    const segment = (lpvBits >>> 16) & 0xffff;
    const offset = lpvBits & 0xffff;
    const size = rowBytes(depth, nWidth) * nHeight;

    for (let at = 0; at < size; at++) {
      writeByte(bitmap, at, core.read8(segment, offset + at));
    }
  }

  return this.handles.allocate(bitmap);
}
