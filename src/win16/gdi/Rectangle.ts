"use strict";

import { TRUE, FALSE } from '../consts.js';

/**
 * The **Rectangle** function draws a rectangle using the current pen. The
 * interior of the rectangle is filled by using the current brush.
 *
 * The figure this function draws extends up to, but does not include, the right
 * and bottom coordinates. This means that the height of the figure is
 * `nBottomRect - nTopRect` and the width of the figure is
 * `nRightRect - nLeftRect`. 
 *
 * Both the width and the height of a rectangle must be greater than 2 units and
 * less than 32,767 units. 
 *
 * **See also**:
 * {@link Gdi.PolyLine PolyLine}
 * {@link Gdi.RoundRect RoundRect}
 *
 * @static
 * @function Rectangle
 * @memberof Gdi
 *
 * @param {Types.HDC} hdc - Identifies the device context.
 * @param {Types.INT} nLeftRect - Specifies the logical x-coordinate of the
 *                                upper-left corner of the rectangle. 
 * @param {Types.INT} nTopRect - Specifies the logical y-coordinate of the
 *                               upper-left corner of the rectangle. 
 * @param {Types.INT} nRightRect - Specifies the logical x-coordinate of the
 *                                 lower-right corner of the rectangle. 
 * @param {Types.INT} nBottomRect - Specifies the logical y-coordinate of the
 *                                  lower-right corner of the rectangle. 
 *
 * @return {Types.INT} The return value is nonzero if the function is
 *                     successful. Otherwise, it is zero.
 */
export function Rectangle(hdc, nLeftRect, nTopRect, nRightRect, nBottomRect) {
    // TODO: what happens with the width/height is less than 2?

    const surface = this.handles.resolve(hdc);

    // Determine if the HDC is valid; bail if not
    if (!surface) {
        return FALSE;
    }

    // Fill and stroke a rect in that surface
    const width = nRightRect - nLeftRect;
    const height = nBottomRect - nTopRect;
    surface.fillRect(nLeftRect, nTopRect, width, height);
    surface.strokeRect(nLeftRect, nTopRect, width, height);

    return TRUE;
}
