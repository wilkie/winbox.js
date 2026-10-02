'use strict';

import { type SegmentHandler, SplitBlock } from './split-block.js';

/**
 * A block is a mebibyte: an address's block and its place in it are a shift
 * and a mask, which a division and a remainder on every access had cost
 * (`pnpm bench`). `Memory.BLOCK_SIZE` is this.
 */
const BLOCK_BITS = 20;
const BLOCK_SIZE = 1 << BLOCK_BITS;
const BLOCK_MASK = BLOCK_SIZE - 1;

/**
 * Where things are in the WebAssembly memory the machine's memory is kept
 * in, so that a core in WebAssembly can share it (`crates/winbox-wasm`):
 *
 * * Below `TABLE_AT`, 128 KiB, the WebAssembly module's own stack and
 *   statics.
 * * At `TABLE_AT`, a 32-bit entry for each mebibyte block of the machine's
 *   address space: where in the WebAssembly memory the block is, or nought
 *   for one never written.
 * * At `HANDLED_AT`, a byte for each 64 KiB segment: whether its bytes are a
 *   handler's (see `SplitBlock`), which only JavaScript can answer for.
 * * From `BLOCKS_AT`, 256 KiB, the blocks, each made the first time it is
 *   written.
 *
 * Small, because every machine has one: the conformance suites make one a
 * test, tens of thousands of them.
 */
export const TABLE_AT = 0x20000;
export const HANDLED_AT = TABLE_AT + 4096 * 4;
const BLOCKS_AT = 0x40000;

/**
 * This class represents the memory space of the virtual machine.
 */
export class Memory {
  declare _blocks: any;
  declare static BLOCK_SIZE: any;

  /** The WebAssembly memory everything is in. */
  readonly wasm: WebAssembly.Memory;

  /** Where the next block goes. */
  #next = BLOCKS_AT;

  #table!: Uint32Array;
  #handled!: Uint8Array;

  /**
   * Constructs a new memory.
   *
   * Technically, the memory is infinitely large. You write to an address and
   * it will allocate a region for that memory to go, on demand. Its blocks
   * are views of one WebAssembly memory, which a WebAssembly core can be
   * given.
   */
  constructor(_options = {}) {
    // Memory is a set of DataView blocks.
    this._blocks = [];
    this.wasm = new WebAssembly.Memory({ initial: BLOCKS_AT >>> 16 });
    this.#views();
  }

  /**
   * The views of the WebAssembly memory made again: growing it lets go of the
   * buffer every view was of.
   */
  #views() {
    const buffer = this.wasm.buffer;

    this.#table = new Uint32Array(buffer, TABLE_AT, 4096);
    this.#handled = new Uint8Array(buffer, HANDLED_AT, 0x10000);

