'use strict';

import { colourOf, isPaletteRef } from '../../raster/palette-colour.js';

import { colorrefOf } from './SetBkColor.js';
import { Color } from '../../raster/color.js';

/**
 * The **SetTextColor** function sets the current text color to the
 * specified color. The system uses the text color when writing text to a device
 * context and also when converting bitmaps between color and monochrome device
 * contexts.
 *
 * If the device cannot represent the specified color, the system sets the
 * text color to the nearest physical color.
 *
 * The background color for a character is specified by the
 * {@link Gdi.SetBkColor SetBkColor} and {@link Gdi.SetBkMode SetBkMode}
 * functions.
 *
 * **See also**:
 * {@link Gdi.GetTextColor GetTextColor}
 * {@link Gdi.BitBlt BitBlt}
 * {@link Gdi.SetBkColor SetBkColor}
 * {@link Gdi.SetBkMode SetBkMode}
 *
 * @static
 * @function SetTextColor
 * @memberof Gdi
 *
 * @param {Types.HDC} hdc - Identifies the device context.
 * @param {Types.COLORREF} clrref - Specifies the color of the text.
 *
 * @return {Types.COLORREF} The return value is the RGB value of the previous
 *                          text color, if the function is successful.
 */
export function SetTextColor(hdc, color) {
  this.debug('SetTextColor', hdc, color);

  // Resolve the destination DC handle
  const surface = this.handles.resolve(hdc);

  // Bail if we cannot find the destination DC
  if (!surface) {
    // TODO: check if this is the proper error code?
    // This is from SetBkColor... so this is known as an error RGB value.
    return 0x80000000;
  }

  /* A palette's colour, its entry's (see `SetBkColor`). */
  const realized: any = isPaletteRef(color)
    ? colourOf(color, surface)
    : (({ r, g, b }) => new Color(r, g, b))(Color.colorToBgr(color));

  /* Kept as it was given, and the colour before answered so (`bkcolor`). */
  realized.colorref = color >>> 0;
  surface.forecolor = realized;

  /* And the colour text is drawn in, which is a field of its own on the
   * surface: `rotstyle` and `smeargnd` draw white text on a black ground
   * through this call, and 126 of their records need it. */
  const before = surface.textColor;

  surface.textColor = realized;

  return colorrefOf(before, 0);
}

/**
 * The colour `SetTextColor` set, as it was given, black for a new device
 * context. **Recorded** by `clipdc`, through `SaveDC` and `RestoreDC`.
 *
 * @param {Types.HDC} hdc - The device context.
 *
 * @returns {Types.COLORREF} The colour, or nought for no device context.
 */
export function GetTextColor(hdc) {
  const surface = this.handles.resolve(hdc);
  return surface ? colorrefOf(surface.textColor, 0) : 0;
}
