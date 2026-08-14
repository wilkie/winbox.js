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

  /**
   * Writes a run of bytes starting at an offset within a sector.
   *
   * The mirror of `read`, and byte-wise for the same reason it is: copying
   * words would have to agree with the reader about byte order, and there is
   * nothing to be gained by giving it the opportunity to disagree.
   *
   * @param {number} index - The sector to start at.
   * @param {number} offset - The offset from the start of that sector.
   * @param {DataView|Uint8Array} data - What to write.
   */
  async write(index, offset, data) {
    const bytes =
      data instanceof Uint8Array
        ? data
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);

    let position = 0;
    let at = index * this._sectorSize + offset;

    while (position < bytes.length) {
      const sector = Math.floor(at / this._sectorSize);
      const block = this.retrieveBlock(sector);

      const within = at - Math.floor(sector / this._sectorsPerBlock) * this._blockSize;
      const toWrite = Math.min(bytes.length - position, this._blockSize - within);

      new Uint8Array(block.buffer).set(bytes.subarray(position, position + toWrite), within);

      position += toWrite;
      at += toWrite;
    }
  }

  /**
   * Fills the disk from a raw image.
   *
   * Blocks are allocated lazily, so an image only occupies memory for the
   * parts of it that hold something. A run of zeroes -- which most of a
   * freshly formatted volume is -- is left unallocated and reads back as zero
   * anyway.
   *
   * @param {Uint8Array} bytes - The image, starting at sector zero.
   */
  load(bytes) {
    if (bytes.byteLength > this._size) {
      throw new Error(`image is ${bytes.byteLength} bytes, disk holds ${this._size}`);
    }

    for (let at = 0; at < bytes.byteLength; at += this._blockSize) {
      const slice = bytes.subarray(at, Math.min(at + this._blockSize, bytes.byteLength));

      if (slice.every((byte) => byte === 0)) {
        continue;
      }

      const block = new Uint8Array(this._blockSize);
      block.set(slice);

      /* Blocks are keyed by the sector number of their first sector, which is
       * what `retrieveBlock` produces once it has masked off the offset within
       * the block -- not by a block index.
       */
      this._blocks[(at / this._blockSize) * this._sectorsPerBlock] = new DataView(block.buffer);
    }
  }

  /**
   * Reads the whole disk back out as one image.
   *
   * The inverse of `load`, for handing a modified drive to something outside
   * the emulator.
   */
  save() {
    const bytes = new Uint8Array(this._size);

    for (let sector = 0; sector * this._sectorSize < this._size; sector += this._sectorsPerBlock) {
      const block = this._blocks[sector];

      if (block) {
        bytes.set(new Uint8Array(block.buffer), sector * this._sectorSize);
      }
    }

    return bytes;
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

  /**
   * Reads a run of bytes starting at an offset within a sector.
   *
   * The offset may be larger than a sector -- a caller working in clusters
   * addresses the first sector of the cluster and an offset within the whole
   * of it -- so this works in absolute byte addresses and lets the block
   * arithmetic fall out of that, rather than trying to carry a sector index
   * and an offset along in step.
   *
   * @param {number} index - The sector to start from.
   * @param {number} offset - The offset from the start of that sector.
   * @param {number} length - How many bytes to read.
   */
  async read(index, offset, length) {
    const ret = new Uint8Array(length);

    let position = 0;
    let at = index * this._sectorSize + offset;

    while (position < length) {
      const sector = Math.floor(at / this._sectorSize);
      const block = this.retrieveBlock(sector);

      // Where this address falls inside the block that holds it.
      const within = at - Math.floor(sector / this._sectorsPerBlock) * this._blockSize;
      const toRead = Math.min(length - position, this._blockSize - within);

      ret.set(new Uint8Array(block.buffer, within, toRead), position);

      position += toRead;
      at += toRead;
    }

    return ret;
  }

  /**
   * Finds the block and the position within it for a sector and offset.
   *
   * The offset is not required to be smaller than a sector. Callers working in
   * clusters address the first sector of a cluster and an offset within the
   * whole of it, which for a 2 KiB cluster is four sectors' worth -- so this
   * works in absolute addresses and lets the block arithmetic follow, which is
   * what `read` and `write` already do.
   *
   * @param {number} index - The sector to start from.
   * @param {number} offset - The offset from the start of that sector.
   */
  locate(index, offset) {
    const at = index * this._sectorSize + offset;
    const sector = Math.floor(at / this._sectorSize);

    return {
      block: this.retrieveBlock(sector),
      within: at - Math.floor(sector / this._sectorsPerBlock) * this._blockSize,
    };
  }

  /** Whether an access of this width would run off the end of its block. */
  straddles(within, width) {
    return within + width > this._blockSize;
  }

  async read8(index, offset) {
    const { block, within } = this.locate(index, offset);

    return block.getUint8(within);
  }

  async read16(index, offset, littleEndian = true) {
    const { block, within } = this.locate(index, offset);

    if (this.straddles(within, 2)) {
      const bytes = await this.read(index, offset, 2);

      return new DataView(bytes.buffer).getUint16(0, littleEndian);
    }

    return block.getUint16(within, littleEndian);
  }

  async read32(index, offset, littleEndian = true) {
    const { block, within } = this.locate(index, offset);

    if (this.straddles(within, 4)) {
      const bytes = await this.read(index, offset, 4);

      return new DataView(bytes.buffer).getUint32(0, littleEndian);
    }

    return block.getUint32(within, littleEndian);
  }

  async readCString(index, offset, max) {
    let ret = '';

    let limit = 0;
    let current = null;
    do {
      current = await this.read8(index, offset);
      if (current) {
        ret = ret + String.fromCharCode(current);
      }
      offset++;
      limit++;
    } while (limit < max && current != 0);

    return ret;
  }

  async write8(index, offset, value) {
    const { block, within } = this.locate(index, offset);

    block.setUint8(within, value);
  }

  async write16(index, offset, value, littleEndian = true) {
    const { block, within } = this.locate(index, offset);

    if (this.straddles(within, 2)) {
      const bytes = new Uint8Array(2);
      new DataView(bytes.buffer).setUint16(0, value, littleEndian);

      return this.write(index, offset, bytes);
    }

    block.setUint16(within, value, littleEndian);
  }

  async write32(index, offset, value, littleEndian = true) {
    const { block, within } = this.locate(index, offset);

    if (this.straddles(within, 4)) {
      const bytes = new Uint8Array(4);
      new DataView(bytes.buffer).setUint32(0, value, littleEndian);

      return this.write(index, offset, bytes);
    }

    block.setUint32(within, value, littleEndian);
  }

  async writeString(index, offset, value, max) {
    let i = 0;
    for (; i < max && i < value.length; i++) {
      const b = value.charCodeAt(i);
      await this.write8(index, offset, b);
      offset++;
    }

    if (i < max) {
      await this.write8(index, offset, 0);
    }
  }

  async writeCString(index, offset, value, max) {
    for (let i = 0; i < max - 1 && i < value.length; i++) {
      const b = value.charCodeAt(i);
      await this.write8(index, offset, b);
      offset++;
    }

    if (max > 0) {
      await this.write8(index, offset, 0);
    }
  }
}
