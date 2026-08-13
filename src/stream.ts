/**
 * A fetcher that will pull content using Range requests, when possible.
 */
export class Stream {
    declare _buffer: any;
    declare _cache: any;
    declare _headInitialized: any;
    declare _initialized: any;
    declare _ranged: any;
    declare _size: any;
    declare _url: any;
    declare static BLOCK_SIZE: any;
    /**
     * Creates a read-only stream from the given URL.
     */
    constructor(url) {
        this._url = url;
        this._cache = {};
        this._ranged = true;
        this._headInitialized = false;
        this._initialized = false;
    }

    /**
     * The URL that this stream corresponds to.
     */
    get url() {
        return this._url;
    }

    /**
     * Returns the known full size of the stream.
     *
     * Same as `byteLength`.
     */
    get size() {
        return this._size;
    }

    /**
     * Returns the known full size of the stream.
     *
     * Same as `size`.
     */
    get byteLength() {
        return this._size;
    }

    /**
     * Returns the filename for this stream based on the URL.
     */
    get name() {
        return this._url.substr(this._url.lastIndexOf('/') + 1);
    }

    async head() {
        if (this._headInitialized) {
            return;
        }

        await fetch(this.url, {
          method: 'HEAD',
          headers: {
            range: 'bytes=' + 0 + '-' + 1
          },
        }).then( async (response) => {
            if (response.ok) {
                this._headInitialized = true;
                if (response.headers.get('Content-Range')) {
                    const header = response.headers.get('Content-Range');
                    const size = header.substr(header.lastIndexOf('/') + 1);
                    this._size = this._size || parseInt(size);
                }
                else {
                    // Range requests are not allowed
                    const header = response.headers.get('Content-Length');
                    this._ranged = false;
                    this._size = this._size || parseInt(header);
                }

                return response.arrayBuffer();
            }
            else {
                throw "HTTP Error";
            }
        }).then( (buffer) => {
        }).catch( (error) => {
            throw error;
        });
    }

    async read8(offset) {
        const blockStart = Math.floor(offset / Stream.BLOCK_SIZE);

        await this.readBlock(blockStart);

        if (!this._ranged) {
            return this._buffer.getUint8(offset);
        }

        const blockOffset = offset % Stream.BLOCK_SIZE;

        // Pull from the cached block
        return this._cache[blockStart].getUint8(offset);
    }

    async read16(offset, littleEndian = true) {
        const blockStart = Math.floor(offset / Stream.BLOCK_SIZE);

        await this.readBlock(blockStart);

        if (!this._ranged) {
            return this._buffer.getUint16(offset, littleEndian);
        }

        const blockOffset = offset % Stream.BLOCK_SIZE;

        // Also from pull the adjacent block, if needed
        if (blockOffset + 1 == Stream.BLOCK_SIZE) {
            const buffer = await this.read(offset, 2);
            const view = new DataView(buffer);
            return view.getUint16(0, littleEndian);
        }

        // Pull the 16-bit value from the block
        return this._cache[blockStart].getUint16(blockOffset, littleEndian);
    }

    async read32(offset, littleEndian = true) {
        const blockStart = Math.floor(offset / Stream.BLOCK_SIZE);

        await this.readBlock(blockStart);

        if (!this._ranged) {
            return this._buffer.getUint32(offset, littleEndian);
        }

        const blockOffset = offset % Stream.BLOCK_SIZE;

        // Also pull from the adjacent block, if needed
        if (blockOffset + 3 >= Stream.BLOCK_SIZE) {
            const buffer = await this.read(offset, 4);
            const view = new DataView(buffer);
            return view.getUint32(0, littleEndian);
        }

        // Pull the 32-bit value from the block
        return this._cache[blockStart].getUint32(blockOffset, littleEndian);
    }

    async readSigned8(offset) {
        const blockStart = Math.floor(offset / Stream.BLOCK_SIZE);

        await this.readBlock(blockStart);

        if (!this._ranged) {
            return this._buffer.getInt8(offset);
        }

        const blockOffset = offset % Stream.BLOCK_SIZE;

        // Pull from the cached block
        return this._cache[blockStart].getInt8(offset);
    }

