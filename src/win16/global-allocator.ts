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
   */
  map(segment, data, options = {}) {
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

    // Write flags
    const flags = 0x80 | 0x10; // Present | Code
    this._memory.write8(base + 5, flags);
    this._memory.write8(base + 6, 0);

    // Copy the memory into the segment
    this._memory.write(segment << 16, data);
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
