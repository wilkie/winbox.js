'use strict';

import { CALL_INSTRUCTIONS } from '../emulator/clock.js';
import { type QuickCall, type QuickCalls, type QuickRun } from '../emulator/wasm-core.js';
import { callInstructions } from './call-costs.js';

/**
 * The calls the Rust core answers without coming here (`crates/winbox-cpu`'s
 * `quick.rs`): the ones a program polls with, which cost it far more to make
 * -- the processor's state handed over, an interrupt taken, the arguments
 * read, the task halted and resumed -- than to answer. SkiFree makes
 * GetTickCount and PeekMessage three hundred and eighty thousand times each
 * in its first ten seconds, and SimTower the rectangle calls a hundred
 * thousand.
 *
 * Each is answered there as it is here: its arguments read from the stack,
 * its structures read and written where this reads them, its answer in AX
 * and DX, the clock charged what a call of it is charged here. The calls
 * are told to whoever watches after the run, in turn, as if made here.
 *
 * Only where answering there does all a call does here: on a virtual
 * clock, nothing due before the call ends (a timer, MMSYSTEM's events); no
 * procedure waiting to be called at interrupt time, none being called; and
 * the task not given up its turn. Otherwise the Rust core leaves them here.
 */

/** USER's functions the Rust core answers, by the number it knows each as. */
const FUNCTIONS: Record<string, number> = {
  GetTickCount: 0,
  GetCurrentTime: 11,
  SetRect: 1,
  SetRectEmpty: 2,
  CopyRect: 3,
  IsRectEmpty: 4,
  PtInRect: 5,
  OffsetRect: 6,
  InflateRect: 7,
  IntersectRect: 8,
  UnionRect: 9,
  EqualRect: 10,
  PeekMessage: 12,
};

/** Each one's name, and its ordinal in USER, by its number. */
interface Known {
  name: string;
  ordinal: number;
}

/** The ones that answer something; the rest leave AX and DX as they were. */
const ANSWERING = new Set([
  'GetTickCount',
  'GetCurrentTime',
  'IsRectEmpty',
  'PtInRect',
  'IntersectRect',
  'UnionRect',
  'EqualRect',
  'PeekMessage',
]);

const signed = (word: number) => (word << 16) >> 16;
const far = (args: number[], at: number) => ((args[at + 1] << 16) | args[at]) >>> 0;

/**
 * A call's arguments as this decodes them for its watcher, in their own
 * order, from the stack's words, last first: structures as their far
 * pointers.
 */
function argumentsOf(name: string, args: number[]): number[] {
  switch (name) {
    case 'SetRect':
      return [far(args, 4), signed(args[3]), signed(args[2]), signed(args[1]), signed(args[0])];
    case 'SetRectEmpty':
    case 'IsRectEmpty':
      return [far(args, 0)];
    case 'CopyRect':
    case 'EqualRect':
      return [far(args, 2), far(args, 0)];
    case 'PtInRect':
      return [far(args, 2), far(args, 0)];
    case 'OffsetRect':
    case 'InflateRect':
      return [far(args, 2), signed(args[1]), signed(args[0])];
    case 'IntersectRect':
    case 'UnionRect':
      return [far(args, 4), far(args, 2), far(args, 0)];
    case 'PeekMessage':
      return [far(args, 4), args[3], args[2], args[1], args[0]];
    default:
      return [];
  }
}

/**
 * Whether the task looking for a message would find none, and its turn
 * given up come straight back with nothing, as `PeekMessage`'s quick answer
 * has it (`noMessageNow`, `Scheduler.yieldNow`): nothing sent it, no window
 * activating, nothing in its queue, no quit, nothing to paint, no timer --
 * on a virtual clock any timer counts as due -- and no other task waiting
 * for its turn. None of these changes but by this side's own code, which
 * does not run during the Rust core's; so what holds as a run begins holds
 * to its end.
 */
function nothingWaiting(system: any) {
  const scheduler = system.scheduler;
  const task = scheduler?.task;
  const desktop = system.rasterDesktop;

  return !(
    !task ||
    scheduler._waiting?.length ||
    task.sent?.length ||
    desktop?.pendingActivation ||
    task.peek() ||
    (task.quitCode !== undefined && task.quitCode !== null) ||
    (desktop &&
      (desktop.backgroundDue || desktop.windows.some((window: any) => window.needsPaint))) ||
    system._timers?.size
  );
}

/** The quick calls `Win16` gives the processor: see the comment above. */
export function quickCalls(system: any): QuickCalls {
  let plan: QuickRun | null = null;
  let measured: boolean | null = null;
  const known = new Map<number, Known>();

  /** The thunks, made once USER is loaded and again if the charges change. */
  const thunks = () => {
    const clock = system.machine.clock;
    const asRecorded = !!clock?.virtual && clock.measuredCalls;

    if (plan && measured === asRecorded) {
      return plan;
    }

    const user = system._modules?.instanceFor('USER');

    if (!user) {
      return null;
    }

    const exports = user.instance.exports;
    const list: QuickRun['thunks'] = [];

    known.clear();

    for (let ordinal = 0; ordinal < exports.length; ordinal++) {
      const name = exports[ordinal]?.[1];
      const number = name === undefined ? undefined : FUNCTIONS[name];

      if (number === undefined) {
        continue;
      }

      /* `PeekMessage` is charged by whether it yields: its flags the fifth
       * argument, `PM_NOYIELD` 2. */
      const charge = (flags: number) =>
        asRecorded
          ? callInstructions(system, 'USER', name, [0, 0, 0, 0, flags])
          : CALL_INSTRUCTIONS;

      list.push({
        linear: (user.segment << 16) + user.step * (ordinal + 1),
        function: number,
        charge: charge(0),
        chargeAlt: charge(2),
      });
      known.set(number, { name, ordinal });
    }

    measured = asRecorded;
    plan = { version: (plan?.version ?? 0) + 1, thunks: list, clock: null, peek: false };
    return plan;
  };

  return {
    prepare() {
      const scheduler = system._scheduler;
      const task = scheduler?.task;

      if (!task || task.yield || scheduler._inInterrupt || scheduler._interrupts?.length) {
        return null;
      }

      const made = thunks();

      if (!made) {
        return null;
      }

      const clock = system.machine.clock;

      made.peek = nothingWaiting(system);
      made.clock = clock?.virtual
        ? {
            rate: clock.rate,
            charged: clock.charged,
            skipped: clock.skipped,
            nextDue: clock.nextDue(),
          }
        : null;

      return made;
    },

    finish(charged: number, calls: QuickCall[]) {
      const clock = system.machine.clock;

      if (charged) {
        clock.charge(charged);
      }

      const watcher = system._onCall;

      if (!watcher) {
        return;
      }

      for (const call of calls) {
        const which = known.get(call.function);

        if (!which) {
          continue;
        }

        watcher({
          module: 'USER',
          name: which.name,
          ordinal: which.ordinal,
          args: argumentsOf(which.name, call.args),
          caller: { segment: call.caller >>> 16, offset: (call.caller & 0xffff) - 5 },
          stub: false,
          rejected: false,
          result: ANSWERING.has(which.name) ? call.result : undefined,
        });
      }
    },
  };
}
