/**
 * The **SetRect** function sets rectangle coordinates. The action of this
 * function is equivalent to assigning the left, top, right, and bottom
 * arguments to the appropriate members of the RECT structure.
 *
 * The width of the rectangle, specified by the absolute value of
 * `nRight - nLeft`, must not exceed 32,767 units. This limit also applies to
 * the height of the rectangle.
 *
 * This function does not return a value.
 *
 * **See also**:
 * {@link User.CopyRect CopyRect}
 * {@link User.SetRectEmpty SetRectEmpty}
 *
 * @static
 * @function SetRect
 * @memberof User
 *
 * @param {Types.RECT} lprc - Points to the `RECT` structure that contains the
 *                            rectangle to be set.
 * @param {Types.INT} nLeft - Specifies the x-coordinate of the upper-left
 *                            corner.
 * @param {Types.INT} nTop - Specifies the y-coordinate of the upper-left
 *                           corner.
 * @param {Types.INT} nRight - Specifies the x-coordinate of the lower-right
 *                             corner.
 * @param {Types.INT} nBottom - Specifies the y-coordinate of the lower-right
 *                              corner.
 */
export function SetRect(lprc, nLeft, nTop, nRight, nBottom) {
  lprc.left = nLeft;
  lprc.top = nTop;
  lprc.bottom = nBottom;
  lprc.right = nRight;
}
