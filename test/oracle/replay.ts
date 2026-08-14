'use strict';

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { Machine } from '../../src/emulator/machine.js';
import { GlobalAllocator } from '../../src/win16/global-allocator.js';
import { Allocator } from '../../src/win16/allocator.js';

import { lstrlen } from '../../src/win16/kernel/lstrlen.js';
import { lstrcpy } from '../../src/win16/kernel/lstrcpy.js';
import { lstrcat } from '../../src/win16/kernel/lstrcat.js';
import { lstrcmp } from '../../src/win16/user/lstrcmp.js';
import { lstrcmpi } from '../../src/win16/user/lstrcmpi.js';
import { AnsiUpper } from '../../src/win16/user/AnsiUpper.js';
import { AnsiLower } from '../../src/win16/user/AnsiLower.js';
import { AnsiNext } from '../../src/win16/user/AnsiNext.js';
import { AnsiPrev } from '../../src/win16/user/AnsiPrev.js';
import { GlobalAlloc } from '../../src/win16/kernel/GlobalAlloc.js';
import { GlobalSize } from '../../src/win16/kernel/GlobalSize.js';
import { GlobalFree } from '../../src/win16/kernel/GlobalFree.js';
import { LocalAlloc } from '../../src/win16/kernel/LocalAlloc.js';
import { LocalSize } from '../../src/win16/kernel/LocalSize.js';
import { LocalInit } from '../../src/win16/kernel/LocalInit.js';
import { GlobalLock } from '../../src/win16/kernel/GlobalLock.js';
import { GlobalUnlock } from '../../src/win16/kernel/GlobalUnlock.js';
import { GlobalFlags } from '../../src/win16/kernel/GlobalFlags.js';
import { GlobalHandle } from '../../src/win16/kernel/GlobalHandle.js';
import { GlobalReAlloc } from '../../src/win16/kernel/GlobalReAlloc.js';

/**
 * Replaying the oracle's recordings against our implementation.
 *
 * `scripts/oracle/record.mjs` runs a probe under real Windows 3.1 and writes
 * down every call it made and what came back. This runs the same calls against
 * us and compares, which turns "is our API right" into a number the same way
 * the CPU conformance oracle did for instructions.
 *
 * What this does not do is run the probe's own binary. That would be the
 * stronger check -- it would put the loader, the linker and the thunks under
 * test too -- but it needs a Win16 system far enough up to schedule a task,
 * and it needs `_lcreat` and `_lwrite`, which are still stubs, or the probe
 * has nowhere to write its answers. So for now the arguments are marshalled
 * the way the thunk layer marshals them and the implementation is called
 * directly. Everything the fixtures actually describe -- what the functions
 * return, given what they were passed -- is still being measured.
 */

export const FIXTURES = join(__dirname, '..', '..', 'oracle', 'fixtures');

/** Where in guest memory the harness builds its arguments. */
const SCRATCH_SEGMENT = 0x4000;

export type Outcome = 'agreed' | 'disagreed' | 'unimplemented' | 'unsupported';

export interface Replayed {
  function: string;
  args: string;
  expected: string;
  actual: string | null;
  outcome: Outcome;
}

export interface Fixture {
  probe: string;
  source: { windows: string };
  records: { function: string; args: string; result: string; section?: string }[];
}

/**
 * A place to build arguments and a `this` for the implementations.
 *
 * The functions that take pointers reach memory through `this.machine`, which
 * is the same road the real thunk layer sends them down.
 */
class Context {
  machine: any;
  allocator: any;
  globalAllocator: any;
  private next: number;

  constructor() {
    this.machine = new Machine();
    this.next = 0x100;

    /* The memory functions reach their heaps through `this.allocator`, built
     * here the way `Win16` builds it so that the allocator under test is the
     * one the system would really be using.
     */
    this.globalAllocator = new GlobalAllocator(this.machine.cpu, this.machine.memory);
    this.allocator = new Allocator(this.machine.memory, this.globalAllocator);
  }

  /**
   * Gives the current data segment a local heap.
   *
   * `LocalAlloc` allocates from the heap belonging to whatever DS holds, and
   * that heap is built by `LocalInit` -- which a task's startup code calls
   * before the program's own entry point runs.
   */
  withLocalHeap(size = 0x2000) {
    const segment = this.machine.cpu.core.ds >> 3;

    if (!this.allocator.heapOf(segment)) {
      LocalInit.call(this, segment, 16, size);
    }

    return this;
  }

