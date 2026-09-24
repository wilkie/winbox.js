'use strict';

import { CreateFontIndirect } from './CreateFontIndirect.js';

/**
 * The **CreateFont** function creates a logical font that has the
 * characteristics specified in the given parameters.
 *
 * It is {@link Gdi.CreateFontIndirect CreateFontIndirect} with the structure
 * spread out into fourteen arguments, and the oracle records both so that
 * "equivalent" is a measurement rather than a claim.
 *
 * **See also**:
 * {@link Gdi.CreateFontIndirect CreateFontIndirect}
 *
 * @static
 * @function CreateFont
 * @memberof Gdi
 *
 * @param {Types.INT} nHeight - Desired height, in logical units, of the font.
 *                              A positive value is the cell height including
 *                              the internal leading; a negative value is the
 *                              character height without it; zero asks the font
 *                              mapper for a default.
 * @param {Types.INT} nWidth - Average width, in logical units, of characters
 *                             in the font. Zero lets the width follow the
 *                             height.
 * @param {Types.INT} nEscapement - Angle, in tenths of a degree, between the
 *                                  base line of a line of text and the x-axis.
 * @param {Types.INT} nOrientation - Angle, in tenths of a degree, between the
 *                                   base line of a character and the x-axis.
 * @param {Types.INT} fnWeight - Font weight, from 0 to 1000. `FW_NORMAL` is
 *                               400 and `FW_BOLD` is 700.
 * @param {Types.BYTE} fbItalic - Specifies an italic font if nonzero.
 * @param {Types.BYTE} fbUnderline - Specifies an underlined font if nonzero.
 * @param {Types.BYTE} fbStrikeOut - Specifies a struck-out font if nonzero.
 * @param {Types.BYTE} fbCharSet - The character set of the font.
 * @param {Types.BYTE} fbOutputPrecision - How closely the output must match
 *                                         the requested height and width.
 * @param {Types.BYTE} fbClipPrecision - How to clip characters that fall
 *                                       partly outside the clipping region.
 * @param {Types.BYTE} fbQuality - How carefully GDI must match the logical
 *                                 font to a physical one.
 * @param {Types.BYTE} fbPitchAndFamily - The pitch and family of the font,
 *                                        which is what the mapper goes on when
 *                                        no face is named.
 * @param {Types.LPCSTR} lpszFace - Points to a null-terminated string naming
 *                                  the typeface.
 *
 * @returns {Types.HFONT} The return value is the handle of the logical font if
 *                        the function is successful. Otherwise, it is `NULL`.
 */
export function CreateFont(
  nHeight,
  nWidth,
  nEscapement,
  nOrientation,
  fnWeight,
  fbItalic,
  fbUnderline,
  fbStrikeOut,
  fbCharSet,
  fbOutputPrecision,
  fbClipPrecision,
  fbQuality,
  fbPitchAndFamily,
  lpszFace
) {
  /* Both angles are carried. The drawing is decided by the escapement alone,
   * which 8u measured by sweeping the two apart, pixel for pixel, in a face
   * that turns and in one that cannot -- but the mapper reads the orientation
   * as well, so it goes into the request. See `CreateFontIndirect`.
   *
   * Precision and quality are still carried no further.
   */
  return CreateFontIndirect.bind(this)({
    lfHeight: nHeight,
    lfWidth: nWidth,
    lfEscapement: nEscapement,
    lfOrientation: nOrientation,
    lfWeight: fnWeight,
    lfItalic: fbItalic,
    lfUnderline: fbUnderline,
    lfStrikeOut: fbStrikeOut,
    lfCharSet: fbCharSet,
    lfPitchAndFamily: fbPitchAndFamily,
    lfFaceName: lpszFace === null ? '' : String(lpszFace),
  });
}
