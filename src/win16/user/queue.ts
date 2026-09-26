'use strict';

import { cursorOf } from './cursor-pos.js';
import { DWORD, HWND, UINT } from '../types.js';
import { MSG, User } from '../user.js';

import { noteKey } from './accelerators.js';

/**
 * A program's messages, in the order Windows gives them: what was posted to
 * its queue, the mouse's and the keyboard's among them, first; then, with
 * nothing queued, `WM_PAINT` for a window of the raster desktop that is due
 * to be painted; then `WM_TIMER` for a timer that has come due. Neither of
 * the last two is ever queued -- each is made when it is asked for and
 * nothing else is waiting -- which is why a timer set before a message is
 * posted still comes after it.
 *
 * `GetMessage`, `PeekMessage` and a menu's own loop all take messages here.
 *
 * Time is the page's clock, unless the system keeps a virtual one: a replay
 * has no time to wait out, and on its clock every timer is due when asked.
 */

export interface Timer {
  hwnd: number;
  id: number;
  interval: number;
  due: number;
  proc: number | ((...args: any[]) => any);
  /** The message it comes as, when not `WM_TIMER`: the caret's is `WM_SYSTIMER`. */
  message?: number;
}

/** A system's timers, by window and identifier. */
function timersOf(system: any): Map<string, Timer> {
  system._timers ??= new Map();

  return system._timers;
}

function now(system: any) {
  return system.virtualClock ? Infinity : Date.now();
}

/** Sets a timer, or resets one, for a window or for a procedure. */
export function setTimer(system: any, hwnd: number, id: number, interval: number, proc: any) {
  const timers = timersOf(system);
  const key = `${hwnd}:${id}`;

  /* Windows' own clock ticks about every 55 milliseconds; no timer is quicker. */
  const every = Math.max(interval, 55);

  timers.set(key, { hwnd, id, interval: every, due: Date.now() + every, proc });

  return id || 1;
}

/** Stops every timer a window has, as destroying it does. */
export function killTimersOf(system: any, hwnd: number) {
  for (const [key, timer] of timersOf(system)) {
    if (timer.hwnd === hwnd) {
      timersOf(system).delete(key);
    }
  }
}

/** Stops a timer; whether there was one. */
export function killTimer(system: any, hwnd: number, id: number) {
  return timersOf(system).delete(`${hwnd}:${id}`);
}

/** Posts a message to the queue of the program that made a window, or of the running one. */
export function postMessage(
  system: any,
  hwnd: number,
  message: number,
  wParam: number,
  lParam: number
) {
  const window = hwnd ? system.handles.resolve(hwnd) : null;
  const task =
    (window?.data?.hInstance && system.handles.resolve(window.data.hInstance)) ||
    system.scheduler.task;

  if (!task) {
    return false;
  }

  task.push(message_(system, hwnd, message, wParam, lParam));

  return true;
}

function message_(system: any, hwnd: number, message: number, wParam: number, lParam: number) {
  const msg: any = new MSG();

  msg.hwnd = hwnd;
  msg.message = message;
  msg.wParam = wParam;
  msg.lParam = lParam;
  msg.time = Date.now() - (system._startTime ?? 0);
  msg.pt = { ...cursorOf(system) };

  return msg;
}

/**
 * `PostQuitMessage`: not a message in the queue but a flag on it, with the
 * exit code, as USER keeps it.
 *
 * Measured by the `quitord` probe: `WM_QUIT` comes after every message
 * posted -- one posted after the quit as well as one before -- and before the
 * paint and the timer that were also waiting, and it comes once. Not
 * measured: where it falls among the mouse's and the keyboard's input, which a
 * probe cannot make; it is taken after them here.
 */
export function postQuit(system: any, code: number) {
  const task = system.scheduler.task;

  if (task) {
    task.quitCode = code & 0xffff;
  }
}

/** The timer that is due first, if one is due now; `remove` sets it going again. */
function dueTimer(system: any, remove: boolean) {
  let earliest: Timer | null = null;

  for (const timer of timersOf(system).values()) {
    if (!earliest || timer.due < earliest.due) {
      earliest = timer;
    }
  }

  if (!earliest || earliest.due > now(system)) {
    return null;
  }

  if (remove) {
    earliest.due = (system.virtualClock ? earliest.due : Date.now()) + earliest.interval;
  }

  return earliest;
}

/**
 * The next message, as `GetMessage` takes it (`wait`) or `PeekMessage` looks
 * at it (`remove` or not): `null` when there is none and not waiting.
 */
export async function nextMessage(
  system: any,
  { remove = true, wait = true }: { remove?: boolean; wait?: boolean } = {}
): Promise<any> {
  const task = system.scheduler.task;

  for (;;) {
    if (task?.peek()) {
      if (!remove) {
        return task.peek();
      }

      const taken = await task.pull();

      /* The keys' state moves with the messages taken; see `noteKey`. */
      noteKey(system, taken);

      return taken;
    }

    /* The quit, once, after everything posted and before a paint or a timer.
     * See `postQuit`. */
    if (task && task.quitCode !== undefined && task.quitCode !== null) {
      const code = task.quitCode;

      if (remove) {
        task.quitCode = null;
      }

      return message_(system, 0, User.WM_QUIT, code, 0);
    }

    const unpainted = system.rasterDesktop?.unpainted;

    if (unpainted) {
      return message_(system, unpainted.hwnd, User.WM_PAINT, 0, 0);
    }

    const timer = dueTimer(system, remove);

    if (timer) {
      return message_(
        system,
        timer.hwnd,
        timer.message ?? User.WM_TIMER,
        timer.id,
        typeof timer.proc === 'number' ? timer.proc : 0
      );
    }

    if (!wait || !task || system.virtualClock) {
      return null;
    }

    /* Nothing yet: whatever comes first, a message or the next timer. */
    let next = Infinity;

    for (const timer of timersOf(system).values()) {
      next = Math.min(next, timer.due);
    }

    if (next === Infinity) {
      return await task.pull();
    }

    const pulled = task.pull();
    const woke = await Promise.race([
      pulled,
      new Promise((resolve) => setTimeout(() => resolve(null), Math.max(0, next - Date.now()))),
    ]);

    if (woke) {
      return woke;
    }

    /* The timer came first: the task no longer waits for a message. A message
     * that arrives now is queued rather than handed to a wait that ended. */
    task._messageLock = null;
  }
}

/**
 * Dispatches a timer's message to its procedure, when it was set with one
 * rather than for a window: `DispatchMessage`'s part in it.
 */
export async function callTimerProc(system: any, msg: any) {
  const timer = [...timersOf(system).values()].find(
    (each) => each.hwnd === msg.hwnd && each.id === msg.wParam
  );
  const proc = timer?.proc ?? msg.lParam;

  if (typeof proc === 'function') {
    return proc(msg.hwnd, User.WM_TIMER, msg.wParam, msg.time);
  }

  return system.scheduler.callProc(proc, [
    [msg.hwnd, HWND],
    [User.WM_TIMER, UINT],
    [msg.wParam, UINT],
    [msg.time >>> 0, DWORD],
  ]);
}
