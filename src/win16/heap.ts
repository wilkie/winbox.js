'use strict';

/**
 * This represents a heap within a section of memory.
 */
export class Heap {
  declare _address: any;
  declare _allocations: any;
  declare _handleCount: any;
  declare _handles: any;
  declare _offset: any;
  declare _segment: any;
  declare _size: any;
  declare _view: any;
  constructor(size) {
    // The size of the heap
    this._size = size;

    /* The heap's own bytes. Handles live in here rather than in a table on the
     * side, because a local handle is an address within the segment and
     * software dereferences it: `LocalLock` on a moveable block reads the
     * pointer the handle holds, and it has to be somewhere the guest can see.
     */
    this._view = new DataView(new Uint8Array(size).buffer);

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

  /**
   * Reads a word from the heap.
   *
   * Offsets here are relative to the start of the heap rather than to the
   * segment, which is why callers subtract `_offset` first.
   */
  getUint16(offset, littleEndian = true) {
    return this._view.getUint16(offset, littleEndian);
  }

  /**
   * Writes a word into the heap, and into the segment the program sees: a
   * moveable block's handle is the address of a word holding its block's
   * address, and programs read it there themselves -- Write keeps lists of
   * handles and reads each block through `[handle]`, not `LocalLock`.
   */
  setUint16(offset, value, littleEndian = true) {
    this._view.setUint16(offset, value, littleEndian);

    if (this.mirror) {
      this.mirror.memory.write16(
        this.mirror.base + ((this._offset + offset) & 0xffff),
        value & 0xffff
      );
    }
  }

  /** Where the heap's segment is in the machine's memory, for the words it writes there. */
  mirror: { memory: any; base: number } | null = null;

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
   * Retrieves the amount of bytes currently allocated to this heap.
   */
  get size() {
    let ret = 0;

    this._allocations.forEach((allocation) => {
      const view = allocation[2];
      ret += view.byteLength;
    });

    return ret;
  }

  /**
   * Makes an allocation of an existing chunk of memory.
   *
   * Returns the address or handle.
   */
  insert(view, options: any = {}) {
    const size = view.byteLength;

    if (size == 0) {
      return null;
    }

    // Find a place to allocate within the heap.
    // We want 2 more bytes to write the size
    const searchSize = size + 2;
    let address = this.find(searchSize) || this.grow(size, searchSize);
    if (address == 0) {
      // `LocalAlloc` fails with NULL; it never throws.
      return null;
    }

    view.heap = this;

    // Create the metadata chunk
    const sizeData = new Uint8Array(2);
    const sizeView = new DataView(sizeData.buffer);

    // Retain the allocation
    this._allocations.push([address, searchSize, sizeView, view]);
    this._allocations.sort((a, b) => a[0] - b[0]);

    // Write the size and increment the address by 2
    sizeView.setUint16(0, size, true);
    address += 2;

    // Allocate (and a handle, if movable)
    let handle: any = false;
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
   * The size a request of this many bytes actually turns into.
   *
   * The local heap deals in four-byte units and never hands out a block
   * smaller than eight bytes. A moveable block spends two of its own bytes on
   * the link back to its handle, so the size reported for one is two less than
   * the block it sits in -- which is why requests of 15, 16, 17 and 18 bytes
   * all come back as 18.
   *
   * Measured rather than assumed; see oracle/fixtures/memory.json, where
   * seventeen sizes agree with this and nine of them were chosen to disprove
   * it.
   *
   * @param {number} request - The bytes asked for.
   * @param {boolean} movable - Whether the block carries a handle.
   * @returns {number} The bytes the caller actually gets.
   */
  static blockFor(request, movable) {
    const block = Math.max(8, (request + (movable ? 2 : 0) + 3) & ~3);

    return movable ? block - 2 : block;
  }

  /**
   * Makes a local allocation to the heap within the given segment.
   */
  allocate(size, options: any = {}) {
    /* Nothing asked of a moveable block is a block already discarded: a
     * handle standing for nothing, which `LocalReAlloc` gives a size to later
     * (documented). A fixed one is refused. */
    if (size == 0) {
      if (!options.movable) {
        return null;
      }

      const handle = this.allocateHandle();

      this.setUint16(handle - this._offset, 0, true);

      return handle;
    }

    /* Allocating what the caller will be told it has, rather than what it
     * asked for: software reads `LocalSize` and uses every byte of it.
     */
    const data = new Uint8Array(Heap.blockFor(size, !!options.movable));
    const view = new DataView(data.buffer);

    // The options decide whether a handle is made, so they have to travel.
    return this.insert(view, options);
  }

  /**
   * The size of the block behind a handle or a pointer.
   *
   * `LocalSize` is defined on both, and a handle is told from a pointer by
   * whether the heap remembers handing it out as one.
   *
   * @param {number} address - A local handle or a local pointer.
   * @returns {number} The size of the block, or zero if it is not one.
   */
  sizeOf(address) {
    if (this._handles[address]) {
      // A handle holds the address of the block it stands for.
      address = this.getUint16(address - this._offset, true);
    }

    // The two bytes before the data hold its size, so the block starts there.
    const start = address - 2;

    for (const allocation of this._allocations) {
      if (allocation[0] === start) {
        return allocation[3].byteLength;
      }
    }

    return 0;
  }

  allocateHandle() {
    // Find 2 bytes of free space for the handle, growing for them as for a block.
    const ret = this.find(2) || this.grow(2, 2);

    // Create the data
    const data = new Uint8Array(2);
    const view = new DataView(data.buffer);

    // Keep track of the allocation
    this._allocations.push([ret, 2, null, view]);
    this._allocations.sort((a, b) => a[0] - b[0]);

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
      const pointer = this.getUint16(address - this._offset, true);
      delete this._handles[address];
      this.free(pointer);
    } else {
      // If it is not a handle, get to the actual starting point
      address -= 2;
    }

    // TODO: this can be a binary search
    for (let i = 0; i < this._allocations.length; i++) {
      const item = this._allocations[i];
      if (item[0] == address) {
        this._allocations.splice(i, 1);
        return;
      }
    }
  }

  /** The largest space between blocks, or after the last: what `LocalCompact` answers. */
  largestFree() {
    let last = this._offset;
    let largest = 0;

    for (const item of this._allocations) {
      largest = Math.max(largest, item[0] - last);
      last = item[0] + item[1];
    }

    return Math.max(largest, this.byteLength + this._offset - last);
  }

  /**
   * Finds space within the heap to fit the requested size.
   */
  find(size) {
    // Go through allocations and find one that matches
    let last = this._offset;
    let space;
    for (let i = 0; i < this._allocations.length; i++) {
      const item = this._allocations[i];

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
    space = this.byteLength + this._offset - last;

    if (space >= size) {
      // We can fit in the remaining space
      return last;
    }

    // Could not fit!
    return 0;
  }

  /**
   * Grows a heap that is out of room, as a moveable data segment's does.
   *
   * Measured by the `localgro` probe: a request that does not fit grows the
   * segment by the request and 544 more, rounded up to 32 -- 1,568 for 1,000
   * bytes, 3,616 for 3,072 and 4,640 for 4,096 -- whatever room there was
   * already. A growth that would pass 64K grows to 64K instead, if the block
   * then fits; if it still does not, nothing grows and the request fails.
   * Refused, because the 1,000-byte request disproves both: the block, its
   * header and 540 (1,544), and the same with 512 rounded up to 32 (1,536),
   * which each fit the other two sizes.
   *
   * @param {number} request - The bytes the caller asked for.
   * @param {number} needed - The bytes the block takes in this heap.
   * @returns {number} Where the block goes, or 0 if the heap cannot grow to it.
   */
  grow(request, needed) {
    if (!this.growable) {
      return 0;
    }

    const limit = 0x10000 - this._offset;
    const size = Math.min(this._size + (((request + 544 + 31) >> 5) << 5), limit);

    if (size <= this._size) {
      return 0;
    }

    const previous = this._size;

    this._size = size;

    const address = this.find(needed);

    if (address == 0) {
      this._size = previous;
      return 0;
    }

    const view = new DataView(new Uint8Array(size).buffer);

    new Uint8Array(view.buffer).set(new Uint8Array(this._view.buffer));
    this._view = view;
    this.onGrow?.(this._offset + size);

    return address;
  }

  /** Told the heap's new end when it grows: its block's size follows it. */
  declare onGrow: ((end: number) => void) | undefined;

  /** Whether the heap may grow: the local heap of a moveable data segment. */
  declare growable: boolean;

  /** Whether a value is a handle this heap gave out, rather than a pointer. */
  isHandle(value) {
    return !!this._handles[value];
  }

  /**
   * The address of the data a handle or pointer stands for: what a handle
   * holds, 0 for one whose block is discarded; a pointer as it is.
   */
  resolve(value) {
    return this._handles[value] ? this.getUint16(value - this._offset, true) : value;
  }

  /** The allocation whose data starts at an address. */
  #allocationAt(address) {
    return this._allocations.find((allocation) => allocation[0] === address - 2 && allocation[2]);
  }

  /**
   * Gives a block a new size, keeping what fits of its bytes.
   *
   * A moveable block keeps its handle and goes wherever there is room; a
   * fixed one moves only when `LMEM_MOVEABLE` allows it, and a pointer to
   * where it went is answered. Asked for nought with `LMEM_MOVEABLE`, a
   * moveable block is discarded: its handle stays, standing for nothing, and
   * is given a block again by the next size. The bytes a block gains are
   * noughts. Documented, and not measured: `LocalReAlloc`'s own rounding is
   * `LocalAlloc`'s.
   *
   * @returns {number|null} The handle or pointer, or null when it cannot.
   */
  reallocate(value, size, movableFlag, zeroInit = false) {
    const handle = this._handles[value] ? value : null;
    const address = this.resolve(value);
    const allocation = address ? this.#allocationAt(address) : null;

    if (address && !allocation) {
      return null;
    }

    if (size === 0) {
      if (!handle || !movableFlag) {
        return null;
      }

      this.#release(address);
      this.setUint16(handle - this._offset, 0, true);

      return handle;
    }

    /* Shrunk, or grown into free space right after it, a block stays where
     * it is (`inPlace`). */
    if (allocation) {
      const stayed = this.#inPlace(allocation, size, !!handle, zeroInit);

      if (stayed) {
        return handle ?? address;
      }
    }

    /* A block's bytes are the program's, in its segment, where it writes
     * them through the pointer `LocalLock` gave it: those are what move. */
    const old = allocation ? this.#bytesAt(address, allocation[3]) : new Uint8Array(0);
    const data = new Uint8Array(Heap.blockFor(size, !!handle));

    data.set(old.subarray(0, Math.min(old.length, data.length)));

    if (!handle && !movableFlag && data.length > old.length) {
      return null;
    }

    if (address) {
      this.#release(address);
    }

    const view: any = new DataView(data.buffer);
    const placed = this.insert(view, {});

    if (placed === null) {
      // Put the old bytes back where they will go.
      const back: any = new DataView(old.buffer);
      const again = old.length ? this.insert(back, {}) : null;

      if (again !== null) {
        this.#writeAt(again, old);
      }

      if (handle && again !== null) {
        this.setUint16(handle - this._offset, again, true);
        back.handle = handle;
      }

      return null;
    }

    this.#writeAt(placed, data);

    if (handle) {
      this.setUint16(handle - this._offset, placed, true);
      view.handle = handle;
      delete view.segment;
      delete view.offset;

      return handle;
    }

    return placed;
  }

  /**
   * A moveable block given a new size where it is, if it can be.
   * **Recorded** by `localre`, a moveable block of 66 bytes:
   *
   * * Shrunk, it stays, keeping its bytes, the ones past its new size too.
   *   Its new block is `LocalAlloc`'s rounding, but never under 12 bytes: 1
   *   to 10 bytes asked for are 10, 12 is 14, 30 is 30. What is left over
   *   becomes free only when it is 20 bytes or more; less, and the block
   *   keeps its size: 46 is 46, 50 is still 66.
   * * Grown, it stays when free space right after it, before another block,
   *   holds it; with `LMEM_ZEROINIT` the bytes gained are noughts. A block
   *   with no other after it moved. This is fitted to the two cases the
   *   probe has, one of each.
   */
  #inPlace(allocation, size, movable, zeroInit) {
    /* A fixed block's are not recorded. */
    if (!movable) {
      return false;
    }

    const [start, block] = allocation;
    const wanted = Math.max(12, (size + 2 + 3) & ~3);

    if (wanted <= block) {
      if (block - wanted >= 20) {
        this.#resize(allocation, wanted);
      }

      return true;
    }

    const index = this._allocations.indexOf(allocation);
    const next = this._allocations[index + 1];

    if (!next || next[0] < start + wanted) {
      return false;
    }

    const was = allocation[3].byteLength;

    this.#resize(allocation, wanted);

    if (zeroInit) {
      this.#writeAt(start + 2 + was, new Uint8Array(allocation[3].byteLength - was));
    }

    return true;
  }

