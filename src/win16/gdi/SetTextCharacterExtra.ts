'use strict';

import { Gdi } from '../gdi.js';

/**
 * The **SetTextCharacterExtra** function sets the amount of intercharacter
 * spacing.
 *
 * GDI adds the amount after every character it draws, so the second character
 * of a string moves by it, the third by twice it, and so on.
 *
 * **Measured.** `textxtra` draws two characters at spacings of nought, one, two
 * and five, on three faces at two sizes, and the ink's right edge moves by
 * exactly the spacing in every one of the twenty-four.
 *
 * **See also**:
 * {@link Gdi.GetTextCharacterExtra GetTextCharacterExtra}
 * {@link Gdi.TextOut TextOut}
 *
 * @static
 * @function SetTextCharacterExtra
 * @memberof Gdi
 *
 * @param {Types.HDC} hdc - Identifies the device context.
 * @param {Types.INT} extra - The spacing, in device units.
 *
 * @return {Types.INT} The previous spacing, or `0x8000` on failure.
 */
export function SetTextCharacterExtra(hdc, extra) {
  this.debug('SetTextCharacterExtra', hdc, extra);

  const surface = this.handles.resolve(hdc);

  if (!surface) {
    return 0x8000;
  }

  const old = surface.charExtra;

  surface.charExtra = extra;

  return old;
}
