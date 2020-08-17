"use strict";

/**
 * This class represents the memory space of the virtual machine.
 */
export class Memory {
    /**
     * Constructs a new memory.
     */
    constructor(options = {}) {
        // Create every possible segment.
        // They are not mapped to any actual memory.
        this._segments = new Array(8192);
    }

    /**
     * Retrieves the raw memory in segments.
     */
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
            let segment = this.segments[i];
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
     * Maps the given byte array to the given segment.
     *
     * This is used to load data into memory from our executables.
     *
     * It will append data to the end of the existing segment which is used to
     * provide allocations.
     *
     * @param {number} segment - The segment selector index.
     * @param {DataView} data - The byte data to append.
     * @param {Object} options - Access flags for the segment selector.
     */
    map(segment, data, options = {}) {
        this._segments[segment] = this._segments[segment] || {
          data: [],
          executable: options.executable || false,
          writable: options.writable || false
        };

        // Append the data to the end of the segment
        this._segments[segment].data.push(data);
    }

    /**
     * Appends an array of bytes set to zero to the given segment.
     *
     * @param {number} segment - The segment selector index.
     * @param {DataView} length - The number of zero bytes to append.
     * @param {Object} options - Access flags for the segment selector.
     */
    allocate(segment, length, options = {}) {
        let bytes = new Uint8Array(length);
        let view = new DataView(bytes.buffer);
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

    /**
     * Reads an integer value from our memory.
     *
     * @param {number} segment - The segment selector index.
     * @param {number} offset - The byte offset into the segment.
     * @param {number} length - The number of bytes to read (1 or 2).
     * @param {bool} signed - Whether or not to read it as a signed integer.
     * @param {bool} littleEndian - Whether or not to read as little endian.
     */
    read(segment, offset, length, signed = false, littleEndian = true) {
        let segmentArray = this._segments[segment];
        if (!segmentArray) {
            // Segmentation Fault
            return 0;
        }

        let position = 0;

        for (let i = 0; i < segmentArray.data.length; i++) {
            let bytes = segmentArray.data[i];
            if (offset < position + bytes.byteLength) {
                // Get relative position
                offset = offset - position;

                // Read value
                if (length == 1) {
                    if (signed) {
                        return bytes.getInt8(offset);
                    }
                    else {
                        return bytes.getUint8(offset);
                    }
                }
                else if (length == 2) {
                    if (signed) {
                        return bytes.getInt16(offset, littleEndian);
                    }
                    else {
                        return bytes.getUint16(offset, littleEndian);
                    }
                }
            }

            position += bytes.byteLength;
        }

        // Empty memory
        return 0;
    }

    /**
     * Reads a 8-bit value from memory.
     *
     * @param {number} segment - The segment selector index.
     * @param {number} offset - The byte offset into the segment.
     */
    read8(segment, offset) {
        return this.read(segment, offset, 1);
    }

    /**
     * Reads a 8-bit value from memory.
     *
     * @param {number} segment - The segment selector index.
     * @param {number} offset - The byte offset into the segment.
     */
    readSigned8(segment, offset) {
        return this.read(segment, offset, 1, true);
    }

    /**
     * Reads a 16-bit value from memory.
     *
     * @param {number} segment - The segment selector index.
     * @param {number} offset - The byte offset into the segment.
     * @param {bool} littleEndian - Whether or not to read as little endian.
     */
    read16(segment, offset, littleEndian = true) {
        return this.read(segment, offset, 2, false, littleEndian);
    }

    /**
     * Reads a 16-bit value from memory.
     *
     * @param {number} segment - The segment selector index.
     * @param {number} offset - The byte offset into the segment.
     * @param {bool} littleEndian - Whether or not to read as little endian.
     */
    readSigned16(segment, offset, littleEndian = true) {
        return this.read(segment, offset, 2, true, littleEndian);
    }

    /**
     * Reads the null terminated string at the given address.
     */
    readCString(segment, offset) {
        let ret = "";

        let limit = 0;
        let current = null;
        do {
            current = this.read8(segment, offset);
            if (current) {
                ret = ret + String.fromCharCode(current);
            }
            offset++;
            limit++;
        } while(limit < 1000 && current != 0);

        return ret;
    }

    /**
     * Writes an integer value to our memory.
     *
     * @param {number} segment - The segment selector index.
     * @param {number} offset - The byte offset into the segment.
     * @param {number} value - The integer value to write.
     * @param {number} length - The number of bytes to write (1 or 2).
     * @param {bool} littleEndian - Whether or not to write as little endian.
     */
    write(segment, offset, value, length, littleEndian = true) {
        let segmentArray = this._segments[segment];
        if (!segmentArray) {
            // Segmentation Fault
            return 0;
        }

        let position = 0;

        for (let i = 0; i < segmentArray.data.length; i++) {
            let bytes = segmentArray.data[i];
            if (offset < position + bytes.byteLength) {
                // Get relative position
                offset = offset - position;

                // Set value
                if (length == 1) {
                    value &= 0xff;
                    bytes.setUint8(offset, value);
                }
                else if (length == 2) {
                    value &= 0xffff;
                    bytes.setUint16(offset, value, littleEndian);
                }

                return value;
            }

            position += bytes.byteLength;
        };

        // Empty memory, hmm
        return 0;
    }

    /**
     * Writes a 8-bit value to memory.
     *
     * @param {number} segment - The segment selector index.
     * @param {number} offset - The byte offset into the segment.
     * @param {number} value - The integer value to write.
     */
    write8(segment, offset, value) {
        return this.write(segment, offset, value, 1);
    }

    /**
     * Writes a 16-bit value to memory.
     *
     * @param {number} segment - The segment selector index.
     * @param {number} offset - The byte offset into the segment.
     * @param {number} value - The integer value to write.
     * @param {bool} littleEndian - Whether or not to write as little endian.
     */
    write16(segment, offset, value, littleEndian = true) {
        return this.write(segment, offset, value, 2, littleEndian);
    }
}

export default Memory;
