'use strict';

import { indexFor } from '../selectors.js';
import { isDiscardable, lockDown } from './locks.js';

/**
 * The **GlobalUnlock** function unlocks the given global memory object.
 * This function has no effect on fixed memory.
 *
 * With movable or discardable memory, this function decrements the object's
 * lock count. The object is completely unlocked and subject to moving or
 * discarding if the lock count is decreased to zero.
 *
 * Windows counts only a discardable block's locks: a moveable or a fixed
 * block's unlock answers nought, however often it was locked (**recorded**
 * by `glocks`).
 *
 * Other functions can also affect the lock count of a memory object. For a list
 * of the functions that affect the lock count, see the description of the
 * {@link Kernel.GlobalFlags GlobalFlags} function.
 *
 * Each time an application calls {@link Kernel.GlobalLock GlobalLock} for an
 * object, it must eventually call the **GlobalUnlock** function for the object.
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
 *                               unlocked.
 *
 * @returns {Types.FARPTR} The return value is zero if the object's lock count
 *                         was decremented (decreased by one) to zero.
 *                         Otherwise, the return value is nonzero.
 */
export function GlobalUnlock(hglb) {
  /* FFFFh is the caller's own data segment, as for `GlobalLock` (seg1
   * `0fea`). */
  const handle = (hglb & 0xffff) === 0xffff ? (this.machine?.cpu?.core?.ds ?? 0) : hglb;
  const index = indexFor(handle);

  /* A discardable block is counted down, and the count left answered;
   * any other block answers nought (`glocks`; seg1 `100b`). See
   * `locks.ts`. */
  if (!isDiscardable(this, index)) {
    return 0;
  }

  return lockDown(this, index);
}
