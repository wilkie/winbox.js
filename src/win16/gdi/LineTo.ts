'use strict';

import { TRUE, FALSE } from '../consts.js';

/**
 * Draws a line from the current position to a point, and moves the current
 * position there.
 *
 * The line is `Surface.drawLine`'s: on pixels winbox.js owns, the recorded
 * walk, which leaves out the pixel the line stops on. See
 * `kb/gdi/lineto.md` for what `lines` recorded.
 *
 * @param {Types.HDC} hdc - The device context to draw on.
 * @param {Types.INT} x - Where the line ends, across.
 * @param {Types.INT} y - Where the line ends, down.
 *
 * @returns {Types.BOOL} Whether there was a device context to draw on.
 */
export function LineTo(hdc, x, y) {
  const surface = this.handles.resolve(hdc);
  this.debug('LineTo', x, y);

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
