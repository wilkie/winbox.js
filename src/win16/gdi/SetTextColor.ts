"use strict";

import { Gdi } from '../gdi.js';

import { Color } from '../../raster/color.js';

/**
 * The **SetTextColor** function sets the current text color to the
 * specified color. The system uses the text color when writing text to a device
 * context and also when converting bitmaps between color and monochrome device
 * contexts.
 *
 * If the device cannot represent the specified color, the system sets the
 * text color to the nearest physical color.
 *
 * The background color for a character is specified by the
 * {@link Gdi.SetBkColor SetBkColor} and {@link Gdi.SetBkMode SetBkMode}
 * functions.
 *
 * **See also**:
 * {@link Gdi.GetTextColor GetTextColor}
 * {@link Gdi.BitBlt BitBlt}
 * {@link Gdi.SetBkColor SetBkColor}
 * {@link Gdi.SetBkMode SetBkMode}
 *
 * @static
 * @function SetTextColor
 * @memberof Gdi
 *
 * @param {Types.HDC} hdc - Identifies the device context.
 * @param {Types.COLORREF} clrref - Specifies the color of the text.
 *
 * @return {Types.COLORREF} The return value is the RGB value of the previous
 *                          text color, if the function is successful.
 */
export function SetTextColor(hdc, color) {
    console.log("SetTextColor", hdc, color);

    // Resolve the destination DC handle
    const surface = this.handles.resolve(hdc);

    // Bail if we cannot find the destination DC
    if (!surface) {
        // TODO: check if this is the proper error code?
        // This is from SetBkColor... so this is known as an error RGB value.
        return 0x80000000;
    }

    const components = Color.colorToBgr(color);
    const old = surface.forecolor;
    const realized = new Color(components.r, components.g, components.b);
    surface.forecolor = realized;
    // TODO: This is wrong... it needs to be in A8B8G8R8 format.
    return old.value;
}
