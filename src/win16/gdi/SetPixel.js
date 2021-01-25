"use strict";

import { Color } from '../../raster/color.js';
import { Brush } from '../../raster/brush.js';

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
    let surface = this.handles.resolve(hdc);

    // Bail if we cannot find the destination DC
    if (!surface) {
        return -1;
    }

    // Interpret color
    let components = Color.colorToBgr(clrref);
    let color = new Color(components.r, components.g, components.b);

    // Create a Brush
    let brush = new Brush(color);
    let old = surface.brush;
    surface.brush = brush;
    surface.fillRect(nXPos, nYPos, 1, 1);
    surface.brush = old;

    // Return the color value that was used
    return clrref;
}
