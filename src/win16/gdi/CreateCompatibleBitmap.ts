'use strict';

import { DeviceBitmap } from '../../raster/device-bitmap.js';
import { DevicePalette } from '../../raster/device-palette.js';

import { NULL } from '../consts.js';
import { driverCaps } from './printer-driver.js';

/**
 * Makes a bitmap of the same kind as a device context's: the display's depth
 * for a window or the screen, and for a memory device context the depth of the
 * bitmap selected into it -- which for a new one is its one-by-one monochrome
 * bitmap, so a bitmap made compatible with a fresh memory device context is
 * monochrome. The pixels start black.
 *
 * @param {Types.HDC} hdc - The device context to match.
 * @param {Types.INT} nWidth - The width in pixels.
 * @param {Types.INT} nHeight - The height in pixels.
 *
 * @returns {Types.HBITMAP} The bitmap, or null.
 */
export function CreateCompatibleBitmap(hdc, nWidth, nHeight) {
  const surface = hdc == NULL ? null : this.handles.resolve(hdc);

  if (!surface) {
    return NULL;
  }

  /* A printer's of its own format (`GDI.EXE` seg4 `01fb`): one plane of
   * one bit is monochrome (`prblt2`). */
  if (surface.driverDevice && driverCaps(surface, 0x0c) === 1 && driverCaps(surface, 0x0e) === 1) {
    return this.handles.allocate(
      new DeviceBitmap(nWidth, nHeight, 1, undefined, DevicePalette.forDisplay(this.display, 1))
    );
  }

  const like = surface.bitmap instanceof DeviceBitmap ? surface.bitmap : null;
  const depth = like ? like.depth : DevicePalette.depthOf(this.display);
  const palette = like ? like.devicePalette : DevicePalette.forDisplay(this.display);

  return this.handles.allocate(new DeviceBitmap(nWidth, nHeight, depth, undefined, palette));
}