  /** Writes a C string into guest memory and returns where it went. */
  place(text: string, reserve = 0) {
    const core = this.machine.cpu.core;
    const offset = this.next;

    for (let index = 0; index < text.length; index++) {
      core.write8(SCRATCH_SEGMENT, offset + index, text.charCodeAt(index) & 0xff);
    }

    core.write8(SCRATCH_SEGMENT, offset + text.length, 0);

    // Leave room for anything the callee is going to append.
    this.next += Math.max(text.length + 1, reserve);

    return { segment: SCRATCH_SEGMENT, offset, far: (SCRATCH_SEGMENT << 16) | offset };
  }

  /** Reads a C string back out of guest memory. */
  fetch(far: number) {
    const core = this.machine.cpu.core;
    const segment = (far >> 16) & 0xffff;
    let offset = far & 0xffff;

    let text = '';

    for (;;) {
      const byte = core.read8(segment, offset++);

      if (!byte) {
        return text;
      }

      text += String.fromCharCode(byte);
    }
  }

  /**
   * Builds the `String` object the thunk layer hands to an `LPCSTR` argument.
   *
   * It carries the segment and offset it came from, and some implementations
   * read those, so a bare JavaScript string would not be the same thing.
   */
  lpcstr(text: string) {
    const at = this.place(text);
    const value: any = new String(text);

    value.segment = at.segment;
    value.offset = at.offset;

    return value;
  }
}

/**
 * Splits a recorded argument list.
 *
 * The probe writes arguments as it would in C -- `"hello"," world"` or
 * `"abc",3` -- so quoted strings come back as strings and everything else as a
 * number. Strings never contain a quote, which keeps this honest and short.
 */
export function parseArgs(args: string): (string | number)[] {
  const parsed: (string | number)[] = [];
  let at = 0;

  while (at < args.length) {
    if (args[at] === ',') {
      at++;
      continue;
    }

    if (args[at] === '"') {
      const end = args.indexOf('"', at + 1);

      if (end === -1) {
        throw new Error(`unterminated string in arguments: ${args}`);
      }

      parsed.push(args.slice(at + 1, end));
      at = end + 1;
    } else {
      let end = args.indexOf(',', at);
      end = end === -1 ? args.length : end;

      const text = args.slice(at, end);

      /* `Number` reads the probe's 0x-prefixed flags as written. Anything that
       * is not a number stays text: probes describe what they are measuring as
       * well as what they passed -- `moveable grow` names a case rather than an
       * argument -- and turning those into NaN loses the distinction between
       * the cases silently.
       */
      const value = Number(text);

      parsed.push(text.trim() !== '' && !Number.isNaN(value) ? value : text);
      at = end;
    }
  }

  return parsed;
}

/** How the probe wrote a string result down. */
function quoted(text: string) {
  return `"${text}"`;
}

/** The allocation flags a probe's description of a block stands for. */
function flagsFor(name: string) {
  if (name === 'fixed') {
    return 0x0000;
  }

  return name === 'discardable' ? 0x0102 : 0x0002;
}

/** The probe records the sign of a comparison, not its magnitude. */
function sign(value: number) {
  return String(value < 0 ? -1 : value > 0 ? 1 : 0);
}

/**
 * How to run each recorded call against us.
 *
 * One entry per function the probes cover. An adapter marshals the recorded
 * arguments, calls the implementation, and formats what came back exactly the
 * way the probe formatted it -- otherwise the comparison would be measuring
 * the formatting.
 *
 * A function with no entry is reported as unsupported rather than quietly
 * skipped, so that adding probe coverage without adding replay coverage cannot
 * look like success.
 */
