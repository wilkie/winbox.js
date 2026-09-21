'use strict';

import { Gdi } from '../gdi.js';

/**
 * The **SetTextAlign** function sets the text-alignment flags for the given
 * device context.
 *
 * The flags say what the point handed to {@link Gdi.TextOut TextOut} means.
 * Across, `TA_LEFT` (0) makes it the left edge, `TA_RIGHT` (2) the right and
 * `TA_CENTER` (6) the middle. Down, `TA_TOP` (0) makes it the top of the cell,
 * `TA_BOTTOM` (8) the bottom and `TA_BASELINE` (24) the baseline.
 *
 * **Measured.** `textalin` draws a character in the middle of the cell with
 * every combination: right moves the text left by the whole advance, centre by
 * half of it truncated, bottom moves it up by the cell height and baseline by
 * the ascent.
 *
 * **See also**:
 * {@link Gdi.GetTextAlign GetTextAlign}
 * {@link Gdi.TextOut TextOut}
 *
 * @static
 * @function SetTextAlign
 * @memberof Gdi
 *
 * @param {Types.HDC} hdc - Identifies the device context.
 * @param {Types.WORD} flags - The alignment flags.
 *
 * @return {Types.WORD} The previous flags, or `0xffff` on failure.
 */
export function SetTextAlign(hdc, flags) {
  this.debug('SetTextAlign', hdc, flags);

  const surface = this.handles.resolve(hdc);

  if (!surface) {
    return 0xffff;
  }

  const old = surface.textAlign;

  surface.textAlign = flags;

  return old;
}
