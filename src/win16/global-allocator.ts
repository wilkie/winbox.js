/**
 * This exposes the global (segment) allocator of the 16-bit system.
 *
 * We are making it rather easy on ourselves by assuming we have infinite
 * memory. So, segments more or less point to continuous 64K blocks.
 *
 * That is, the memory is 1:1 mapped.
 */
/**
 * Where the local descriptor table is kept.
 *
 * Above anything a guest addresses, since the table is ours rather than the
 * program's, and the program reaches its segments through selectors instead.
 */
const LDT_BASE = 0xffff0000;

/** How many descriptors the table has room for, which is the architecture's. */
const SELECTORS = 8192;

export class GlobalAllocator {
  declare _cpu: any;
  declare _memory: any;
  declare _usedMap: any;
  constructor(cpu, memory) {
    this._memory = memory;
    this._cpu = cpu;
    this._usedMap = new Array(8192);

    // Segment 0 is a system segment always
    this._usedMap[0] = true;

    this.reset();
  }

  reset() {
    /* A task's segments live in the local descriptor table, which is where
     * Windows puts them -- the table bit is part of every selector a program
     * sees, so this is not an implementation detail we get to choose. See
     * selectors.ts, and oracle/fixtures/handles.json for the recording.
     */
    this._cpu.core.ldtBase = LDT_BASE;
    this._cpu.core.ldtLimit = 8 * SELECTORS - 1;
    this._memory.zero(LDT_BASE, 8 * SELECTORS);
  }

  /**
   * Retrieves the connected cpu object.
   */
  get cpu() {
    return this._cpu;
  }

  /**
   * Retrieves the connected memory object.
   */
  get memory() {
    return this._memory;
  }

  /**
   * Maps in the given segment with the given access options to the system.
   *
   * We can provide initial data for the segment.
   *
   * Its descriptor is a program's, as Windows makes them: privilege 3, code
   * readable and data writable, the accessed bit already set -- FBh for code
   * and F3h for data, as `LAR` reads them in the `selinfo` recording.
   * `code` says which; `limit`, the last offset, when not the whole 64 KiB.
   */
  map(segment, data, options: { code?: boolean; limit?: number } = {}) {
    if (this._usedMap[segment]) {
      console.log('OH NO. OVERWRITING SEGMENT.');
    }

    this._usedMap[segment] = true;

    // Modify the descriptor table to point to the segment
    const base = this._cpu.core.ldtBase + 8 * segment;

    // Limit of 0xffff (64K)
    this._memory.write16(base, 0xffff);

    // Base (1:1 mapping, so 64K * segment index)
    const segmentBase = segment << 16;
    this._memory.write16(base + 2, segmentBase & 0xffff);
    this._memory.write8(base + 4, (segmentBase >> 16) & 0xff);
    this._memory.write8(base + 7, (segmentBase >> 24) & 0xff);

    this._memory.write8(base + 5, options.code ? 0xfb : 0xf3);
    this._memory.write8(base + 6, 0);

    if (options.limit !== undefined) {
      this.setLimit(segment, options.limit);
    }

    // Copy the memory into the segment
    this._memory.write(segment << 16, data);
  }

  /**
   * A segment's limit, its last offset, in bytes: up to twenty bits, so that
   * the first selector of a block past 64 KiB reaches all of it, as `LSL`
   * shows on Windows.
   */
  setLimit(segment, limit) {
    const base = this._cpu.core.ldtBase + 8 * segment;

    limit = Math.max(0, Math.min(limit, 0xfffff));
    this._memory.write16(base, limit & 0xffff);
    this._memory.write8(base + 6, (this._memory.read8(base + 6) & 0xf0) | ((limit >>> 16) & 0x0f));
  }

  /**
   * A freed segment's descriptor emptied: `LAR`, `LSL`, `VERR` and `VERW`
   * refuse its selector, as they do on Windows, and any use of it faults.
   */
  unmap(segment) {
    const base = this._cpu.core.ldtBase + 8 * segment;

    for (let at = 0; at < 8; at++) {
      this._memory.write8(base + at, 0);
    }
  }

  /**
   * Finds an unallocated segment or set of sequential unallocated segments.
   */
  find(start = 1, count = 1) {
    for (let i = start; i < this._usedMap.length; i++) {
      let j = 0;
      for (; j < count; j++) {
        if (this._usedMap[i + j]) {
          break;
        }
      }

      if (j == count) {
        return i;
      }
    }

    return -1;
  }
}
