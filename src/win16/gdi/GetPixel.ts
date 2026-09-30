'use strict';

import { clipOf } from './clipping.js';
import { devicePoint, mapped } from './mapping.js';

import { DeviceBitmap } from '../../raster/device-bitmap.js';

/** What `GetPixel` returns for a point it has no pixel for. */
const CLR_INVALID = 0xffffffff;

/**
 * The colour of one pixel, as a `COLORREF`, `0x00BBGGRR`: for a bitmap
 * selected into a memory device context, the palette's colour for the pixel's
 * index. The `bitblt` probe reads every colour it records this way.
 *
 * @param {Types.HDC} hdc - The device context.
 * @param {Types.INT} x - The pixel's column.
 * @param {Types.INT} y - Its row.
 *
 * @returns {Types.COLORREF} Its colour, or `CLR_INVALID` outside the pixels.
 */
export function GetPixel(hdc, x, y) {
  const surface = this.handles.resolve(hdc);

  if (surface && mapped(surface)) {
    [x, y] = devicePoint(surface, x, y);
  }

  if (!surface) {
    return CLR_INVALID;
  }

  /* Outside a clip region the program set, nothing: `CLR_INVALID`, the
   * pixel there as it may be (`selrgn`). */
  if (surface.clipRegion && !clipOf(surface).contains(x, y)) {
    return CLR_INVALID;
  }

  const bitmap = surface.bitmap;

  if (bitmap instanceof DeviceBitmap) {
    const index = bitmap.indexAt(x, y);

    return index === null ? CLR_INVALID : bitmap.devicePalette.colorref(index);
  }

  if (x < 0 || y < 0 || x >= surface.width || y >= surface.height) {
    return CLR_INVALID;
  }

  const [red, green, blue] = surface.context.getImageData(x, y, 1, 1).data;

  return (blue << 16) | (green << 8) | red;
}
