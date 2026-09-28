'use strict';

import { Color } from '../../raster/color.js';
import { Pen } from '../../raster/pen.js';

const PS_NULL = 5;
const PS_INSIDEFRAME = 6;

/**
 * The **CreatePen** function creates a pen having the specified style, width,
 * and color. The pen can subsequently be selected as the current pen for any
 * device.
 *
 * Pens whose width is greater than one pixel always have the `PS_NULL`,
 * `PS_SOLID`, or `PS_INSIDEFRAME` style.
 *
 * If a pen has the `PS_INSIDEFRAME` style and a color that does not match a
 * color in the logical color table, the pen is drawn with a dithered color.
 * The PS_SOLID pen style cannot be used to create a pen with a dithered color.
 * The style `PS_INSIDEFRAME` is identical to `PS_SOLID` if the pen width is
 * less than or equal to 1.
 *
 * When it has finished using a pen created by **CreatePen**, an application
 * should remove the pen by using the {@link Gdi.DeleteObject DeleteObject}
 * function.
 *
 * The `fnPenStyle` parameter can be one of the following values:
 *
 * | Flag                | Description                                         |
 * |---------------------|-----------------------------------------------------|
 * |**`PS_SOLID`**       | Creates a solid pen.                                |
 * |**`PS_DASH`**        | Creates a dashed pen. (Valid only when width is 1.) |
 * |**`PS_DOT`**         | Creates a dotted pen. (Valid only when width is 1.) |
 * |**`PS_DASHDOT`**     | Creates a pen with alternating dashes and dots. (Valid only when width is 1.) |
 * |**`PS_DASHDOTDOT`**  | Creates a pen with alternating dashes and double dots. (Valid only when width is 1.) |
 * |**`PS_NULL`**        | Creates a null pen.                                 |
 * |**`PS_INSIDEFRAME`** | Creates a pen that draws a line inside the frame of closed shapes produced by graphics device interface (GDI) output functions that specify a bounding rectangle (for example, the {@link Gdi.Ellipse Ellipse}, {@link Gdi.Rectangle Rectangle}, {@link Gdi.RoundRect RoundRect}, {@link Gdi.Pie Pie}, and {@link Gdi.Chord Chord} functions). When this style is used with GDI output functions that do not specify a bounding rectangle (for example, the {@link Gdi.LineTo LineTo} function), the drawing area of the pen is not limited by a frame. |
 * |---------------------|-----------------------------------------------------|
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
 * @param {Types.INT} fnPenStyle - Specifies the pen style. See the general
 *                                 function description for the possible values.
 * @param {Types.INT} nWidth - Specifies the width, in logical units, of the
 *                             pen. If this value is zero, the width in device
 *                             units is always one pixel, regardless of the
 *                             mapping mode.
 * @param {Types.COLORREF} clrref - Specifies the color of the pen.
 *
 * @return {Types.BOOL} The return value is the handle of the brush if the
 *                      function is successful. Otherwise, it is `NULL`.
 */
export function CreatePen(fnPenStyle, nWidth, clrref) {
  return penOf.call(this, fnPenStyle & 0xffff, nWidth, 0, clrref >>> 0);
}

/**
 * A pen from a `LOGPEN`: its style, its width as the x of a `POINT`, and its
 * colour.
 *
 * **Recorded** by `penind`: `GetObject` answers the `LOGPEN` as it was given,
 * the width's y too, where `CreatePen` gives a y of nought. `PS_NULL`, and a
 * style past `PS_INSIDEFRAME`, draw nothing.
 *
 * @param {Types.FARPTR} lplgpn - The `LOGPEN`.
 *
 * @returns {Types.HPEN} The pen, or nought.
 */
export function CreatePenIndirect(this: any, lplgpn: number) {
  if (!lplgpn) {
    return 0;
  }

  const core = this.machine.cpu.core;
  const segment = (lplgpn >>> 16) & 0xffff;
  const offset = lplgpn & 0xffff;
  const word = (at: number) => core.read16(segment, (offset + at) & 0xffff);
  const signed = (value: number) => (value << 16) >> 16;

  return penOf.call(
    this,
    word(0),
    signed(word(2)),
    signed(word(4)),
    (word(6) | (word(8) << 16)) >>> 0
  );
}

function penOf(this: any, style: number, width: number, y: number, clrref: number) {
  const components = Color.colorToBgr(clrref);
  const drawn = style !== PS_NULL && style <= PS_INSIDEFRAME;
  const color = new Color(components.r, components.g, components.b, drawn ? 255 : 0);
  const pen = new Pen(color, width, style);

  pen.logpen = { style, width, y, color: clrref };

  return this.handles.allocate(pen);
}
