'use strict';

import { TRUE, FALSE } from '../consts.js';

import { BitmapFont } from '../../raster/bitmap-font.js';
import { LogicalFont } from '../../raster/logical-font.js';

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
  if (font instanceof LogicalFont || font instanceof BitmapFont) {
    const header = (font instanceof LogicalFont ? font.entry : font.fontFor(12)).header;

    /* A bitmap face has one weight, no slant and no rule, so a request for
     * bold, italic, underline or strikeout is answered by altering the strike
     * rather than by opening another file. The metrics then have to report
     * what was asked for rather than what the file says, because the file
     * says the same thing either way.
     *
     * And when the size asked for is larger than any strike installed, the
     * strike is stretched: a hundred pixel MS Sans Serif is the twenty pixel
     * strike five times over, exact in every metric.
     */
    const style = font instanceof LogicalFont ? font.style : {};
    const scale = font instanceof LogicalFont ? font.scale : 1;
    const horizontal = font instanceof LogicalFont ? font.horizontal : 1;

    /* Whether the strike has to be emboldened, which is not the same as
     * whether the request asked for bold. The System font is drawn bold
     * already, so asking it for bold changes nothing: no character widens and
     * nothing overhangs. Emboldening a face that is bold in the file would
     * make it bolder than Windows ever draws it.
     */
    const wantsBold = (style.weight ?? 0) >= 700;
    const bold = wantsBold && header.dfWeight < 700;

    lptm.tmHeight = header.dfPixHeight * scale;
    lptm.tmAscent = header.dfAscent * scale;
    lptm.tmDescent = (header.dfPixHeight - header.dfAscent) * scale;
    lptm.tmInternalLeading = header.dfInternalLeading * scale;
    lptm.tmExternalLeading = header.dfExternalLeading * scale;

    // Emboldening a bitmap widens every character by one pixel.
    lptm.tmAveCharWidth = header.dfAvgWidth * horizontal + (bold ? 1 : 0);
    lptm.tmMaxCharWidth = header.dfMaxWidth * horizontal + (bold ? 1 : 0);

    /* A request for bold reports 700 however heavy it asked for. A request for
     * anything else reports what the file says, which is not always 400: the
     * System font is drawn bold and reports 700 to a program that asked for
     * nothing of the kind.
     */
    lptm.tmWeight = wantsBold ? 700 : header.dfWeight;

    /* Italic reports 1 and the other two report 255. Not a typo on either
     * side: `tmItalic` is a flag and the other two are the byte with every
     * bit set, and a program comparing against 1 would get the wrong answer
     * about an underlined font.
     */
    lptm.tmItalic = style.italic === undefined ? header.dfItalic : style.italic ? 1 : 0;
    lptm.tmUnderlined =
      style.underline === undefined ? header.dfUnderline : style.underline ? 0xff : 0;
    lptm.tmStruckOut =
      style.strikeout === undefined ? header.dfStrikeOut : style.strikeout ? 0xff : 0;
    lptm.tmFirstChar = header.dfFirstChar;
    lptm.tmLastChar = header.dfLastChar;
    /* The font file stores these two relative to the first character it
     * contains, while the metrics report them as the characters they are.
     */
    lptm.tmDefaultChar = header.dfDefaultChar + header.dfFirstChar;
    lptm.tmBreakChar = header.dfBreakChar + header.dfFirstChar;
    lptm.tmPitchAndFamily = header.dfPitchAndFamily;
    lptm.tmCharSet = header.dfCharSet;
    /* What a synthesised style adds to the width of a whole string, over and
     * above the characters in it.
     *
     * Emboldening smears each character one pixel to the right, so the last
     * one hangs one pixel past where it would have ended -- one, at every size
     * and on every face. Slanting leans the cell over by half its own height,
     * so the overhang grows with the font: `floor((height - 1) / 2)`, which
     * fits every size of every face measured. The height it follows is the one
     * actually being drawn, so a strike stretched to a size it was not
     * installed at leans further in proportion.
     *
     * Asking for both adds both.
     */
    lptm.tmOverhang = (bold ? 1 : 0) + (style.italic ? Math.floor((lptm.tmHeight - 1) / 2) : 0);
    lptm.tmDigitizedAspectX = header.dfHorizRes;
    lptm.tmDigitizedAspectY = header.dfVertRes;
  }

  return TRUE;
}
