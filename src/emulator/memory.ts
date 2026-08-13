'use strict';

/**
 * This class represents the memory space of the virtual machine.
 */
export class Memory {
  declare _blocks: any;
  declare static BLOCK_SIZE: any;
  /**
   * Constructs a new memory.
   *
   * Technically, the memory is infinitely large. You write to an address and
   * it will allocate a region for that memory to go, on demand.
   */
  constructor(options = {}) {
    // Memory is a set of DataView blocks.
    // The DataView has an 'address' property depicting where it was placed.
    this._blocks = [];
  }

  /**
   * Retrieves the raw memory in blocks.
   */
  get blocks() {
    return this._blocks;
  }

  /**
   * Copies the given byte array to the given offset.
   *
   * @param {number} address - The address to map the data to within memory.
   * @param {DataView} data - The byte data to append.
   */
  write(address, data) {
    let bytesLeft = data.byteLength;
    let position = 0;

    while (bytesLeft > 0) {
      const blockStart = Math.floor(address / Memory.BLOCK_SIZE);
      const blockOffset = Math.floor(address % Memory.BLOCK_SIZE);

      if (!this._blocks[blockStart]) {
        this.allocateBlock(blockStart);
      }

      const block = new Uint8Array(this._blocks[blockStart].buffer);
      const length = Math.min(Memory.BLOCK_SIZE - blockOffset, bytesLeft);
      block.set(new Uint8Array(data.buffer.slice(position, position + length)), blockOffset);

      bytesLeft -= length;
      address += length;
      position += length;
    }
  }

  /**
   * Zeros out the memory range.
   *
   * @param {number} address - The address to zero the data to within memory.
   * @param {number} size - The number of zero bytes from that address.
   */
  zero(address, size) {
    let bytesLeft = size;

    while (bytesLeft > 0) {
      const blockStart = Math.floor(address / Memory.BLOCK_SIZE);
      const blockOffset = Math.floor(address % Memory.BLOCK_SIZE);

      const length = Math.min(Memory.BLOCK_SIZE - blockOffset, bytesLeft);

      if (!this._blocks[blockStart]) {
        this.allocateBlock(blockStart);
      }

      const block = new Uint8Array(this._blocks[blockStart].buffer);
      block.set(new Uint8Array(length), blockOffset);

      bytesLeft -= length;
      address += length;
    }
  }

  /**
   * Returns an ArrayBuffer for the given region.
   */
  read(address, length) {
    let blockStart = Math.floor(address / Memory.BLOCK_SIZE);
    let blockOffset = Math.floor(address % Memory.BLOCK_SIZE);

    const ret = new Uint8Array(length);

    let position = 0;
    let bytesRemaining = length;

    // Read enough blocks to cover the requested range
    while (bytesRemaining > 0) {
      const bytesRead = Math.min(Memory.BLOCK_SIZE - blockOffset, bytesRemaining);

      const block = this._blocks[blockStart];
      const buffer = block.buffer.slice(blockOffset, blockOffset + bytesRead);

      ret.set(new Uint8Array(buffer), position);

      position += bytesRead;
      bytesRemaining -= bytesRead;
      blockOffset = 0;
      blockStart++;
    }

    return ret.buffer;
  }

  /**
   * Reads a 8-bit value from memory.
   *
   * @param {number} address - The address to read from.
   */
  read8(address) {
    const blockStart = Math.floor(address / Memory.BLOCK_SIZE);
    const blockOffset = address % Memory.BLOCK_SIZE;

    if (!this._blocks[blockStart]) {
      return this.readGarbage(address, 1);
    }

    // Pull from the block
    return this._blocks[blockStart].getUint8(blockOffset);
  }

  /**
   * Reads a 8-bit signed value from memory.
   *
   * @param {number} address - The address to read from.
   */
  readSigned8(address) {
    const blockStart = Math.floor(address / Memory.BLOCK_SIZE);
    const blockOffset = address % Memory.BLOCK_SIZE;

    if (!this._blocks[blockStart]) {
      return this.readGarbage(address, 1);
    }

    // Pull from the block
    return this._blocks[blockStart].getInt8(blockOffset);
  }

