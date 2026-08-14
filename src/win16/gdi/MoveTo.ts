'use strict';

import { NULL } from '../consts.js';

/**
 * The **MoveTo** function moves the current position to the specified
 * coordinates.
 *
 * **See also**:
 * {@link Gdi.GetCurrentPosition GetCurrentPosition}
 * {@link Gdi.LineTo LineTo}
 *
 * @static
 * @function MoveTo
 * @memberof Gdi
 *
 * @param {Types.HDC} hdc - Identifies the device context.
 * @param {Types.INT} x - Specifies the logical x-coordinate of the new
 *                        position.
 * @param {Types.INT} y - Specifies the logical y-coordinate of the new
 *                        position.
 *
 * @returns {Types.DWORD} The low-order word of the return value contains the
 *                        logical x-coordinate of the previous position, if the
 *                        function is successful; the high-order word contains
 *                        the logical y-coordinate.
 */
export function MoveTo(hdc, x, y) {
  const surface = this.handles.resolve(hdc);
  this.debug('MoveTo', x, y);

  // Determine if the HDC is valid; bail if not
  if (!surface) {
    return NULL;
  }

  // Get the previous coordinate
  const oldX = surface.data.x || 0;
  const oldY = surface.data.y || 0;

  // Set the new coordinate
  surface.data.x = x;
  surface.data.y = y;

  // Return the old coordinate
  return ((oldY & 0xffff) << 16) | (oldX & 0xffff);
}
