'use strict';

/**
 * The handle of the local block in the current data segment that a pointer
 * points at, as KERNEL finds it (`KRNL386.EXE` seg1 `8d6a`,
 * `Heap.localHandle`): a value with bit 1 clear as it is, a fixed block's
 * pointer being its handle; one with it set, the word before it -- a
 * moveable block's handle, in its arena -- if that handle holds the value;
 * else NULL. **Recorded** by `lochand`. With no heap there, the value as it
 * is where bit 1 is clear, else NULL. Windows Help hands its macros'
 * buttons over by the handle of a block it holds only by its pointer:
 * answered NULL, it said "Unable to add button."
 */
export function LocalHandle(this: any, pvMem: number) {
  const heap = this.allocator.heapOf(this.machine.cpu.core.ds >> 3);

  if (!heap) {
    return pvMem & 2 ? 0 : pvMem;
  }

  return heap.localHandle(pvMem & 0xffff);
}
