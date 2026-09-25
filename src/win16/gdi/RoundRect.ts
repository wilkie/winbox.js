'use strict';

import { paintShape } from './Ellipse.js';

/**
 * Draws a rectangle with rounded corners, its outline in the selected pen
 * and its inside in the selected brush. Each corner is a quarter of an
 * ellipse `nWidth` by `nHeight`; the right and bottom of the rectangle are
 * outside the shape.
 *
 * See `src/raster/curves.ts`, read out of `GDI.EXE` and recorded by `curves`:
 * eleven rounded rectangles on four displays, with corners from nought to
 * larger than the rectangle, pens of one pixel, three pixels and none, and
 * with and without a brush. A corner is one pixel larger than an `Ellipse`
 * of its size, and a corner of nought draws a rectangle. Calculator draws
 * its keys with this.
 *
 * Not yet measured: the return value, the pen styles other than solid,
 * `PS_INSIDEFRAME`, and a wide pen whose inner corner is empty, for which GDI
 * adds a `PatBlt` of its own.
 *
 * @param {Types.HDC} hdc - The device context to draw on.
 * @param {Types.INT} nLeftRect - The rectangle's left.
 * @param {Types.INT} nTopRect - Its top.
 * @param {Types.INT} nRightRect - Its right, outside the shape.
 * @param {Types.INT} nBottomRect - Its bottom, outside the shape.
 * @param {Types.INT} nWidth - The width of the ellipse the corners are cut from.
 * @param {Types.INT} nHeight - Its height.
 *
 * @returns {Types.BOOL} Whether the shape was drawn.
 */
export function RoundRect(hdc, nLeftRect, nTopRect, nRightRect, nBottomRect, nWidth, nHeight) {
  return paintShape(this, hdc, nLeftRect, nTopRect, nRightRect, nBottomRect, [nWidth, nHeight]);
}
