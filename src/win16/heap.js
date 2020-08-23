"use strict";

/**
 * This represents a heap within a section of memory.
 */
export class Heap {
    constructor(data, offset) {
        // The data is already connected to Memory.
        // Our job is to subdivide it.
        this._data = data;
        this._offset = offset;

        // The number of handles we have allocated
        this._handleCount = 0;

        // We will cheat and keep track of allocations in our own memory
        this._allocations = [];

        console.log("allocated heap of size", data.byteLength);
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
        // We want 2 more bytes to write the size
        let searchSize = size + 2;
        let address = this.find(searchSize);
        console.log("allocated chunk", address);

        this._allocations.push([address, searchSize]);
        this._allocations.sort( (a, b) => { a[0] - b[0] });

        // Write the size and increment the address by 2
        this._data.setUint16(address - this._offset, size, true);
        address += 2;

        // Allocate (and a handle, if movable)
        let handle = false;
        if (options.movable) {
            handle = this.allocateHandle();
            console.log("allocated handle", handle);

            // Write the address to the handle
            this._data.setUint16(handle - this._offset, address, true);
        }

        // Return a pointer to the new allocated space or handle
        if (handle) {
            return handle;
        }

        return address;
    }

    allocateHandle() {
        // Find 2 bytes of free space for the handle.
        let ret = this.find(2);
        this._allocations.push([ret, 2]);
        this._allocations.sort( (a, b) => { a[0] - b[0] });
    }

    /**
     * Frees the allocated chunk for the given address.
     */
    free(address) {
        // If it is not a handle, get to the actual starting point
        address -= 2;

        // TODO: this can be a binary search
        for (let i = 0; i < this._allocations.length; i++) {
            let item = this._allocations[i];
            if (item[0] == address) {
                delete item[0];
                return;
            }
        }
    }

    /**
     * Finds space within the heap to fit the requested size.
     */
    find(size) {
        // Go through allocations and find one that matches
        let last = this._offset;
        let space = 0;
        for (let i = 0; i < this._allocations.length; i++) {
            let item = this._allocations[i];

            // Calculate the space inbetween the two adjacent allocations
            space = item[0] - last;

            if (space >= size) {
                // If it fits, we sit
                return last;
            }

            // Set last to the address at the end of this allocated chunk
            last = item[0] + item[1];
        }

        // Get the remaining space in the heap
        space = (this.size + this._offset) - last;

        if (space >= size) {
            // We can fit in the remaining space
            return last;
        }

        return 0;
    }

    /**
     * Moves movable sections of memory to create free space.
     */
    defragment() {
    }
}

export default Heap;
