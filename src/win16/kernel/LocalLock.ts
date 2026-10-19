'use strict';

/**
 * A local block's address in the current data segment, as KERNEL gives it
 * (`KRNL386.EXE` seg1 `8d1f`, `Heap.localLock`): a fixed block's pointer as
 * it is; for a moveable block's handle, its lock count up -- a locked
 * block is not moved -- and the address it holds, NULL for a discarded
 * block. NULL with no heap there.
 */
export function LocalLock(this: any, hloc: number) {
  const heap = this.allocator.heapOf(this.machine.cpu.core.ds >> 3);

  if (!heap) {
    return 0;
  }

  return heap.localLock(hloc & 0xffff);
}
