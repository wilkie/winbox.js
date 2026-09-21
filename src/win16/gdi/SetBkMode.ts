'use strict';

import { Gdi } from '../gdi.js';

/**
 * The **SetBkMode** function sets the background mode used with text and
 * hatched brushes.
 *
 * `OPAQUE` fills the background before drawing text, hatched brushes or pens;
 * `TRANSPARENT` leaves whatever is already there alone.
 *
 * **Measured.** `textbk` draws a character on a white cell with the background
 * colour set to black. Under `OPAQUE` the cell comes back with a black
 * rectangle over it and the glyph lost inside; under `TRANSPARENT` it is a
 * white cell with a black glyph. With the background colour white the two are
 * the same, which is what says the difference is the mode and not the colour.
 *
 * **See also**:
 * {@link Gdi.GetBkMode GetBkMode}
 * {@link Gdi.SetBkColor SetBkColor}
 *
 * @static
 * @function SetBkMode
 * @memberof Gdi
 *
 * @param {Types.HDC} hdc - Identifies the device context.
 * @param {Types.INT} mode - `OPAQUE` (2) or `TRANSPARENT` (1).
 *
 * @return {Types.INT} The previous background mode, or nought on failure.
 */
export function SetBkMode(hdc, mode) {
  this.debug('SetBkMode', hdc, mode);

  const surface = this.handles.resolve(hdc);

  if (!surface) {
    return 0;
  }

  const old = surface.backMode;

  surface.backMode = mode;

  return old;
}
