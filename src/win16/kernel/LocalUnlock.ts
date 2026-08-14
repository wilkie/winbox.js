'use strict';

/**
 * The **LocalUnlock** function unlocks the given local memory object. This
 * function has no effect on fixed memory.
 *
 * With discardable memory, this function decrements (decreases by one) the
 * object's lock count. The object is completely unlocked, and subject to
 * discarding, if the lock count is decreased to zero.
 *
 * **See also**:
 * {@link Kernel.LocalLock LocalLock}
 *
 * @static
 * @function LocalUnlock
 * @memberof Kernel
 *
 * @param {Types.HLOCAL} hloc - Identifies the local memory object to be
 *                              unlocked.
 *
 * @returns {Types.BOOL} The return value is zero if the function is successful.
 *                       Otherwise it is non-zero.
 */
export function LocalUnlock(hloc) {
  this.debug('LocalUnlock:', hloc);
}
