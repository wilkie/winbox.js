'use strict';

import { Heap } from './heap.js';

/**
 * Manages heap memory for the system.
 */
export class Allocator {
  declare _globalAllocator: any;
  declare _heaps: any;
  declare _memory: any;
  declare _objects: any;
  /**
   * Constructs a new allocation manager for the given memory.
   */
  constructor(memory, globalAllocator, options = {}) {
    this._memory = memory;
    this._globalAllocator = globalAllocator;

    // Keep track of the local allocators
    this._heaps = {};

    // Keep track of global memory objects
    this._objects = {};
  }

  /**
   * Retrieves the memory associated with this allocator.
   */
  get memory() {
    return this._memory;
  }

  /**
   * Retrieves the global allocator associated with this allocator.
   */
  get globalAllocator() {
    return this._globalAllocator;
  }

  /**
   * Allocates a set of memory selectors to accommodate the given size.
   *
   * @param {number} size - The number of bytes to allocate.
   *
   * @return {number} - The segment selector index or null on error.
   */
  allocate(size, options = {}) {
    if (size < 0) {
      return null;
    }

    /* A request for nothing is legal and gets a real handle back, whose size
     * reports as zero -- it is how software reserves a handle without
     * committing memory to it, which matters most for discardable blocks. It
     * still costs a selector. Recorded from Windows in
     * oracle/fixtures/memory.json.
     */
    size = size === 0 ? 0 : (size + 0x1f) & ~0x1f;

    // Determine how many selectors we need to allocate
    const selectorCount = Math.max(1, (size + 0xffff) >> 16);

    // For each selector we are allocating, create the memory data
    // And then also map it into our machine memory.
    const nextSelector = this.globalAllocator.find(100, selectorCount);
    if (nextSelector < 0) {
      return null;
    }

    /* What was asked for, and how much room it was given. The selector count
     * is kept because a later `GlobalReAlloc` needs to know whether a bigger
     * size still fits where the block already is.
     */
    this._objects[nextSelector] = {
      size: size,
      selectors: selectorCount,
      flags: (options as any).flags ?? 0,
    };

    // Map it in
    for (let i = nextSelector; i < nextSelector + selectorCount; i++) {
      const amount = Math.min(size, 0x10000);
      size -= amount;
      const bytes = new Uint8Array(amount);
      const view = new DataView(bytes.buffer);
      this.globalAllocator.map(i, view);
    }

    return nextSelector;
  }

  free(handle) {
    return true;
  }

  sizeOf(handle) {
    if (this._objects[handle]) {
      return this._objects[handle].size;
    }

    return 0;
  }

  /**
   * The allocation flags an object was made with.
   *
   * @param {number} index - The descriptor index of the object.
   * @returns {number} The flags, or zero if there is no such object.
   */
  flagsOf(index) {
    return this._objects[index]?.flags ?? 0;
  }

  /**
   * Changes the size of an existing allocation, in place.
   *
   * A descriptor here covers the whole 64 KiB its selector can address and the
   * mapping is one to one, so a block that still fits behind the selectors it
   * already has does not move and does not need its descriptor touched --
   * which is why real Windows hands back the same handle and the same address
   * for a block grown four times over. Only the bookkeeping changes.
   *
   * @param {number} index - The descriptor index of the object.
   * @param {number} size - The new size in bytes.
   * @returns {boolean} Whether the object could be resized where it stands.
   */
  resize(index, size) {
    const object = this._objects[index];

    if (!object || size < 0) {
      return false;
    }

    size = size === 0 ? 0 : (size + 0x1f) & ~0x1f;

    /* Growing past the selectors it was given would mean moving it, and what
     * Windows does in that case has not been measured.
     */
    if (Math.max(1, (size + 0xffff) >> 16) > object.selectors) {
      return false;
    }

    object.size = size;

    return true;
  }

  /**
   * Allocates a section of an allocated segment to form a local heap.
   *
   * @param {number} segment - The segment selector index.
   * @param {number} start - The starting byte of that segment for the heap.
   * @param {number} size - The maximum size of this heap.
   */
  heapInitialize(segment, start, size) {
    // We cannot create a heap if this segment already has one
    if (this._heaps[segment]) {
      console.log('segment already has a heap allocated');
      return null;
    }

    // The size has to fit
    if (start + size > 0xffff) {
      console.log('requested heap size does not fit', size);
      return null;
    }

    /*
        let segmentSize = this.memory.sizeOf(segment);

        // We need to allocate some space to memory to pad to the heap.
        if (segmentSize < start) {
            this.memory.allocate(segment, start - segmentSize);
        }
        else if (segmentSize > start) {
            throw "Overlapping heap and data segment???"
            return null;
        }*/

    // Let us create our heap, which brings its own storage with it
    const heap = new Heap(size);
    this._heaps[segment] = heap;
    heap.segment = segment;
    heap.offset = start;

    // Return the heap instance
    return this._heaps[segment];
  }

  /**
   * Retrieves the heap data and metadata for the given segment.
   *
   * @param {number} segment - The segment selector index.
   *
   * @return {Object} The heap metadata.
   */
  heapOf(segment) {
    return this._heaps[segment];
  }
}

export default Allocator;
