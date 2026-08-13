'use strict';

/**
 * The **LocalHandle** function retrieves the handle of the specified local
 * memory object.
 *
 * **See also**:
 * {@link Kernel.LocalAlloc LocalAlloc}
 *
 * @static
 * @function LocalHandle
 * @memberof Kernel
 *
 * @param {Types.NEARPTR} pvMem - Specifies the address of the local memory
 *                                object.
 *
 * @returns {number} The return value is the handle of the specified object if
 *                   the function is successful. It is `NULL` if the specified
 *                   addresss has no handle.
 */
export function LocalHandle(pvMem) {
  console.log('LocalHandle:', pvMem);
}
