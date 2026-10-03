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
 * A faithful clock's rate: the recorder's DOSBox at `cycles=fixed 80000`
 * (`record.mjs --cycles`), 80,000 instructions a millisecond, the rate the
 * calls' costs were recorded at (`call-costs.ts`) and SimTower's screens
 * with them. As fast as the host lets it, DOSBox runs no one rate: from
 * 150,000 to 425,000 a millisecond by the work, and slower again for a
 * screen's worth of drawing, which is why a game that paces itself by what
 * it gets done -- SimTower -- cannot be matched against such a recording.
 * With calls charged as recorded (`measuredCalls`), it is the clock
 * `WINBOX_CLOCK=faithful` asks for; the survey keeps `INSTRUCTIONS_PER_MS`.
 * See `topics/timing`.
 */
export const FAITHFUL_INSTRUCTIONS_PER_MS = 80000;

interface Pending {
  due: number;
  fn: () => void;
}

export class Clock {
  readonly virtual: boolean;
  /** Virtual: the instructions run in a millisecond. */
  readonly rate: number;
  /**
   * Virtual: whether a call is charged the instructions Windows was recorded
   * running for it (`call-costs.ts`), the same at any rate, rather than
   * `CALL_INSTRUCTIONS` whatever it is. Off by default: see `topics/timing`.
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

  /** Virtual: the instructions charged so far that the processor did not count. */
  get charged(): number {
    return this.#charged;
  }

  /** Virtual: the milliseconds skipped so far, as when nothing ran. */
  get skipped(): number {
    return this.#skipped;
  }

  /** Virtual: when the next thing waiting on the clock is due; `Infinity` for nothing. */
  nextDue(): number {
    let next = Infinity;

    for (const entry of this.#pending) {
      if (entry.due < next) {
        next = entry.due;
      }
    }

    return next;
  }

  /** Virtual: instructions run that the processor did not count, as a call's. */
  charge(instructions: number) {
    if (this.virtual) {
      this.#charged += instructions;
    }
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
