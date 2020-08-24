"use strict";

import { TRUE, FALSE } from '../consts.js';

/**
 * The **DeleteObject** function deletes an object from memory by freeing all
 * system storage associated with the object. (Objects include pens, brushes,
 * fonts, bitmaps, regions, and palettes.)
 *
 * After the object is deleted, the handle given in the *`hgdiobj`* parameter
 * is no longer valid.
 *
 * An application should not delete an object that is currently selected into
 * a device context.
 *
 * When a pattern brush is deleted, the bitmap associated with the brush is not
 * deleted. The bitmap must be deleted independently.
 *
 * **See also**:
 * {@link Gdi.SelectObject SelectObject}
 *
 * @static
 * @function DeleteObject
 * @memberof Gdi
 *
 * @param {Types.HGDIOBJ} hgdiobj - Identifies a pen, brush, font, bitmap,
 *                                  region, or palette.
 *
 * @return {Types.BOOL} The return value is nonzero if the function is
 *                      successful. Otherwise, it is zero.
 */
export function DeleteObject(handle) {
    // Delete the handle
    if (!this.handles.isGDI(handle)) {
        return FALSE;
    }

    this.handles.free(handle);
    return TRUE;
}
