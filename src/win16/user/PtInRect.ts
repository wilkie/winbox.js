'use strict';

import { TRUE, FALSE } from '../consts.js';

/**
 * The **PtInRect** function determines whether or not the specified point lies
 * within a given rectangle. A point is within a rectangle if it lies on the
 * left or top side or is within all four sides. A point on the right or bottom
 * side is considered outside the rectangle.
 *
 * **See also**:
 * {@link Gdi.PolyLine PolyLine}
 * {@link Gdi.RoundRect RoundRect}
 *
 * @static
 * @function Rectangle
 * @memberof Gdi
 *
 * @param {Types.RECT} lprc - Points to a `RECT` structure that contains the
 *                            specified rectangle.
 * @param {Types.POINT} pt - Specifies a `POINT` structure that contains the
 *                           specified point.
 *
 * @return {Types.BOOL} The return value is nonzero if the point lies within
 *                      the rectangle. Otherwise it is zero.
 */
export function PtInRect(lprc, pt) {
  if (pt.x >= lprc.left && pt.x < lprc.right && pt.y >= lprc.top && pt.y < lprc.bottom) {
    return TRUE;
  }

  return FALSE;
}
