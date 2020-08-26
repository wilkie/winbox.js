"use strict";

import { Gdi } from '../gdi.js';

/**
 *
 * @static
 * @function GetDeviceCaps
 * @memberof User
 *
 * @param {Types.HDC} hdc - 
 * @param {Types.INT} iCapability - 
 *
 * @returns {Types.HDC} The return value is a handle of the device context for
 *                      the given window's client area, if the function is
 *                      successful. Otherwise, it is `NULL`.
 */
export function GetDeviceCaps(hdc, iCapability) {
    switch (iCapability) {
        case Gdi.HORZRES:
            return this._desktop.width;
        case Gdi.VERTRES:
            return this._desktop.height;
    }

    return 0;
}
