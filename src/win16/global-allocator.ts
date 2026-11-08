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
 * Selector 40h: the BIOS's data area, at 400h of the first megabyte, as
 * DOS's extender gives it to programs in the global table. A C runtime
 * clears the BIOS's midnight flag through it when the clock says a day has
 * turned; Hearts, Cribbage and Solitaire programs of the corpus do, as
 * they start. KERNEL exports another for it, `__0040H`
 * (`FIRST_MEGABYTE_SELECTORS`).
 */
export const BIOS_DATA_SELECTOR = 0x40;

/**
 * Where the machine's first megabyte is, as the selectors for its fixed
 * places reach it: not at nought, where a program's segments are, one to a
 * 64 KiB from index 1 -- 0A0000h is index 0Ah's -- but above anything a
 * program is given, just below the global table. What a program reads
 * there is the machine's, as the selectors' bases are; how far each is
 * from the first is Windows' (`kconst`).
 */
export const FIRST_MEGABYTE = 0xffe00000;

/**
 * The selectors KERNEL makes for the first megabyte's fixed places as it
 * starts and exports as constants -- `__E000H`, `__D000H`, `__C000H`,
 * `__B800H`, `__B000H`, `__A000H`, `__F000H` (and `__ROMBIOS`), `__0040H`
 * and `__0000H` -- each with the paragraph its entry in `KRNL386.EXE`'s
 * file holds, in the order KERNEL gives them, one after another in the
 * local table. **Recorded** by `kconst`: 227h up to 267h, each a data
 * segment of 64 KiB from its paragraph, not yet accessed (F2h). Here they
 * are the nine indices below the interrupt descriptor table's, 0FFDh, where
 * no block reaches: not the table's last, which stay empty, as the
 * selectors past the end of Windows' smaller table are, which a program may
 * count on faulting (`fault`, `badptr`, `badarg` load 0FFF7h).
 */
export const FIRST_MEGABYTE_SELECTORS: [paragraph: number, index: number][] = [
  [0xe000, 0xff4],
  [0xd000, 0xff5],
  [0xc000, 0xff6],
  [0xb800, 0xff7],
  [0xb000, 0xff8],
  [0xa000, 0xff9],
  [0xf000, 0xffa],
  [0x0040, 0xffb],
  [0x0000, 0xffc],
];

/**
 * Where the descriptors of programs' module databases are found from: above
 * any block, program or module winbox.js keeps (`Win16.load`).
 */
export const MODULE_DATABASES = 0x1e00;

/** The selector for a paragraph of the first megabyte KERNEL exports one for. */
export function firstMegabyteSelector(paragraph: number) {
  const found = FIRST_MEGABYTE_SELECTORS.find(([each]) => each === paragraph);

  return found ? (found[1] << 3) | 7 : undefined;
}

export class GlobalAllocator {
  declare _cpu: any;
  declare _memory: any;
  declare _usedMap: any;

  /**
   * The descriptors given back, the last on top. KERNEL keeps one list of
   * free selectors for every block, a module's segments and its own blocks
   * among them: a selector freed goes to its head (**read out**,
   * `KRNL386.EXE` seg1 `2009`-`2044`), and one asked for alone is the head
   * taken (`1e33`-`1e54`). **Recorded** by `greuse` and `segfree`.
   */
  #freed: number[] = [];

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
    this.#freed = [];
    this._cpu.core.ldtBase = LDT_BASE;
    this._cpu.core.ldtLimit = 8 * SELECTORS - 1;
    this._memory.zero(LDT_BASE, 8 * SELECTORS);

    this._cpu.core.gdtBase = GDT_BASE;
    this._cpu.core.gdtLimit = 8 * GDT_ENTRIES - 1;
    this._memory.zero(GDT_BASE, 8 * GDT_ENTRIES);

    const describe = (at: number, base: number, access: number) => {
      this._memory.write16(at, 0xffff);
      this._memory.write16(at + 2, base & 0xffff);
      this._memory.write8(at + 4, (base >>> 16) & 0xff);
      this._memory.write8(at + 5, access);
      this._memory.write8(at + 6, 0);
      this._memory.write8(at + 7, (base >>> 24) & 0xff);
    };

    /* 64 KiB of data from 400h of the first megabyte, writable at a
     * program's privilege. */
    describe(GDT_BASE + (BIOS_DATA_SELECTOR & 0xfff8), FIRST_MEGABYTE + 0x400, 0xf3);

