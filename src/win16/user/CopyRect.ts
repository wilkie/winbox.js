'use strict';

/**
 * The **CopyRect** function copies the dimensions of one rectangle to another.
 *
 * This function does not return a value.
 *
 * **See also**:
 * {@link User.SetRect SetRect}
 * {@link User.SetRectEmpty SetRectEmpty}
 *
 * @static
 * @function CopyRect
 * @memberof User
 *
 * @param {Types.RECT} lprcDst - Points to the `RECT` structure that will
 *                               receive the dimensions of the source rectangle.
 * @param {Types.RECT} lprcSrc - Points to the `RECT` structure whose dimensions
 *                               are to be copied.
 */
export function CopyRect(lprcDst, lprcSrc) {
  lprcDst.left = lprcSrc.left;
  lprcDst.top = lprcSrc.top;
  lprcDst.bottom = lprcSrc.bottom;
  lprcDst.right = lprcSrc.right;
}
