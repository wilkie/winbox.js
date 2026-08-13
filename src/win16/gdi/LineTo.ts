'use strict';

import { TRUE, FALSE } from '../consts.js';

/**
 * The **LineTo** function moves the current position to the specified
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
export function LineTo(hdc, x, y) {
  const surface = this.handles.resolve(hdc);
  console.log('LineTo', x, y);

  // Determine if the HDC is valid; bail if not
  if (!surface) {
    return FALSE;
  }

  // Get the current coordinate
  const startX = surface.data.x || 0;
  const startY = surface.data.y || 0;

  // Set the new coordinate
  surface.data.x = x;
  surface.data.y = y;

  // Draw the line
  surface.drawLine(startX, startY, x, y);

  // Return success
  return TRUE;
}
