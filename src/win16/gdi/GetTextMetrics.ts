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
  /* An outline face has no strike to read a header from: everything comes out
   * of the font's own tables of grid-fitted values at the pixel size it was
   * settled at. See `TrueTypeFont` for why those tables exist.
   */
  if (font instanceof LogicalFont && font.outline) {
    const outline = font.outline;
    const ppem = font.ppem;
    const style = font.style;

    lptm.tmAscent = style.ascent;
    lptm.tmDescent = style.descent;
    lptm.tmHeight = style.ascent + style.descent;

    // What the cell has over the em is the leading inside it.
    lptm.tmInternalLeading = lptm.tmHeight - ppem;
    lptm.tmExternalLeading = Math.round((outline.lineGap * ppem) / outline.unitsPerEm);

    const scaled = (units) => Math.round((units * ppem) / outline.unitsPerEm);

    lptm.tmAveCharWidth = scaled(outline.averageAdvance);

    // The grid-fitted maximum where the font states one, which is not the
    // scaled outline maximum: hinting can widen a glyph past it.
    lptm.tmMaxCharWidth = outline.deviceMaxAdvance(ppem) ?? scaled(outline.maxAdvance);

    const bold = (style.weight ?? 0) >= 700 && outline.weight < 700;

    lptm.tmWeight = (style.weight ?? 0) >= 700 ? 700 : outline.weight;
    lptm.tmItalic = style.italic ? 1 : 0;
    lptm.tmUnderlined = style.underline ? 0xff : 0;
    lptm.tmStruckOut = style.strikeout ? 0xff : 0;
    lptm.tmOverhang = bold ? 1 : 0;

    lptm.tmFirstChar = 32;
    lptm.tmLastChar = 255;
    lptm.tmDefaultChar = 128;
    lptm.tmBreakChar = 32;

    /* `TMPF_TRUETYPE` and `TMPF_VECTOR` both, since an outline is a vector
     * font that happens to be a TrueType one.
     */
    /* Variable pitch unless the font says otherwise, plus the two bits that
     * say how it is drawn -- `TMPF_VECTOR` and `TMPF_TRUETYPE` -- plus the
     * family the font puts itself in.
     */
    lptm.tmPitchAndFamily = (outline.fixedPitch ? 0x00 : 0x01) | 0x06 | outline.family;
    lptm.tmCharSet = 0;
    lptm.tmDigitizedAspectX = 96;
    lptm.tmDigitizedAspectY = 96;

    return TRUE;
  }

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

    /* The height actually being drawn. For a strike stretched by a whole
     * number that is the design times the factor; for a scalable face it is
     * whatever was asked for, and the factor is a fraction.
     */
    const cell = Math.round(header.dfPixHeight * scale);

    /* Whether the strike has to be emboldened, which is not the same as
     * whether the request asked for bold. The System font is drawn bold
     * already, so asking it for bold changes nothing: no character widens and
     * nothing overhangs. Emboldening a face that is bold in the file would
     * make it bolder than Windows ever draws it.
     */
    const wantsBold = (style.weight ?? 0) >= 700;
    const bold = wantsBold && header.dfWeight < 700;

    /* A scalable face is drawn at exactly the height asked for, and every
     * other vertical measure is its design value scaled to that and rounded on
     * its own. They are rounded independently, so the ascent and descent need
     * not add up to the height -- a sixteen pixel Roman reports thirteen and
     * four. Measured across three faces at nine sizes each, including one
     * whose design is 37 pixels rather than 32.
     */
    const design = header.dfPixHeight;
    const vertical = (value) => (scale === 1 ? value : Math.round((value * cell) / design));

    lptm.tmHeight = cell;
    lptm.tmAscent = vertical(header.dfAscent);
    lptm.tmDescent = vertical(design - header.dfAscent);
    lptm.tmInternalLeading = vertical(header.dfInternalLeading);
    lptm.tmExternalLeading = vertical(header.dfExternalLeading);

    /* Widths follow the design's own aspect for a stroke font and the stretch
     * factor for a strike. Emboldening widens every character by one pixel
     * either way.
     */
    const vector = font instanceof LogicalFont && font.isVector;
    const widths = vector ? font.widthScale : horizontal;

    /* How far the emboldening is smeared, in pixels.
     *
     * A strike is drawn again one pixel across, always. Strokes are drawn
     * again a *scaled* pixel across -- the pen thickens with the font -- so
     * the offset is the width scale rounded to whole pixels, which is zero
     * until the font is drawn at about half its design width and three by the
     * time it is drawn at three times. Recorded across three faces at sixteen
     * sizes each; it follows the width scale rather than the height, which is
     * why Roman and Script part company at the same requested height.
     */
    const smear = !bold ? 0 : vector ? Math.round(font.widthScale) : 1;

    lptm.tmAveCharWidth = Math.round(header.dfAvgWidth * widths) + smear;
    lptm.tmMaxCharWidth = Math.round(header.dfMaxWidth * widths) + smear;

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
    /* GDI adds `TMPF_VECTOR` for a stroke font. The file itself does not carry
     * it -- Roman says 17 and the metrics report 19 -- because it describes how
     * the font is drawn rather than what it looks like.
     */
    lptm.tmPitchAndFamily =
      header.dfPitchAndFamily | (font instanceof LogicalFont && font.isVector ? 0x02 : 0x00);
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
    /* A stroke font reports no overhang for bold at all -- its extra pixel is
     * inside the string's width rather than past its end -- and leans one
     * pixel further than a strike does at the same cell, `floor(h / 2)`
     * against `floor((h - 1) / 2)`. One pixel, and the only way to know it is
     * to measure both.
     */
    lptm.tmOverhang = vector
      ? smear + (style.italic ? Math.floor(lptm.tmHeight / 2) : 0)
      : (bold ? 1 : 0) + (style.italic ? Math.floor((lptm.tmHeight - 1) / 2) : 0);
    lptm.tmDigitizedAspectX = header.dfHorizRes;
    lptm.tmDigitizedAspectY = header.dfVertRes;
  }

  return TRUE;
}