    async readSigned16(offset, littleEndian = true) {
        const blockStart = Math.floor(offset / Stream.BLOCK_SIZE);

        await this.readBlock(blockStart);

        if (!this._ranged) {
            return this._buffer.getInt16(offset, littleEndian);
        }

        const blockOffset = offset % Stream.BLOCK_SIZE;

        // Also pull from the adjacent block, if needed
        if (blockOffset + 1 == Stream.BLOCK_SIZE) {
            const buffer = await this.read(offset, 2);
            const view = new DataView(buffer);
            return view.getInt16(0, littleEndian);
        }

        // Pull the 16-bit value from the block
        return this._cache[blockStart].getInt16(blockOffset, littleEndian);
    }

    async readSigned32(offset, littleEndian = true) {
        const blockStart = Math.floor(offset / Stream.BLOCK_SIZE);

        await this.readBlock(blockStart);

        if (!this._ranged) {
            return this._buffer.getInt32(offset, littleEndian);
        }

        const blockOffset = offset % Stream.BLOCK_SIZE;

        // Also pull from the adjacent block, if needed
        if (blockOffset + 3 >= Stream.BLOCK_SIZE) {
            const buffer = await this.read(offset, 4);
            const view = new DataView(buffer);
            return view.getInt32(0, littleEndian);
        }

        // Pull the 32-bit value from the block
        return this._cache[blockStart].getInt32(blockOffset, littleEndian);
    }

    /**
     * Returns an ArrayBuffer for the given region.
     */
    async read(offset, length) {
        let blockStart = Math.floor(offset / Stream.BLOCK_SIZE);

        if (!this._initialized) {
            // If we have never interacted, then we pull the block first
            // to decide if we can handle ranged requests.
            await this.readBlock(blockStart);
        }

        let blockOffset = Math.floor(offset % Stream.BLOCK_SIZE);

        const ret = new Uint8Array(length);

        if (this._ranged) {
            let position = 0;
            let bytesRemaining = length;

            // Read enough blocks to cover the requested range
            while (bytesRemaining > 0) {
                const bytesRead = Math.min(Stream.BLOCK_SIZE - blockOffset,
                                         bytesRemaining);

                const block = await this.readBlock(blockStart);
                
                const buffer = block.slice(blockOffset, blockOffset + bytesRead);

                ret.set(new Uint8Array(buffer), position);

                position += bytesRead;
                bytesRemaining -= bytesRead;
                blockOffset = 0;
                blockStart++;
            }

            return ret.buffer;
        }
        else {
            // Range requests aren't allowed, so slice off part of the whole
            return this._buffer.buffer.slice(offset, offset + length);
        }
    }

    /**
     * Low-level routine to read a data block from the network.
     */
    async readBlock(position) {
        if (!this._ranged && this._buffer) {
            return this._buffer;
        }
        else if (this._cache[position]) {
            return this._cache[position];
        }
        else {
            const start = Math.floor(position * Stream.BLOCK_SIZE);
            let end = start + Stream.BLOCK_SIZE - 1;
            if (this.size) {
                end = Math.min(end, this.size - 1);
            }

            let ret = null;

            await fetch(this.url, {
              headers: {
                range: 'bytes=' + start + '-' + end
              },
            }).then( async (response) => {
                if (response.ok) {
                    this._initialized = true;
                    this._headInitialized = true;
                    if (response.headers.get('Content-Range')) {
                        const header = response.headers.get('Content-Range');
                        const size = header.substr(header.lastIndexOf('/') + 1);
                        this._size = this._size || parseInt(size);
                    }
                    else {
                        // Range requests are not allowed
                        const header = response.headers.get('Content-Length');
                        this._ranged = false;
                        this._size = this._size || parseInt(header);
                    }

                    return response.arrayBuffer();
                }
                else {
                    throw "HTTP Error";
                }
            }).then( (buffer) => {
                ret = buffer;

                if (!this._ranged) {
                    this._buffer = new DataView(buffer);
                }
                else {
                    this._cache[position] = new DataView(buffer);
                }
            }).catch( (error) => {
                throw error;
            });

            return ret;
        }
    }
}

/**
 * Amount of bytes to read at a time.
 */
Stream.BLOCK_SIZE = 1024 * 100;
