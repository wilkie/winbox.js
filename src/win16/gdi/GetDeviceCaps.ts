'use strict';

import { Gdi } from '../gdi.js';

/**
 * The **GetDeviceCaps** function retrieves device-specific information about a
 * device.
 *
 * Every answer here belongs to the display driver rather than to Windows, and
 * programs act on them: a dialog is sized from `LOGPIXELSY`, a bitmap is built
 * for the depth `BITSPIXEL` and `PLANES` describe, and a circle comes out round
 * only if `ASPECTX` and `ASPECTY` were believed. Reporting the capabilities of
 * the browser we happen to be running in -- which is what this used to do, with
 * 32 bits per pixel and 256 colours -- tells a 1992 program something no 1992
 * driver could have told it.
 *
 * The numbers come from {@link Win16.display the display mode}, which is
 * chosen when the system starts and recorded from real Windows where that was
 * possible.
 *
 * **See also**:
 * {@link Gdi.GetTextMetrics GetTextMetrics}
 *
 * @static
 * @function GetDeviceCaps
 * @memberof Gdi
 *
 * @param {Types.HDC} hdc - Identifies the device context.
 * @param {Types.INT} iCapability - The capability to retrieve.
 *
 * @return {Types.INT} The value of the capability, or zero if it is one this
 *                     driver does not describe.
 */
export function GetDeviceCaps(hdc, iCapability) {
  const display = this.display;

  switch (iCapability) {
    case Gdi.DRIVERVERSION:
      return display.driverVersion;
    case Gdi.TECHNOLOGY:
      return display.technology;

    // The width of the display in millimetres.
    case Gdi.HORZSIZE:
      return display.widthMillimetres;
    case Gdi.VERTSIZE:
      return display.heightMillimetres;

    case Gdi.HORZRES:
      return display.width;
    case Gdi.VERTRES:
      return display.height;

    case Gdi.BITSPIXEL:
      return display.bitsPerPixel;
    case Gdi.PLANES:
      return display.planes;
    case Gdi.NUMCOLORS:
      return display.colors;

    case Gdi.NUMBRUSHES:
      return display.numBrushes;
    case Gdi.NUMPENS:
      return display.numPens;
    case Gdi.NUMMARKERS:
      return display.numMarkers;
    case Gdi.NUMFONTS:
      return display.numFonts;

    case Gdi.CURVECAPS:
      return display.curveCaps;
    case Gdi.LINECAPS:
      return display.lineCaps;
    case Gdi.POLYGONALCAPS:
      return display.polygonalCaps;
    case Gdi.TEXTCAPS:
      return display.textCaps;
    case Gdi.CLIPCAPS:
      return display.clipCaps;
    case Gdi.RASTERCAPS:
      return display.rasterCaps;

    case Gdi.ASPECTX:
      return display.aspectX;
    case Gdi.ASPECTY:
      return display.aspectY;
    case Gdi.ASPECTXY:
      return display.aspectXY;

    case Gdi.LOGPIXELSX:
      return display.logicalPixelsX;
    case Gdi.LOGPIXELSY:
      return display.logicalPixelsY;

    case Gdi.SIZEPALETTE:
      return display.sizePalette;
    case Gdi.NUMRESERVED:
      return display.numReserved;
    case Gdi.COLORRES:
      return display.colorRes;
  }

  return 0;
}
