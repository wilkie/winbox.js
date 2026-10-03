'use strict';

import { handleFor, indexFor, selectorFor } from '../selectors.js';
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
const GMEM_MOVEABLE = 0x0002;
const GMEM_ZEROINIT = 0x0040;
const GMEM_MODIFY = 0x0080;
const GMEM_DISCARDABLE = 0x0100;

export function GlobalReAlloc(hglb, cbNewSize, fuAlloc) {
  /* With `GMEM_MODIFY`, only the flags change: whether it may be discarded. */
  if (fuAlloc & GMEM_MODIFY) {
    return this.allocator.modify?.(indexFor(hglb), fuAlloc & GMEM_DISCARDABLE) ? hglb : NULL;
  }

  /* Nought, moveable: the block discarded, its handle kept (documented).
   * Program Manager discards its groups' blocks and reads a group in again
   * when the lock answers NULL. */
  if (cbNewSize === 0 && fuAlloc & GMEM_MOVEABLE) {
    return this.allocator.discard(indexFor(hglb)) ? hglb : NULL;
  }

  const before = this.allocator.sizeOf(indexFor(hglb));
  const index = this.allocator.resize(indexFor(hglb), cbNewSize);

  if (index === false) {
    return NULL;
  }

  /* Grown with `GMEM_ZEROINIT`, what it reaches past where it ended is
   * nought; without, it is what the memory held -- **recorded** by
   * `grealloc`, a block grown in place over a freed one's bytes. Visual
   * Basic grows its blocks so, and Four Seas read a freed block's bytes as
   * its own where they were not cleared. */
  const after = this.allocator.sizeOf(index);

  if (fuAlloc & GMEM_ZEROINIT && after > before) {
    this.machine.memory.zero((index << 16) + before, after - before);
  }

  /* Grown past the selectors it had, the block has moved, and has a handle
   * of its own, in the form the caller gave (`grow`). */
  if (index !== indexFor(hglb)) {
    return hglb & 1 ? selectorFor(handleFor(index)) : handleFor(index);
  }

  return hglb;
}
