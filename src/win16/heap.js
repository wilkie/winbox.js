"use strict";

export class Heap {
    constructor(data) {
        this._data = data;
    }

    /**
     * Returns the byte data for this heap.
     */
    get data() {
        return this._data;
    }

    /**
     * Retrieves the size of this heap.
     */
    get size() {
        return this._data.byteLength;
    }

    /**
     * Makes a local allocation to the heap within the given segment.
     */
    allocate(size, options = {}) {
        if (size == 0) {
            return null;
        }

        // Find a place to allocate within the heap.

        // Allocate (and a handle, if movable)

        // Return a pointer to the new allocated space
    }
}

export default Heap;
