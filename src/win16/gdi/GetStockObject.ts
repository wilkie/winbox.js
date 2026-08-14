'use strict';

import { STOCK_FONTS } from './stock-fonts.js';

import { Brush } from '../../raster/brush.js';
import { Pen } from '../../raster/pen.js';
import { Color } from '../../raster/color.js';

import { Gdi } from '../gdi.js';

import { NULL } from '../consts.js';

/**
 * The **GetStockObject** function retrieves a handle of one of the predefined
 * stock pens, brushes, or fonts.
 *
 * The `DK_GRAY_BRUSH`, `GRAY_BRUSH`, and `LTGRAY_BRUSH` objects should be used
 * only in windows with the `CS_HREDRAW` and `CS_VREDRAW` class styles. Using a
 * gray stock brush in any other style of window can lead to misalignment of
 * brush patterns after a window is moved or sized. The origins of stock brushes
 * cannot be adjusted.
 *
 * **See also**:
 * {@link User.BeginPaint BeginPaint}
 *
 * @static
 * @function GetStockObject
 * @memberof Gdi
 *
 * @param {Types.INT} fnObject - Specifies the type of stock object for which to
 *                               retrieve a handle. This parameter can be one of
 *                               the following values:
 * * `BLACK_BRUSH`: Black brush.
 * * `DKGRAY_BRUSH`: Dark-gray brush.
 * * `GRAY_BRUSH`: Gray brush.
 * * `HOLLOW_BRUSH`: Hollow brush.
 * * `LTGRAY_BRUSH`: Light-gray brush.
 * * `NULL_BRUSH`: Null brush.
 * * `WHITE_BRUSH`: White brush.
 * * `BLACK_PEN`: Black pen.
 * * `NULL_PEN`: Null pen.
 * * `WHITE_PEN`: White pen.
 * * `ANSI_FIXED_FONT`: Fixed-pitch system font.
 * * `ANSI_VAR_FONT`: Variable-pitch system font.
 * * `DEVICE_DEFAULT_FONT`: Device-dependent font.
 * * `OEM_FIXED_FONT`: OEM-dependent fixed font.
 * * `SYSTEM_FONT`: System font. By default, the system uses the system font to
 *                  draw menus, dialog box controls, and other text. In versions
 *                  of the system 3.0 and later, the system font is a variable-
 *                  pitch font width; earlier versions of the system use a
 *                  fixed-pitch system font.
 * * `SYSTEM_FIXED_FONT`: Fixed-pitch system font used in system versions
 *                        earlier than 3.0. This object is available for
 *                        compatibility with earlier versions of the system.
 * * `DEFAULT_PALETTE`: Default color palette. This palette consists of static
 *                      colors in the system palette.
 *
 *  @return {Types.HGDIOBJ} The return value is the handle of the specified
 *                          object if the function is successful. Otherwise it
 *                          is `NULL`.
 */
export function GetStockObject(fnObject) {
  let handle = NULL;

  // If we want to cache them, we can give them names in the HandleManager.

  switch (fnObject) {
    case Gdi.WHITE_BRUSH:
      handle = this.handles.allocate(new Brush(new Color(0xff, 0xff, 0xff)));
      break;
    case Gdi.LTGRAY_BRUSH:
      handle = this.handles.allocate(new Brush(new Color(0xc0, 0xc0, 0xc0)));
      break;
    case Gdi.GRAY_BRUSH:
      handle = this.handles.allocate(new Brush(new Color(0x80, 0x80, 0x80)));
      break;
    case Gdi.DKGRAY_BRUSH:
      handle = this.handles.allocate(new Brush(new Color(0x40, 0x40, 0x40)));
      break;
    case Gdi.BLACK_BRUSH:
      handle = this.handles.allocate(new Brush(new Color(0x00, 0x00, 0x00)));
      break;
    case Gdi.NULL_BRUSH:
      handle = this.handles.allocate(new Brush(new Color(0x00, 0x00, 0x00, 0x00)));
      break;
    case Gdi.WHITE_PEN:
      handle = this.handles.allocate(new Pen(new Color(0xff, 0xff, 0xff)));
      break;
    case Gdi.BLACK_PEN:
      handle = this.handles.allocate(new Pen(new Color(0x00, 0x00, 0x00)));
      break;
    case Gdi.NULL_PEN:
      handle = this.handles.allocate(new Pen(new Color(0x00, 0x00, 0x00, 0x00)));
      break;
    case Gdi.OEM_FIXED_FONT:
    case Gdi.ANSI_FIXED_FONT:
    case Gdi.ANSI_VAR_FONT:
    case Gdi.SYSTEM_FONT:
    case Gdi.SYSTEM_FIXED_FONT:
    case Gdi.DEVICE_DEFAULT_FONT:
      {
        /* A stock font is a face at a size, and both halves matter: the same
         * file holds Courier at ten points and at fifteen, and they are thirteen
         * and twenty pixels tall. See stock-fonts.ts for where these come from.
         */
        const wanted = STOCK_FONTS[fnObject];
        const font = this.fonts.realize(wanted.face, wanted.points);

        if (font) {
          handle = this.handles.lookup(font) || this.handles.allocate(font);
        }
      }
      break;
    case Gdi.DEFAULT_PALETTE:
      this.debug('GetStockObject: IMPLEMENTATION REQUIRED');
      break;
    default:
      break;
  }

  return handle;
}
