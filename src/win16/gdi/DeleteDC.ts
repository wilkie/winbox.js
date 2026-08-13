"use strict";

import { TRUE, FALSE } from '../consts.js';

/**
 * The **DeleteDC** function deletes the given device context.
 *
 * If the `hdc` parameter identifies the last device context for a given
 * device, the device is notified and all storage and system resources used by
 * the device are released. 
 *
 * An application must not delete a device context whose handle was retrieved
 * by calling the {@link User.GetDC GetDC} function. Instead, the application
 * must call the {@link User.ReleaseDC ReleaseDC} function to free the device
 * context. 
 *
 * An application should not call **DeleteDC** if the application has selected
 * objects into the device context. Objects must be selected out of the device
 * context before it is deleted. 
 *
 * **See also**:
 * {@link Gdi.CreateDC CreateDC}
 * {@link User.GetDC GetDC}
 * {@link User.ReleaseDC ReleaseDC}
 *
 * @static
 * @function DeleteDC
 * @memberof Gdi
 *
 * @param {Types.HDC} hdc - Identifies the device context.
 *
 * @return {Types.BOOL} The return value is nonzero if the function is
 *                      successful. Otherwise, it is zero.
 */
export function DeleteDC(hdc) {
    const surface = this.handles.resolve(hdc);
    if (!surface) {
        return FALSE;
    }

    this.handles.free(hdc);
    return TRUE;
}
