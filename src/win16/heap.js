"use strict";

/**
 * This represents a heap within a section of memory.
 */
export class Heap {
    constructor(size) {
        // The size of the heap
        this._size = size;

        // By default, we set the segment/offset to 0.
        // A segment of 0 indicates the heap is not mapped into memory.
        this._segment = 0;
        this._offset = 0;

        // The address in memory this heap is located
        this._address = 0;

        // The number of handles we have allocated
        this._handleCount = 0;
        this._handles = {};

        // We will cheat and keep track of allocations in our own memory
        this._allocations = [];
    }

    get address() {
        return this._address;
    }

    set address(value) {
        this._address = value;
    }

    /**
     * Retains the segment where this heap is currently located in system
     * memory.
     */
    set segment(value) {
        this._segment = value;
    }

    /**
     * Returns the segment where this heap is currently located in system
     * memory. Or `0` if it is not mapped to system memory.
     */
    get segment() {
        return this._segment;
    }

    /**
     * Retains the offset where this heap is currently located in system
     * memory.
     */
    set offset(value) {
        this._offset = value;
    }

    /**
     * Returns the offset where this heap is currently located in system
     * memory.
     */
    get offset() {
        return this._offset;
    }

    /**
     * Returns the total size of the heap in bytes.
     */
    get byteLength() {
        return this._size;
    }

    /**
     * Returns the byte data for this heap.
     */
    get data() {
        return this._data;
    }

    /**
     * Retrieves the amount of bytes currently allocated to this heap.
     */
    get size() {
        let ret = 0;

        this._allocations.forEach( (allocation) => {
            let view = allocation[2];
            ret += view.byteLength;
        });

        return ret;
    }

    read(offset, length, signed = false, littleEndian = false) {
        for (let i = 0; i < this._allocations.length; i++) {
            let allocation = this._allocations[i];
            let chunkOffset = allocation[0] - this.offset;
            let size = allocation[1];

            if (offset >= chunkOffset && offset < (chunkOffset + size)) {
                // Get relative position within this allocation
                offset = offset - chunkOffset;

                // Get the allocation data
                let view = allocation[2];

                if (!view || (offset >= view.byteLength)) {
                    if (view) {
                        offset -= view.byteLength;
                    }
                    view = allocation[3];
                }

                // Read value
                if (length == 1) {
                    if (signed) {
                        return view.getInt8(offset);
                    }
                    else {
                        return view.getUint8(offset);
                    }
                }
                else if (length == 2) {
                    if (signed) {
                        return view.getInt16(offset, littleEndian);
                    }
                    else {
                        return view.getUint16(offset, littleEndian);
                    }
                }
                else if (length == 4) {
                    if (signed) {
                        return view.getInt32(offset, littleEndian);
                    }
                    else {
                        return view.getUint32(offset, littleEndian);
                    }
                }
            }
            else if (offset < chunkOffset) {
                // Allocations are ordered by address
                // So, let's bail
                break;
            }
        }

        // Empty memory, which is fine
        return 0;
    }

    /**
     * Returns the unsigned 8-bit value at the given offset within the heap.
     */
    getUint8(offset) {
        return this.read(offset, 1, false);
    }

    /**
     * Returns the signed 8-bit value at the given offset within the heap.
     */
    getInt8(offset) {
        return this.read(offset, 1, true);
    }

    /**
     * Returns the unsigned 16-bit value at the given offset within the heap.
     */
    getUint16(offset, littleEndian = false) {
        return this.read(offset, 2, false, littleEndian);
    }

    /**
     * Returns the signed 16-bit value at the given offset within the heap.
     */
    getInt16(offset, littleEndian = false) {
        return this.read(offset, 2, true, littleEndian);
    }

    /**
     * Returns the unsigned 32-bit value at the given offset within the heap.
     */
    getUint32(offset, littleEndian = false) {
        return this.read(offset, 4, false, littleEndian);
    }

    /**
     * Returns the signed 32-bit value at the given offset within the heap.
     */
    getInt32(offset, littleEndian = false) {
        return this.read(offset, 4, true, littleEndian);
    }

    write(offset, value, length, signed = false, littleEndian = false) {
        for (let i = 0; i < this._allocations.length; i++) {
            let allocation = this._allocations[i];
            let address = allocation[0] - this._offset;
            let size = allocation[1];

            if (offset >= address && offset < (address + size)) {
                // Get relative position within this allocation
                offset = offset - address;

                // Get the allocation data
                let view = allocation[2];

                if (!view || offset >= view.byteLength) {
                    if (view) {
                        offset -= view.byteLength;
                    }
                    view = allocation[3];
                }

                // Read value
                if (length == 1) {
                    if (signed) {
                        return view.setInt8(offset, value);
                    }
                    else {
                        return view.setUint8(offset, value);
                    }
                }
                else if (length == 2) {
                    if (signed) {
                        return view.setInt16(offset, value, littleEndian);
                    }
                    else {
                        return view.setUint16(offset, value, littleEndian);
                    }
                }
            }
            else if (offset < address) {
                // Allocations are ordered by address
                // So, let's return 0
                return 0;
            }
        }

        // Empty memory, which is fine, we can ignore the write, hopefully.
        return 0;
    }

