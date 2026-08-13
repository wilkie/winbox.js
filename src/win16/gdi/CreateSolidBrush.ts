'use strict';

import { Color } from '../../raster/color.js';
import { Brush } from '../../raster/brush.js';

/**
 * The **CreateSolidBrush** function creates a brush that has a specified solid
 * color. The brush can subsequently be selected as the current brush for any
 * device.
 *
 * When an application has finished using the brush created by
 * **CreateSolidBrush**, it should select the brush out of the device context
 * and then remove it by using the {@link Gdi.DeleteObject DeleteObject}
 * function.
 *
 * **See also**:
 * {@link Gdi.CreateBrushIndirect CreateBrushIndirect}
 * {@link Gdi.CreateDIBPatternBrush CreateDIBPatternBrush}
 * {@link Gdi.CreateHatchBrush CreateHatchBrush}
 * {@link Gdi.CreatePatternBrush CreatePatternBrush}
 * {@link Gdi.DeleteObject DeleteObject}
 *
 * @static
 * @function CreateSolidBrush
 * @memberof Gdi
 *
 * @param {Types.COLORREF} clrref - Specifies the color of the brush.
 *
 * @return {Types.BOOL} The return value is the handle of the brush if the
 *                      function is successful. Otherwise, it is `NULL`.
 */
export function CreateSolidBrush(clrref) {
  // Interpret color
  const components = Color.colorToBgr(clrref);
  const color = new Color(components.r, components.g, components.b);

  // Create a Brush
  const brush = new Brush(color);

  const handle = this.handles.allocate(brush);
  return handle;
}
