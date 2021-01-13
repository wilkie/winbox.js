"use strict";

import { NULL } from '../consts.js';

/**
 * The **GlobalFree** function frees the given global memory object (if the
 * object is not locked) and invalidates its handle.
 *
 * The **GlobalFree** function cannot be used to free a locked memory object--
 * that is, a memory object with a lock count greater than zero. For a list of
 * the functions that affect the lock count, see the description of the
 * {@link Kernel.GlobalFlags GlobalFlags} function.
 *
 * Once freed, the handle of the memory object must not be used again.
 * Attempting to free the same memory object more than once can cause the system
 * to terminate abnormally.
 *
 * **See also**:
 * {@link Kernel.GlobalAlloc GlobalAlloc}
 * {@link Kernel.GlobalLock GlobalLock}
 * {@link Kernel.GlobalNotify GlobalNotify}
 * {@link Kernel.GlobalReAlloc GlobalReAlloc}
 * {@link Kernel.GlobalSize GlobalSize}
 * {@link Kernel.GlobalUnlock GlobalUnlock}
 * {@link Kernel.LocalAlloc LocalAlloc}
 *
 * @static
 * @function GlobalFree
 * @memberof Kernel
 *
 * @param {Types.HGLOBAL} hglb - Identifies the global memory object to be
 *                               freed.
 *
 * @returns {Types.HGLOBAL} The return value is `NULL` if the function is
 *                          successful. Otherwise, it is equal to the `hglb`
 *                          parameter.
 */
export function GlobalFree(hglb) {
    if (this.allocator.free(hglb)) {
        return NULL;
    }

    return hglb;
}
