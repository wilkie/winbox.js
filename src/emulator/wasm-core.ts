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

/** The state block's layout, as `crates/winbox-wasm`'s `State` has it. */
const IP = 32;
const FLAGS = 36;
const PROTECTED = 40;
const GDT_BASE = 44;
const SEGMENTS = 48;
const GDT_LIMIT = 144;
const LDT_BASE = 148;
const LDT_LIMIT = 152;
const LOADED = 156;
const STATE_SIZE = 160;

/** Why a run stopped, as `last_exit` answers. */
export const EXIT_BUDGET = 0;
export const EXIT_HALT = 1;

const TRAP = 0x100;

export class WasmCore {
  readonly #exports: any;
  #state: DataView;

  /** The JavaScript core's segment registers, in the order the state keeps them. */
  static readonly SEGMENT_NAMES = ['es', 'cs', 'ss', 'ds', 'fs', 'gs'];

  constructor(module: WebAssembly.Module, memory: Memory) {
    const instance = new WebAssembly.Instance(module, { env: { memory: memory.wasm } });

    this.#exports = instance.exports;
    this.#state = new DataView(memory.wasm.buffer, this.#exports.state_ptr(), STATE_SIZE);
    this.#memory = memory;
  }

  readonly #memory: Memory;

  /** The state block, again if the memory grew and let go of the buffer it was in. */
  #view() {
    if (this.#state.buffer !== this.#memory.wasm.buffer) {
      this.#state = new DataView(this.#memory.wasm.buffer, this.#exports.state_ptr(), STATE_SIZE);
    }

    return this.#state;
  }

  /**
   * Runs up to `budget` instructions of `core`'s machine, the registers
   * passed over and back: how many ran, and why it stopped.
   */
  run(core: any, budget: number): { ran: number; exit: number } {
    const state = this.#view();
    const descriptors: any[] = [];

    for (const name of WasmCore.SEGMENT_NAMES) {
      const selector = core[name];
      const descriptor = core._translationCache[selector] ?? core.retrieveDescriptor(selector);

      descriptors.push(descriptor);
    }

    /* What this core cannot follow is left to the JavaScript one. */
    const [, cs, ss] = descriptors;

    if (cs.addressSize || ss.addressSize || core.f & TRAP) {
      return { ran: 0, exit: -1 };
    }

    for (let index = 0; index < 8; index++) {
      state.setUint32(index * 4, core._registers[index] >>> 0, true);
    }

    state.setUint32(IP, core.ip, true);
    state.setUint32(FLAGS, core.f, true);
    state.setUint32(PROTECTED, core.cr0 & 1, true);
    state.setUint32(GDT_BASE, core.gdtBase ?? 0, true);
    state.setUint32(GDT_LIMIT, core.gdtLimit ?? 0, true);
    state.setUint32(LDT_BASE, core.ldtBase ?? 0, true);
    state.setUint32(LDT_LIMIT, core.ldtLimit ?? 0, true);

    descriptors.forEach((descriptor, index) => {
      const at = SEGMENTS + index * 16;
      /* A segment only a lower bound or its absence can stop -- expand-down,
       * not present, the null selector -- is given no room at all: any
       * access through it stops the run, and the JavaScript core faults. */
      const plain = descriptor.present && !descriptor.nullSelector && !descriptor.lowLimit;

      state.setUint32(at, core[WasmCore.SEGMENT_NAMES[index]], true);
      state.setUint32(at + 4, descriptor.base >>> 0, true);
      state.setUint32(at + 8, plain ? descriptor.pastLimit : 0, true);
    });

    const ran = this.#exports.run(budget);
    const exit = this.#exports.last_exit();

    for (let index = 0; index < 8; index++) {
      core._registers[index] = state.getUint32(index * 4, true) >>> 0;
    }

    core.ip = state.getUint32(IP, true) & 0xffff;

    /* Only the flags an instruction sets: the rest, IF and IOPL among them,
     * are as the JavaScript core had them. */
    const flags = state.getUint32(FLAGS, true);

    if (ran > 0) {
      core.f = flags;
    }

    /* A segment register the run loaded is loaded here as the JavaScript
     * core loads one unchecked -- the Rust core made any checks -- which
     * reads its descriptor afresh into the cache. */
    const loaded = state.getUint32(LOADED, true);

    for (let index = 0; loaded >> index; index++) {
      if (loaded & (1 << index)) {
        core.writeSegmentRegister(index, state.getUint32(SEGMENTS + index * 16, true));
      }
    }

    return { ran, exit };
  }
}
