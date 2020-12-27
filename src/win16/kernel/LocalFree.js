"use strict";

import { NULL } from '../consts.js';

/**
 * The **LocalFree** function frees the given local memory object (if the
 * object is not locked) and invalidates its handle.
 *
 * An application cannot use the **LocalFree** function to free a locked
 * memory object-- that is, a memory object with a lock count greater than zero.
 *
 * After freeing the handle of the memory object, an application cannot use the
 * handle again. An attempt to free the same memory object more than once can
 * cause the system to terminate abnormally.
 *
 * **See also**:
 * {@link Kernel.LocalFlags LocalFlags}
 * {@link Kernel.LocalLock LocalLock}
 *
 * @static
 * @function LocalFree
 * @memberof Kernel
 *
 * @param {Types.HLOCAL} hloc - Identifies the local memory object to be freed.
 *
 * @returns {number} The return value is `NULL` if the function is successful.
 *                   Otherwise, it is equal to the `hloc` parameter.
 */
export function LocalFree(hloc) {
    console.log("LocalFree:", hloc);

    // LocalFree deallocates from the heap of the current segment selected via DS.
    let segment = this.machine.cpu.core.ds >> 3;

    // Get the local heap
    let heap = this.allocator.heapOf(segment);
    if (!heap) {
        // No heap initialized
        return hloc;
    }

    // Free the memory object from the heap
    heap.free(hloc);

    return NULL;
}