  /**
   * Reads a 16-bit value from memory.
   *
   * @param {number} address - The address to read from.
   * @param {bool} littleEndian - Whether or not to read as little endian.
   */
  read16(address, littleEndian = true) {
    const blockStart = Math.floor(address / Memory.BLOCK_SIZE);
    const blockOffset = address % Memory.BLOCK_SIZE;

    if (!this._blocks[blockStart]) {
      return this.readGarbage(address, 2, littleEndian);
    }

    // Also pull from the adjacent block, if needed
    if (blockOffset + 1 == Memory.BLOCK_SIZE) {
      const buffer = this.read(address, 2);
      const view = new DataView(buffer);
      return view.getUint16(0, littleEndian);
    }

    // Pull from the block
    return this._blocks[blockStart].getUint16(blockOffset, littleEndian);
  }

  /**
   * Reads a 16-bit signed value from memory.
   *
   * @param {number} address - The address to read from.
   * @param {bool} littleEndian - Whether or not to read as little endian.
   */
  readSigned16(address, littleEndian = true) {
    const blockStart = Math.floor(address / Memory.BLOCK_SIZE);
    const blockOffset = address % Memory.BLOCK_SIZE;

    if (!this._blocks[blockStart]) {
      return this.readGarbage(address, 2, littleEndian);
    }

    // Also pull from the adjacent block, if needed
    if (blockOffset + 1 == Memory.BLOCK_SIZE) {
      const buffer = this.read(address, 2);
      const view = new DataView(buffer);
      return view.getInt16(0, littleEndian);
    }

    // Pull from the block
    return this._blocks[blockStart].getInt16(blockOffset, littleEndian);
  }

  /**
   * Reads a 32-bit value from memory.
   *
   * @param {number} address - The address to read from.
   * @param {bool} littleEndian - Whether or not to read as little endian.
   */
  read32(address, littleEndian = true) {
    const blockStart = Math.floor(address / Memory.BLOCK_SIZE);
    const blockOffset = address % Memory.BLOCK_SIZE;

    if (!this._blocks[blockStart]) {
      return this.readGarbage(address, 4, littleEndian);
    }

    // Also pull from the adjacent block, if needed
    if (blockOffset + 3 >= Memory.BLOCK_SIZE) {
      const buffer = this.read(address, 4);
      const view = new DataView(buffer);
      return view.getUint32(0, littleEndian);
    }

    // Pull from the block
    return this._blocks[blockStart].getUint32(blockOffset, littleEndian);
  }

  /**
   * Reads a 64-bit value from memory.
   *
   * @param {number} address - The address to read from.
   * @param {bool} littleEndian - Whether or not to read as little endian.
   */
  read64(address, littleEndian = true) {
    const blockStart = Math.floor(address / Memory.BLOCK_SIZE);
    const blockOffset = address % Memory.BLOCK_SIZE;

    if (!this._blocks[blockStart]) {
      return this.readGarbage(address, 4, littleEndian);
    }

    // Also pull from the adjacent block, if needed
    if (blockOffset + 7 >= Memory.BLOCK_SIZE) {
      const buffer = this.read(address, 8);
      const view = new DataView(buffer);
      return view.getBigInt64(0, littleEndian);
    }

    // Pull from the block
    return this._blocks[blockStart].getBigInt64(blockOffset, littleEndian);
  }

  /**
   * Reads a 32-bit signed value from memory.
   *
   * @param {number} address - The address to read from.
   * @param {bool} littleEndian - Whether or not to read as little endian.
   */
  readSigned32(address, littleEndian = true) {
    const blockStart = Math.floor(address / Memory.BLOCK_SIZE);
    const blockOffset = address % Memory.BLOCK_SIZE;

    if (!this._blocks[blockStart]) {
      return this.readGarbage(address, 4, littleEndian);
    }

    // Also pull from the adjacent block, if needed
    if (blockOffset + 3 >= Memory.BLOCK_SIZE) {
      const buffer = this.read(address, 2);
      const view = new DataView(buffer);
      return view.getInt32(0, littleEndian);
    }

    // Pull from the block
    return this._blocks[blockStart].getInt32(blockOffset, littleEndian);
  }

  /**
   * Reads the null terminated string at the given address.
   *
   * @param {number} address - The address to read from.
   * @param {number} max - The maximum number of bytes to read.
   */
  readCString(address, max = 1000) {
    let ret = '';

    let limit = 0;
    let current = null;
    do {
      current = this.read8(address);
      if (current) {
        ret = ret + String.fromCharCode(current);
      }
      address++;
      limit++;
    } while (limit < max && current != 0);

    return ret;
  }

