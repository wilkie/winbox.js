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
 * It runs only where it reads the machine as the JavaScript core would: a
 * 16-bit stack, no trap flag, and segments it can check by an upper limit;
 * code 16-bit or 32-bit, a segment's D bit carried in its entry's
 * `attributes`. Anything else is left to the JavaScript core whole.
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
const LOAD_COUNT = 40;
const LOADS = 41;
const STATE_WORDS = 49;

/**
 * The quick calls' block (`crates/winbox-wasm`'s `QuickState`), in bytes:
 * the words `enabled`, `thunk_count`, `virtual_clock` and `logged`; the
 * clock's doubles from 16; the thunks, 16 bytes each, from 56; the log, 32
 * bytes a call, from 312.
 */
const QUICK_BYTES = 312 + 32 * 32;
const QUICK_THUNKS = 16;
const QUICK_CLOCK = 16;
const QUICK_THUNK_AT = 56;
const QUICK_LOG_AT = 312;

/**
 * Calls to Windows the Rust core answers itself (`crates/winbox-cpu`'s
 * `quick.rs`) -- the ones a program polls with -- as whoever answers them
 * otherwise gives them: for a run, whether and which, at what charge, and
 * the virtual clock, or `null` for none; and after it, the instructions
 * the calls were charged and the calls answered, to be told as if they had
 * been made the usual way.
 */
export interface QuickCalls {
  prepare(instructions: number): QuickRun | null;
  finish(charged: number, calls: QuickCall[]): void;
}

export interface QuickRun {
  /** Changes whenever `thunks` does, so they are written only then. */
  version: number;
  thunks: { linear: number; function: number; charge: number }[];
  clock: { rate: number; charged: number; skipped: number; nextDue: number } | null;
}

