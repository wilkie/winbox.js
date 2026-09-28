'use strict';

import { segmentSelector } from './selectors.js';
import { Loader } from './loader.js';
import { winFlags } from './kernel/GetWinFlags.js';

/**
 * KERNEL's exports that are numbers rather than functions, which a program
 * reads where its relocation puts them: in protected mode a huge pointer's
 * selector steps by 8, a shift of 3 (`__AHINCR`, `__AHSHIFT`), and
 * `__WINFLAGS` is what `GetWinFlags` answers. `COMMDLG.DLL`'s entry point
 * reads `__WINFLAGS` and takes another path when bit 15 is set.
 */
const CONSTANTS: Record<string, Record<number, (coprocessor: boolean) => number>> = {
  KERNEL: {
    113: () => 3,
    114: () => 8,
    178: (coprocessor) => winFlags(coprocessor) & 0xffff,
    /* `__0040H`: the BIOS data area's selector (see `global-allocator.ts`). */
    193: () => 0x40,
  },
};

/**
 * What KERNEL adds to a site of each OS fixup's type as it loads a segment
 * (`KRNL386.EXE` seg1 `7536`, tables at `74f3`): the word at the site and
 * the word a byte after. The site holds a floating-point instruction as
 * the compiler wrote it, `FWAIT` first. Without a coprocessor, types 1 to 5
 * make it `INT 34h` to `3Ch`, the emulator's; with one, the `FWAIT` becomes
 * `NOP`. Type 6, a lone `FWAIT`, becomes `INT 3Dh` either way.
 */
const OS_FIXUPS: Record<number, { without: [number, number]; with: [number, number] }> = {
  1: { without: [0xfe32, 0x4000], with: [0xfff5, 0] },
  2: { without: [0x0632, 0x8000], with: [0xfff5, 0] },
  3: { without: [0x0e32, 0xc000], with: [0xfff5, 0] },
  4: { without: [0x1632, 0], with: [0xfff5, 0] },
  5: { without: [0x5c32, 0], with: [0xfff5, 0] },
  6: { without: [0xa23d, 0], with: [0xa23d, 0] },
};

/** A number a module exports rather than a function, by its ordinal: undefined for none. */
export function exportedConstant(module: string, ordinal: number, coprocessor = true) {
  return CONSTANTS[String(module).toUpperCase()]?.[ordinal]?.(coprocessor);
}

/**
 * The ordinal a module exports a procedure's name as, 0 if none: a module
 * loaded from its file by its name tables, one of winbox.js's own by its
 * exports' names.
 */
export function ordinalFor(module: any, name: string | undefined) {
  if (!name) {
    return 0;
  }

  if (typeof module.ordinalOf === 'function') {
    return module.ordinalOf(name);
  }

  const exports = module.instance?.exports ?? module.exports;
  const wanted = String(name).toUpperCase();

  if (!Array.isArray(exports)) {
    return 0;
  }

  const index = exports.findIndex((entry) => entry && String(entry[1]).toUpperCase() === wanted);

  return index > 0 ? index : 0;
}

/**
 * This links executables after being loaded into memory.
 */
export class Linker {
  declare _memory: any;
  declare _modules: any;
  /** Whether the machine has a coprocessor: what `__WINFLAGS` says, and which OS fixups apply. */
  declare coprocessor: boolean;

  constructor(memory, modules, options: { coprocessor?: boolean } = {}) {
    this._memory = memory;
    this._modules = modules;
    this.coprocessor = options.coprocessor ?? true;
  }

  get memory() {
    return this._memory;
  }

  get modules() {
    return this._modules;
  }

  /**
   * Retrieves a list of external libraries it must have to link.
   */
  requirementsFor(task) {
    const ret = [];

    // Go through the relocations and see the required modules
    task.loader.segments.forEach((segment, _i) => {
      segment.relocations.forEach((relocation) => {
        if (relocation.type == Loader.RELOCATION_IMPORT) {
          const module = this.modules.fromName(relocation.from);

          if (!module) {
            // We do not have this module loaded already
            if (ret.indexOf(relocation.from) < 0) {
              ret.push(relocation.from);
            }
          }
        }
      });
    });

    return ret;
  }

