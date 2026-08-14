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
 *
 * It carries what it was reaching for, which is the whole of what anyone
 * debugging one wants to know. It deliberately does not extend `Error`: this
 * is thrown for every segment violation, including the forty thousand the
 * conformance corpus expects, and capturing a stack trace each time would cost
 * more than the information is worth there.
 */
export class MemoryFault {
  declare selector: any;
  declare offset: any;
  declare size: any;

  constructor(selector?, offset?, size?) {
    this.selector = selector;
    this.offset = offset;
    this.size = size;
  }

  /** A description, for the cases where one escapes into host code. */
  get message() {
    if (this.selector === undefined) {
      return 'access outside a segment';
    }

    const at = `${this.selector.toString(16)}:${(this.offset ?? 0).toString(16)}`;

    return `access of ${this.size ?? '?'} bytes at ${at} ran outside its segment`;
  }
}

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
