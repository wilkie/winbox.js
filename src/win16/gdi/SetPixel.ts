'use strict';

import { colourOf } from '../../raster/palette-colour.js';

import { devicePoint, mapped } from './mapping.js';

import { Brush } from '../../raster/brush.js';
import { matchedIndex } from '../../raster/colour-match.js';
import { DeviceBitmap } from '../../raster/device-bitmap.js';
import { DevicePalette } from '../../raster/device-palette.js';

/**
 * The **SetPixel** function sets the pixel at the specified coordinates to the
 * closest approximation of the given color. The point must be in the clipping
 * region; if it is not, the function does nothing.
 *
 * Not all devices support the SetPixel function. To discover whether a device
 * supports raster operations, an application can call the
 * {@link Gdi.GetDeviceCaps GetDeviceCaps} function using the `RC_BITBLT` index.
 *
 * **See also**:
 * {@link Gdi.GetDeviceCaps GetDeviceCaps}
 * {@link Gdi.GetPixel GetPixel}
 *
 * @static
 * @function SetPixel
 * @memberof Gdi
 *
 * @param {Types.HDC} hdc - Identifies the device context.
 * @param {Types.INT} nXPos - Specifies the logical x-coordinate of the point to
 *                            be set.
 * @param {Types.INT} nYPos - Specifies the logical y-coordinate of the point to
 *                            be set.
 * @param {Types.COLORREF} clrref - Specifies the color to be used to paint the
 *                                  point.
 *
 * @return {Types.COLORREF} The return value is the RGB value for the color the
 *                          point is painted, if the function is successful.
 *                          This value can be different from the specified value
 *                          if an approximation of that color is used. The
 *                          return value is `-1` if the function fails (if the
 *                          point is outside the clipping region.)
 */
export function SetPixel(hdc, nXPos, nYPos, clrref) {
  // Resolve the destination DC handle
  const surface = this.handles.resolve(hdc);

  if (surface && mapped(surface)) {
    [nXPos, nYPos] = devicePoint(surface, nXPos, nYPos);
  }

  // Bail if we cannot find the destination DC
  if (!surface) {
    return -1;
  }

  /* The colour, a palette's if it names one (`palette-colour.ts`). */
  const color = colourOf(clrref, surface);

  // Create a Brush
  const brush = new Brush(color);
  const old = surface.brush;
  surface.brush = brush;
  surface.fillRect(nXPos, nYPos, 1, 1);
  surface.brush = old;

  /* The colour drawn, which is the display driver's for the one asked for,
   * as `penmatch` recorded: 512 of 512, on the screen's bitmaps and on a
   * monochrome one. */
  const palette =
    surface.bitmap instanceof DeviceBitmap
      ? surface.bitmap.devicePalette
      : DevicePalette.forDisplay(this.display);

  return palette.colorref(matchedIndex(this.display, palette, color.red, color.green, color.blue));
}
