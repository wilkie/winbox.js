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

/**
 * The current position, as \`MoveTo\` and \`LineTo\` leave it: x in the low
 * word, y in the high, (0, 0) for a new device context. **Recorded** by
 * \`minis2\`.
 */
export function GetCurrentPosition(this: any, hdc: number) {
  const surface = this.handles.resolve(hdc);

  if (!surface) {
    return 0;
  }

  return (((surface.data.y || 0) & 0xffff) << 16) | ((surface.data.x || 0) & 0xffff);
}

const TA_UPDATECP = 0x0001;
const TA_RIGHT = 0x0002;
const TA_CENTER = 0x0006;

/**
 * Where text goes with `TA_UPDATECP`, and the current position moved after
 * it. **Recorded** by `updatecp`, for `TextOut` and `ExtTextOut` alike: the
 * point given is passed over and the text drawn at the current position, as
 * the alignment places it; then the position moves right by the text's
 * width for `TA_LEFT`, left by it for `TA_RIGHT`, and not at all for
 * `TA_CENTER`. Without the flag the position is left as it was.
 *
 * @returns The point to draw at, and what moves the position once drawn.
 */
export function currentPositionText(surface: any, x: number, y: number, width: () => number) {
  if (!(surface.textAlign & TA_UPDATECP)) {
    return { x, y, after: () => {} };
  }

  const across = surface.textAlign & TA_CENTER;

  return {
    x: surface.data.x || 0,
    y: surface.data.y || 0,
    after: () => {
      if (across === TA_CENTER) {
        return;
      }

      surface.data.x = (surface.data.x || 0) + (across === TA_RIGHT ? -width() : width());
    },
  };
}
