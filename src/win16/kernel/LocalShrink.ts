'use strict';

import { indexFor } from '../selectors.js';

/**
 * Shrinks a local heap as far as what is in it allows, as KERNEL does it
 * (`KRNL386.EXE` seg1 `8db0`, `9093`; `Heap.localShrink`): its blocks
 * compacted, its discardable ones discarded, blocks from its top moved into
 * free blocks below, and its end brought down to the last block, no lower
 * than the size asked or the span `LocalInit` gave it. It answers the
 * heap's span, from its first arena to past its last, which is not what
 * `LocalCompact` answers -- **recorded** by `minis3` for the caller's own
 * heap. A segment of nought is the caller's data segment.
 *
 * @param {Types.HANDLE} hSeg - The heap's segment, or nought for the caller's.
 * @param {Types.UINT} wSize - The size wanted.
 *
 * @returns {Types.UINT} The heap's span, or nought for no heap.
 */
export function LocalShrink(this: any, hSeg: number, wSize: number) {
  const segment = hSeg & 0xffff || this.machine.cpu.core.ds;
  const heap = this.allocator?.heapOf?.(indexFor(segment));

  return heap ? heap.localShrink(wSize & 0xffff) : 0;
}
