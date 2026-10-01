'use strict';

import { colourOf } from '../../raster/palette-colour.js';

import { matchedIndex } from '../../raster/colour-match.js';
import { DeviceBitmap } from '../../raster/device-bitmap.js';
import { DevicePalette } from '../../raster/device-palette.js';

/**
 * The colour the device draws a colour as, when it is a pen's or text's: one
 * of the device's own, chosen as its display driver chooses. For the screen
 * that is one of the display's colours; for a monochrome bitmap, black or
 * white. See `matchedIndex` for how, which is not by nearness.
 *
 * @param {Types.HDC} hdc - The device context.
 * @param {Types.COLORREF} clrref - The colour.
 *
 * @returns {Types.COLORREF} The colour the device has, or `CLR_INVALID` for
 *                           no device context.
 */
export function GetNearestColor(hdc, clrref) {
  const surface = this.handles.resolve(hdc);

  if (!surface) {
    return 0xffffffff;
  }

  const palette =
    surface.bitmap instanceof DeviceBitmap
      ? surface.bitmap.devicePalette
      : DevicePalette.forDisplay(this.display);
  /* A palette's colour, realized on the 256-colour display, is its slot's
   * (`palreal`). */
  const named: any = colourOf(clrref, surface);
  const index =
    named.slot !== undefined && palette.size === 256
      ? named.slot
      : matchedIndex(
          this.display,
          palette,
          clrref & 0xff,
          (clrref >> 8) & 0xff,
          (clrref >> 16) & 0xff
        );

  return palette.colorref(index);
}
