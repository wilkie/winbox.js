'use strict';

/**
 * The things execution can end with instead of finishing.
 *
 * These live apart from `CPU` because the execution cores raise them and the
 * cores are what `CPU` is built out of. Importing them from `cpu.ts` made a
 * cycle -- the cores reached back into the module that was still busy
 * constructing them -- which surfaced as classes being unreadable at load time,
 * and only for some orders of import, which is the worst way for it to
 * surface.
 */

/**
 * An access that ran past the end of its segment.
 *
 * The fault has already been raised by the time this is thrown; what it means
 * is that the instruction does not complete.
 */
export class MemoryFault {}

export class InvalidInstruction {
  declare _callback: any;
  declare _instruction: any;
  constructor(instruction, callback?) {
    this._instruction = instruction;
    this._callback = callback;
  }

  get callback() {
    return this._callback;
  }
}
