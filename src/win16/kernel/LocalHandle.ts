'use strict';

/**
 * The handle of the local block in the current data segment that a pointer
 * points at, as `Heap.handleOf` finds it: a moveable block's handle, or a
 * fixed block's pointer as it is. With no heap there, the value as it is
 * where bit 1 is clear, else NULL (`KRNL386.EXE` seg1 `8d6a`). Windows Help
 * hands its macros' buttons over by the handle of a block it holds only by
 * its pointer: answered NULL, it said "Unable to add button."
 */
export function LocalHandle(this: any, pvMem: number) {
  const heap = this.allocator.heapOf(this.machine.cpu.core.ds >> 3);

  if (!heap) {
    return pvMem & 2 ? 0 : pvMem;
  }

  return heap.handleOf(pvMem);
}
