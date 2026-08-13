"use strict";

import { Gdi } from '../gdi.js';

import { Color } from '../../raster/color.js';

/**
 * The **SetBkColor** function sets the current background color to the
 * specified color.
 *
 * If the background mode is `OPAQUE`, the system uses the background color to
 * fill the gaps in styled lines, the gaps between hatched lines in brushes, and
 * the background in character cells. The system also uses the background color
 * when converting bitmaps between color and monochrome device contexts.
 *
 * If the device cannot display the specified color, the system sets the
 * background color to the nearest physical color.
 *
 * **See also**:
 * {@link Gdi.BitBlt BitBlt}
 * {@link Gdi.GetBkColor GetBkColor}
 * {@link Gdi.GetBkMode GetBkMode}
 * {@link Gdi.SetBkMode SetBkMode}
 * {@link Gdi.StretchBlt StretchBlt}
 *
 * @static
 * @function SetBkColor
 * @memberof Gdi
 *
 * @param {Types.HDC} hdc - Identifies the device context.
 * @param {Types.COLORREF} clrref - Specifies the new background color.
 *
 * @return {Types.COLORREF} The return value is the RGB value of the previous
 *                          background color, if the function is successful. The
 *                          return value is `0x80000000` if an error occurs.
 */
export function SetBkColor(hdc, clrref) {
    console.log("SetBkColor", hdc, clrref);

    // Resolve the destination DC handle
    const surface = this.handles.resolve(hdc);

    // Bail if we cannot find the destination DC
    if (!surface) {
        return 0x80000000;
    }

    const components = Color.colorToBgr(clrref);
    const old = surface.backcolor;
    const color = new Color(components.r, components.g, components.b);
    surface.backcolor = color;
    // TODO: This is wrong... it needs to be in A8B8G8R8 format.
    return old.value;
}
