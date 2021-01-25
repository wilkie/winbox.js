"use strict";

/**
 * The **GetDesktopWindow** function retrieves the handle of the desktop window.
 * The desktop window covers the entire screen and is the area on top of which
 * all icons and other windows are painted.
 *
 * @static
 * @function GetDesktopWindow
 * @memberof User
 *
 * @returns {Types.HWND} The return value is a handle of the desktop window.
 */
export function GetDesktopWindow() {
    return this._desktop.window.data.hwnd;
}
