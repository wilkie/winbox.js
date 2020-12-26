"use strict";

import { Gdi } from '../gdi.js';

import { Color } from '../../raster/color.js';
import { Brush } from '../../raster/brush.js';
import { Bitmap } from '../../raster/bitmap.js';

/**
 * The **PatBlt** function creates a bit pattern on the specified device. The
 * pattern is a combination of the selected brush and the pattern already on the
 * device. The specified raster-operation code defines how the patterns are
 * combined.
 *
 * The raster operations listed for this function are a limited subset of the
 * full 256 ternary raster-operation codes; in particular, a raster-operation
 * code that refers to a source cannot be used.
 *
 * Not all devices support the **PatBlt** function. To determine whether a
 * device supports **PatBlt**, an application can call the
 * {@link Gdi.GetDeviceCaps GetDeviceCaps} function with the `RASTERCAPS` index.
 *
 * **See also**:
 * {@link Gdi.GetDeviceCaps GetDeviceCaps}
 *
 * @static
 * @function PatBlt
 * @memberof Gdi
 *
 * @param {Types.HDC} hdc - Identifies the destination device context.
 * @param {Types.INT} nLeftRect - Specifies the logical x-coordinate of the
 *                                upper-left corner of the rectangle that
 *                                receives the pattern.
 * @param {Types.INT} nTopRect - Specifies the logical y-coordinate of the
 *                               upper-left corner of the rectangle that
 *                               receives the pattern.
 * @param {Types.INT} nwidth - Specifies the width, in logical units, of the
 *                             rectangle that receives the pattern.
 * @param {Types.INT} nheight - Specifies the height, in logical units, of the
 *                             rectangle that receives the pattern.
 * @param {Types.DWORD} fdwRop - Specifies the raster-operation code that
 *                               determines how the graphics device interface
 *                               (GDI) combines the colors in the output
 *                               operation. This parameter can be one of the
 *                               following values:
 * * `PATCOPY`: Copies the pattern to the destination bitmap.
 * * `PATINVERT`: Combines the destination bitmap with the pattern by using the
 *                Boolean XOR operator.
 * * `PATPAINT`: Paints the destination bitmap.
 * * `DSTINVERT`: Inverts the destination bitmap.
 * * `BLACKNESS`: Turns all output black.
 * * `WHITENESS`: Turns all output white.
 *
 * @return {Types.BOOL} The return value is nonzero if the function is
 *                      successful. Otherwise it is zero.
 */
export function SetBkColor(hdc, color) {
    console.log("SetBkColor", arguments);

    // Resolve the destination DC handle
    let surface = this.handles.resolve(hdc);

    // Bail if we cannot find the destination DC
    if (!surface) {
        return FALSE;
    }

    return color;
}