const ADAPTERS: Record<string, (context: Context, args: (string | number)[]) => string> = {
  lstrlen(context, [text]) {
    const at = context.place(text as string);
    return String(lstrlen.call(context, at.far));
  },

  lstrcmp(context, [left, right]) {
    return sign(
      lstrcmp.call(context, context.lpcstr(left as string), context.lpcstr(right as string))
    );
  },

  lstrcmpi(context, [left, right]) {
    return sign(
      lstrcmpi.call(context, context.lpcstr(left as string), context.lpcstr(right as string))
    );
  },

  AnsiUpper(context, [text]) {
    const at = context.place(text as string);
    AnsiUpper.call(context, at.far);

    // The probe recorded the buffer, which these convert in place.
    return quoted(context.fetch(at.far));
  },

  AnsiLower(context, [text]) {
    const at = context.place(text as string);
    AnsiLower.call(context, at.far);

    return quoted(context.fetch(at.far));
  },

  AnsiNext(context, [text]) {
    /* The probe recorded how far the pointer moved rather than where it landed,
     * since an address means nothing outside the run that produced it.
     */
    const at = context.place(text as string);
    const next = AnsiNext.call(context, at.far);

    return String((next & 0xffff) - at.offset);
  },

  AnsiPrev(context, [text, from]) {
    const at = context.place(text as string);
    const previous = AnsiPrev.call(context, at.far, at.far + (from as number));

    return String((previous & 0xffff) - at.offset);
  },

  lstrcpy(context, [source]) {
    // The probe recorded what the destination held afterwards.
    const destination = context.place('', 256);
    const from = context.place(source as string);

    lstrcpy.call(context, destination.far, from.far);

    return quoted(context.fetch(destination.far));
  },

  lstrcat(context, [left, right]) {
    /* The probe copied the first string into a buffer and then appended the
     * second, so the recorded result is both of them.
     */
    const destination = context.place('', 256);
    const first = context.place(left as string);
    const second = context.place(right as string);

    lstrcpy.call(context, destination.far, first.far);
    lstrcat.call(context, destination.far, second.far);

    return quoted(context.fetch(destination.far));
  },

  'GlobalAlloc+GlobalSize'(context, [flags, request]) {
    /* Handles are the allocator's business and two runs need not agree on
     * them, so the probe recorded the size that came back rather than what it
     * came back in.
     */
    const handle = GlobalAlloc.call(context, flags as number, request as number);

    if (!handle) {
      return 'failed';
    }

    return String(GlobalSize.call(context, handle));
  },

  'LocalAlloc+LocalSize'(context, [flags, request]) {
    /* A local heap does not exist until something makes one. In a real program
     * the startup code does it before `WinMain` is reached, so the probe never
     * had to; here it has to happen explicitly, or this would be measuring the
     * absence of a heap rather than the allocator.
     */
    context.withLocalHeap();

    const handle = LocalAlloc.call(context, flags as number, request as number);

    if (!handle) {
      return 'failed';
    }

    return String(LocalSize.call(context, handle));
  },

  GlobalLock(context, [flags]) {
    const handle = GlobalAlloc.call(context, flags as number, 128);

    if (!handle) {
      return 'failed';
    }

    const pointer = GlobalLock.call(context, handle);

    if (!pointer) {
      return 'null';
    }

    /* The selector is the allocator's to choose, so the probe recorded only
     * what does not depend on it: that a global block starts at offset zero of
     * its segment, and whether the handle turned out to be that selector.
     */
    const selector = (pointer >> 16) & 0xffff;

    return `offset=${pointer & 0xffff},handle-is-selector=${selector === handle ? 1 : 0}`;
  },

  /**
   * How a handle relates to the selector its pointer carries.
   *
   * Neither value is comparable on its own, so what the probe recorded is the
   * shape of the relationship rather than either number.
   */
  'handle vs selector'(context, [name]) {
    const handle = GlobalAlloc.call(context, flagsFor(name as string), 256);

    if (!handle) {
      return 'failed';
    }

    const selector = (GlobalLock.call(context, handle) >>> 16) & 0xffff;

    return `equal=${selector === handle ? 1 : 0},difference=${selector - handle}`;
  },

  /** Which table and privilege level the pair name. */
  'table and privilege bits'(context, [name]) {
    const handle = GlobalAlloc.call(context, flagsFor(name as string), 256);

    if (!handle) {
      return 'failed';
    }

    const selector = (GlobalLock.call(context, handle) >>> 16) & 0xffff;

    return `handle=${handle & 7},selector=${selector & 7}`;
  },

  /** Whether a block keeps its address across an unlock and a relock. */
  stability(context, [name]) {
    const handle = GlobalAlloc.call(context, flagsFor(name as string), 256);

    if (!handle) {
      return 'failed';
    }

    const before = GlobalLock.call(context, handle);
    GlobalUnlock.call(context, handle);

    // Stir the heap the way the probe does, to give a compactor its chance.
    const filler = [];

    for (let index = 0; index < 8; index++) {
      filler.push(GlobalAlloc.call(context, 0x0002, 4096));
    }

    for (let index = 0; index < 8; index += 2) {
      if (filler[index]) {
        GlobalFree.call(context, filler[index]);
      }
    }

    return `moved=${before === GlobalLock.call(context, handle) ? 0 : 1}`;
  },

  GlobalFlags(context, [flags]) {
    const handle = GlobalAlloc.call(context, flags as number, 64);

    if (!handle) {
      return 'failed';
    }

    return `0x${(GlobalFlags.call(context, handle) & 0xffff).toString(16).padStart(4, '0')}`;
  },

  GlobalHandle(context, [name]) {
    const handle = GlobalAlloc.call(context, flagsFor(name as string), 256);

    if (!handle) {
      return 'failed';
    }

    // The probe passes the selector out of the pointer it locked.
    const selector = (GlobalLock.call(context, handle) >>> 16) & 0xffff;
    const recovered = GlobalHandle.call(context, selector) & 0xffff;

    return `recovered=${recovered === handle ? 1 : 0}`;
  },

  'lock count'(context, [name]) {
    const handle = GlobalAlloc.call(context, flagsFor(name as string), 256);

    if (!handle) {
      return 'failed';
    }

    const first = GlobalLock.call(context, handle);
    const second = GlobalLock.call(context, handle);

    return `same=${first === second ? 1 : 0},count=${GlobalFlags.call(context, handle) & 0xff}`;
  },

  GlobalReAlloc(context, [description, sizes]) {
    /* The probe names the block and the change together, as `moveable
     * grow,256->1024`, so the sizes arrive as one field to split.
     */
    const [from, to] = String(sizes).split('->').map(Number);
    const flags = String(description).startsWith('fixed') ? 0x0000 : 0x0002;

    const handle = GlobalAlloc.call(context, flags, from);

    if (!handle) {
      return 'failed';
    }

    const before = GlobalLock.call(context, handle);
    const resized = GlobalReAlloc.call(context, handle, to, flags);

    if (!resized) {
      return 'failed';
    }

    const after = GlobalLock.call(context, resized);

    return (
      `same-handle=${resized === handle ? 1 : 0},` +
      `same-address=${before === after ? 1 : 0},` +
      `size=${GlobalSize.call(context, resized)}`
    );
  },

  GlobalFree(context) {
    const handle = GlobalAlloc.call(context, 0x0002, 256);

    if (!handle) {
      return 'failed to allocate';
    }

    return `returns=${GlobalFree.call(context, handle) ? 'handle' : 'null'}`;
  },
};

