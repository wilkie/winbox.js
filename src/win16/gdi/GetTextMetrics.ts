"use strict";

import { TRUE, FALSE } from '../consts.js';

import { BitmapFont } from '../../raster/bitmap-font.js';

/**
 * The **GetTextMetrics** function retrieves the metrics for the current font.
 *
 * The following example calls the **GetTextMetrics** function and then uses
 * information in a `TEXTMETRIC` structure to determine how many break
 * characters are in a string of text.
 *
 * **See also**:
 * {@link Gdi.GetTextAlign GetTextAlign}
 * {@link Gdi.GetTextExtent GetTextExtent}
 * {@link Gdi.GetTextFace GetTextFace}
 * {@link Gdi.SetTextJustification SetTextJustification}
 *
 * @static
 * @function GetTextMetrics
 * @memberof Gdi
 *
 * @param {Types.HDC} hdc - Identifies the device context.
 * @param {Gdi.TEXTMETRIC} lptm - Points to the TEXTMETRIC structure that
 *                                receives the metrics.
 *
 * @return {Types.BOOL} The return value is nonzero if the function is
 *                      successful. Otherwise, it is zero.
 */
export function GetTextMetrics(hdc, lptm) {
    // Get the surface instance
    const surface = this.handles.resolve(hdc);

    if (!surface) {
        return FALSE;
    }

    // Get the current font
    const font = surface.font;

    // Get the information
    if (font instanceof BitmapFont) {
        const header = font.fontFor(12).header;

        lptm.tmHeight = header.dfPixHeight;
        lptm.tmAscent = header.dfAscent;
        lptm.tmDescent = header.dfPixHeight - header.dfAscent;
        lptm.tmInternalLeading = header.dfInternalLeading;
        lptm.tmExternalLeading = header.dfExternalLeading;
        lptm.tmAveCharWidth = header.dfAvgWidth;
        lptm.tmMaxCharWidth = header.dfMaxWidth;
        lptm.tmWeight = header.dfWeight;
        lptm.tmItalic = header.dfItalic;
        lptm.tmUnderlined = header.dfUnderline;
        lptm.tmStruckOut = header.dfStrikeOut;
        lptm.tmFirstChar = header.dfFirstChar;
        lptm.tmLastChar = header.dfLastChar;
        lptm.tmDefaultChar = header.dfDefaultChar;
        lptm.tmBreakChar = header.dfBreakChar;
        lptm.tmPitchAndFamily = header.dfPitchAndFamily;
        lptm.tmCharSet = header.dfCharSet;
        lptm.tmOverhang = 0;
        lptm.tmDigitizedAspectX = header.dfHorizRes;
        lptm.tmDigitizedAspectY = header.dfVertRes;
    }

    return TRUE;
}
