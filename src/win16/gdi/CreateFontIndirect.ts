'use strict';

import { NULL } from '../consts.js';

import { LogicalFont } from '../../raster/logical-font.js';

/**
 * The **CreateFontIndirect** function creates a logical font that has the
 * characteristics specified in the given structure.
 *
 * The font can subsequently be selected as the current font for any device
 * context. This function does not open a file: it describes what is wanted,
 * and the description is matched against what is installed when the font is
 * selected into a device context and used. Two programs asking for the same
 * thing on machines with different fonts installed get different results, and
 * neither is told.
 *
 * The matching itself is in {@link FontManager#map}, and every rule in it was
 * recorded from Windows rather than read out of a manual -- see
 * `oracle/probes/font.c`. The parts worth knowing here are that the character
 * set outranks the face name, that an unrecognised name is not an error, and
 * that a request for bold or italic is answered by altering the one strike a
 * bitmap face has rather than by finding another.
 *
 * **See also**:
 * {@link Gdi.CreateFont CreateFont}
 * {@link Gdi.GetTextMetrics GetTextMetrics}
 * {@link Gdi.SelectObject SelectObject}
 *
 * @static
 * @function CreateFontIndirect
 * @memberof Gdi
 *
 * @param {Types.LOGFONT} lplf - Points to a `LOGFONT` structure that defines
 *                               the characteristics of the logical font.
 *
 * @returns {Types.HFONT} The return value is the handle of the logical font if
 *                        the function is successful. Otherwise, it is `NULL`.
 */
export function CreateFontIndirect(lplf) {
  if (!lplf) {
    return NULL;
  }

  const request = {
    face: lplf.lfFaceName ?? '',
    height: lplf.lfHeight ?? 0,
    width: lplf.lfWidth ?? 0,
    weight: lplf.lfWeight ?? 0,
    italic: !!lplf.lfItalic,
    underline: !!lplf.lfUnderline,
    strikeout: !!lplf.lfStrikeOut,
    charset: lplf.lfCharSet ?? 0,
    pitchAndFamily: lplf.lfPitchAndFamily ?? 0,

    /* Proof quality refuses a stretched strike outright; see
     * `FontManager.choose`.
     */
    quality: lplf.lfQuality ?? 0,

    /* The device's own aspect, because an outline is realised wider than it is
     * tall wherever the pixel is not square. See `FontManager.map`.
     */
    aspectX: this.display?.logicalPixelsX ?? 0,
    aspectY: this.display?.logicalPixelsY ?? 0,
  };

  const found = this.fonts.map(request);

  if (!found) {
    return NULL;
  }

  /* The name reported afterwards comes from the mapper rather than from the
   * request: a name that was honoured is echoed back even when something else
   * answered it, and a name that could not be is replaced by what did.
   */
  const font = new LogicalFont(found.face, 0, found.entry, {
    weight: request.weight,
    italic: request.italic,
    underline: request.underline,
    strikeout: request.strikeout,
    scale: found.scale,
    horizontal: found.horizontal,

    /* An outline face carries the font itself and the pixel size it was
     * settled at, because there is no strike to stand in for either.
     */
    outline: found.outline,

    /* Whether the family had the style asked for as a file of its own. When it
     * did there is nothing to make up: the glyphs are already bold, or already
     * slanted, and emboldening them again would be drawing them twice.
     */
    exactStyle: found.exactStyle,
    faceBold: found.faceBold,

    /* Whether the family the mapper settled on was an outline one, even where
     * a strike ended up being drawn. Only `tmItalic` reads it; see
     * `GetTextMetrics` for the pair of records that separate the two answers.
     */
    outlineFamily: found.outlineFamily,
    ppem: found.ppem,

    /* The horizontal pixel size, which differs from `ppem` only when the
     * request asked for an average character width of its own.
     */
    xPpem: found.xPpem,

    /* And the horizontal size before the width was applied, which the metrics
     * take the average and the maximum at. See `LogicalFont.xBase`.
     */
    xBase: found.xBase,
    ascent: found.ascent,
    descent: found.descent,
  });

  this.debug('CreateFontIndirect', request.face, request.height, found.scale);

  return this.handles.allocate(font);
}
