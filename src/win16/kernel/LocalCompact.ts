'use strict';

import { indexFor } from '../selectors.js';

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
export function LocalCompact(this: any, _uMinFree: number) {
  /* The largest free block of the heap in DS, which nothing here ever needs
   * to move blocks to make (documented). Bago asks before it reads its
   * dictionary, and read only part of it when this answered nothing. */
  const heap = this.allocator?.heapOf?.(indexFor(this.machine.cpu.core.ds));

  /* Less six, the arena of a moveable block, where there is any (`KRNL386.EXE`
   * seg1 `8d9c`-`8da3`; see `Heap.HEADER`). So it is never the heap's whole
   * size, which `LocalShrink` answers (`minis3`). */
  const largest = heap ? heap.largestFree() : 0;

  return largest ? Math.min(Math.max(0, largest - 6), 0xffff) : 0;
}
