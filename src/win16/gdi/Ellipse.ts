'use strict';

import { FALSE, TRUE } from '../consts.js';
import { shapeOf } from '../../raster/curves.js';
import { rasterOp } from '../../raster/raster-op.js';
import { MulDiv } from './MulDiv.js';

/**
 * The selected pen's size in device pixels, across and down: nought for a
 * null pen, and a pen of width nought or one a pixel.
 *
 * **Read out of `GDI.EXE`**, where the pen is realised (seg1 `268e`, `2751`):
 * the width scaled from window to viewport, and the height that width taken
 * through `MulDiv` by the display's `ASPECTX` over its `ASPECTY`. A three
 * pixel pen is two pixels tall on the EGA, 3 × 38 / 48, and on the Hercules,
 * 3 × 11 / 16, as `curves` recorded. Mapping modes are not kept, so the width
 * is taken as it is.
 */
export function penSize(context: any, pen: any): [number, number] {
  if (!pen?.color?.alpha) {
    return [0, 0];
  }

  const width = Math.max(Math.abs(pen.width ?? 0), 1);
  const display = context.display;

  return [width, Math.abs(MulDiv(width, display?.aspectX ?? 1, display?.aspectY ?? 1))];
}

/**
 * Draws what `shapeOf` makes on the surface a device context names: the
 * brush's rows as `PatBlt` paints them, patterned as the display driver
 * patterns the brush, then the pen's pixels in its colour.
 */
export function paintShape(
  context: any,
  hdc: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
  corner: [number, number] | null
) {
  const surface = context.handles.resolve(hdc);

  if (!surface) {
    return FALSE;
  }

  const [penWidth, penHeight] = penSize(context, surface.pen);
  const shape = shapeOf(
    Math.min(left, right),
    Math.min(top, bottom),
    Math.max(left, right),
    Math.max(top, bottom),
    corner,
    penWidth,
    penHeight,
    !!surface.brush?.color?.alpha
  );

  for (const [y, from, to] of shape.brush) {
    rasterOp(context.display, surface, from, y, to - from, 1, 0xf00021, null, 0, 0);
  }

  if (shape.pen.length && typeof surface.context.setPixel === 'function') {
    const colour = surface.pen.color;
    const rgba = [colour.red, colour.green, colour.blue, 0xff];

    for (const [x, y] of shape.pen) {
      surface.context.setPixel(x, y, rgba);
    }

    surface._stale = true;
  }

  return TRUE;
}

/**
 * Draws an ellipse inside a rectangle, its outline in the selected pen and
 * its inside in the selected brush. The right and bottom of the rectangle
 * are outside the ellipse.
 *
 * See `src/raster/curves.ts` for how the ellipse is made, read out of
 * `GDI.EXE` and recorded by `curves`: fourteen ellipses on four displays, from
 * one pixel square to forty by twenty-four, with pens of one pixel, three
 * pixels and none, and with and without a brush.
 *
 * Not yet measured: the return value, the pen styles other than solid, and
 * `PS_INSIDEFRAME`.
 *
 * @param {Types.HDC} hdc - The device context to draw on.
 * @param {Types.INT} nLeftRect - The rectangle's left.
 * @param {Types.INT} nTopRect - Its top.
 * @param {Types.INT} nRightRect - Its right, outside the ellipse.
 * @param {Types.INT} nBottomRect - Its bottom, outside the ellipse.
 *
 * @returns {Types.BOOL} Whether the ellipse was drawn.
 */
export function Ellipse(hdc, nLeftRect, nTopRect, nRightRect, nBottomRect) {
  return paintShape(this, hdc, nLeftRect, nTopRect, nRightRect, nBottomRect, null);
}
