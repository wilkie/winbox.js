'use strict';

/**
 * The **LocalSize** function returns the current size, in bytes, of the given
 * local memory object.
 *
 * The size of a memory object sometimes is larger than the size requested when
 * the memory was allocated.
 *
 * To verify that the memory object has not been discarded, an application
 * should call the LocalFlags function prior to calling the **LocalSize**
 * function. If the memory object has been discarded, the return value for
 * **LocalSize** is meaningless.
 *
 * **See also**:
 * {@link Kernel.LocalAlloc LocalAlloc}
 *
 * @static
 * @function LocalSize
 * @memberof Kernel
 *
 * @param {Types.HLOCAL} hloc - Identifies the local memory object.
 *
 * @returns {Types.UINT} The return value specifies the size, in bytes, of the
 *                       memory object, if the function is successful. It is zero
 *                       if the specified handle is invalid or the object has been
 *                       discarded.
 */
export function LocalSize(hloc) {
  console.log('LocalSize:', hloc);
}
