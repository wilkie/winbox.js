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

  for (let code = wFirstChar; code <= wLastChar; code++) {
    cpu.write16(
      segment,
      offset,
      outline ? outline.outlineAdvance(code) : entry.characterEntryFor(code).width
    );
    offset += 2;
  }

  return TRUE;
}
