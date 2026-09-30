'use strict';

import { Color } from '../../raster/color.js';
import { Brush } from '../../raster/brush.js';
import { isPaletteRef } from '../../raster/palette-colour.js';

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

  /* A palette's colour is looked up where the brush is used: in the palette
   * of the device context it draws in. */
  if (isPaletteRef(clrref)) {
    brush.colorref = clrref >>> 0;
  }

  /* What `GetObject` tells of it: solid, the colour as it was asked for,
   * dithered on the display or not (`brushobj`). FIBS/W reads it back for
   * its dialogs' text. */
  brush.logbrush = { style: 0, color: clrref >>> 0, hatch: 0 };

  const handle = this.handles.allocate(brush);
  return handle;
}
