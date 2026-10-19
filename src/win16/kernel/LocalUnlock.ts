'use strict';

/**
 * A local block's lock count down, as `Heap.localUnlock` counts it
 * (`KRNL386.EXE` seg1 `8d43`): what is left, for a moveable block's
 * handle; nought for a fixed block, a discarded one, a count already
 * nought, and with no heap in the current data segment.
 *
 * @param {Types.HLOCAL} hloc - The block.
 *
 * @returns {Types.BOOL} The count left.
 */
export function LocalUnlock(this: any, hloc: number) {
  const heap = this.allocator.heapOf(this.machine.cpu.core.ds >> 3);

  return heap ? heap.localUnlock(hloc & 0xffff) : 0;
}
