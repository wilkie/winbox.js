'use strict';

/**
 * A local block made another size, or its flags changed, as KERNEL does it
 * (`KRNL386.EXE` seg1 `8b4b`, `Heap.localReAlloc`): a block that shrinks
 * or has room after it stays where it is; any other moves, a fixed one only
 * with `LMEM_MOVEABLE`; nought with `LMEM_MOVEABLE` discards a moveable
 * block; `LMEM_MODIFY` sets a handle's discard level. **Recorded** by
 * `localre`. NULL when there is no room, or no heap.
 */
export function LocalReAlloc(this: any, hloc: number, fuNewSize: number, fuFlags: number) {
  const heap = this.allocator.heapOf(this.machine.cpu.core.ds >> 3);

  if (!heap) {
    return 0;
  }

  return heap.localReAlloc(hloc & 0xffff, fuNewSize & 0xffff, fuFlags & 0xffff);
}
