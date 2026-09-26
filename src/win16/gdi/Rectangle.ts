'use strict';

import { paintShape } from './Ellipse.js';

/**
 * A rectangle outlined with the pen and filled with the brush, its right and
 * bottom edges outside it: the round rectangle with corners of nought.
 *
 * **Recorded** by `mapmode`, a rectangle 6 by 6 drawn whole: the outline
 * runs along its first and last column and row, and the brush fills inside.
 * And by `clipdc`, through a clip.
 *
 * @param {Types.HDC} hdc - The device context.
 * @param {Types.INT} nLeftRect - The left edge.
 * @param {Types.INT} nTopRect - The top edge.
 * @param {Types.INT} nRightRect - The right edge, outside it.
 * @param {Types.INT} nBottomRect - The bottom edge, outside it.
 *
 * @returns {Types.BOOL} Whether there was a device context.
 */
export function Rectangle(hdc, nLeftRect, nTopRect, nRightRect, nBottomRect) {
  return paintShape(this, hdc, nLeftRect, nTopRect, nRightRect, nBottomRect, [0, 0]);
}
