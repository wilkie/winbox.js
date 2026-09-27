'use strict';

const LMEM_MOVEABLE = 0x0002;
const LMEM_MODIFY = 0x0080;
const LMEM_ZEROINIT = 0x0040;

/**
 * A local block made another size (`Heap.reallocate`): a moveable block keeps
 * its handle, and a fixed one moves only with `LMEM_MOVEABLE`. With
 * `LMEM_MODIFY`, only the block's flags change, which are not kept, so the
 * block is answered as it is. NULL when there is no room.
 */
export function LocalReAlloc(this: any, hloc: number, fuNewSize: number, fuFlags: number) {
  const heap = this.allocator.heapOf(this.machine.cpu.core.ds >> 3);

  if (!heap || !hloc) {
    return 0;
  }

  if (fuFlags & LMEM_MODIFY) {
    return hloc;
  }

  return (
    heap.reallocate(
      hloc,
      fuNewSize & 0xffff,
      !!(fuFlags & LMEM_MOVEABLE),
      !!(fuFlags & LMEM_ZEROINIT)
    ) ?? 0
  );
}