    /* The first megabyte's selectors, never given to a block. */
    for (const [paragraph, index] of FIRST_MEGABYTE_SELECTORS) {
      this._usedMap[index] = true;
      describe(LDT_BASE + 8 * index, FIRST_MEGABYTE + paragraph * 16, 0xf2);
    }
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
    this.#forget(segment);

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
   * A descriptor made or changed, forgotten by the processor's cache of
   * them under each of its selectors, so the new one is read from the table.
   * Bubble Girl reads a bitmap's bits through their selector and deletes the
   * bitmap, and a lookup after cached the emptied descriptor; given the
   * selector again at once, the next block -- a window's name, in `InitApp`
   * -- was reached through that, and faulted. A changed one, because once
   * Windows has changed a descriptor the program reaches the new one: the
   * `segreg` probe loads FS with a block's selector, and after GlobalReAlloc
   * moves the block FS no longer holds it, and DS comes back from a call by
   * POP, which reads the table again. Star Merc grows a local heap with
   * LocalAlloc and reads it with lstrlen past the old limit. Not forgotten
   * when a block is freed: a segment register holding the selector keeps
   * the descriptor it loaded, as the part's does.
   */
  #forget(segment) {
    const cache = this._cpu.core._translationCache;

    if (cache) {
      for (let rpl = 0; rpl < 8; rpl++) {
        cache[(segment << 3) | rpl] = undefined;
      }
    }
  }

  /**
   * A segment's limit, its last offset, in bytes: up to twenty bits, so that
   * the first selector of a block past 64 KiB reaches all of it, as `LSL`
   * shows on Windows.
   */
  setLimit(segment, limit) {
    const base = this._cpu.core.ldtBase + 8 * segment;

    this.#forget(segment);

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
    this.#forget(index);

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

    this.#forget(to);

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
    this.#forget(index);

    const base = this._cpu.core.ldtBase + 8 * index;

    for (let at = 0; at < 8; at++) {
      this._memory.write8(base + at, 0);
    }

    this._memory.write8(base + 5, 0xf2);

    return index;
  }

  /** A descriptor's base changed, its limit and rights kept. */
  setBase(segment, base) {
    const entry = this._cpu.core.ldtBase + 8 * segment;

    this.#forget(segment);
    this._memory.write16(entry + 2, base & 0xffff);
    this._memory.write8(entry + 4, (base >>> 16) & 0xff);
    this._memory.write8(entry + 7, (base >>> 24) & 0xff);
  }

  /** A descriptor's access byte (5) and its byte 6, its limit's top and its flags. */
  rightsOf(segment) {
    const entry = this._cpu.core.ldtBase + 8 * segment;

    return this._memory.read8(entry + 5) | (this._memory.read8(entry + 6) << 8);
  }

  setRights(segment, rights) {
    const entry = this._cpu.core.ldtBase + 8 * segment;

    this.#forget(segment);
    this._memory.write8(entry + 5, rights & 0xff);
    this._memory.write8(entry + 6, (rights >>> 8) & 0xff);
  }

  /**
   * `count` descriptors one after another, each data at nought with no
   * limit, its access byte F3h: what `AllocSelectorArray` makes. The first's
   * index, or -1.
   */
  blankRun(count) {
    const index = this.find(1, count);

    if (index < 0) {
      return -1;
    }

    for (let at = index; at < index + count; at++) {
      this._usedMap[at] = true;
      this.#forget(at);

      const entry = this._cpu.core.ldtBase + 8 * at;

      for (let byte = 0; byte < 8; byte++) {
        this._memory.write8(entry + byte, 0);
      }

      this._memory.write8(entry + 5, 0xf3);
    }

    return index;
  }

  /** Whether a descriptor is given out. */
  used(segment: number) {
    return !!this._usedMap[segment];
  }

  /**
   * A descriptor marked given or free, its bytes left as they are: the
   * DPMI host's, which writes them itself (`dpmi.ts`).
   */
  claim(segment: number, given = true) {
    this._usedMap[segment] = given;
    this.#forget(segment);
  }

  /** A descriptor given up: emptied, and free to be found again. */
  release(segment) {
    this.unmap(segment);
    this._usedMap[segment] = false;
  }

  /**
   * A descriptor for one selector: the one given back last that is free
   * still, else the first free from `start`. Its index, or -1; not yet
   * marked given.
   */
  take(start = 1) {
    while (this.#freed.length) {
      const index = this.#freed.pop()!;

      if (!this._usedMap[index]) {
        return index;
      }
    }

    return this.find(start);
  }

  /** A descriptor given back: emptied, and the next `take` answers it. */
  give(segment) {
    this.release(segment);
    this.#freed.push(segment);
  }

  /**
   * A descriptor taken for a block of Windows' own that WinBox keeps
   * nothing in -- a task's database, its second selector, its message
   * queue (`Win16.load`) -- so that the selectors around it are given as
   * Windows gives them: data, at nought, not yet accessed. Its index, or -1.
   */
  reserve(start = 1) {
    const index = this.take(start);

    if (index < 0) {
      return -1;
    }

    this._usedMap[index] = true;
    this.#forget(index);

    const base = this._cpu.core.ldtBase + 8 * index;

    for (let at = 0; at < 8; at++) {
      this._memory.write8(base + at, 0);
    }

    this._memory.write8(base + 5, 0xf2);

    return index;
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
