'use strict';

import { Region } from './gdi-objects.js';
import { SelectClipRgn } from './clipping.js';
import { DeviceBitmap } from '../../raster/device-bitmap.js';

import { realiseBrush } from './CreatePatternBrush.js';
import { GetStockObject } from './GetStockObject.js';
import { handleHeld } from './DeleteObject.js';

import { TRUE, NULL } from '../consts.js';

/**
 * The **SelectObject** function selects an object into the given device
 * context. The new object replaces the previous object of the same type.
 *
 * When an application uses the **SelectObject** function to select a font, pen,
 * or brush, the system allocates space for that object in its data segment.
 * Because data-segment space is limited, an application should use the
 * {@link Gdi.DeleteObject DeleteObject} function to remove each drawing object
 * that it no longer requires. Before removing the object, the application
 * should select it out of the device context. To do this, the application can
 * select a different object of the same type back into the device context;
 * typically, this different object is the original object for the device
 * context.
 *
 * When the *`hdc`* parameter identifies a metafile device context, the
 * **SelectObject** function does not return the handle of the previously
 * selected object. When the device context is a metafile, calling
 * **SelectObject** with the *`hgdiobj`* parameter set to a value returned by a
 * previous call to **SelectObject** can cause unpredictable results. Because
 * metafiles perform their own object cleanup, an application need not reselect
 * default objects when recording a metafile.
 *
 * Memory device context are the only device contexts into which an application
 * can select a bitmap. A bitmap can be selected into only one memory context at
 * a time. The format of the bitmap must either be monochrome or be compatible
 * with the given device; if it is not, **SelectObject** returns an error.
 *
 * **See also**:
 * {@link Gdi.DeleteObject DeleteObject}
 * {@link Gdi.SelectClipRgn SelectClipRgn}
 * {@link Gdi.SelectPalette SelectPalette}
 *
 * @static
 * @function SelectObject
 * @memberof Gdi
 *
 * @param {Types.HDC} hdc - Identifies the device context.
 * @param {Types.HGDIOBJ} hgdiobj - Identifies the object to be selected. The
 *                                  object can be one of the following and must
 *                                  have been created by using one of the listed
 *                                  functions:
 * * Bitmap: {@link Gdi.CreateBitmap CreateBitmap},
 *           {@link Gdi.CreateBitmapIndirect CreateBitmapIndirect},
 *           {@link Gdi.CreateCompatibleBitmap CreateCompatibleBitmap},
 *           {@link Gdi.CreateDIBitmap CreateDIBitmap}
 * * Brush: {@link Gdi.CreateBrushIndirect CreateBrushIndirect},
 *          {@link Gdi.CreateDIBPatternBrush CreateDIBPatternBrush},
 *          {@link Gdi.CreateHatchBrush CreateHatchBrush},
 *          {@link Gdi.CreatePatternBrush CreatePatternBrush},
 *          {@link Gdi.CreateSolidBrush CreateSolidBrush}
 * * Font: {@link Gdi.CreateFont CreateFont},
 *         {@link Gdi.CreateFontIndirect CreateFontIndirect}
 * * Pen: {@link Gdi.CreatePen CreatePen},
 *        {@link Gdi.CreatePenIndirect CreatePenIndirect}
 * * Region: {@link Gdi.CreateEllipticRgn CreateEllipticRgn},
 *           {@link Gdi.CreateEllipticRgnIndirect CreateEllipticRgnIndirect},
 *           {@link Gdi.CreatePolygonRgn CreatePolygonRgn},
 *           {@link Gdi.CreateRoundRectRgn CreateRoundRectRgn},
 *           {@link Gdi.CreateRectRgn CreateRectRgn},
 *           {@link Gdi.CreateRectRgnIndirect CreateRectRgnIndirect}
 *
 * @return {Types.HGDIOBJ} The return value is the handle of the object being
 *                         replaced, if the function is successful. Otherwise it
 *                         is `NULL`.
 *
 *                         If the *`hgdiobj`* parameter identifies a region,
 *                         this function performs the same task as the
 *                         {@link Gdi.SelectClipRgn SelectClipRgn} function and
 *                         the return value is `SIMPLEREGION` (region has no
 *                         overlapping borders), `COMPLEXREGION` (region has
 *                         overlapping borders), or `NULLREGION` (region is
 *                         empty). If an error occurs, the return value is
 *                         `ERROR` and the previously selected object of the
 *                         specified type remains selected in the device
 *                         context.
 */
export function SelectObject(hdc, hgdiobj) {
  // Gather the surface we are 'emulating'
  let surface;
  if (hdc == NULL) {
    // The screen device
    //surface = this._desktop.surface;
    return NULL;
  } else {
    surface = this.handles.resolve(hdc);
  }

  if (!surface) {
    return NULL;
  }

  // Resolve the provided handle
  const item = this.handles.resolve(hgdiobj);
  let ret = NULL;

  /* A region is the clip, as `SelectClipRgn` makes it, and the answer is
   * what it makes: 3 for an ellipse, 2 for a rectangle, 1 for nothing
   * (`selrgn`). Roulette clips its wheel to a circle so. */
  if (item instanceof Region) {
    return SelectClipRgn.call(this, hdc, hgdiobj);
  }

  /* A bitmap of a shape no device context takes is not selected
   * (`patmono`). */
  if (item instanceof DeviceBitmap && item.shape) {
    return NULL;
  }

  /* Only a memory context takes a bitmap. Any other -- a window's from
   * `GetDC`, `BeginPaint`'s, the screen's, `CreateDC("DISPLAY")`'s --
   * answers nought and keeps drawing on the screen (`selbmp`): GDI tests the
   * context's memory flag, bit 0 of its byte at +0Ah, before anything else
   * and answers nought without it (`GDI.EXE` 1:1BF3). Four Seasons' Visual
   * Basic picture boxes select a memory context's first bitmap into
   * `BeginPaint`'s context before they draw their cards through it: taken,
   * the cards went into that bitmap and not onto the screen. */
  if (this.handles.isBitmap(item) && !surface.memoryContext) {
    return NULL;
  }

  if (this.handles.isBitmap(item)) {
    /* A memory context's first bitmap, given back, is a bitmap: one by one,
     * as `GetObject` reads it (`wingapi`). */
    const first = surface.bitmap instanceof DeviceBitmap && surface.bitmap.placeholder;

    /* Every memory context's first bitmap is the one stock bitmap in Windows,
     * one handle (`GDI.EXE` 1:197F; `stockdel`): given the first time one is
     * replaced, and the same for every one after. */
    ret =
      handleHeld(this, surface.bitmap) ||
      (first ? (this.stockBitmap ??= this.handles.allocate(surface.bitmap)) : TRUE);
    surface.bitmap = item;

    if (item instanceof DeviceBitmap) {
      item.selected = true;
      item.context.display = this.display;
    }
  } else if (this.handles.isPen(item)) {
    /* One deleted while it was selected answers the handle it had
     * (`stockdel`): the context holds the handle, not the object. */
    ret = handleHeld(this, surface.pen) || TRUE;
    surface.pen = item;
  } else if (this.handles.isFont(item)) {
    ret = handleHeld(this, surface.font) || TRUE;
    surface.font = item;
  } else if (this.handles.isBrush(item)) {
    const stock = surface.brush?.stock;

    ret =
      handleHeld(this, surface.brush) ||
      (stock !== null && stock !== undefined ? GetStockObject.call(this, stock) : TRUE);
    surface.brush = item;
    realiseBrush(surface, item);
  } else {
    this.debug('SelectObject: unknown or invalid object handle');
  }

  return ret;
}
