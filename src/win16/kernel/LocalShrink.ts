'use strict';

import { indexFor } from '../selectors.js';

/**
 * Shrinks a local heap as far as what is in it allows. **Read out of
 * `KRNL386.EXE`**: it answers the heap's span, from its first arena to past
 * its last, which is not what `LocalCompact` answers -- **recorded** by
 * `minis3` for the caller's own heap. A segment of nought is the caller's
 * data segment.
 *
 * winbox.js's local heaps do not shrink; it answers the heap's size.
 *
 * @param {Types.HANDLE} hSeg - The heap's segment, or nought for the caller's.
 * @param {Types.UINT} wSize - The size wanted.
 *
 * @returns {Types.UINT} The heap's size, or nought for no heap.
 */
export function LocalShrink(this: any, hSeg: number, _wSize: number) {
  const segment = hSeg & 0xffff || this.machine.cpu.core.ds;
  const heap = this.allocator?.heapOf?.(indexFor(segment));

  return heap ? heap.byteLength & 0xffff : 0;
}
