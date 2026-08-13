'use strict';

/**
 * The **LocalCompact** function rearranges the local heap so that the
 * specified amount of memory is free.
 *
 * The function first checks the local heap for the specified number of
 * contiguous free bytes. If the bytes do not exist, the function compacts local
 * memory by moving all unlocked, movable objects into high memory. If this does
 * not generate the requested amount of space, the function discards movable and
 * discardable objects that are not locked until the requested amount of space
 * is generated (if possible).
 *
 * **See also**:
 * {@link Kernel.LocalAlloc LocalAlloc}
 * {@link Kernel.LocalLock LocalLock}
 *
 * @static
 * @function LocalCompact
 * @memberof Kernel
 *
 * @param {Types.UINT} uMinFree - Specifies the number of contiguous free bytes
 *                                requested. If this parameter is zero, the
 *                                function does not compact memory, but the
 *                                return value is valid.
 *
 * @returns {Types.UINT} The return value specifies the number of bytes in the
 *                       largest free local memory object. If the `uMinFree`
 *                       parameter is zero, the return value specifies the
 *                       number of bytes in the largest free object that the
 *                       system can generate if it removes all discardable
 *                       objects.
 */
export function LocalCompact(uMinFree) {
  console.log('LocalCompact:', uMinFree);
}
