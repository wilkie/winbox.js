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
    // Do not allocate if the size is 0 or negative.
    if (size <= 0) {
      return null;
    }

    // Align the bytes requested to at least 32 bytes
    size = (size + 0x1f) & ~0x1f;

    // Determine how many selectors we need to allocate
    const selectorCount = (size + 0xffff) >> 16;

    // For each selector we are allocating, create the memory data
    // And then also map it into our machine memory.
    const nextSelector = this.globalAllocator.find(100, selectorCount);
    if (nextSelector < 0) {
      return null;
    }

    // Record the memory object
    this._objects[nextSelector] = {
      size: size,
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

    // Let us create our heap
    const bytes = new Uint8Array(size);
    const view = new DataView(bytes.buffer);

    // And keep track of it
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
