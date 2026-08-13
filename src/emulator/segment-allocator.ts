export class SegmentAllocator {
    declare _memory: any;
    declare _segments: any;
    constructor(memory, options: any = {}) {
        this._memory = memory;

        // Allocate all possible segments
        this._segments = new Array(8192);
    }

    get segments() {
        return this._segments;
    }

    /**
     * Determines the next selector (from a given index) is free.
     *
     * This will find the first segment selector that will accommodate the given
     * number of segments requested by size. It will return -1 when it is not
     * possible.
     *
     * @param {number} size - The number of continuous segments to find.
     * @param {number} start - The index to start from when searching.
     *
     * @return {number} The index of the next free selector or -1 if none.
     */
    findFirstFree(size = 1, start = 0) {
        let ret = -1;
        for (let i = start; i < this.segments.length; i++) {
            const segment = this.segments[i];
            if (segment === undefined) {
                // Make sure we can fit every entry
                let j = i + 1;
                for ( ; j < i + size && j < this.segments.length; j++) {
                    if (this.segments[j] !== undefined) {
                        break;
                    }
                }

                if (j == (i + size)) {
                    ret = i;
                    break;
                }
                else {
                    // We know we can skip ahead of 'j' since j is filled
                    i = j + 1;
                }
            }
        }

        return ret;
    }

    /**
     * Maps the given byte array to the given offset.
     *
     * This is used to load data into memory from our executables.
     *
     * It will append data to the end of the existing span which is used to
     * provide allocations.
     *
     * It will also set the 'segment' and 'offset' property on the given data
     * object to the assigned segment and its byte offset within that segment.
     *
     * @param {number} segment - The segment selector index.
     * @param {DataView} data - The byte data to append.
     * @param {Object} options - Access flags for the segment selector.
     */
    map(segment, data, options: any = {}) {
        this._segments[segment] = this._segments[segment] || {
          data: [],
          executable: options.executable || false,
          writable: options.writable || false
        };

        // Remember the position of this data
        data.segment = segment;
        data.offset = this.sizeOf(segment);

        // Append the data to the end of the segment
        this._segments[segment].data.push(data);

        this._memory.map((segment << 16) + data.offset, data);
    }

    /**
     * Appends an array of bytes set to zero to the given segment.
     *
     * @param {number} segment - The segment selector index.
     * @param {DataView} length - The number of zero bytes to append.
     * @param {Object} options - Access flags for the segment selector.
     */
    allocate(segment, length, options: any = {}) {
        const bytes = new Uint8Array(length);
        const view = new DataView(bytes.buffer);
        return this.map(segment, view, options);
    }

    /**
     * Unmaps and frees the data at the given segment.
     *
     * @param {number} segment - The segment selector index.
     */
    free(segment) {
        delete this._segments[segment];
    }

    /**
     * Returns the number of bytes allocated to the given segment.
     *
     * @param {number} segment - The segment selector index to query.
     * 
     * @return {number} The size in bytes of mapped in data for this segment.
     */
    sizeOf(segment) {
        let ret = 0;

        (this._segments[segment] || {data: []}).data.forEach( (mapping) => {
            ret += mapping.byteLength;
        });

        return ret;
    }

}

export default SegmentAllocator;
