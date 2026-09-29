'use strict';

import { deviceRect, mapped, scale } from './mapping.js';

import { FALSE, TRUE } from '../consts.js';
import { shapeOf } from '../../raster/curves.js';
import { rasterOp } from '../../raster/raster-op.js';
import { MulDiv } from './MulDiv.js';
import { ropOfMode } from './SetROP2.js';
import { Brush } from '../../raster/brush.js';
import { Color } from '../../raster/color.js';
import { DeviceBitmap } from '../../raster/device-bitmap.js';
import { DevicePalette } from '../../raster/device-palette.js';

const PS_INSIDEFRAME = 6;

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
 * Draws what `shapeOf` makes on the surface a device context names, in the
 * drawing mode `SetROP2` set: first the brush's rows as `PatBlt` paints them,
 * patterned as the display driver patterns the brush, then the pen's pixels
 * in the nearest colour the device has.
 *
 * The brush and the pen each mix with what is there, one after the other,
 * so where a thin pen's outline lies over the fill -- its left and top, which
 * a polygon fill takes in -- a mode like `R2_NOT` applies twice and leaves
 * the pixel as it was. **Recorded** by `mixmode`: Calculator's key drawn over
 * itself once with `R2_NOT` keeps its left and top edges black and turns its
 * right and bottom white, and drawn twice is as it was.
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

  const m = mapped(surface);

  if (m) {
    ({ left, top, right, bottom } = deviceRect(surface, left, top, right, bottom));
    corner = corner && [
      Math.abs(scale(corner[0], m.vex, m.wex)),
      Math.abs(scale(corner[1], m.vey, m.wey)),
    ];
  }

  const [penWidth, penHeight] = penSize(context, surface.pen);

  /* `PS_INSIDEFRAME` wider than a pixel keeps a rectangle's frame inside it:
   * the rectangle drawn is the one given less the pen's reach, half the
   * width rounded down at the left and top, the rest at the right and
   * bottom (`widepoly`). Not recorded for other shapes. */
  if (surface.pen?.style === PS_INSIDEFRAME && penWidth > 1 && corner && !corner[0] && !corner[1]) {
    const across = Math.max(left, right) - Math.min(left, right);
    const down = Math.max(top, bottom) - Math.min(top, bottom);

    left = Math.min(left, right) + (penWidth >> 1);
    top = Math.min(top, bottom) + (penHeight >> 1);
    right = left - (penWidth >> 1) + across - ((penWidth + 1) >> 1) + 1;
    bottom = top - (penHeight >> 1) + down - ((penHeight + 1) >> 1) + 1;
  }

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
  const rop = ropOfMode(surface.rop2 ?? 13);

  for (const [y, from, to] of shape.brush) {
    rasterOp(context.display, surface, from, y, to - from, 1, rop, null, 0, 0);
  }

  if (!shape.pen.length) {
    return TRUE;
  }

  /* The pen is a colour the device has, never a pattern. */
  const palette =
    surface.bitmap instanceof DeviceBitmap
      ? surface.bitmap.devicePalette
      : DevicePalette.forDisplay(context.display);
  const { red, green, blue } = surface.pen.color;
  const [r, g, b] = palette.colours[palette.index(red, green, blue)] ?? [0, 0, 0];
  const brush = surface.brush;

  surface.brush = new Brush(new Color(r, g, b));

  for (const [y, from, to] of runs(shape.pen)) {
    rasterOp(context.display, surface, from, y, to - from, 1, rop, null, 0, 0);
  }

  if (brush) {
    surface.brush = brush;
  }

  return TRUE;
}

/** Pixels gathered into runs along their rows, `[y, left, right)`. */
function runs(pixels: [number, number][]) {
  const sorted = [...pixels].sort((one, other) => one[1] - other[1] || one[0] - other[0]);
  const out: [number, number, number][] = [];

  for (const [x, y] of sorted) {
    const last = out[out.length - 1];

    if (last && last[0] === y && last[2] === x) {
      last[2]++;
    } else {
      out.push([y, x, x + 1]);
    }
  }

  return out;
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
