'use strict';

import { indexFor } from '../selectors.js';
import { isDiscardable, lockUpToCeiling } from './locks.js';

/**
 * The **LockSegment** function locks the specified discardable segment. The
 * segment is locked into memory at the given address and its lock count is
 * incremented (increased by one).
 *
 * Locked memory is not subject to discarding except when a portion of the
 * segment is being reallocated by the {@link Kernel.GlobalReAlloc GlobalReAlloc}
 * function. The segment remains locked in memory until its lock count is
 * decreased to zero by the {@link Kernel.UnlockSegment UnlockSegment} function.
 *
 * Each time an application calls **LockSegment** for a segment, it must
 * eventually call {@link Kernel.UnlockSegment UnlockSegment} for the segment.
 * The **UnlockSegment** function decrements the lock count for the segment.
 * Other functions also can affect the lock count of a memory object. For a
 * list of these functions, see the description of the
 * {@link Kernel.GlobalFlags GlobalFlags} function.
 *
 * **See also**:
 * {@link Kernel.GlobalFlags GlobalFlags}
 * {@link Kernel.GlobalReAlloc GlobalReAlloc}
 * {@link Kernel.LockData LockData}
 * {@link Kernel.UnlockSegment UnlockSegment}
 *
 * @static
 * @function LockSegment
 * @memberof Kernel
 *
 * @param {Types.UINT} uSegment - Specifies the segment address of the segment
 *                                to be locked. If this parameter is -1, the
 *                                **LockSegment** function locks the current
 *                                data segment.
 *
 * @returns {Types.HGLOBAL} The return value specifies the data segment if the
 *                          function is successful. It is `NULL` if the segment
 *                          has been discarded or an error occurs.
 */
export function LockSegment(uSegment) {
  /* A discardable segment is counted up, no further than FFh; any other is
   * not counted (seg1 `0f1e`). FFFFh is the caller's own data segment. See
   * `locks.ts`. */
  const segment = uSegment == 0xffff ? (this.machine?.cpu?.core?.ds ?? 0) : uSegment;
  const index = indexFor(segment);

  if (isDiscardable(this, index)) {
    lockUpToCeiling(this, index);
  }

  if (uSegment == 0xffff) {
    uSegment = -1;
  }

  return uSegment;
}
