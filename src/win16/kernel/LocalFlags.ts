'use strict';

/**
 * A local block's flags and lock count, as `Heap.localFlags` answers them
 * (`KRNL386.EXE` seg1 `8d06`): for a moveable block's handle, its flags in
 * the high byte -- `LMEM_DISCARDED`, 40h, and its discard level -- and its
 * lock count in the low; nought for a fixed block, and with no heap in the
 * current data segment.
 *
 * @param {Types.HLOCAL} hloc - The block.
 *
 * @returns {Types.UINT} Its flags and lock count.
 */
export function LocalFlags(this: any, hloc: number) {
  const heap = this.allocator.heapOf(this.machine.cpu.core.ds >> 3);

  return heap ? heap.localFlags(hloc & 0xffff) : 0;
}