  /**
   * Writes a null terminated string to the given address.
   *
   * @param {number} address - The address to write to.
   */
  writeCString(address, string) {
    for (let i = 0; i < string.length; i++) {
      const chr = string.charCodeAt(i);
      this.write8(address, chr);
      address++;
    }

    // Write null-terminator
    this.write8(address, 0);
  }

  /**
   * Writes a 8-bit value to memory.
   *
   * @param {number} address - The address to write to.
   * @param {number} value - The integer value to write.
   */
  write8(address, value) {
    const blockStart = Math.floor(address / Memory.BLOCK_SIZE);
    const blockOffset = address % Memory.BLOCK_SIZE;

    if (!this._blocks[blockStart]) {
      this.allocateBlock(blockStart);
    }

    // Write to the block
    this._blocks[blockStart].setUint8(blockOffset, value);
  }

  /**
   * Writes a 16-bit value to memory.
   *
   * @param {number} address - The address to write to.
   * @param {number} value - The integer value to write.
   * @param {bool} littleEndian - Whether or not to write as little endian.
   */
  write16(address, value, littleEndian = true) {
    const blockStart = Math.floor(address / Memory.BLOCK_SIZE);
    const blockOffset = address % Memory.BLOCK_SIZE;

    if (!this._blocks[blockStart]) {
      this.allocateBlock(blockStart);
    }

    // Also write to the adjacent block, if needed
    if (blockOffset + 1 == Memory.BLOCK_SIZE) {
      const bytes = new Uint16Array(1);
      const view = new DataView(bytes.buffer);
      view.setUint16(0, value, littleEndian);
      this.write(address, view);
      return;
    }

    // Write to the block
    this._blocks[blockStart].setUint16(blockOffset, value, littleEndian);
  }

  /**
   * Writes a 32-bit value to memory.
   *
   * @param {number} address - The address to write to.
   * @param {number} value - The integer value to write.
   * @param {bool} littleEndian - Whether or not to write as little endian.
   */
  write32(address, value, littleEndian = true) {
    const blockStart = Math.floor(address / Memory.BLOCK_SIZE);
    const blockOffset = address % Memory.BLOCK_SIZE;

    if (!this._blocks[blockStart]) {
      this.allocateBlock(blockStart);
    }

    // Also write to the adjacent block, if needed
    if (blockOffset + 3 >= Memory.BLOCK_SIZE) {
      const bytes = new Uint32Array(1);
      const view = new DataView(bytes.buffer);
      view.setUint32(0, value, littleEndian);
      this.write(address, view);
      return;
    }

    // Write to the block
    this._blocks[blockStart].setUint32(blockOffset, value, littleEndian);
  }

  /**
   * Writes a 64-bit value to memory.
   *
   * @param {number} address - The address to write to.
   * @param {BigInt} value - The integer value to write.
   * @param {bool} littleEndian - Whether or not to write as little endian.
   */
  write64(address, value, littleEndian = true) {
    const blockStart = Math.floor(address / Memory.BLOCK_SIZE);
    const blockOffset = address % Memory.BLOCK_SIZE;

    if (!this._blocks[blockStart]) {
      this.allocateBlock(blockStart);
    }

    // Also write to the adjacent block, if needed
    if (blockOffset + 7 >= Memory.BLOCK_SIZE) {
      const bytes = new Uint32Array(2);
      const view = new DataView(bytes.buffer);
      view.setBigInt64(0, value, littleEndian);
      this.write(address, view);
      return;
    }

    // Write to the block
    this._blocks[blockStart].setBigInt64(blockOffset, value, littleEndian);
  }

  allocateBlock(index) {
    const block = new Uint8Array(Memory.BLOCK_SIZE);
    this._blocks[index] = new DataView(block.buffer);

    // TODO: set to garbage
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
    let ret = 0;
    let bi = 0;

    for (let i = address; i < address + length; i++, bi++) {
      let b = (0x1234 % address) & 0xff;

      // Swap endianness where appropriate
      if (littleEndian) {
        b <<= 8 * bi;
      } else {
        ret <<= 8;
      }

      ret |= b;
    }

    return ret >>> 0;
  }
}

// 1MiB chunks
Memory.BLOCK_SIZE = 1 * 1024 * 1024;
