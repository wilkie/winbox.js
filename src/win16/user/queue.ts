'use strict';

import { DWORD, HWND, UINT } from '../types.js';
import { MSG, User } from '../user.js';

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
  msg.pt = { x: 0, y: 0 };

  return msg;
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
      return remove ? await task.pull() : task.peek();
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
        User.WM_TIMER,
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
