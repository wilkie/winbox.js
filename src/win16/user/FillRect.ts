'use strict';

import { rasterOp } from '../../raster/raster-op.js';
import { realiseBrush } from '../gdi/CreatePatternBrush.js';
import { deviceRect, mapped } from '../gdi/mapping.js';

import { HWND, WPARAM, LPARAM, UINT } from '../types.js';

import { NULL } from '../consts.js';

import { User } from '../user.js';

/** `PATCOPY`. */
const PATCOPY = 0x00f00021;

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

  /* No device context: nothing filled. */
  if (!surface || !lprc) {
    return 0;
  }

  /* The brush is the device context's only while it fills: `patbrush`
   * recorded its own brush selected after. */
  const old = surface.brush;
  const box = mapped(surface)
    ? deviceRect(surface, lprc.left, lprc.top, lprc.right, lprc.bottom)
    : lprc;
  const width = box.right - box.left;
  const height = box.bottom - box.top;

  surface.brush = brush;

  if (brush?.pattern) {
    realiseBrush(surface, brush);
    rasterOp(this.display, surface, box.left, box.top, width, height, PATCOPY, null, 0, 0);
  } else {
    surface.fillRect(box.left, box.top, width, height);
  }

  surface.brush = old;

  // Return the... uh... meaningless value.
  return 0;
}
