'use strict';

import { forgetBitmap } from './gdi-heap.js';
import { forgetInMetafiles } from './metafile.js';

import { DeviceBitmap } from '../../raster/device-bitmap.js';
import { stockHandle } from '../handle-manager.js';

import { TRUE, FALSE } from '../consts.js';

/**
 * The **DeleteObject** function deletes an object from memory by freeing all
 * system storage associated with the object. (Objects include pens, brushes,
 * fonts, bitmaps, regions, and palettes.)
 *
 * After the object is deleted, the handle given in the *`hgdiobj`* parameter
 * is no longer valid.
 *
 * An application should not delete an object that is currently selected into
 * a device context.
 *
 * When a pattern brush is deleted, the bitmap associated with the brush is not
 * deleted. The bitmap must be deleted independently.
 *
 * **See also**:
 * {@link Gdi.SelectObject SelectObject}
 *
 * @static
 * @function DeleteObject
 * @memberof Gdi
 *
 * @param {Types.HGDIOBJ} hgdiobj - Identifies a pen, brush, font, bitmap,
 *                                  region, or palette.
 *
 * @return {Types.BOOL} The return value is nonzero if the function is
 *                      successful. Otherwise, it is zero.
 */
export function DeleteObject(handle) {
  // Delete the handle
  if (!this.handles.isGDI(handle)) {
    return FALSE;
  }

  const item = this.handles.resolve(handle);
  if (!item) {
    return FALSE;
  }

  /* A stock object is not deleted at all, and the answer is yes: GDI marks
   * each as it makes them at start-up, `8000h` in the object's type word
   * (`GDI.EXE` 2:02AE, 2:0331), and `DeleteObject` answers 1 for an object so
   * marked, or one made private (`2000h`), before anything else (1:194C).
   * **Recorded** by `stockdel` on four displays: every stock object, and the
   * bitmap a memory device context starts with, survives being deleted,
   * twice, with the same handle and what `GetObject` tells of it. Two
   * Notepads give their edit controls the same stock font, and the first to
   * exit deletes it. */
  if (isStock(handle, item)) {
    return TRUE;
  }

  /* The block a program was shown its bits in, if it asked (`gdi-heap.ts`). */
  forgetBitmap(this, item);

  /* Out of any metafile being recorded that holds it, by a record of its
   * own (`metafile`). */
  forgetInMetafiles(this, handle);

  this.handles.free(handle);

  /* An object selected into a device context is deleted all the same
   * (`stockdel`); the context keeps its handle, which `SelectObject` gives
   * back when something else is selected (`handleHeld`). */
  (this.deletedHandles ??= new WeakMap()).set(item, handle);
  return TRUE;
}

/**
 * Whether a handle is a stock object's, which every program is given the
 * same handle of: one of `GetStockObject`'s, or a memory device context's
 * first bitmap, which in Windows is the one stock bitmap every memory context
 * starts with.
 */
function isStock(handle: number, item: any) {
  for (let index = 0; index <= 16; index++) {
    if (stockHandle(index) === handle) {
      return true;
    }
  }

  return item instanceof DeviceBitmap && item.placeholder;
}

/**
 * The handle an object had, where a device context may still hold it: its
 * own, or the one it had when it was deleted (`stockdel`).
 */
export function handleHeld(context: any, item: any): number | undefined {
  return context.handles.lookup(item) || context.deletedHandles?.get(item);
}
