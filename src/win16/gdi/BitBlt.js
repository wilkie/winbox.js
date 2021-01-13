"use strict";

import { Gdi } from '../gdi.js';

import { Bitmap } from '../../raster/bitmap.js';

import { TRUE, FALSE } from '../consts.js';

/**
 * The **BitBlt** function copies a bitmap from a specified device context to a
 * destination device context.
 *
 * An application that uses the **BitBlt** function to copy pixels from one
 * window to another window or from a source rectangle in a window into a
 * target rectangle in the same window should set the `CS_BYTEALIGNWINDOW` or
 * `CS_BYTEALIGNCLIENT` flag when registering the window classes. By aligning
 * the windows or client areas on byte boundaries, the application can ensure
 * that the **BitBlt** operations occur on byte-aligned rectangles. **BitBlt**
 * operations on byte-aligned rectangles are considerably faster than **BitBlt**
 * operations on rectangles that are not byte-aligned.
 *
 * GDI transforms the *`nWidth`* and *`nHeight`* parameters once by using the
 * destination device context, and once by using the source device context. If
 * the resulting extents do not match, GDI uses the {@link Gdi.StretchBlt
 * StretchBlt} function to compress or stretch the source bitmap as necessary.
 * If destination, source, and pattern bitmaps do not have the same color
 * format, the **BitBlt function converts the source and pattern bitmaps to
 * match the destination. The foreground and background colors of the
 * destination bitmap are used in the conversion.
 *
 * When the **BitBlt** function converts a monochrome bitmap to color, it sets
 * white bits (1) to the background color and black bits (0) to the foreground
 * color. The foreground and background colors of the destination device context
 * are used. To convert color to monochrome, **BitBlt** sets pixels that match
 * the background color to white and sets all other pixels to black. **BitBlt**
 * uses the foreground and background colors of the source (color) device
 * context to convert from color to monochrome.
 *
 * The foreground color is the current text color to the specified device
 * context, and the background color is the current background color for the
 * specified device context.
 *
 * Not all devices support the **BitBlt** function. An application can determine
 * whether a device supports **BitBlt** by calling the {@link Gdi.GetDeviceCaps
 * GetDeviceCaps} function and specifying the **RASTERCAPS** index.
 *
 * **See also**:
 * {@link Gdi.GetDeviceCaps GetDeviceCaps}
 * {@link Gdi.PatBlt PatBlt}
 * {@link Gdi.SetTextColor SetTextColor}
 * {@link Gdi.StetchBlt StretchBlt}
 * {@link Gdi.StetchDIBits StretchDIBits}
 *
 * @static
 * @function BitBlt
 * @memberof Gdi
 *
 * @param {Types.HDC} hdcDest - Identifies the destination device context.
 * @param {Types.INT} nXDest - Specifies the logical x-coordinate of the upper-
 *                             left corner of the destination rectangle.
 * @param {Types.INT} nYDest - Specifies the logical y-coordinate of the upper-
 *                             left corner of the destination rectangle.
 * @param {Types.INT} nWidth - Specifies the width, in logical units, of the
 *                             destination rectangle and source bitmap.
 * @param {Types.INT} nHeight - Specifies the height, in logical units, of the
 *                              destination rectangle and source bitmap.
 * @param {Types.HDC} hdcSrc - Identifies the device context from which the
 *                             bitmap will be copied. This parameter must be
 *                             `NULL` if the *`dwRop`* parameter specifies a
 *                             raster operation the does not include a source.
 *                             This parameter can specify a memory device
 *                             context.
 * @param {Types.INT} nXSrc - Specifies the logical x-coordinate of the upper-
 *                            left corner of the source bitmap.
 * @param {Types.INT} nYSrc - Specifies the logical y-coordinate of the upper-
 *                            left corner of the source bitmap.
 * @param {Types.DWORD} dwRop - Specifies the raster operation to be performed.
 *                              Raster operation codes define how the graphics
 *                              device interface (GDI) combines colors in output
 *                              operations that involve a current brush, a
 *                              possible source bitmap, and a destination
 *                              bitmap. This parameter can be one of the
 *                              following:
 * * `BLACKNESS`: Turns all output black.
 * * `DSTINVERT`: Inverts the destination bitmap.
 * * `MERGECOPY`: Combines the pattern and the source bitmap by using the
 *                Boolean AND operator.
 * * `MERGEPAINT`: Combines the inverted source bitmap with the destination
 *                 bitmap by using the Boolean OR operator.
 * * `NOTSRCCOPY`: Copies the inverted source bitmap to the destination.
 * * `NOTSRCERASE`: Inverts the result of combining the destination and source
 *                  bitmaps by using the Boolean OR operator.
 * * `PATCOPY`: Copies the pattern to the destination bitmap.
 * * `PATINVERT`: Combines the destination bitmap with the pattern by using the
 *                Boolean XOR operator.
 * * `PATPAINT`: Combines the inverted source bitmap with the pattern by using
 *               the Boolean OR operator. Combines the result of this operation
 *               with the destination bitmap by using the Boolean OR operator.
 * * `SRCAND`: Combines pixels of the destination and source bitmaps by using
 *             the boolean AND operator.
 * * `SRCCOPY`: Copies the source bitmap to the destination bitmap.
 * * `SRCERASE`: Inverts the destination bitmap and combines the result with the
 *               source bitmap by using the Boolean AND operator.
 * * `SRCINVERT`: Combines pixels of the destination and source bitmaps by using
 *                the boolean XOR operator.
 * * `SRCPAINT`: Combines pixels of the destination and source bitmaps by using
 *               the boolean OR operator.
 * * `WHITENESS`: Turns all output white.
 *
 * @return {Types.BOOL} The return value is nonzero if the function is
 *                      successful. Otherwise it is zero.
 */
