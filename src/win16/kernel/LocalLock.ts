'use strict';

/**
 * A local block's address in the current data segment: what a moveable
 * block's handle holds, or a fixed block's pointer as it is. A discarded
 * block, or a handle this heap did not give out, is NULL. Blocks here do not
 * move while a program holds their address, so no lock count is kept.
 */
export function LocalLock(this: any, hloc: number) {
  const heap = this.allocator.heapOf(this.machine.cpu.core.ds >> 3);

  if (!heap || !hloc) {
    return 0;
  }

  return heap.sizeOf(hloc) ? heap.resolve(hloc) : 0;
}
