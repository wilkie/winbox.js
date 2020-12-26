"use strict";

import { TRUE, FALSE } from '../consts.js';

/**
 * The **LocalInit** function initializes a local heap in the specified segment.
 *
 * The first 16 bytes of the segment containing a local heap must be reserved
 * for use by the system.
 *
 * **See also**:
 * {@link Kernel.GlobalLock GlobalLock}
 * {@link Kernel.LocalAlloc LocalAlloc}
 * {@link Kernel.LocalReAlloc LocalReAlloc}
 *
 * @static
 * @function LocalInit
 * @memberof Kernel
 *
 * @param {Types.UINT} uSegment - Identifies the segment that is to contain the
 *                                local heap.
 * @param {Types.UINT} uStartAddr - Specifies the starting address of the local
 *                                  heap within the segment.
 * @param {Types.UINT} uEndAddr - Specifies the ending address of the local heap
 *                                within the segment.
 *
 * @returns {Types.BOOL} The return value is nonzero if the function is
 *                       successful. Otherwise it is zero.
 */
export function LocalInit(uSegment, uStartAddr, uEndAddr) {
    console.log("LocalInit:", uSegment, uStartAddr, uEndAddr);

    // Apparently, if the uSegment is 0, they *mean* the current DS.
    uSegment = uSegment || this.machine.cpu.ds;

    // Also, apparently, if the start address is less than 16, it gets set
    // to 16.
    if (uStartAddr < 16) {
        uStartAddr = 16;
    }

    // Get the selector index
    let segment = uSegment;

    // If the heap is already allocated, we fail out
    if (this.allocator.heapOf(segment)) {
        return FALSE;
    }

    // Allocate a heap
    let size = uEndAddr - uStartAddr;
    let heap = this.allocator.heapInitialize(segment, uStartAddr, size);

    console.log("allocated a heap", segment, heap);
    if (heap) {
        return TRUE;
    }

    return FALSE;
}