/** Thrown by an adapter for a function we have not implemented at all. */
export class Unimplemented extends Error {}

/**
 * Disagreements we know about and have not fixed.
 *
 * Each of these is a real difference from Windows with a reason it has not
 * simply been corrected, and each is reported as an expected failure -- so the
 * suite stays green while they persist, and turns red the moment one of them
 * starts agreeing and the entry becomes stale.
 */
export const KNOWN_GAPS: Record<string, string> = {};

/**
 * Functions a module declares but wires to a stub.
 *
 * Kept as an explicit list so that a stub reports as unimplemented rather than
 * as a disagreement -- the two want different work, and conflating them makes
 * the report harder to act on.
 */
const STUBBED = new Set<string>([]);

/** Runs one recorded call. */
export function replayRecord(record: Fixture['records'][number]): Replayed {
  const base = { function: record.function, args: record.args, expected: record.result };

  if (STUBBED.has(record.function)) {
    return { ...base, actual: null, outcome: 'unimplemented' };
  }

  const adapter = ADAPTERS[record.function];

  if (!adapter) {
    return { ...base, actual: null, outcome: 'unsupported' };
  }

  let actual: string;

  try {
    actual = adapter(new Context(), parseArgs(record.args));
  } catch (error) {
    if (error instanceof Unimplemented) {
      return { ...base, actual: null, outcome: 'unimplemented' };
    }

    return {
      ...base,
      actual: `threw ${error instanceof Error ? error.message : String(error)}`,
      outcome: 'disagreed',
    };
  }

  return {
    ...base,
    actual,
    outcome: actual === record.result ? 'agreed' : 'disagreed',
  };
}

export interface Summary {
  total: number;
  agreed: number;
  byFunction: Map<string, { total: number; agreed: number; outcome: Outcome }>;
}

/** Replays every record in a fixture and summarises the result. */
export function replayFixture(fixture: Fixture) {
  const replayed = fixture.records.map(replayRecord);
  const byFunction = new Map<string, { total: number; agreed: number; outcome: Outcome }>();

  for (const record of replayed) {
    const entry = byFunction.get(record.function) ?? {
      total: 0,
      agreed: 0,
      outcome: record.outcome,
    };

    entry.total++;
    entry.agreed += record.outcome === 'agreed' ? 1 : 0;

    // A function is only as good as its worst record.
    if (record.outcome !== 'agreed') {
      entry.outcome = record.outcome;
    }

    byFunction.set(record.function, entry);
  }

  const summary: Summary = {
    total: replayed.length,
    agreed: replayed.filter((record) => record.outcome === 'agreed').length,
    byFunction,
  };

  return { replayed, summary };
}

/** Every fixture the recorder has produced. */
export function loadFixtures(): Fixture[] {
  if (!existsSync(FIXTURES)) {
    return [];
  }

  return readdirSync(FIXTURES)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')));
}
