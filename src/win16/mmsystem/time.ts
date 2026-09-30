'use strict';

import { clockOf } from '../../emulator/clock.js';
import { DWORD, UINT } from '../types.js';

/**
 * MMSYSTEM's timer services. **Recorded** by `mmtime`:
 *
 * * `timeGetDevCaps` gives periods from 1 to 65535, and answers
 *   `TIMERR_NOCANDO`, 97, writing nothing, for a structure too small.
 * * `timeBeginPeriod` and `timeEndPeriod` answer nought for a period of 1,
 *   and 97 for nought; `timeBeginPeriod` answers 97 for 65535 as well.
 * * `timeGetTime` counts milliseconds from where `GetTickCount` counts
 *   them, a millisecond at a time.
 * * `timeGetSystemTime` answers nought and gives milliseconds, whatever
 *   type it was asked for.
 * * `timeSetEvent` answers an event's id, or nought for a delay of nought.
 *   The procedure is called at interrupt time with the id, nought, the
 *   caller's `DWORD` and two noughts: once for `TIME_ONESHOT`, after which
 *   the event is gone, and every period for `TIME_PERIODIC` until
 *   `timeKillEvent`, which answers nought, or 97 for an event there is not.
 *
 * Not recorded: the ids themselves (here counted from 1), the resolution,
 * which changes nothing here, and what becomes of a task's events when it
 * ends -- here they stop.
 */

const TIMERR_NOCANDO = 97;
const TIME_PERIODIC = 1;
const TIME_MS = 1;

interface TimerEvent {
  id: number;
  due: number;
  delay: number;
  periodic: boolean;
  proc: number;
  user: number;
  task: number;
  timer: any;
}

function events(system: any): Map<number, TimerEvent> {
  return (system._timeEvents ??= new Map());
}

/**
 * Calls what has come due, at interrupt time (`Scheduler.atInterrupt`).
 * Looked at by the scheduler between slices of a task's instructions, as
 * a program running on sees the time pass, and by a timer of the host's,
 * which wakes a task waiting for a message. A program that calls the API
 * over and over without waiting never lets the host's timers run.
 */
export function pollTimeEvents(system: any) {
  const all = system._timeEvents as Map<number, TimerEvent> | undefined;

  if (!all?.size) {
    return;
  }

  const now = clockOf(system).now();

  for (const event of [...all.values()]) {
    if (event.due > now) {
      continue;
    }

    if (system.handles.resolve(event.task)?.ended) {
      stop(system, event);
      continue;
    }

    if (event.periodic) {
      event.due = Math.max(event.due + event.delay, now);
      arm(system, event);
    } else {
      stop(system, event);
    }

    system.scheduler.atInterrupt(
      event.proc,
      [
        [event.id, UINT],
        [0, UINT],
        [event.user >>> 0, DWORD],
        [0, DWORD],
        [0, DWORD],
      ],
      event,
      event.task
    );
  }
}

/** The host's timer for an event's next time, to wake a task that waits. */
function arm(system: any, event: TimerEvent) {
  const clock = clockOf(system);

  if (event.timer) {
    clock.cancel(event.timer);
  }

  event.timer = clock.after(event.due - clock.now(), () => pollTimeEvents(system));
}

function stop(system: any, event: TimerEvent) {
  if (event.timer) {
    clockOf(system).cancel(event.timer);
  }

  events(system).delete(event.id);
}

/** Milliseconds since Windows started, as `GetTickCount` counts them. */
export function timeGetTime(this: any) {
  return clockOf(this).now() >>> 0;
}

/** What the timer can do: periods from 1 to 65535. */
export function timeGetDevCaps(this: any, lpTimeCaps: number, uSize: number) {
  if (!lpTimeCaps || uSize < 4) {
    return TIMERR_NOCANDO;
  }

  const core = this.machine.cpu.core;
  const segment = (lpTimeCaps >>> 16) & 0xffff;
  const offset = lpTimeCaps & 0xffff;

  core.write16(segment, offset, 1);
  core.write16(segment, (offset + 2) & 0xffff, 0xffff);

  return 0;
}

/** Asks for a period, which changes nothing here. */
export function timeBeginPeriod(this: any, uPeriod: number) {
  return uPeriod === 0 || uPeriod >= 0xffff ? TIMERR_NOCANDO : 0;
}

/** Lets a period go. */
export function timeEndPeriod(this: any, uPeriod: number) {
  return uPeriod === 0 ? TIMERR_NOCANDO : 0;
}

/** The time as an `MMTIME`, in milliseconds whatever was asked. */
export function timeGetSystemTime(this: any, lpTime: number, _uSize: number) {
  const core = this.machine.cpu.core;
  const segment = (lpTime >>> 16) & 0xffff;
  const offset = lpTime & 0xffff;
  const ms = timeGetTime.call(this);

  core.write16(segment, offset, TIME_MS);
  core.write16(segment, (offset + 2) & 0xffff, ms & 0xffff);
  core.write16(segment, (offset + 4) & 0xffff, (ms >>> 16) & 0xffff);

  return 0;
}

/** Calls a procedure after a delay, or every period. */
export function timeSetEvent(
  this: any,
  uDelay: number,
  _uResolution: number,
  lpFunction: number,
  dwUser: number,
  uFlags: number
) {
  if (!uDelay || !lpFunction) {
    return 0;
  }

  const id = (this._nextTimeEvent = (this._nextTimeEvent ?? 0) + 1) & 0xffff;
  const event: TimerEvent = {
    id,
    due: clockOf(this).now() + uDelay,
    delay: uDelay,
    periodic: (uFlags & TIME_PERIODIC) !== 0,
    proc: lpFunction,
    user: dwUser,
    task: this.scheduler.active,
    timer: null,
  };

  events(this).set(id, event);
  arm(this, event);

  return id;
}

/** Stops an event. */
export function timeKillEvent(this: any, uId: number) {
  const event = events(this).get(uId);

  if (!event) {
    return TIMERR_NOCANDO;
  }

  /* Nothing more, not even a call due and not yet made: on Windows it
   * would have been made already. */
  stop(this, event);
  this.scheduler.cancelInterrupts(event);

  return 0;
}
