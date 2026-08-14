'use strict';

/**
 * The **LocalFlags** function retrieves information about the given local
 * memory object.
 *
 * To retrieve the lock count from the return value, use the LMEM_LOCKCOUNT
 * mask.
 *
 * **See also**:
 * {@link Kernel.LocalAlloc LocalAlloc}
 *
 * @static
 * @function LocalFlags
 * @memberof Kernel
 *
 * @param {Types.HLOCAL} hloc - Identifies the local memory object.
 *
 * @returns {Types.UINT} The low-order byte of the return value contains the
 *                       lock count of the object; the high-order byte contains
 *                       either LMEM_DISCARDABLE (object has been marked as
 *                       discardable) or LMEM_DISCARDED (object has been
 *                       discarded).
 */
export function LocalFlags(hloc) {
  this.debug('LocalFlags:', hloc);
}
