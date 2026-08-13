"use strict";

import { NULL } from '../consts.js';

/**
 * The **GetDC** function retrieves the handle of a device context for the
 * client area of the given window. The device context can be used in
 * subsequent graphics device interface (GDI) functions to draw in the client
 * area.
 *
 * The **GetDC** function retrieves a common, class, or private device context
 * depending on the class style specified for the given window. For common
 * device contexts, **GetDC** assigns default attributes to the context each
 * time it is retrieved. For class and private contexts, **GetDC** leaves the
 * previously assigned attributes unchanged.
 *
 * Unless the device context belongs to a window class, the
 * {@link User.ReleaseDC ReleaseDC} function must be called to release the
 * context after drawing. Since only five common device contexts are available
 * at any given time, failure to release a device context can prevent other
 * applications from accessing a device context. If the *`hwnd`* parameter of
 * the **GetDC** function is `NULL`, the first parameter of **ReleaseDC** should
 * also be `NULL`.
 *
 * A device context with special characteristics is returned by the **GetDC**
 * function if `CS_CLASSDC`, `CS_OWNDC`, or `CS_PARENTDC` style was specified
 * in the `WNDCLASS` structure when the class was registered. For more
 * information about these characteristics, see the description of the
 * `WNDCLASS` structure.
 *
 * @static
 * @function GetDC
 * @memberof User
 *
 * @param {Types.HWND} hwnd - Identifies the window where the drawing will
 *                            occur. If this parameter is `NULL`, the function
 *                            returns a device context for the screen.
 *
 * @returns {Types.HDC} The return value is a handle of the device context for
 *                      the given window's client area, if the function is
 *                      successful. Otherwise, it is `NULL`.
 */
export function GetDC(hwnd) {
    let dc = 1;
    if (hwnd == NULL) {
        // Gets the desktop context
    }
    else {
        // Get the window
        const dialog = this.handles.resolve(hwnd);

        // Get the surface
        const surface = dialog.surface;

        // Allocate a DC
        dc = this.handles.allocate(surface);

        //console.log("GetDC", dialog, surface, dc);
    }

    return dc;
}
