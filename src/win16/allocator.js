"use strict";

import { Heap } from './heap.js';

/**
 * Manages heap memory for the system.
 */
export class Allocator {
    /**
     * Constructs a new allocation manager for the given memory.
     */
    constructor(memory, options = {}) {
        this._memory = memory;

        // Keep track of the local allocators
        this._heaps = {};
    }

    /**
     * Retrieves the memory associated with this allocator.
     */
    get memory() {
        return this._memory;
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
        let selectorCount = (size + 0xffff) >> 16;

        // For each selector we are allocating, create the memory data
        // And then also map it into our machine memory.
        let nextSelector = this.memory.findFirstFree(selectorCount, 100);
        if (nextSelector < 0) {
            return null;
        }

        for (var i = nextSelector; i < nextSelector + selectorCount; i++) {
            let amount = size;
            if (amount > 0xffff) {
                amount = 0x10000;
            }
            size -= amount;
            this.memory.allocate(i, amount, options);
        }

        return nextSelector;
    }

    /**
     * Allocates a section of a selector to form a local heap.
     *
     * @param {number} segment - The segment selector index.
     * @param {number} start - The starting byte of that segment for the heap.
     * @param {number} size - The maximum size of this heap.
     */
    heapInitialize(segment, start, size) {
        // We cannot create a heap if this segment already has one
        if (this._heaps[segment]) {
            console.log("segment already has a heap allocated");
            return null;
        }

        // The size has to fit
        if (start + size > 0xffff) {
            console.log("requested heap size does not fit", size);
            return null;
        }

        let segmentSize = this.memory.sizeOf(segment);

        // We need to allocate some space to memory to pad to the heap.
        if (segmentSize < start) {
            this.memory.allocate(segment, start - segmentSize);
        }
        else if (segmentSize > start) {
            throw "Overlapping heap and data segment???"
            return null;
        }

        // Let us create our heap
        let bytes = new Uint8Array(size);
        let view = new DataView(bytes.buffer);

        // Now we can append the heap data
        this.memory.allocate(segment, size);

        // And keep track of it
        this._heaps[segment] = new Heap(view, start);

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
