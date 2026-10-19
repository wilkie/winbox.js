'use strict';

import { TRUE, FALSE } from '../consts.js';
import { Heap } from '../heap.js';

/**
 * The **LocalInit** function initializes a local heap in the specified segment.
 *
 * The first 16 bytes of the segment containing a local heap must be reserved
 * for use by the system.
 *
 * **See also**:
 * {@link Kernel.GlobalLock GlobalLock}
 * {@link Kernel.LocalAlloc LocalAlloc}
 * {@link Kernel.LocalReAlloc LocalReAlloc}
 *
 * @static
 * @function LocalInit
 * @memberof Kernel
 *
 * @param {Types.UINT} uSegment - Identifies the segment that is to contain the
 *                                local heap.
 * @param {Types.UINT} uStartAddr - Specifies the starting address of the local
 *                                  heap within the segment.
 * @param {Types.UINT} uEndAddr - Specifies the ending address of the local heap
 *                                within the segment.
 *
 * @returns {Types.BOOL} The return value is nonzero if the function is
 *                       successful. Otherwise it is zero.
 */
export function LocalInit(uSegment, uStartAddr, uEndAddr) {
  this.debug('LocalInit:', uSegment, uStartAddr, uEndAddr);

  /* The segment is a selector, as a program has one -- a library's entry
   * point passes its DS -- or nought for the current DS; the heap is kept by
   * the descriptor's index. Taken as an index before, a library's heap was
   * made for a segment nobody used, and its `LocalAlloc` answered nothing. */
  uSegment = (uSegment || this.machine.cpu.core.ds) >> 3;

  /* A start of nought puts the heap at the end of the segment, as big as
   * the end says, ending a byte short of the segment's size -- a size of
   * 64K or more counting as FFFFh (`KRNL386.EXE` seg2 `28c7`). A library's
   * entry point asks for its heap this way. */
  if (uStartAddr === 0) {
    const size = Math.min(this.allocator.sizeOf(uSegment) || 0x10000, 0xffff);

    uStartAddr = size - 1 - uEndAddr;
    uEndAddr = size - 1;
  }

  // Get the selector index
  const segment = uSegment;

  // If the heap is already allocated, we fail out
  if (this.allocator.heapOf(segment)) {
    return FALSE;
  }

  /* KERNEL's arenas laid from the start to the end (`Heap.layout`): the
   * blocks go between the free block and the last arena. */
  const layout = Heap.layout(uStartAddr, uEndAddr);

  if (!layout) {
    return FALSE;
  }

  const heap = this.allocator.heapInitialize(segment, layout.free, layout.last - layout.free);

  if (heap) {
    /* A heap in a block of `GlobalAlloc`'s grows too, the block with it,
     * fixed or moveable, as the Visual Basic runtime's does (`lheapseg`). */
    const block = this.allocator._objects?.[segment];

    /* Its growth goes by the segment's size, `GlobalSize`'s, for a block of
     * `GlobalAlloc`'s; a data segment's is not kept, and the heap's end
     * stands for it (`Heap.segmentSize`). */
    heap.segmentSize = block ? block.size : uEndAddr + 1;

    if (this._growable?.has(segment)) {
      heap.growable = true;
    }

    if (block) {
      heap.growable = true;
      heap.onGrow = (end: number) => {
        if (end > block.size) {
          this.allocator.resize(segment, end);
        }
      };
    }

    return TRUE;
  }

  return FALSE;
}
