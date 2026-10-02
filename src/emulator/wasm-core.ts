'use strict';

import { type Memory } from './memory.js';

/**
 * The Rust core, in WebAssembly (`crates/winbox-wasm`), run beside the
 * JavaScript one on the same machine.
 *
 * The two share the machine's memory outright: the WebAssembly module
 * imports the memory `Memory` keeps it in. Registers they pass between
 * them: before a run the JavaScript core's are written into the module's
 * state block, and after it they are read back. The Rust core runs until
 * the budget is spent or it meets an instruction it leaves to JavaScript --
 * one it does not interpret yet, a fault, memory only JavaScript can answer
 * for -- and stops before it, for the JavaScript core to run.
 *
 * It runs only where it reads the machine as the JavaScript core would:
 * 16-bit code and a 16-bit stack, no trap flag, and segments it can check
 * by an upper limit. Anything else is left to the JavaScript core whole.
 */

/** The state block's layout, as `crates/winbox-wasm`'s `State` has it, in words. */
const IP = 8;
const FLAGS = 9;
const PROTECTED = 10;
const GDT_BASE = 11;
const SEGMENTS = 12;
const GDT_LIMIT = 36;
const LDT_BASE = 37;
const LDT_LIMIT = 38;
const LOADED = 39;
const STATE_WORDS = 40;

/** Why a run stopped, as `last_exit` answers. */
export const EXIT_BUDGET = 0;
export const EXIT_HALT = 1;

const TRAP = 0x100;

export class WasmCore {
  readonly #exports: any;
  readonly #memory: Memory;

  /** The state block, as words: WebAssembly's memory is little-endian. */
  #state: Uint32Array;

  /**
   * The descriptor each segment register's entry in the state was last
   * written from, and its selector: an entry is written again only when
   * one of them is another. The JavaScript core makes a descriptor anew
   * when it loads a segment register, and never changes one.
   */
  readonly #written: any[] = new Array(6).fill(null);
  readonly #selectors: number[] = new Array(6).fill(-1);

  /** Why the last run stopped: `last_exit`'s answer, or -1 where none ran. */
  exit = EXIT_BUDGET;

  /** The JavaScript core's segment registers, in the order the state keeps them. */
  static readonly SEGMENT_NAMES = ['es', 'cs', 'ss', 'ds', 'fs', 'gs'];

  constructor(module: WebAssembly.Module, memory: Memory) {
    const instance = new WebAssembly.Instance(module, { env: { memory: memory.wasm } });

    this.#exports = instance.exports;
    this.#memory = memory;
    this.#state = new Uint32Array(memory.wasm.buffer, this.#exports.state_ptr(), STATE_WORDS);
  }

  /** The state block, again if the memory grew and let go of the buffer it was in. */
  #view() {
    if (this.#state.buffer !== this.#memory.wasm.buffer) {
      this.#state = new Uint32Array(
        this.#memory.wasm.buffer,
        this.#exports.state_ptr(),
        STATE_WORDS
      );
    }

    return this.#state;
  }

  /**
   * Runs up to `budget` instructions of `core`'s machine, the registers
   * passed over and back: how many ran. `exit` says why it stopped.
   */
  run(core: any, budget: number): number {
    const state = this.#view();
    const cache = core._translationCache;
    const names = WasmCore.SEGMENT_NAMES;

    /* What this core cannot follow is left to the JavaScript one. */
    const cs = cache[core.cs] ?? core.retrieveDescriptor(core.cs);
    const ss = cache[core.ss] ?? core.retrieveDescriptor(core.ss);

    if (cs.addressSize || ss.addressSize || core.f & TRAP) {
      this.exit = -1;
      return 0;
    }

    const registers = core._registers;

    for (let index = 0; index < 8; index++) {
      state[index] = registers[index];
    }

    state[IP] = core.ip;
    state[FLAGS] = core.f;
    state[PROTECTED] = core.cr0 & 1;
    state[GDT_BASE] = core.gdtBase ?? 0;
    state[GDT_LIMIT] = core.gdtLimit ?? 0;
    state[LDT_BASE] = core.ldtBase ?? 0;
    state[LDT_LIMIT] = core.ldtLimit ?? 0;

    for (let index = 0; index < 6; index++) {
      const selector = core[names[index]];
      const descriptor =
        index === 1
          ? cs
          : index === 2
            ? ss
            : (cache[selector] ?? core.retrieveDescriptor(selector));

      if (descriptor !== this.#written[index] || selector !== this.#selectors[index]) {
        const at = SEGMENTS + index * 4;
        /* A segment only a lower bound or its absence can stop -- expand-down,
         * not present, the null selector -- is given no room at all: any
         * access through it stops the run, and the JavaScript core faults. */
        const plain = descriptor.present && !descriptor.nullSelector && !descriptor.lowLimit;

        state[at] = selector;
        state[at + 1] = descriptor.base;
        state[at + 2] = plain ? descriptor.pastLimit : 0;
        this.#written[index] = descriptor;
        this.#selectors[index] = selector;
      }
    }

    const ran = this.#exports.run(budget);

    this.exit = this.#exports.last_exit();

    for (let index = 0; index < 8; index++) {
      registers[index] = state[index];
    }

    core.ip = state[IP] & 0xffff;

    /* Only the flags an instruction sets: the rest, IF and IOPL among them,
     * are as the JavaScript core had them. */
    if (ran > 0) {
      core.f = state[FLAGS];
    }

    /* A segment register the run loaded is loaded here as the JavaScript
     * core loads one unchecked -- the Rust core made any checks -- which
     * reads its descriptor afresh into the cache; its entry in the state is
     * written again next run, from that. */
    const loaded = state[LOADED];

    for (let index = 0; loaded >> index; index++) {
      if (loaded & (1 << index)) {
        core.writeSegmentRegister(index, state[SEGMENTS + index * 4]);
      }
    }

    return ran;
  }
}
