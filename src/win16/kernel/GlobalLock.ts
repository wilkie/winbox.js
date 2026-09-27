'use strict';

import { indexFor, selectorFor } from '../selectors.js';

/**
 * The **GlobalLock** function returns a pointer to the given global memory
 * object. **GlobalLock** increments (increases by one) the lock count of
 * movable objects and locks the memory. Locked memory will not be moved or
 * discarded unless the memory object is reallocated by the
 * {@link Kernel.GlobalReAlloc GlobalReAlloc} function. The object remains
 * locked in memory until its lock count is decreased to zero.
 *
 * Each time an application calls the **GlobalLock** function for an object,
 * it must eventually call the {@link Kernel.GlobalUnlock GlobalUnlock}
 * function for the object.
 *
 * This function will return `NULL` if an application attempts to lock a memory
 * object with a zero-byte size.
 *
 * If **GlobalLock** incremented the lock count for the object,
 * {@link Kernel.GlobalUnlock GlobalUnlock} decrements the lock count for the
 * object. Other functions can also affect the lock count of a memory object.
 * For a list of these functions, see the description of the **GetGlobalFlags**
 * function.
 *
 * Discarded objects always have a lock count of zero.
 *
 * **See also**:
 * {@link Kernel.GlobalFree GlobalFree}
 * {@link Kernel.GlobalAlloc GlobalAlloc}
 * {@link Kernel.GlobalNotify GlobalNotify}
 * {@link Kernel.GlobalReAlloc GlobalReAlloc}
 * {@link Kernel.GlobalSize GlobalSize}
 * {@link Kernel.GlobalUnlock GlobalUnlock}
 *
 * @static
 * @function GlobalLock
 * @memberof Kernel
 *
 * @param {Types.HGLOBAL} hglb - Identifies the global memory object to be
 *                               locked.
 *
 * @returns {Types.FARPTR} The return value points to the first byte of memory
 *                         in the global object, if the function is successful.
 *                         It is `NULL` if the object has been discarded or an
 *                         error occurs.
 */
export function GlobalLock(hglb) {
  const core = this.machine?.cpu?.core;

  /* FFFFh is the caller's own data segment. **Recorded** by `glock`. */
  if ((hglb & 0xffff) === 0xffff && core) {
    return (core.ds << 16) >>> 0;
  }

  /* A handle that names no segment -- nought, 1, a block freed -- locks
   * nothing, **recorded** by `glock`: Control Panel's printers applet locks
   * whatever Print Manager passes it, and Print Manager passes 1. */
  const index = indexFor(hglb);

  if (!index || (core && !(this.machine.memory.read8(core.ldtBase + 8 * index + 5) & 0x80))) {
    return 0;
  }

  /* A discarded block has nothing to address. */
  if (this.allocator?.isDiscarded?.(index)) {
    return 0;
  }

  /* A locked block is addressed through the handle's own descriptor at the
   * privilege level code runs at, and it starts at offset zero of it.
   */
  return (selectorFor(hglb) << 16) >>> 0;
}