  /** An allocation made a block of a new length, its size word and all. */
  #resize(allocation, block) {
    allocation[1] = block;
    allocation[2].setUint16(0, block - 2, true);

    const view: any = new DataView(new ArrayBuffer(block - 2));

    view.heap = this;
    view.handle = allocation[3].handle;
    view.segment = allocation[3].segment;
    view.offset = allocation[3].offset;
    allocation[3] = view;
  }

  /** A block's bytes at an address of the segment: the segment's own, where there is one. */
  #bytesAt(address, view) {
    const length = view.byteLength;

    if (!this.mirror) {
      return new Uint8Array(view.buffer, view.byteOffset, length).slice();
    }

    const bytes = new Uint8Array(length);

    for (let at = 0; at < length; at++) {
      bytes[at] = this.mirror.memory.read8(this.mirror.base + ((address + at) & 0xffff));
    }

    return bytes;
  }

  /** Writes a block's bytes into the segment, at an address of it. */
  #writeAt(address, bytes) {
    if (!this.mirror) {
      return;
    }

    for (let at = 0; at < bytes.length; at++) {
      this.mirror.memory.write8(this.mirror.base + ((address + at) & 0xffff), bytes[at]);
    }
  }

  /** Frees a block's data, leaving any handle to it. */
  #release(address) {
    const index = this._allocations.findIndex(
      (allocation) => allocation[0] === address - 2 && allocation[2]
    );

    if (index >= 0) {
      this._allocations.splice(index, 1);
    }
  }

  /**
   * Moves movable sections of memory to create free space.
   */
  defragment() {}
}

export default Heap;
