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

    /* Only two weights come out, whatever goes in: a request for anything
     * bold or heavier reports 700, and everything else reports 400. Recorded
     * -- 900 comes back as 700 and 300 as 400.
     */
    const bold = (style.weight ?? 0) >= 700;

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
    lptm.tmWeight = bold ? 700 : header.dfWeight;

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
     * above the characters themselves. Emboldening smears each character one
     * pixel to the right and the last one overhangs by that pixel; slanting
     * pushes the top of the last character further still. Both were measured
     * at a single size, so whether the slant's overhang follows the height is
     * not something these recordings settle.
     */
    lptm.tmOverhang = style.italic ? 7 : bold ? 1 : 0;
    lptm.tmDigitizedAspectX = header.dfHorizRes;
    lptm.tmDigitizedAspectY = header.dfVertRes;
  }

  return TRUE;
}
