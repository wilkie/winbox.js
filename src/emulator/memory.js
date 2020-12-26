"use strict";

/**
 * This class represents the memory space of the virtual machine.
 */
export class Memory {
    /**
     * Constructs a new memory.
     */
    constructor(options = {}) {
        // Memory is a set of DataView chunks.
        // The DataView has an 'address' property depicting where it was placed.
        this._chunks = [];
    }

    /**
     * Retrieves the raw memory in chunks.
     */
    get chunks() {
        return this._chunks;
    }

    /**
     * Maps the given byte array to the given offset.
     *
     * This is used to load data into memory from our executables.
     *
     * It will append data to the end of the existing span which is used to
     * provide allocations.
     *
     * It will also set the 'address' property on the given data object to the
     * assigned address, which is the byte offset within memory it resides.
     *
     * @param {number} address - The address to map the data to within memory.
     * @param {DataView} data - The byte data to append.
     * @param {Object} options - Access flags for the chunk.
     */
    map(address, data, options = {}) {
        var i = this._find(address);

        // Append the chunk at chunks[i]
        data.address = address;
        this.chunks.splice(i, 0, data);

        return data;
    }

    /**
     * Appends an array of bytes set to zero to the given segment.
     *
     * @param {number} address - The address to map the data to within memory.
     * @param {DataView} length - The number of zero bytes to append.
     * @param {Object} options - Access flags for the segment selector.
     */
    allocate(address, length, options = {}) {
        let bytes = new Uint8Array(length);
        let view = new DataView(bytes.buffer);
        return this.map(address, view, options);
    }

    /**
     * Returns the chunk index for the given address.
     *
     * @return {number} The index of the chunk within the chunks array.
     */
    _find(address) {
        var i = 0;
        for ( ; i < this.chunks.length; i++) {
            let chunk = this.chunks[i];
            if (chunk.address + chunk.byteLength > address) {
                break;
            }
        }

        return i;
    }

    /**
     * Unmaps and frees the data at the given address.
     *
     * @param {number} address - The address of the chunk to free.
     *
     * @return {DataView} The DataView representing the freed chunk, or null.
     */
    free(address) {
        var i = this._find(address);
        var ret = null;

        if (i < this.chunks.length) {
            ret = this.chunks[i];
            this.chunks.splice(i, 1)
        }

        return ret;
    }

    /**
     * Returns the number of bytes allocated to the given chunk.
     *
     * @param {number} address - The chunk address to query.
     * 
     * @return {number} The size in bytes of mapped in data for this segment.
     */
    sizeOf(address) {
        var i = this._find(address);
        let ret = 0;

        if (i < this.chunks.length) {
            ret = this.chunks[i].byteLength;
        }

        return ret;
    }

    /**
     * Reads an integer value from our memory.
     *
     * @param {number} address - The address to read from.
     * @param {number} length - The number of bytes to read (1, 2, 4, etc).
     * @param {bool} signed - Whether or not to read it as a signed integer.
     * @param {bool} littleEndian - Whether or not to read as little endian.
     */
    read(address, length, signed = false, littleEndian = true) {
        // Find the first chunk
        var i = this._find(address);

        let ret = 0;

        if (i >= this.chunks.length) {
            // Cannot find the chunk... read a garbage value.
            return this.readGarbage(address, length, littleEndian);
        }

        let remaining = length;
        let toRetrieve = remaining;

        for ( ; i < this.chunks.length && remaining > 0; i++) {
            var chunk = this.chunks[i];

            // Get relative position
            var offset = address - chunk.address;
            //console.log("reading from", address, chunk, this.chunks[i - 1], offset);

            // Read value
            if (offset < 0) {
                // The chunk does not contain the data
                // TODO: handle big endian!
                ret <<= (8 * remaining);
                ret += this.readGarbage(address, remaining, littleEndian);
                break;
            }
            else if ((offset + remaining) > chunk.byteLength) {
                // Chunk only contains partial data
                toRetrieve = chunk.byteLength - offset;

                if (toRetrieve < 0) {
                    // Also not in the memory
                    ret <<= (8 * remaining);
                    ret += this.readGarbage(address, remaining, littleEndian);
                    break;
                }
            }

            if (toRetrieve == 1) {
                ret <<= 8;
                ret += chunk.getUint8(offset);
                address++;
                remaining--;
            }
            else if (toRetrieve <= 3) {
                ret <<= 16;
                ret += chunk.getUint16(offset, littleEndian);
                address += 2;
                remaining -= 2;
            }
            else if (toRetrieve == 4) {
                ret <<= 32;
                ret += chunk.getUint32(offset, littleEndian);
                address += 4;
                remaining -= 4;
            }

            toRetrieve = remaining;
        }

        if (signed) {
            if (length == 1) {
                return ret >= 0x80 ? ret | ~0xff : ret;
            }
            else if (length == 2) {
                return ret >= 0x8000 ? ret | ~0xffff : ret;
            }
            else if (length == 4) {
                return ret >= 0x80000000 ? ret | ~0xffffffff : ret;
            }
        }

        return ret;
    }

    /**
     * Reads a 8-bit value from memory.
     *
     * @param {number} address - The address to read from.
     */
    read8(address) {
        return this.read(address, 1);
    }

