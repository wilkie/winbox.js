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

/**
 * Where the global descriptor table is kept, just below the local one: a few
 * descriptors Windows keeps there for every program, which the table bit of
 * their selectors says are not a task's.
 */
const GDT_BASE = 0xfffef000;
const GDT_ENTRIES = 32;

/**
 * Selector 40h: the BIOS's data area, at 400h, as Windows gives it to
 * programs and exports it as `__0040H`. A C runtime clears the BIOS's
 * midnight flag through it when the clock says a day has turned; Hearts,
 * Cribbage and Solitaire programs of the corpus do, as they start.
 */
export const BIOS_DATA_SELECTOR = 0x40;

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

    this._cpu.core.gdtBase = GDT_BASE;
    this._cpu.core.gdtLimit = 8 * GDT_ENTRIES - 1;
    this._memory.zero(GDT_BASE, 8 * GDT_ENTRIES);

    /* 64 KiB of data from 400h, writable at a program's privilege. */
    const bios = GDT_BASE + (BIOS_DATA_SELECTOR & 0xfff8);

    this._memory.write16(bios, 0xffff);
    this._memory.write16(bios + 2, 0x0400);
    this._memory.write8(bios + 4, 0);
    this._memory.write8(bios + 5, 0xf3);
    this._memory.write8(bios + 6, 0);
    this._memory.write8(bios + 7, 0);
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
   * A second descriptor for a segment's memory: the same base and limit,
   * code or data as asked. Its index, or -1 with none free.
   */
  alias(segment, code: boolean) {
    const index = this.find();

    if (index < 0) {
      return -1;
    }

    this._usedMap[index] = true;

    const from = this._cpu.core.ldtBase + 8 * segment;
    const to = this._cpu.core.ldtBase + 8 * index;

    for (let at = 0; at < 8; at++) {
      this._memory.write8(to + at, this._memory.read8(from + at));
    }

    this._memory.write8(to + 5, code ? 0xfb : 0xf3);

    return index;
  }

  /**
   * One descriptor made a copy of another, with its type swapped between
   * code and data: what `PrestoChangoSelector` does.
   */
  copySwapped(from, to) {
    const source = this._cpu.core.ldtBase + 8 * from;
    const target = this._cpu.core.ldtBase + 8 * to;

    for (let at = 0; at < 8; at++) {
      this._memory.write8(target + at, this._memory.read8(source + at));
    }

    this._memory.write8(target + 5, this._memory.read8(source + 5) & 0x08 ? 0xf3 : 0xfb);
  }

  /** A descriptor for nothing yet: data, at nought, not yet accessed. Its index, or -1. */
  blank(start = 1) {
    const index = this.find(start);

    if (index < 0) {
      return -1;
    }

    this._usedMap[index] = true;

    const base = this._cpu.core.ldtBase + 8 * index;

    for (let at = 0; at < 8; at++) {
      this._memory.write8(base + at, 0);
    }

    this._memory.write8(base + 5, 0xf2);

    return index;
  }

  /** A descriptor given up: emptied, and free to be found again. */
  release(segment) {
    this.unmap(segment);
    this._usedMap[segment] = false;
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