export interface QuickCall {
  function: number;
  /** The caller's CS and IP, as the thunk saw them, in the high and low words. */
  caller: number;
  /** The words of arguments on the stack, from the last argument. */
  args: number[];
  result: number;
}

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

  /** The quick calls' block, as words, half-words and doubles. */
  #quickWords!: Uint32Array;
  #quickHalves!: Uint16Array;
  #quickDoubles!: Float64Array;
  /** The thunks' version last written there. */
  #quickVersion = -1;

  /** Why the last run stopped: `last_exit`'s answer, or -1 where none ran. */
  exit = EXIT_BUDGET;

  /** The JavaScript core's segment registers, in the order the state keeps them. */
  static readonly SEGMENT_NAMES = ['es', 'cs', 'ss', 'ds', 'fs', 'gs'];

  constructor(module: WebAssembly.Module, memory: Memory) {
    const instance = new WebAssembly.Instance(module, { env: { memory: memory.wasm } });

    this.#exports = instance.exports;
    this.#memory = memory;
    this.#state = new Uint32Array(memory.wasm.buffer, this.#exports.state_ptr(), STATE_WORDS);
    this.#quickViews();
  }

  /** Views of the quick calls' block, made again with the state's. */
  #quickViews() {
    const buffer = this.#memory.wasm.buffer;
    const at = this.#exports.quick_ptr();

    this.#quickWords = new Uint32Array(buffer, at, QUICK_BYTES / 4);
    this.#quickHalves = new Uint16Array(buffer, at, QUICK_BYTES / 2);
    this.#quickDoubles = new Float64Array(buffer, at, QUICK_BYTES / 8);
  }

  /** The quick calls of a run written into the block: off where `plan` is `null`. */
  #quickBefore(plan: QuickRun | null, instructions: number) {
    const words = this.#quickWords;

    words[3] = 0;

    if (!plan) {
      words[0] = 0;
      return;
    }

    words[0] = 1;

    if (plan.version !== this.#quickVersion) {
      const count = Math.min(plan.thunks.length, QUICK_THUNKS);

      for (let index = 0; index < count; index++) {
        const thunk = plan.thunks[index];
        const at = QUICK_THUNK_AT + 16 * index;

        words[at / 4] = thunk.linear;
        words[at / 4 + 1] = thunk.function;
        this.#quickDoubles[at / 8 + 1] = thunk.charge;
      }

      words[1] = count;
      this.#quickVersion = plan.version;
    }

    const clock = plan.clock;

    words[2] = clock ? 1 : 0;

    if (clock) {
      const doubles = this.#quickDoubles;
      const at = QUICK_CLOCK / 8;

      doubles[at] = clock.rate;
      doubles[at + 1] = instructions;
      doubles[at + 2] = clock.charged;
      doubles[at + 3] = clock.skipped;
      doubles[at + 4] = clock.nextDue;
    }
  }

  /** The calls a run answered, and what they were charged, told to `quick`. */
  #quickAfter(quick: QuickCalls, plan: QuickRun) {
    const words = this.#quickWords;
    const logged = words[3];
    const charged = plan.clock ? this.#quickDoubles[QUICK_CLOCK / 8 + 2] - plan.clock.charged : 0;

    if (!logged && !charged) {
      return;
    }

    const calls: QuickCall[] = [];

    for (let index = 0; index < logged; index++) {
      const at = QUICK_LOG_AT + 32 * index;
      const args: number[] = [];

      for (let word = 0; word < 8; word++) {
        args.push(this.#quickHalves[(at + 8) / 2 + word]);
      }

      calls.push({
        function: words[at / 4],
        caller: words[at / 4 + 1],
        args,
        result: words[at / 4 + 6],
      });
    }

    quick.finish(charged, calls);
  }

  /** The state block, again if the memory grew and let go of the buffer it was in. */
  #view() {
    if (this.#state.buffer !== this.#memory.wasm.buffer) {
      this.#state = new Uint32Array(
        this.#memory.wasm.buffer,
        this.#exports.state_ptr(),
        STATE_WORDS
      );
      this.#quickViews();
    }

    return this.#state;
  }

  /**
   * Runs up to `budget` instructions of `core`'s machine, the registers
   * passed over and back: how many ran. `exit` says why it stopped.
   */
  run(core: any, budget: number, quick: QuickCalls | null = null, instructions = 0): number {
    const state = this.#view();
    const cache = core._translationCache;
    const names = WasmCore.SEGMENT_NAMES;

    /* What this core cannot follow is left to the JavaScript one. */
    const cs = cache[core.cs] ?? core.retrieveDescriptor(core.cs);
    const ss = cache[core.ss] ?? core.retrieveDescriptor(core.ss);

    if (ss.addressSize || core.f & TRAP) {
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
        state[at + 3] = descriptor.addressSize ? 1 : 0;
        this.#written[index] = descriptor;
        this.#selectors[index] = selector;
      }
    }

    const plan = quick ? quick.prepare(instructions) : null;

    this.#quickBefore(plan, instructions);

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

    const loaded = state[LOADED];

    /* Every selector the run loaded has its descriptor read afresh, as the
     * JavaScript core's loads read it: one loaded and then replaced in the
     * same run would otherwise keep what was cached for it before. One a
     * register holds at the end is read below, as that register is loaded. */
    for (let at = 0; at < state[LOAD_COUNT]; at++) {
      const selector = state[LOADS + at];
      let held = false;

      for (let index = 0; index < 6; index++) {
        if (loaded & (1 << index) && state[SEGMENTS + index * 4] === selector) {
          held = true;
        }
      }

      if (!held) {
        cache[selector] = core.freshDescriptor(selector);
      }
    }

    /* A segment register the run loaded is loaded here as the JavaScript
     * core loads one unchecked -- the Rust core made any checks -- which
     * reads its descriptor afresh into the cache; its entry in the state is
     * written again next run, from that. */
    for (let index = 0; loaded >> index; index++) {
      if (loaded & (1 << index)) {
        core.writeSegmentRegister(index, state[SEGMENTS + index * 4]);

        /* Its entry in the state is the Rust core's own reading of it, which
         * the JavaScript core's descriptor -- often the very one it had,
         * unchanged -- is written over next run. */
        this.#written[index] = null;
      }
    }

    if (quick && plan) {
      this.#quickAfter(quick, plan);
    }

    return ran;
  }
}