    /**
     * Writes an unsigned 8-bit value at the given offset within the heap.
     */
    setUint8(offset, value) {
        return this.write(offset, value, 1, false);
    }

    /**
     * Sets a signed 8-bit value at the given offset within the heap.
     */
    setInt8(offset, value) {
        return this.write(offset, value, 1, true);
    }

    /**
     * Sets an unsigned 16-bit value at the given offset within the heap.
     */
    setUint16(offset, value, littleEndian = false) {
        return this.write(offset, value, 2, false, littleEndian);
    }

    /**
     * Sets a signed 16-bit value at the given offset within the heap.
     */
    setInt16(offset, value, littleEndian = false) {
        return this.write(offset, value, 2, true, littleEndian);
    }

    /**
     * Sets an unsigned 32-bit value at the given offset within the heap.
     */
    setUint32(offset, value, littleEndian = false) {
        return this.write(offset, value, 4, false, littleEndian);
    }

    /**
     * Sets a signed 32-bit value at the given offset within the heap.
     */
    setInt32(offset, value, littleEndian = false) {
        return this.write(offset, value, 4, true, littleEndian);
    }

    /**
     * Makes an allocation of an existing chunk of memory.
     *
     * Returns the address or handle.
     */
    insert(view, options = {}) {
        let size = view.byteLength;

        if (size == 0) {
            return null;
        }

        // Find a place to allocate within the heap.
        // We want 2 more bytes to write the size
        let searchSize = size + 2;
        let address = this.find(searchSize);
        if (address == 0) {
            console.log("Local heap: out of memory attempting to allocate", searchSize);
            throw "Out of Memory";
        }

        view.heap = this;

        // Create the metadata chunk
        let sizeData = new Uint8Array(2);
        let sizeView = new DataView(sizeData.buffer);

        // Retain the allocation
        this._allocations.push([address, searchSize, sizeView, view]);
        this._allocations.sort( (a, b) => { a[0] - b[0] });

        // Write the size and increment the address by 2
        sizeView.setUint16(0, size, true);
        address += 2;

        // Allocate (and a handle, if movable)
        let handle = false;
        if (options.movable) {
            handle = this.allocateHandle();

            // Write the address to the handle
            this.setUint16(handle - this._offset, address, true);

            view.handle = handle;
        }

        // Return a pointer to the new allocated space or handle
        if (handle) {
            return handle;
        }

        view.segment = this.segment;
        view.offset = address;

        // Return the address of the usable, allocated space
        return address;
    }

    /**
     * Makes a local allocation to the heap within the given segment.
     */
    allocate(size, options = {}) {
        if (size == 0) {
            return null;
        }

        // Create the data
        let data = new Uint8Array(size);
        let view = new DataView(data.buffer);

        return this.insert(view);
    }

    allocateHandle() {
        // Find 2 bytes of free space for the handle.
        let ret = this.find(2);

        // Create the data
        let data = new Uint8Array(2);
        let view = new DataView(data.buffer);

        // Keep track of the allocation
        this._allocations.push([ret, 2, null, view]);
        this._allocations.sort( (a, b) => { a[0] - b[0] });

        // Keep track that this address is a handle
        this._handles[ret] = true;

        // Return the address
        return ret;
    }

    /**
     * Frees the allocated chunk for the given address.
     */
    free(address) {
        // If it is a handle, we need to call free for the address the handle
        // points to. And then deallocate the handle itself.
        if (this._handles[address]) {
            let pointer = this.getUint16(handle - this._offset, true);
            delete this._handles[address];
            this.free(pointer);
        }
        else {
            // If it is not a handle, get to the actual starting point
            address -= 2;
        }

        // TODO: this can be a binary search
        for (let i = 0; i < this._allocations.length; i++) {
            let item = this._allocations[i];
            if (item[0] == address) {
                this._allocations.splice(i, 1);
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
        space = (this.byteLength + this._offset) - last;

        if (space >= size) {
            // We can fit in the remaining space
            return last;
        }

        // Could not fit!
        return 0;
    }

    /**
     * Moves movable sections of memory to create free space.
     */
    defragment() {
    }
}

export default Heap;
