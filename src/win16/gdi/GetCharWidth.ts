'use strict';

import { BitmapFont } from '../../raster/bitmap-font.js';
import { LogicalFont } from '../../raster/logical-font.js';
import { FALSE, TRUE } from '../consts.js';

/**
 * The **GetCharWidth** function retrieves the widths of individual characters
 * in the current font.
 *
 * A proportional font's whole point is that these differ, and the extent of a
 * string is not its length times the average width -- which is the assumption
 * code makes when it has never had the real numbers to hand.
 *
 * **See also**:
 * {@link Gdi.GetTextExtent GetTextExtent}
 *
 * @static
 * @function GetCharWidth
 * @memberof Gdi
 *
 * @param {Types.HDC} hdc - Identifies the device context.
 * @param {Types.UINT} wFirstChar - The first character in the range.
 * @param {Types.UINT} wLastChar - The last character in the range.
 * @param {Types.FARPTR} lpBuffer - Points to a buffer of integers to receive
 *                                  one width per character.
 *
 * @return {Types.BOOL} Whether the widths could be retrieved.
 */
export function GetCharWidth(hdc, wFirstChar, wLastChar, lpBuffer) {
  const surface = this.handles.resolve(hdc);

  if (!surface || wLastChar < wFirstChar) {
    return FALSE;
  }

  const font = surface.font;

  if (!(font instanceof LogicalFont) && !(font instanceof BitmapFont)) {
    return FALSE;
  }

  /* An outline face has no strike to read a width out of: each advance is the
   * grid-fitted one the scaler would lay the character out with, which is the
   * same number a one character string measures. */
  const outline = font instanceof LogicalFont && font.outline ? font : null;
  const entry = outline ? null : font instanceof LogicalFont ? font.entry : font.fontFor(12);

  if (!outline && !entry) {
    return FALSE;
  }

  const cpu = this.machine.cpu.core;
  const segment = (lpBuffer >> 16) & 0xffff;
  let offset = lpBuffer & 0xffff;

  /* A strike's width is the one in its file carried across the width the
   * realisation ended up at -- the same `round(width * horizontal)` a string
   * of one character measures. Reading it out of the file unscaled answers the
   * design strike rather than the realised one, and a stretched strike is
   * exactly where the two part company: MS Sans Serif asked for a cell of 26 is
   * the 13 pixel strike doubled, whose `A` is 7 in the file and 14 on the
   * screen. **Measured** by `groundw` over four faces and every cell from eight
   * to forty-eight -- 195 of its 820 records, all of them a strike at a cell it
   * had to be stretched to reach.
   */
  const horizontal = font instanceof LogicalFont ? (font.widthScale ?? 1) : 1;

  for (let code = wFirstChar; code <= wLastChar; code++) {
    cpu.write16(
      segment,
      offset,
      outline
        ? outline.outlineAdvance(code)
        : Math.round(entry.characterEntryFor(code).width * horizontal)
    );
    offset += 2;
  }

  return TRUE;
}