var i = 0;

export function BitBlt(hdcDest, nXDest, nYDest, nWidth, nHeight,
                       hdcSrc, nXSrc, nYSrc, dwRop) {
    // Resolve the source DC handle
    let source = this.handles.resolve(hdcSrc);
    
    i++;
    if (!(i % 10)) {
        //return TRUE;
    }

    // Bail if we cannot find the source DC
    if (!source) {
        return FALSE;
    }

    // Resolve the bitmap attached to the device
    let sourceBitmap = source.bitmap;
    //console.log(source, sourceBitmap);
    let sourceView = sourceBitmap.view;

    // Resolve the destination DC handle
    let destination = this.handles.resolve(hdcDest);

    //console.log("BitBlt", source, destination.width, destination.bitmap.width);

    // Bail if we cannot find the destination DC
    if (!destination) {
        return FALSE;
    }

    // Resolve the bitmap attached to the device
    let destinationBitmap = destination.bitmap;
    let destinationView = destinationBitmap.view;

    // Determine the monochrome palette (for conversion)
    if (sourceBitmap.bpp == 1) {
        sourceBitmap.palette[0] = destination.forecolor.r8g8b8a8;
        sourceBitmap.palette[1] = destination.backcolor.r8g8b8a8;
    }

    // TODO: Check width/height and bounds of bitmaps (otherwise we crash)

    // Perform the operation
    let invert = false;
    switch (dwRop) {
        case Gdi.NOTSRCCOPY:
            //console.log("NOT");
            invert = true;
            // fall through
        case Gdi.SRCCOPY:
            //console.log("SRCCOPY");
            destinationBitmap.blit(Bitmap.OPERATIONS.COPY, nXDest, nYDest, nWidth, nHeight, sourceBitmap, nXSrc, nYSrc, nWidth, nHeight, invert);
            break;

        case Gdi.SRCPAINT:
            destinationBitmap.blit(Bitmap.OPERATIONS.OR, nXDest, nYDest, nWidth, nHeight, sourceBitmap, nXSrc, nYSrc, nWidth, nHeight, invert);
            break;

        case Gdi.SRCAND:
            destinationBitmap.blit(Bitmap.OPERATIONS.AND, nXDest, nYDest, nWidth, nHeight, sourceBitmap, nXSrc, nYSrc, nWidth, nHeight, invert);
            break;

        case Gdi.SRCINVERT:
            console.log("SRCINVERT");
            break;

        case Gdi.NOTSRCERASE:
            console.log("NOT");
            invert = true;
            // fall through
        case Gdi.SRCERASE:
            console.log("SRCERASE");
            break;

        case Gdi.MERGECOPY:
            console.log("MERGECOPY");
            break;

        case Gdi.MERGEPAINT:
            console.log("MERGEPAINT");
            break;

        case Gdi.PATCOPY:
            console.log("PATCOPY");
            break;

        case Gdi.PATPAINT:
            console.log("PATPAINT");
            break;

        case Gdi.DSTINVERT:
            console.log("DSTINVERT");
            break;

        case Gdi.BLACKNESS:
            console.log("BLACKNESS");
            break;

        case Gdi.WHITENESS:
            console.log("WHITENESS");
            break;

        default:
            break;
    }

    if (destinationBitmap.surface) {
        this.scheduler.pushDirty(destinationBitmap.surface);
    }

    return TRUE;
}
