'use strict';

import { stockFontHandle } from './stock-fonts.js';
import { defaultPalette } from './gdi-objects.js';

import { Brush } from '../../raster/brush.js';
import { Pen } from '../../raster/pen.js';
import { Color } from '../../raster/color.js';

import { Gdi } from '../gdi.js';

import { NULL } from '../consts.js';
import { stockHandle } from '../handle-manager.js';

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
/**
 * A stock brush of a colour, its `LOGBRUSH` solid and the colour, as
 * `GetObject` tells of it; the null brush is `BS_HOLLOW` (`brushobj`).
 */
function solid(r: number, g: number, b: number) {
  const brush: any = new Brush(new Color(r, g, b));

  brush.logbrush = { style: 0, color: (r | (g << 8) | (b << 16)) >>> 0, hatch: 0 };

  return brush;
}

export function GetStockObject(fnObject) {
  /* One handle for each: `patbrush` recorded the white brush a new device
   * context has as the one `GetStockObject` answers. A handle that has been
   * deleted is made again. */
  const stock: Map<number, number> = (this.stockObjects ??= new Map());
  const made = stock.get(fnObject);

  if (made && this.handles.resolve(made)) {
    return made;
  }

  let handle = NULL;
  /* At its own handle, the same on every display (`gdinum`). */
  const place = (item: any) => {
    const at = stockHandle(fnObject);

    this.handles.assign(at, item);

    return at;
  };

  switch (fnObject) {
    case Gdi.WHITE_BRUSH:
      handle = place(solid(0xff, 0xff, 0xff));
      break;
    case Gdi.LTGRAY_BRUSH:
      handle = place(solid(0xc0, 0xc0, 0xc0));
      break;
    case Gdi.GRAY_BRUSH:
      handle = place(solid(0x80, 0x80, 0x80));
      break;
    case Gdi.DKGRAY_BRUSH:
      handle = place(solid(0x40, 0x40, 0x40));
      break;
    case Gdi.BLACK_BRUSH:
      handle = place(solid(0x00, 0x00, 0x00));
      break;
    case Gdi.NULL_BRUSH: {
      const brush: any = new Brush(new Color(0x00, 0x00, 0x00, 0x00));

      brush.logbrush = { style: 1, color: 0, hatch: 0 };
      handle = place(brush);
      break;
    }
    case Gdi.WHITE_PEN:
      handle = place(new Pen(new Color(0xff, 0xff, 0xff)));
      break;
    case Gdi.BLACK_PEN:
      handle = place(new Pen(new Color(0x00, 0x00, 0x00)));
      break;
    case Gdi.NULL_PEN:
      handle = place(new Pen(new Color(0x00, 0x00, 0x00, 0x00)));
      break;
    /* The index nothing documents: a pen too, a null one, white, nought
     * wide (`gdinum`, on four displays). */
    case STOCK_9: {
      const pen: any = new Pen(new Color(0xff, 0xff, 0xff, 0x00));

      pen.logpen = { style: 5, width: 0, y: 0, color: 0xffffff };
      handle = place(pen);
      break;
    }
    case Gdi.OEM_FIXED_FONT:
    case Gdi.ANSI_FIXED_FONT:
    case Gdi.ANSI_VAR_FONT:
    case Gdi.SYSTEM_FONT:
    case Gdi.SYSTEM_FIXED_FONT:
    case Gdi.DEVICE_DEFAULT_FONT:
      // See stock-fonts.ts for what each of these actually is, and why.
      handle = stockFontHandle(this, fnObject) ?? NULL;
      break;
    case Gdi.DEFAULT_PALETTE:
      handle = defaultPalette(this);
      break;
    default:
      break;
  }

  if (handle) {
    stock.set(fnObject, handle);
  }

  return handle;
}

const STOCK_9 = 9;
