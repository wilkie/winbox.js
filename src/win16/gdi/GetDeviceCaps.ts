'use strict';

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
    case Gdi.NUMCOLORS:
      // Size of the color palette.
      // TODO: read from surface (32bpp... so lots of colors)
      return 256;
    case Gdi.RASTERCAPS:
      // Raster capabilities
      // TODO: actually just mark the ones known about
      return 0xffff;
    case Gdi.NUMRESERVED:
      // Number of palette entries reserved by the system.
      return 16;
    case Gdi.BITSPIXEL:
      // The bits-per-pixel (bpp) of the device.
      return 32;
  }

  return 0;
}
