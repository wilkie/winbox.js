"use strict";

import { NULL } from '../consts.js';

/**
 * The **GlobalUnlock** function unlocks the given global memory object.
 * This function has no effect on fixed memory.
 *
 * With movable or discardable memory, this function decrements the object's
 * lock count. The object is completely unlocked and subject to moving or
 * discarding if the lock count is decreased to zero.
 *
 * This function returns nonzero if the given memory object is not movable.
 * An application should not rely on the return value to determine the number
 * of times it must subsequently call the **GlobalUnlock** function for the
 * memory object.
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
    // TODO: handle lock counts
    return 0;
}
