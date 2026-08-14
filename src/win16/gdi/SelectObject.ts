'use strict';

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
  let surface = null;
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

  if (this.handles.isBitmap(item)) {
    ret = this.handles.lookup(surface.bitmap) || TRUE;
    surface.bitmap = item;
  } else if (this.handles.isPen(item)) {
    ret = this.handles.lookup(surface.pen) || TRUE;
    surface.pen = item;
  } else if (this.handles.isFont(item)) {
    ret = this.handles.lookup(surface.font) || TRUE;
    surface.font = item;
  } else if (this.handles.isBrush(item)) {
    ret = this.handles.lookup(surface.brush) || TRUE;
    surface.brush = item;
  } else {
    this.debug('SelectObject: unknown or invalid object handle');
  }

  return ret;
}
