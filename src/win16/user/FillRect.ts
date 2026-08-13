'use strict';

import { HWND, WPARAM, LPARAM, UINT } from '../types.js';

import { NULL } from '../consts.js';

import { User } from '../user.js';

/**
 * The **FillRect** function fills a given rectangle by using the specified
 * brush. The **FillRect** function fills the complete rectangle, including the
 * left and top borders, but does not fill the right and bottom borders.
 *
 * **See also**:
 * {@link Gdi.CreateHatchBrush CreateHatchBrush}
 * {@link Gdi.CreatePatternBrush CreatePatternBrush}
 * {@link Gdi.CreateSolidBrush CreateSolidBrush}
 * {@link Gdi.GetStockObject GetStockObject}
 * {@link User.InvertRect InvertRect}
 *
 * @static
 * @function FillRect
 * @memberof User
 *
 * @param {Types.HDC} hdc - Identifies the device context.
 * @param {Types.RECT} lprc - Points to a RECT structure that contains the
 *                            logical coordinates of the rectangle to be filled.
 * @param {Types.HBRUSH} hbr - Identifies the brush used to fill the rectangle.
 *
 * @return {Types.INT} The return value is not used and has no meaning.
 */
export function FillRect(hdc, lprc, hbr) {
  const brush = this.handles.resolve(hbr);
  const surface = this.handles.resolve(hdc);

  // Fill a rect in that surface
  surface.brush = brush;
  const width = lprc.right - lprc.left;
  const height = lprc.bottom - lprc.top;
  surface.fillRect(lprc.left, lprc.top, width, height);

  // Return the... uh... meaningless value.
  return 0;
}