    /**
     * Reads a 8-bit signed value from memory.
     *
     * @param {number} address - The address to read from.
     */
    readSigned8(address) {
        return this.read(address, 1, true);
    }

    /**
     * Reads a 16-bit value from memory.
     *
     * @param {number} address - The address to read from.
     * @param {bool} littleEndian - Whether or not to read as little endian.
     */
    read16(address, littleEndian = true) {
        return this.read(address, 2, false, littleEndian);
    }

    /**
     * Reads a 16-bit signed value from memory.
     *
     * @param {number} address - The address to read from.
     * @param {bool} littleEndian - Whether or not to read as little endian.
     */
    readSigned16(address, littleEndian = true) {
        return this.read(address, 2, true, littleEndian);
    }

    /**
     * Reads a 32-bit value from memory.
     *
     * @param {number} address - The address to read from.
     * @param {bool} littleEndian - Whether or not to read as little endian.
     */
    read32(address, littleEndian = true) {
        return this.read(address, 4, false, littleEndian);
    }

    /**
     * Reads a 32-bit signed value from memory.
     *
     * @param {number} address - The address to read from.
     * @param {bool} littleEndian - Whether or not to read as little endian.
     */
    readSigned32(address, littleEndian = true) {
        return this.read(address, 4, true, littleEndian);
    }

    /**
     * Reads the null terminated string at the given address.
     *
     * @param {number} address - The address to read from.
     */
    readCString(address) {
        let ret = "";

        let limit = 0;
        let current = null;
        do {
            current = this.read8(address);
            if (current) {
                ret = ret + String.fromCharCode(current);
            }
            address++;
            limit++;
        } while(limit < 1000 && current != 0);

        return ret;
    }

    /**
     * Writes a null terminated string to the given address.
     *
     * @param {number} address - The address to write to.
     */
    writeCString(address, string) {
        for (let i = 0; i < string.length; i++) {
            let chr = string.charCodeAt(i);
            this.write8(address, chr);
            address++;
        }

        // Write null-terminator
        this.write8(address, 0);
    }

    /**
     * Writes an integer value to our memory.
     *
     * @param {number} address - The address to write to.
     * @param {number} value - The integer value to write.
     * @param {number} length - The number of bytes to write (1 or 2).
     * @param {bool} littleEndian - Whether or not to write as little endian.
     */
    write(address, value, length, littleEndian = true) {
        // Find the first chunk
        var i = this._find(address);

        if (i >= this.chunks.length) {
            // Cannot find the chunk... we need to append a new chunk here
            this.allocate(address, length);
            i = this._find(address);
        }

        var chunk = this.chunks[i];
        var offset = address - chunk.address;

        // Read value
        if (offset < 0 || (offset + length) > chunk.byteLength) {
            this.allocate(address, length);
            i = this._find(address);
        }

        for ( ; i < this.chunks.length; i++) {
            chunk = this.chunks[i];

            // Get relative position
            offset = address - chunk.address;

            //console.log("writing to chunk", chunk, offset, chunk.byteLength);

            // Set value
            if (length == 1) {
                value &= 0xff;
                chunk.setUint8(offset, value);
            }
            else if (length == 2) {
                value &= 0xffff;
                chunk.setUint16(offset, value, littleEndian);
            }
            else if (length == 4) {
                value &= 0xffffffff;
                chunk.setUint32(offset, value, littleEndian);
            }

            // TODO: write across chunk boundaries.
            return;
        }
    }

    /**
     * Writes a 8-bit value to memory.
     *
     * @param {number} address - The address to write to.
     * @param {number} value - The integer value to write.
     */
    write8(address, value) {
        return this.write(address, value, 1);
    }

    /**
     * Writes a 16-bit value to memory.
     *
     * @param {number} address - The address to write to.
     * @param {number} value - The integer value to write.
     * @param {bool} littleEndian - Whether or not to write as little endian.
     */
    write16(address, value, littleEndian = true) {
        return this.write(address, value, 2, littleEndian);
    }

    /**
     * Writes a 32-bit value to memory.
     *
     * @param {number} address - The address to write to.
     * @param {number} value - The integer value to write.
     * @param {bool} littleEndian - Whether or not to write as little endian.
     */
    write32(address, value, littleEndian = true) {
        return this.write(address, value, 4, littleEndian);
    }

    /**
     * Reads a garbage value that is deterministic based on the address.
     *
     * This allows programs to use uninitialized memory that acts like it would
     * in a realisitic situation. That is, it yields some random value.
     *
     * @param {number} address - The address to read garbage from.
     * @param {number} length - The number of bytes to read (1, 2, 4, etc).
     *
     * @return {number} The garbage value.
     */
    readGarbage(address, length, littleEndian = true) {
        // Generate bytes based on the address and then form the appropriate
        // return value.
        var ret = 0;
        var bi = 0;

        for (var i = address; i < address + length; i++, bi++) {
            var b = (0x1234 % address) & 0xff;

            // Swap endianness where appropriate
            if (littleEndian) {
                b <<= (8 * bi);
            }
            else {
                ret <<= 8;
            }

            ret |= b;
        }

        return ret >>> 0;
    }
}

export default Memory;
