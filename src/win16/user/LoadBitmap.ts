'use strict';

import { Executable } from '../../executable.js';
import { decodeDib, dibToDevice } from '../../raster/dib.js';
import { DeviceBitmap } from '../../raster/device-bitmap.js';
import { DevicePalette } from '../../raster/device-palette.js';

import { NULL } from '../consts.js';

import { resourceBytes } from './resources.js';

/**
 * The **LoadBitmap** function loads the specified bitmap resource from the
 * given module's executable file.
 *
 * If the bitmap pointed to by lpszBitmap does not exist or if there is
 * insufficient memory to load the bitmap, the function fails. The application
 * must call the {@link User.DeleteObject DeleteObject} function to delete each
 * bitmap handle returned by the **LoadBitmap** function. This also applies to
 * the following predefined bitmaps.
 *
 * An application can use the **LoadBitmap** function to access the predefined
 * bitmaps used by the system. To do so, the application must set the *`hinst`*
 * parameter to `NULL` and the *`lpszBitmap`* parameter to one of the following
 * values:
 *
 * * `OBM_BTNCORNERS`
 * * `OBM_BTSIZE`
 * * `OBM_CHECK`
 * * `OBM_CHECKBOXES`
 * * `OBM_CLOSE`
 * * `OBM_COMBO`
 * * `OBM_DNARROW`
 * * `OBM_DNARROWD`
 * * `OBM_DNARROWI`
 * * `OBM_LFARROW`
 * * `OBM_LFARROWD`
 * * `OBM_LFARROWI`
 * * `OBM_MNARROW`
 * * `OBM_OLD_CLOSE`
 * * `OBM_OLD_DNARROW`
 * * `OBM_OLD_LFARROW`
 * * `OBM_OLD_REDUCE`
 * * `OBM_OLD_RESTORE`
 * * `OBM_OLD_RGARROW`
 * * `OBM_OLD_UPARROW`
 * * `OBM_OLD_ZOOM`
 * * `OBM_REDUCE`
 * * `OBM_REDUCED`
 * * `OBM_RESTORE`
 * * `OBM_RESTORED`
 * * `OBM_RGARROW`
 * * `OBM_RGARROWD`
 * * `OBM_RGARROWI`
 * * `OBM_SIZE`
 * * `OBM_UPARROW`
 * * `OBM_UPARROWD`
 * * `OBM_UPARROWI`
 * * `OBM_ZOOM`
 * * `OBM_ZOOMD`
 *
 * Bitmap names that begin with `OBM_OLD` represent bitmaps used by the system
 * in versions earlier than 3.0.
 *
 * The bitmaps identified by `OBM_DNARROWI`, `OBM_LFARROWI`, `OBM_RGARROWI`, and
 * `OBM_UPARROWI` are new for system version 3.1. These bitmaps are not found in
 * device drivers for previous versions of the system.
 *
 * **See also**:
 * {@link User.DeleteObject DeleteObject}
 *
 * @static
 * @function LoadBitmap
 * @memberof User
 *
 * @param {Types.HINSTANCE} hinst - Identifies the instance of the module whose
 *                                  executable file contains the bitmap to be
 *                                  loaded.
 * @param {Types.LPCSTR} lpszBitmap - Points to a null terminated string that
 *                                    contains the name of the bitmap resource
 *                                    to be loaded. Alternatively, this
 *                                    parameter can consist of the resource
 *                                    identifier in the low-order word and zero
 *                                    in the high-order word.
 *
 * @return {Types.HBITMAP} The return value is the handle of the specified
 *                         bitmap if the function is successful. Otherwise it is
 *                         `NULL`.
 */
export async function LoadBitmap(hinst, lpszBitmap) {
  /* No module: one of the system's bitmaps, `OBM_...`, which the display
   * driver keeps. Each call gets a bitmap of its own to draw with or delete. */
  if (hinst == NULL) {
    const oem = this.rasterDesktop?.environment?.oem?.get(lpszBitmap & 0xffff);

    if (!oem) {
      return NULL;
    }

    const copy = new DeviceBitmap(oem.width, oem.height, oem.depth, undefined, oem.devicePalette);

    copy.indices.set(oem.indices);

    return this.handles.allocate(copy);
  }

  const module = this.handles.resolve(hinst);
  const data = await resourceBytes(module?.executable, Executable.RESOURCES.Bitmap, lpszBitmap);

  if (!data) {
    return NULL;
  }

  /* Into a device-dependent bitmap at the display's depth, each colour
   * matched to the display's palette, as the bitmap will be drawn with. A
   * two-colour resource becomes a monochrome bitmap, which keeps a mask a
   * mask. Inferred, not recorded. See `DeviceBitmap`. */
  let dib;

  try {
    dib = decodeDib(data);
  } catch {
    return NULL;
  }

  const depth = dib.bitCount === 1 ? 1 : DevicePalette.depthOf(this.display);

  return this.handles.allocate(
    dibToDevice(dib, depth, DevicePalette.forDisplay(this.display, depth), this.display)
  );
}