    this._blocks.forEach((block: any, index: number) => {
      if (!block) {
        return;
      }

      const view = new DataView(buffer, this.#table[index], BLOCK_SIZE);

      if (block instanceof SplitBlock) {
        block.view = view;
      } else {
        this._blocks[index] = view;
      }
    });
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
      const blockStart = address >>> BLOCK_BITS;
      const blockOffset = address & BLOCK_MASK;

      if (!this._blocks[blockStart]) {
        this.allocateBlock(blockStart);
      }

      const length = Math.min(BLOCK_SIZE - blockOffset, bytesLeft);
      const source = new Uint8Array(data.buffer, data.byteOffset + position, length);
      const target = this._blocks[blockStart];

      if (target instanceof SplitBlock) {
        target.copyIn(blockOffset, source);
      } else {
        new Uint8Array(target.buffer, target.byteOffset, BLOCK_SIZE).set(source, blockOffset);
      }

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
      const blockStart = address >>> BLOCK_BITS;
      const blockOffset = address & BLOCK_MASK;

      const length = Math.min(BLOCK_SIZE - blockOffset, bytesLeft);

      if (!this._blocks[blockStart]) {
        this.allocateBlock(blockStart);
      }

      const target = this._blocks[blockStart];

      if (target instanceof SplitBlock) {
        for (let at = 0; at < length; at++) {
          target.setUint8(blockOffset + at, 0);
        }
      } else {
        new Uint8Array(target.buffer, target.byteOffset + blockOffset, length).fill(0);
      }

      bytesLeft -= length;
      address += length;
    }
  }

  /**
   * Returns an ArrayBuffer for the given region.
   */
  read(address, length) {
    let blockStart = address >>> BLOCK_BITS;
    let blockOffset = address & BLOCK_MASK;

    const ret = new Uint8Array(length);

    let position = 0;
    let bytesRemaining = length;

    // Read enough blocks to cover the requested range
    while (bytesRemaining > 0) {
      const bytesRead = Math.min(BLOCK_SIZE - blockOffset, bytesRemaining);

      const block = this._blocks[blockStart];

      if (block instanceof SplitBlock) {
        block.copyOut(blockOffset, ret, position, bytesRead);
      } else {
        ret.set(new Uint8Array(block.buffer, block.byteOffset + blockOffset, bytesRead), position);
      }

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
    const blockStart = address >>> BLOCK_BITS;
    const blockOffset = address & BLOCK_MASK;

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
    const blockStart = address >>> BLOCK_BITS;
    const blockOffset = address & BLOCK_MASK;

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
    const blockStart = address >>> BLOCK_BITS;
    const blockOffset = address & BLOCK_MASK;

    if (!this._blocks[blockStart]) {
      return this.readGarbage(address, 2, littleEndian);
    }

    // Also pull from the adjacent block, if needed
    if (blockOffset + 1 == BLOCK_SIZE) {
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
    const blockStart = address >>> BLOCK_BITS;
    const blockOffset = address & BLOCK_MASK;

    if (!this._blocks[blockStart]) {
      return this.readGarbage(address, 2, littleEndian);
    }

    // Also pull from the adjacent block, if needed
    if (blockOffset + 1 == BLOCK_SIZE) {
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
    const blockStart = address >>> BLOCK_BITS;
    const blockOffset = address & BLOCK_MASK;

    if (!this._blocks[blockStart]) {
      return this.readGarbage(address, 4, littleEndian);
    }

    // Also pull from the adjacent block, if needed
    if (blockOffset + 3 >= BLOCK_SIZE) {
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
    const blockStart = address >>> BLOCK_BITS;
    const blockOffset = address & BLOCK_MASK;

    if (!this._blocks[blockStart]) {
      return this.readGarbage(address, 4, littleEndian);
    }

    // Also pull from the adjacent block, if needed
    if (blockOffset + 7 >= BLOCK_SIZE) {
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
    const blockStart = address >>> BLOCK_BITS;
    const blockOffset = address & BLOCK_MASK;

    if (!this._blocks[blockStart]) {
      return this.readGarbage(address, 4, littleEndian);
    }

    // Also pull from the adjacent block, if needed
    if (blockOffset + 3 >= BLOCK_SIZE) {
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
    let current;
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
    const blockStart = address >>> BLOCK_BITS;
    const blockOffset = address & BLOCK_MASK;

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
    const blockStart = address >>> BLOCK_BITS;
    const blockOffset = address & BLOCK_MASK;

    if (!this._blocks[blockStart]) {
      this.allocateBlock(blockStart);
    }

    // Also write to the adjacent block, if needed
    if (blockOffset + 1 == BLOCK_SIZE) {
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
    const blockStart = address >>> BLOCK_BITS;
    const blockOffset = address & BLOCK_MASK;

    if (!this._blocks[blockStart]) {
      this.allocateBlock(blockStart);
    }

    // Also write to the adjacent block, if needed
    if (blockOffset + 3 >= BLOCK_SIZE) {
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
    const blockStart = address >>> BLOCK_BITS;
    const blockOffset = address & BLOCK_MASK;

    if (!this._blocks[blockStart]) {
      this.allocateBlock(blockStart);
    }

    // Also write to the adjacent block, if needed
    if (blockOffset + 7 >= BLOCK_SIZE) {
      const bytes = new Uint32Array(2);
      const view = new DataView(bytes.buffer);
      view.setBigInt64(0, value, littleEndian);
      this.write(address, view);
      return;
    }

    // Write to the block
    this._blocks[blockStart].setBigInt64(blockOffset, value, littleEndian);
  }

  /**
   * Gives a 64 KiB segment's bytes to a handler, which makes them when read
   * and takes them when written (see `SplitBlock`). `segment` counts 64 KiB
   * from nought, as a descriptor's index places its segment.
   */
  mapHandler(segment: number, handler: SegmentHandler) {
    const blockStart = segment >> 4;

    if (!this._blocks[blockStart]) {
      this.allocateBlock(blockStart);
    }

    if (!(this._blocks[blockStart] instanceof SplitBlock)) {
      this._blocks[blockStart] = new SplitBlock(this._blocks[blockStart]);
    }

    this._blocks[blockStart].handlers[segment & 15] = handler;
    this.#handled[segment & 0xffff] = 1;
  }

  /** Takes a handler's segment back: its bytes are kept again, as noughts. A segment with no handler is left as it is. */
  unmapHandler(segment: number) {
    const block = this._blocks[segment >> 4];

    if (block instanceof SplitBlock && block.handlers[segment & 15]) {
      block.handlers[segment & 15] = undefined;
      new Uint8Array(
        block.view.buffer,
        block.view.byteOffset + ((segment & 15) << 16),
        0x10000
      ).fill(0);
      this.#handled[segment & 0xffff] = 0;
    }
  }

  allocateBlock(index) {
    const at = this.#next;

    /* Grown by half again, at least the block: seldom, as the machine's
     * memory grows, and by no more than a block for a small one. */
    if (at + BLOCK_SIZE > this.wasm.buffer.byteLength) {
      const pages = this.wasm.buffer.byteLength >>> 16;
      const needed = (at + BLOCK_SIZE - this.wasm.buffer.byteLength) >>> 16;

      this.wasm.grow(Math.max(needed, pages >>> 1));
      this.#views();
    }

    this.#next += BLOCK_SIZE;
    this.#table[index] = at;
    this._blocks[index] = new DataView(this.wasm.buffer, at, BLOCK_SIZE);

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
Memory.BLOCK_SIZE = BLOCK_SIZE;
