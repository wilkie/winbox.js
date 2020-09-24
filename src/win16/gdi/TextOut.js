"use strict";

import { BitmapFont } from '../../raster/bitmap-font.js';

import { TRUE } from '../consts.js';

/**
 * The **TextOut** function writes a character string at the specified location,
 * using the currently selected font.
 *
 * Character origins are at the upper-left corner of the character cell.
 *
 * By default, the **TextOut** function does not use or update the current
 * position. If an application must update the current position when calling
 * **TextOut**, it can cell the {@link Gdi.SetTextAlign SetTextAlign} function
 * with the *`wFlags`* parameter set to `TA_UPDATECP`. When this flag is set,
 * the system ignores the *`nXStart`* and *`nYStart`* parameters on subsequent
 * calls to the **TextOut** function, using the current position instead.
 *
 * **See also**:
 * {@link Gdi.CreateBrushIndirect CreateBrushIndirect}
 * {@link Gdi.CreateDIBPatternBrush CreateDIBPatternBrush}
 * {@link Gdi.CreateHatchBrush CreateHatchBrush}
 * {@link Gdi.CreatePatternBrush CreatePatternBrush}
 * {@link Gdi.DeleteObject DeleteObject}
 *
 * @static
 * @function TextOut
 * @memberof Gdi
 *
 * @param {Types.HDC} hdc - Identifies the device context.
 * @param {Types.INT} nXStart - Specifies the logical x-coordinate of the
 *                              starting point of the string.
 * @param {Types.INT} nYStart - Specifies the logical y-coordinate of the
 *                              starting point of the string.
 * @param {Types.LPCSTR} lpszString - Points to the character string to be
 *                                    drawn.
 * @param {Types.INT} cbString - Specifies the number of bytes in the string.
 *
 * @return {Types.BOOL} The return value is nonzero if the function is
 *                      successful. Otherwise, it is zero.
 */
export function TextOut(hdc, nXStart, nYStart, lpszString, cbString) {
    //console.log("textout", lpszString, cbString, nXStart, nYStart);
    // Get the surface instance
    let surface = this.handles.resolve(hdc);

    // Draw background around the text
    let metrics = surface.measureText(lpszString.slice(0, cbString));
    surface.fillRect(nXStart, nYStart, metrics.width, metrics.height);

    // Draw the text
    surface.fillText(nXStart, nYStart, lpszString.slice(0, cbString));

    return TRUE;
}
