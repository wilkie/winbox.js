'use strict';

import { indexFor } from '../selectors.js';
import { NULL } from '../consts.js';

/**
 * The **GlobalReAlloc** function changes the size or attributes of a global
 * memory object.
 *
 * The object keeps both its handle and its address. A descriptor covers the
 * whole 64 KiB its selector can address, so a block that still fits behind the
 * selectors it already has does not need to move -- real Windows returns the
 * same handle and the same address for a block grown from 256 bytes to 1024,
 * and for one shrunk back again.
 *
 * **See also**:
 * {@link Kernel.GlobalAlloc GlobalAlloc}
 * {@link Kernel.GlobalSize GlobalSize}
 *
 * @static
 * @function GlobalReAlloc
 * @memberof Kernel
 *
 * @param {Types.HGLOBAL} hglb - Identifies the global memory object.
 * @param {Types.DWORD} cbNewSize - The new size, in bytes.
 * @param {Types.UINT} fuAlloc - How to reallocate the object.
 *
 * @return {Types.HGLOBAL} The handle, unchanged, or NULL if the object could
 *                         not be resized.
 */
export function GlobalReAlloc(hglb, cbNewSize, fuAlloc) {
  if (!this.allocator.resize(indexFor(hglb), cbNewSize)) {
    return NULL;
  }

  return hglb;
}
