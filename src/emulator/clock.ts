'use strict';

/**
 * The emulator's time: what `GetTickCount`, a message's time, a timer and
 * DOS's clock all read.
 *
 * Real, it is the host's wall clock since the system started, and waiting is
 * the host's `setTimeout`. Virtual, it is the guest's instructions executed,
 * at a fixed rate, and waiting is a callback the clock itself calls as it
 * passes a time; when nothing runs, it moves straight to the next such time.
 * A run on a virtual clock does the same whatever the host's speed and load,
 * which is what a survey that compares screens needs: SkiFree placed its
 * skier by how long its start took on the host.
 *
 * The rate and the date a virtual clock starts at are winbox.js's choices,
 * not Windows': 3,000 instructions a millisecond, about a 386's, and the
 * date the caller gives. A call's cost is measured (`CALL_INSTRUCTIONS`).
 */

export const INSTRUCTIONS_PER_MS = 3000;

/**
 * What a call to Windows costs a virtual clock, as instructions: winbox.js
 * runs a call in the host's code, not the guest's, and a program that asks
 * over and over, as one polling `PeekMessage` does, would otherwise find no
 * time passing between its calls. Five microseconds: `speed` timed calls
 * under the recorder's DOSBox at 2.2 (`GetPixel` of a memory device
 * context), 2.9 (`SetPixel` into one), 5.3 (`GetPixel` of the screen) and
 * 7.8 (`PeekMessage` with nothing waiting). At a third of a millisecond, as
 * this was, Solitaire spent its first ten seconds finding its cards' shapes
 * a pixel at a time, and dealt none.
 */
export const CALL_INSTRUCTIONS = 15;

/**
 * A faithful clock's rate: instructions a millisecond as Windows runs a
 * program's own under the recorder's DOSBox, `cpurate`'s `mixed` workload --
 * arithmetic against memory, the shape of compiled code -- the middle of
 * three runs, 258,269. Its other workloads run from 330,000 to 425,000 a
 * millisecond, and all of them as fast as the recording host lets DOSBox:
 * a choice among them, not a property of Windows. With calls charged as
 * recorded (`measuredCalls`), it is the clock `WINBOX_CLOCK=faithful` asks
 * for; the survey keeps `INSTRUCTIONS_PER_MS`, which runs a hundred times
 * faster. See `topics/timing`.
 */
export const FAITHFUL_INSTRUCTIONS_PER_MS = 258269;

/** The same, as time: what `CALL_INSTRUCTIONS` is at `INSTRUCTIONS_PER_MS`. */
export const CALL_MICROSECONDS = (CALL_INSTRUCTIONS * 1000) / INSTRUCTIONS_PER_MS;

interface Pending {
  due: number;
  fn: () => void;
}

export class Clock {
  readonly virtual: boolean;
  /** Virtual: the instructions run in a millisecond. */
  readonly rate: number;
  /**
   * Virtual: whether a call is charged the time Windows was recorded taking
   * over it (`call-costs.ts`), rather than `CALL_MICROSECONDS` whatever it
   * is. An experiment, off by default: see `topics/timing`.
   */
  readonly measuredCalls: boolean;
  readonly #start: number;
  readonly #epoch: number;
  readonly #instructions: () => number;
  #skipped = 0;
  #charged = 0;
  #pending: Pending[] = [];

  constructor({
    virtual = false,
    epoch,
    instructions = () => 0,
    rate = INSTRUCTIONS_PER_MS,
    measuredCalls = false,
  }: {
    virtual?: boolean;
    epoch?: number;
    instructions?: () => number;
    rate?: number;
    measuredCalls?: boolean;
  } = {}) {
    this.virtual = virtual;
    this.rate = rate;
    this.measuredCalls = measuredCalls;
    this.#start = Date.now();
    this.#epoch = epoch ?? this.#start;
    this.#instructions = instructions;
  }

  /** Milliseconds since the system started. */
  now(): number {
    if (!this.virtual) {
      return Date.now() - this.#start;
    }

    return Math.floor((this.#instructions() + this.#charged) / this.rate) + this.#skipped;
  }

  /** The date and time of day now, for DOS. */
  date(): Date {
    return new Date(this.#epoch + this.now());
  }

  /** Calls `fn` once `ms` milliseconds have passed; answers what `cancel` takes. */
  after(ms: number, fn: () => void): any {
    if (!this.virtual) {
      return setTimeout(fn, Math.max(0, ms));
    }

    const entry = { due: this.now() + Math.max(0, ms), fn };

    this.#pending.push(entry);

    return entry;
  }

  cancel(handle: any) {
    if (!this.virtual) {
      clearTimeout(handle);
      return;
    }

    this.#pending = this.#pending.filter((entry) => entry !== handle);
  }

  /** Virtual: calls what has come due. */
  tick() {
    if (!this.virtual || !this.#pending.length) {
      return;
    }

    const now = this.now();
    const due = this.#pending.filter((entry) => entry.due <= now);

    if (!due.length) {
      return;
    }

    this.#pending = this.#pending.filter((entry) => entry.due > now);

    for (const entry of due.sort((a, b) => a.due - b.due)) {
      entry.fn();
    }
  }

  /**
   * Virtual: nothing is running, so time moves to the next thing waiting and
   * calls it. Answers whether anything was waiting.
   */
  idle(): boolean {
    if (!this.virtual || !this.#pending.length) {
      return false;
    }

    const next = Math.min(...this.#pending.map((entry) => entry.due));
    const now = this.now();

    if (next > now) {
      this.#skipped += next - now;
    }

    this.tick();

    return true;
  }

  /** Virtual: instructions run that the processor did not count, as a call's. */
  charge(instructions: number) {
    if (this.virtual) {
      this.#charged += instructions;
    }
  }

  /** Virtual: a call's time, in microseconds, as the instructions it is at the clock's rate. */
  chargeTime(microseconds: number) {
    this.charge((microseconds * this.rate) / 1000);
  }

  /** Virtual: time moved on by `ms`, as when nothing ran for a while. */
  advance(ms: number) {
    if (this.virtual) {
      this.#skipped += Math.ceil(ms);
      this.tick();
    }
  }
}

/** For a system with no machine, as a test's is: the host's time. */
const HOST = new Clock();

/** The clock a system, or a machine, keeps time by. */
export function clockOf(system: any): Clock {
  return system?.clock ?? system?._machine?.clock ?? system?.machine?.clock ?? HOST;
}
