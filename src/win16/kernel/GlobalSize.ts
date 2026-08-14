'use strict';

import { indexFor } from '../selectors.js';

import { NULL } from '../consts.js';

import { Kernel } from '../kernel.js';

/**
 * The **GlobalSize** function retrieves the current size, in bytes, of the
 * given global memory object.
 *
 * The size of a memory object is sometimes larger than the size requested at
 * the time the memory was allocated.
 *
 * An application should call the {@link Kernel.GlobalFlags GlobalFlags}
 * function prior to calling the GlobalSize function, to verify that the
 * specified memory object was not discarded. If the memory object has been
 * discarded, the return value for **GlobalSize** is meaningless.
 *
 *
 * **See also**:
 * {@link Kernel.GlobalAlloc GlobalAlloc}
 * {@link Kernel.GlobalFlags GlobalFlags}
 *
 * @static
 * @function GlobalSize
 * @memberof Kernel
 *
 * @param {Types.HGLOBAL} hglb - Identifies the global memory object.
 *
 * @returns {Types.DWORD} The return value specifies the size, in bytes, of the
 *                        memory object. It is zero if the specified handle is
 *                        not valid or if the object has been discarded.
 */
export function GlobalSize(hglb) {
  return this.allocator.sizeOf(indexFor(hglb));
}