  /**
   * Links the executable.
   */
  link(task) {
    // Go through the relocations and link/load imported modules

    // Link each segment relocations
    task.loader.segments.forEach((segment, i) => {
      const segmentIndex = task.loader.translate(i + 1);
      const relocations = segment.relocations;

      relocations.sort((a, b) => a.offset - b.offset);

      relocations.forEach((relocation) => {
        if (relocation.type == Loader.RELOCATION_OSFIXUP) {
          const fixup = OS_FIXUPS[relocation.fixup];

          if (fixup) {
            const [low, high] = this.coprocessor ? fixup.with : fixup.without;
            const at = (segmentIndex << 16) + relocation.offset;

            this._memory.write16(at, (this._memory.read16(at) + low) & 0xffff);
            this._memory.write16(at + 1, (this._memory.read16(at + 1) + high) & 0xffff);
          }
        } else if (relocation.type == Loader.RELOCATION_IMPORT) {
          let module = this.modules.fromName(relocation.from);

          const constant = CONSTANTS[String(relocation.from).toUpperCase()]?.[relocation.ordinal];

          if (constant !== undefined && !(module instanceof Loader)) {
            /* A number, not a function: written where the program reads it. */
            this.writeRelocation16(relocation, segmentIndex, constant(this.coprocessor));
          } else if (module) {
            module = this.modules.load(module);

            /* Imported by name: the ordinal the module exports it as. */
            const ordinal = relocation.ordinal || ordinalFor(module, relocation.procedure);

            if (ordinal) {
              const info = module.lookup(ordinal);
              const segment = info.segment;
              const offset = info.offset;

              if (relocation.addressType == Loader.RELOCATION_ADDRESSTYPE_SEGMENT) {
                this.writeRelocation16(relocation, segmentIndex, segmentSelector(segment));
              } else if (relocation.addressType == Loader.RELOCATION_ADDRESSTYPE_FARADDR) {
                this.writeRelocation32(relocation, segmentIndex, segmentSelector(segment), offset);
              } else if (relocation.addressType == Loader.RELOCATION_ADDRESSTYPE_OFFSET) {
                this.writeRelocation16(relocation, segmentIndex, offset);
              }
            } else {
              console.log('HMM');
            }
          } else {
            console.log('WE NEED', relocation.from + '.DLL', '@', relocation.ordinal);
          }
        } else {
          // Internal relocation

          // Get the segment:offset that should be written (if fixed)
          let segment = relocation.segment;
          let offset = relocation.targetOffset;

          // Get the entrypoint for that ordinal (if movable)
          if (relocation.ordinal) {
            const entryPoint = task.executable.entryPoints[relocation.ordinal];
            segment = entryPoint.segment;
            offset = entryPoint.offset;
          }

          /* The executable numbers its segments from one; where each was put
           * is the loader's to say. The first module loaded has them at the
           * same numbers, a library after it does not. */
          segment = task.loader.translate(segment) ?? segment;

          if (relocation.addressType == Loader.RELOCATION_ADDRESSTYPE_SEGMENT) {
            this.writeRelocation16(relocation, segmentIndex, segmentSelector(segment));
          } else if (relocation.addressType == Loader.RELOCATION_ADDRESSTYPE_FARADDR) {
            this.writeRelocation32(relocation, segmentIndex, segmentSelector(segment), offset);
          } else if (relocation.addressType == Loader.RELOCATION_ADDRESSTYPE_OFFSET) {
            this.writeRelocation16(relocation, segmentIndex, offset);
          }
        }
      });
    });
  }

  /**
   * Writes the relocation data to the indicated memory for a 16-bit value.
   *
   * The value can be an offset or a segment number.
   *
   * @param {Object} relocation - The relocation metadata.
   * @param {number} destinationSegment - The segment to write.
   * @param {number} value - The value to write.
   */
  writeRelocation16(relocation, destinationSegment, value) {
    if (relocation.additive) {
      // Not a relocation chain... just add to the current value
      value += this._memory.read16((destinationSegment << 16) + relocation.offset);
      this._memory.write16((destinationSegment << 16) + relocation.offset, value);
    } else {
      let nextOffset = relocation.offset;
      let limit = 1000;
      while (limit > 0 && nextOffset != 0xffff) {
        // Get the next offset
        const thisOffset = nextOffset;
        nextOffset = this._memory.read16((destinationSegment << 16) + thisOffset);

        // Rewrite the code segment
        this._memory.write16((destinationSegment << 16) + thisOffset, value);

        limit--;
      }
    }
  }

  /**
   * Writes the relocation data to the indicated memory for a 32-bit pointer.
   *
   * The 32-bit pointer is provided in each 16-bit part: The segment and
   * offset values.
   *
   * @param {Object} relocation - The relocation metadata.
   * @param {number} destinationSegment - The segment to write.
   * @param {number} segment - The segment to write.
   * @param {number} offset - The offset to write.
   */
  writeRelocation32(relocation, destinationSegment, segment, offset) {
    if (relocation.additive) {
      // Not a relocation chain... just add to the current values
      offset += this._memory.read16((destinationSegment << 16) + relocation.offset);
      segment += this._memory.read16((destinationSegment << 16) + relocation.offset + 2);
      this._memory.write16((destinationSegment << 16) + relocation.offset, offset);
      this._memory.write16((destinationSegment << 16) + relocation.offset + 2, segment);
    } else {
      let nextOffset = relocation.offset;
      let limit = 1000;
      while (limit > 0 && nextOffset != 0xffff) {
        // Get the next offset
        const thisOffset = nextOffset;
        nextOffset = this._memory.read16((destinationSegment << 16) + thisOffset);

        // Rewrite the code segment
        this._memory.write16((destinationSegment << 16) + thisOffset, offset);
        this._memory.write16((destinationSegment << 16) + thisOffset + 2, segment);

        limit--;
      }
    }
  }
}
