'use strict';

import { Heap } from './heap.js';

/**
 * Manages heap memory for the system.
 */
/** The first selector a block is given. */
const FIRST_SELECTOR = 100;

export class Allocator {
  declare _globalAllocator: any;
  declare _heaps: any;
  declare _memory: any;
  declare _objects: any;
  /**
   * Constructs a new allocation manager for the given memory.
   */
  constructor(memory, globalAllocator, _options = {}) {
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
    /* A block of one selector takes the selector freed last, as Windows'
     * does: **recorded** by `greuse`, a block allocated after a free has the
     * freed one's selector, and three freed come back last first. A block's
     * bytes are its own once given (`grealloc`, `lzero`), whatever the
     * selector held before. */
    let nextSelector = selectorCount === 1 ? this.#reused() : -1;

    if (nextSelector < 0) {
      nextSelector = this.globalAllocator.find(FIRST_SELECTOR, selectorCount);
    }

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
      const bytes = new Uint8Array(amount);
      const view = new DataView(bytes.buffer);
      this.globalAllocator.map(i, view);
      size -= amount;
    }

    this.#setLimits(nextSelector);

    return nextSelector;
  }

  /** Selectors freed, the last on top. */
  #freed: number[] = [];

  /** The selector freed last that is free still, or -1. */
  #reused() {
    while (this.#freed.length) {
      const selector = this.#freed.pop()!;

      if (!this.globalAllocator._usedMap[selector]) {
        return selector;
      }
    }

    return -1;
  }

  /**
   * A block's selectors' limits: the first reaches the whole block, its size
   * rounded to 32 bytes less one -- recorded by `selinfo` -- and each after it
   * what is left from there (documented). A block of nothing keeps 64 KiB.
   */
  #setLimits(index) {
    const object = this._objects[index];

    if (!object || !object.size) {
      return;
    }

    for (let tile = 0; tile < object.selectors; tile++) {
      const left = object.size - tile * 0x10000;

      this.globalAllocator.setLimit(index + tile, Math.max(0, left) - 1);
    }
  }

  /**
   * A block freed: its selectors' descriptors emptied, and free to be given
   * again (see `GlobalAllocator.release`). **Recorded** by `gcycle`: a block
   * allocated and freed 20,000 times over never fails. Emptied but kept, as
   * they once were, the selectors ran out after a few thousand blocks, and
   * SimTower with them.
   */
  free(handle) {
    const object = this._objects[handle];

    if (object) {
      /* What was kept for each selector goes with it -- a local heap made in
       * the block, a handler its bytes were given to -- or the next block
       * given the selector finds it (`lheapseg`: a heap made in a block
       * found the last one's, and `LocalInit` refused it). */
      for (let tile = 0; tile < object.selectors; tile++) {
        this.globalAllocator.release(handle + tile);
        this.#freed.push(handle + tile);
        delete this._heaps[handle + tile];
        this._memory.unmapHandler(handle + tile);
      }

      delete this._objects[handle];
    }

    return true;
  }

  sizeOf(handle) {
    if (this._objects[handle]) {
      return this._objects[handle].size;
    }

    return (this as any)._segmentSizes?.[handle] ?? 0;
  }

  /**
   * The size of a segment a module was loaded into, as `GlobalSize` answers
   * it: KERNEL's allocation for it rather than the file's bytes. See
   * `library.ts`.
   */
  setSegmentSize(index, size) {
    (this as any)._segmentSizes ??= {};
    (this as any)._segmentSizes[index] = size;
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
  /**
   * Discards a moveable block: its handle stays, standing for nothing, until
   * it is given a size again (documented).
   */
  discard(index) {
    const object = this._objects[index];

    if (!object) {
      return false;
    }

    object.size = 0;
    object.discarded = true;

    return true;
  }

  /** A block's discardable flag set or cleared, as `GMEM_MODIFY` does. */
  modify(index, discardable) {
    const object = this._objects[index];

    if (!object) {
      return false;
    }

    object.flags = discardable ? (object.flags ?? 0) | 0x0100 : (object.flags ?? 0) & ~0x0100;

    return true;
  }

  /** Whether a block is discarded. */
  isDiscarded(index) {
    return !!this._objects[index]?.discarded;
  }

  resize(index, size) {
    const object = this._objects[index];

    /* A segment a module was loaded into grows or shrinks within the 64 KiB
     * its selector reaches, as any block does: a Visual Basic program grows
     * its data segment as it starts. */
    if (!object && (this as any)._segmentSizes?.[index] !== undefined) {
      if (size < 0 || size > 0x10000) {
        return false;
      }

      (this as any)._segmentSizes[index] = size === 0 ? 0 : (size + 0x1f) & ~0x1f;
      return index;
    }

    if (!object || size < 0) {
      return false;
    }

    object.discarded = false;

    size = size === 0 ? 0 : (size + 0x1f) & ~0x1f;

    const selectors = Math.max(1, (size + 0xffff) >> 16);

    /* Growing past the selectors it was given moves it: a block with
     * selectors enough, the contents copied, the old selectors let go, and
     * its index answered, for a handle of its own -- locked or fixed alike
     * (`grow`). */
    if (selectors > object.selectors) {
      return this.#move(index, size);
    }

    /* Shrinking gives up the selectors it no longer reaches. */
    for (let tile = selectors; tile < object.selectors; tile++) {
      this.globalAllocator.unmap(index + tile);
    }

    object.selectors = selectors;
    object.size = size;
    this.#setLimits(index);

    return index;
  }

  /** A block moved to new selectors, `size` bytes: its new index, or false. */
  #move(index: number, size: number) {
    const object = this._objects[index];
    const moved = this.allocate(size, { flags: object.flags });

    if (moved === null || moved < 0) {
      return false;
    }

    const memory = this.globalAllocator.memory;
    const kept = Math.min(object.size, size);

    for (let at = 0; at < kept; at += 0x10000) {
      const length = Math.min(0x10000, kept - at);
      const bytes = memory.read((index << 16) + at, length);

      memory.write((moved << 16) + at, new DataView(bytes));
    }

    this._objects[moved].discarded = false;
    this.free(index);

    return moved;
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
    heap.mirror = { memory: this._memory, base: segment << 16 };

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
