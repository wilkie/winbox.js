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

  /* And a strike's simulations on top, each width alike. The display
   * driver's `GetCharWidth` adds two to each where the text transform asks
   * for a weight of 700 or more over a strike lighter than that -- the
   * smear's pixel and its overhang (`VGA.DRV` seg1 `17f6`-`1815`, `18af`);
   * GDI's then adds a slant's overhang, half the height less one, where the
   * device cannot slant (`GDI.EXE` seg3 `216f`-`218e`; the VGA's `TEXTCAPS`
   * lacks `TC_IA_ABLE`). **Recorded** by `lbtext`: MS Sans Serif at 11
   * points' 13 rows answers 6 for '1', 8 in bold, 12 in italic and 14 in
   * both -- each what a string of the one character measures. */
  const strike = font instanceof LogicalFont && !outline && !font.isVector ? font : null;
  const simulated = strike
    ? (strike.emboldens ? 2 : 0) +
      (strike.style.italic
        ? Math.floor((strike.entry.header.dfPixHeight * strike.scale - 1) / 2)
        : 0)
    : 0;

  for (let code = wFirstChar; code <= wLastChar; code++) {
    cpu.write16(
      segment,
      offset,
      outline
        ? outline.outlineAdvance(code)
        : Math.round(entry.characterEntryFor(code).width * horizontal) + simulated
    );
    offset += 2;
  }

  return TRUE;
}
