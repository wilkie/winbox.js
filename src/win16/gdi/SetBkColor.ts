'use strict';

import { colourOf, isPaletteRef } from '../../raster/palette-colour.js';

import { Color } from '../../raster/color.js';

/**
 * The **SetBkColor** function sets the current background color to the
 * specified color.
 *
 * If the background mode is `OPAQUE`, the system uses the background color to
 * fill the gaps in styled lines, the gaps between hatched lines in brushes, and
 * the background in character cells. The system also uses the background color
 * when converting bitmaps between color and monochrome device contexts.
 *
 * If the device cannot display the specified color, the system sets the
 * background color to the nearest physical color.
 *
 * **See also**:
 * {@link Gdi.BitBlt BitBlt}
 * {@link Gdi.GetBkColor GetBkColor}
 * {@link Gdi.GetBkMode GetBkMode}
 * {@link Gdi.SetBkMode SetBkMode}
 * {@link Gdi.StretchBlt StretchBlt}
 *
 * @static
 * @function SetBkColor
 * @memberof Gdi
 *
 * @param {Types.HDC} hdc - Identifies the device context.
 * @param {Types.COLORREF} clrref - Specifies the new background color.
 *
 * @return {Types.COLORREF} The return value is the RGB value of the previous
 *                          background color, if the function is successful. The
 *                          return value is `0x80000000` if an error occurs.
 */
export function SetBkColor(hdc, clrref) {
  this.debug('SetBkColor', hdc, clrref);

  // Resolve the destination DC handle
  const surface = this.handles.resolve(hdc);

  // Bail if we cannot find the destination DC
  if (!surface) {
    return 0x80000000;
  }

  const old = surface.backcolor;
  /* A palette's colour, its entry's: drawn in its slot where the palette is
   * realized on the 256-colour display (`palette-colour.ts`). SimTower sets
   * `PALETTEINDEX(0)`, its white, for the dots of its focus rectangle. */
  const color: any = isPaletteRef(clrref)
    ? colourOf(clrref, surface)
    : (({ r, g, b }) => new Color(r, g, b))(Color.colorToBgr(clrref));

  /* Kept as it was given, to be answered so: the colour before, as the
   * program gave it -- one the display has not, or one of a palette, too
   * -- white for a new device context (`bkcolor`). */
  color.colorref = clrref >>> 0;
  surface.backcolor = color;

  return colorrefOf(old, 0xffffff);
}

/** A colour of a device context as the program gave it, or made of its parts. */
export function colorrefOf(colour: any, none: number) {
  if (!colour) {
    return none;
  }

  return colour.colorref ?? (colour.red | (colour.green << 8) | (colour.blue << 16)) >>> 0;
}

/**
 * The colour `SetBkColor` set, as it was given, white for a new device
 * context. **Recorded** by `clipdc`, through `SaveDC` and `RestoreDC`.
 *
 * @param {Types.HDC} hdc - The device context.
 *
 * @returns {Types.COLORREF} The colour, or nought for no device context.
 */
export function GetBkColor(hdc) {
  const surface = this.handles.resolve(hdc);
  return surface ? colorrefOf(surface.backcolor, 0xffffff) : 0;
}
