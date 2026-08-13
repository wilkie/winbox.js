"use strict";

import { HWND, WPARAM, LPARAM, UINT } from '../types.js';

import { NULL } from '../consts.js';

import { User } from '../user.js';

/**
 * The **FrameRect** function draws a border around the given rectangle, using
 * the specified brush. The width and height of the border are always one
 * logical unit.
 *
 * **See also**:
 * {@link Gdi.CreateHatchBrush CreateHatchBrush}
 * {@link Gdi.CreatePatternBrush CreatePatternBrush}
 * {@link Gdi.CreateSolidBrush CreateSolidBrush}
 * {@link User.DrawFocusRect DrawFocusRect}
 *
 * @static
 * @function FrameRect
 * @memberof User
 *
 * @param {Types.HDC} hdc - Identifies the device context in which to draw the
 *                          border.
 * @param {Types.RECT} lprc - Points to a RECT structure that contains the
 *                            logical coordinates of the upper-left and lower-
 *                            right corners of the rectangle.
 * @param {Types.HBRUSH} hbr - Identifies the brush used to draw the border.
 *
 * @return {Types.INT} The return value is not used and has no meaning.
 */
export function FrameRect(hdc, lprc, hbr) {
    const brush = this.handles.resolve(hbr);
    const surface = this.handles.resolve(hdc);

    // Stroke a rect in that surface
    surface.pen = brush;
    const width = lprc.right - lprc.left;
    const height = lprc.bottom - lprc.top;
    surface.strokeRect(lprc.left, lprc.top, width - 1, height - 1);

    // Return the... uh... meaningless value.
    return 0;
}
