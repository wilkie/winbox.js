'use strict';

import { DeviceBitmap } from '../../raster/device-bitmap.js';
import { DevicePalette } from '../../raster/device-palette.js';

import { bitsSize, rowBytes, writeByte } from './ddb.js';

/**
 * Makes a device-dependent bitmap, optionally from bits the caller gives, in
 * rows padded to 16-bit words: recorded by `bitbits` for monochrome bitmaps at
 * widths of 8 to 40 pixels. The pixels are kept as palette indices; see
 * `DeviceBitmap` and `ddb.ts`.
 *
 * The planes and the bits per pixel are read as bytes: SkiFree passes `0xab01`
 * for the bits per pixel and gets a monochrome bitmap. One plane of one bit is
 * monochrome, and the display's own shape is its colours: four planes of one
 * bit on a sixteen-colour display, one of eight bits taken for a 256-colour
 * one. Any other shape is made as it is asked for -- `GetObject` tells it so
 * -- but no device context takes it; `patmono` recorded one plane of four,
 * eight and 24 bits and three planes of one on four displays, and four planes
 * of one on the Hercules.
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
  const planes = cbPlanes & 0xff;
  const bits = cbBits & 0xff;
  const display = DevicePalette.depthOf(this.display);
  const own = display === 4 ? planes === 4 && bits === 1 : planes === 1 && bits === display;
  const depth = planes === 1 && bits === 1 ? 1 : display;

  const bitmap = new DeviceBitmap(
    nWidth,
    nHeight,
    depth,
    undefined,
    DevicePalette.forDisplay(this.display, depth)
  );

  if (depth !== 1 && !own) {
    bitmap.shape = {
      planes,
      bits,
      bytes: new Uint8Array(rowBytes(bits, Math.max(nWidth, 0)) * planes * Math.max(nHeight, 0)),
    };
  }

  if (lpvBits) {
    const core = this.machine.cpu.core;
    const segment = (lpvBits >>> 16) & 0xffff;
    const offset = lpvBits & 0xffff;
    const size = bitsSize(bitmap);

    for (let at = 0; at < size; at++) {
      writeByte(bitmap, at, core.read8(segment, offset + at));
    }
  }

  return this.handles.allocate(bitmap);
}
