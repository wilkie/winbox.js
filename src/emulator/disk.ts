export class Disk {
    declare _blockSize: any;
    declare _blocks: any;
    declare _fileSystem: any;
    declare _indexMask: any;
    declare _sectorSize: any;
    declare _sectorsPerBlock: any;
    declare _size: any;
    constructor(size, sectorSize = 512, blockSize = 32768) {
        this._blocks = new Array(Math.ceil(size / blockSize));
        this._sectorSize = sectorSize;
        this._blockSize = blockSize;
        this._size = size;
        this._sectorsPerBlock = blockSize / sectorSize;
        this._indexMask = ~(this._sectorsPerBlock - 1);
    }

    get size() {
        return this._size;
    }

    get sectorSize() {
        return this._sectorSize;
    }

    get blockSize() {
        return this._blockSize;
    }

    get fileSystem() {
        return this._fileSystem;
    }

    set fileSystem(value) {
        this._fileSystem = value;
    }

    async write(index, offset, data) {
        for (let i = 0; i < data.byteLength; i += 4, offset += 4) {
            if (offset >= this.sectorSize) {
                index++;
                offset -= this.sectorSize;
            }

            const length = Math.min(data.byteLength - i, this.sectorSize - offset);
            if (length == 1) {
                await this.write8(index, offset, data.getUint8(i));
                i -= 3;
                offset -= 3;
            }
            else if (length < 4) {
                await this.write16(index, offset, data.getUint16(i));
                // Ensure the loop moves only to current i + 2
                i -= 2;
                offset -= 2;
            }
            else {
                await this.write32(index, offset, data.getUint32(i));
            }
        }
    }

    retrieveBlock(index) {
        index &= this._indexMask;
        let block = this._blocks[index];
        if (!block) {
            const bytes = new Uint8Array(this.blockSize);
            block = new DataView(bytes.buffer);
            this._blocks[index] = block;
        }
        return block;
    }

    async read(index, offset, length) {
        // Get the proper block index and offset for the sector
        offset += (this.sectorSize * (index % this._sectorsPerBlock))
        index &= this._indexMask;

        // Craft a return by reading every cluster
        const ret = new Uint8Array(length);
        let position = 0;

        while (position < length) {
            let toRead = this.blockSize - offset;
            if ((position + toRead) > length) {
                toRead = length - position;
            }

            const bytes = this._blocks[index].buffer.slice(0, toRead);
            ret.set(new Uint8Array(bytes), position);

            position += toRead;
            offset = 0;
            index++;
        }

        return ret;
    }

    async read8(index, offset) {
        return this.retrieveBlock(index).getUint8(
            offset + (this.sectorSize * (index % this._sectorsPerBlock))
        );
    }

    async read16(index, offset, littleEndian = true) {
        return this.retrieveBlock(index).getUint16(
            offset + (this.sectorSize * (index % this._sectorsPerBlock)),
            littleEndian
        );
    }

    async read32(index, offset, littleEndian = true) {
        return this.retrieveBlock(index).getUint32(
            offset + (this.sectorSize * (index % this._sectorsPerBlock)),
            littleEndian
        );
    }

    async readCString(index, offset, max) {
        let ret = "";

        let limit = 0;
        let current = null;
        do {
            current = await this.read8(index, offset);
            if (current) {
                ret = ret + String.fromCharCode(current);
            }
            offset++;
            limit++;
        } while(limit < max && current != 0);

        return ret;
    }

    async write8(index, offset, value) {
        this.retrieveBlock(index).setUint8(
            offset + (this.sectorSize * (index % this._sectorsPerBlock)),
            value
        );
    }

    async write16(index, offset, value, littleEndian = true) {
        this.retrieveBlock(index).setUint16(
            offset + (this.sectorSize * (index % this._sectorsPerBlock)),
            value,
            littleEndian
        );
    }

    async write32(index, offset, value, littleEndian = true) {
        this.retrieveBlock(index).setUint32(
            offset + (this.sectorSize * (index % this._sectorsPerBlock)),
            value,
            littleEndian
        );
    }

    async writeString(index, offset, value, max) {
        let i = 0;
        for ( ; i < max && i < value.length; i++) {
            const b = value.charCodeAt(i);
            await this.write8(index, offset, b);
            offset++;
        }

        if (i < max) {
            await this.write8(index, offset, 0);
        }
    }

    async writeCString(index, offset, value, max) {
        for (let i = 0; i < (max - 1) && i < value.length; i++) {
            const b = value.charCodeAt(i);
            await this.write8(index, offset, b);
            offset++;
        }

        if (max > 0) {
            await this.write8(index, offset, 0);
        }
    }
}
