'use strict';

/**
 * The **LocalReAlloc** function changes the size or attributes of the given
 * local memory object.
 *
 * If **LocalReAlloc** reallocates a movable object, the return value is a
 * local handle of the memory. To access the memory, an application must use
 * the {@link Kernel.LocalLock LocalLock} function to convert the handle to a
 * pointer.
 *
 * If **LocalReAlloc** reallocates a fixed object, the return value is a
 * pointer to the memory. To access the memory, an application can simply cast
 * the return value to a pointer.
 *
 * To free a local memory object, an application should use the
 * {@link Kernel.LocalFree LocalFree} function.
 *
 * **See also**:
 * {@link Kernel.LocalAlloc LocalAlloc}
 * {@link Kernel.LocalFree LocalFree}
 * {@link Kernel.LocalDiscard LocalDiscard}
 * {@link Kernel.LocalLock LocalLock}
 *
 * @static
 * @function LocalReAlloc
 * @memberof Kernel
 *
 * @param {Types.HLOCAL} hloc - Identifies the local memory object to be
 *                              reallocated.
 * @param {Types.UINT} fuNewSize - Specifies the new size of the local memory
 *                                 object.
 * @param {Types.UINT} fuFlags - Specifies how to reallocate the local memory
 *                               object. If this parameter includes
 *                               {@link Kernel.LMEM_MODIFY LMEM_MODIFY}
 *                               and {@link Kernel.LMEM_DISCARDABLE
 *                               LMEM_DISCARDABLE} flags, **LocalReAlloc**
 *                               ignores the `fuNewSize` parameter. The
 *                               `fuFlags` parameters can be a combination of
 *                               the following values:
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
 *
 * @returns {Types.HLOCAL} The return value is the handle of the reallocated
 *                         local memory object, if the function is successful.
 *                         Otherwise, it is `NULL`.
 */
export function LocalReAlloc(hloc, fuNewSize, fuFlags) {
  this.debug('LocalReAlloc:', hloc, fuNewSize, fuFlags);
}
