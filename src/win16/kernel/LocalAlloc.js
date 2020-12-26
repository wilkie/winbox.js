"use strict";

import { NULL } from '../consts.js';

import { Kernel } from '../kernel.js';

/**
 * The **LocalAlloc** function allocates the specified number of bytes from the
 * local heap.
 *
 * If **LocalAlloc** allocates movable memory, the return value is a local handle
 * of the memory. To access the memory, an application must use the
 * {@link Kernel.LocalLock LocalLock} function to convert the handle to a pointer.
 *
 * If **LocalAlloc** allocates fixed memory, the return value is a pointer to the
 * memory. To access the memory, an application can simply cast the return value
 * to a pointer.
 *
 * Fixed memory will be slightly faster than movable memory. If memory will be
 * allocated and freed without an intervening local allocation, then the memory
 * should be allocated as fixed.
 *
 * If this function is successful, it allocates at least the amount requested.
 * If the amount allocated is greater than the amount requested, the application
 * can use the entire amount. To determine the size of a local memory object, an
 * application can use the {@link Kernel.LocalSize LocalSize} function.
 *
 * To free a local memory object, an application should use the
 * {@link Kernel.LocalFree LocalFree} function. To change the size or attributes
 * of an allocated memory object, an application can use the
 * {@link Kernel.LocalReAlloc LocalReAlloc} function.
 *
 * **See also**:
 * {@link Kernel.LocalFree LocalFree}
 * {@link Kernel.LocalLock LocalLock}
 * {@link Kernel.LocalReAlloc LocalReAlloc}
 * {@link Kernel.LocalSize LocalSize}
 * {@link Kernel.LocalUnlock LocalUnlock}
 *
 * @static
 * @function LocalAlloc
 * @memberof Kernel
 *
 * @param {Types.UINT} fuAllocFlags - Specifies how to allocate memory. This
 *                                    parameter can be a combination of the following
 *                                    values:
 * * LHND: Combines LMEM_MOVEABLE and LMEM_ZEROINIT
 * * LMEM_DISCARDABLE: Allocates discardable memory.
 * * LMEM_FIXED: Allocates fixed memory. The
 * * LMEM_FIXED and LMEM_MOVEABLE flags cannot be combined.
 * * LMEM_MOVEABLE: Allocates movable memory. The LMEM_FIXED and
 *   LMEM_MOVEABLE flags cannot be combined.
 * * LMEM_NOCOMPACT: Does not compact or discard memory to satisfy the
 *   allocation request.
 * * LMEM_NODISCARD: Does not discard memory to satisfy the allocation
 *   request.
 * * LMEM_ZEROINIT: Initializes memory contents to zero.
 * * LPTR: Combines LMEM_FIXED and LMEM_ZEROINIT.
 * * NONZEROLHND: Same as the LMEM_MOVEABLE flag.
 * * NONZEROLPTR: Same as the LMEM_FIXED flag.
 * @param {Types.UINT} fuAlloc - Specifies the number of bytes to be allocated.
 *
 * @returns {Types.HLOCAL} The return value is the instance handle of the newly
 *                         allocated local memory object, if the function is
 *                         successful. Otherwise it is NULL.
 */
export function LocalAlloc(fuAllocFlags, fuAlloc) {
    // LocalAlloc allocates to the heap of the current segment selected via DS.
    let segment = this.machine.cpu.core.ds >> 3;

    // We can negotiate flags.
    // TODO: flags
    let options = {};

    if (fuAllocFlags & Kernel.LMEM_MOVEABLE) {
        options.movable = true;
    }

    if (fuAllocFlags & Kernel.LMEM_NOCOMPACT) {
        options.noCompact = true;
    }

    if (fuAllocFlags & Kernel.LMEM_NODISCARD) {
        options.noDiscard = true;
    }

    if (fuAllocFlags & Kernel.LMEM_ZEROINIT) {
        options.zeroInit = true;
    }

    if (fuAllocFlags & Kernel.LMEM_DISCARDABLE) {
        options.discardable = true;
    }

    // Get the local heap.
    let heap = this.allocator.heapOf(segment);
    if (!heap) {
        // No heap initialized
        return NULL;
    }

    let handle = heap.allocate(fuAlloc, options);
    if (handle === null) {
        return NULL;
    }
    console.log("allocated", handle);

    return handle;
}
