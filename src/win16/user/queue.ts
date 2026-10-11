'use strict';

import { clockOf } from '../../emulator/clock.js';
import { IsChild } from './window-queries.js';
import { cursorOf } from './cursor-pos.js';
import { DWORD, HWND, UINT } from '../types.js';
import { MSG, User } from '../user.js';

import { noteButton, noteKey } from './accelerators.js';
import { queueTakesKey } from './task-list.js';
import { GetSysModalWindow } from './userwin.js';
import { deliverActivation } from './activation.js';
import { paintMessage } from './paint-icon.js';
import { askForCursor } from './set-cursor.js';
import {
  filterKinds,
  looksAtInput,
  mouseTaken,
  noteClick,
  refuseMouse,
  resolveMouse,
} from './mouse-scan.js';
import {
  eventTaken,
  keyLParam,
  keyTarget,
  keyboardHook,
  mouseHook,
  playbackDue,
  playedEvent,
  playing,
  systemQueue,
  typedPlayed,
} from './system-queue.js';

/**
 * A program's messages, in the order Windows gives them: what was posted to
 * its queue first; then the quit; then the mouse's and the keyboard's
 * (`quitin`); then, with nothing queued, `WM_PAINT` for a window of the raster desktop that is due
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
  /** The task that set it, whose queue it comes to when it has no window. */
  task?: number;
}

/** A system's timers, by window and identifier. */
function timersOf(system: any): Map<string, Timer> {
  system._timers ??= new Map();

  return system._timers;
}

function now(system: any) {
  return system.virtualClock ? Infinity : clockOf(system).now();
}

/** Sets a timer, or resets one, for a window or for a procedure. */
export function setTimer(system: any, hwnd: number, id: number, interval: number, proc: any) {
  const timers = timersOf(system);
  const key = `${hwnd}:${id}`;

  /* Windows' own clock ticks about every 55 milliseconds; no timer is quicker. */
  const every = Math.max(interval, 55);

  timers.set(key, {
    hwnd,
    id,
    interval: every,
    due: clockOf(system).now() + every,
    proc,
    task: system.scheduler?.active ?? 0,
  });

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
  const task = queueOf(system, hwnd);

  if (!task) {
    return false;
  }

  task.push(message_(system, hwnd, message, wParam, lParam));

  return true;
}

/**
 * The task whose queue a window's messages go to: the program's that made it,
 * or the running one's -- the running one's too where that program has ended,
 * as the first program, whose the desktop window is, may.
 */
export function queueOf(system: any, hwnd: number) {
  const window = hwnd ? system.handles.resolve(hwnd) : null;
  const owner = window?.data?.hInstance && system.handles.resolve(window.data.hInstance);

  return (owner && !owner.ended ? owner : null) || system.scheduler.task;
}

function message_(system: any, hwnd: number, message: number, wParam: number, lParam: number) {
  const msg: any = new MSG();

  msg.hwnd = hwnd;
  msg.message = message;
  msg.wParam = wParam;
  msg.lParam = lParam;
  msg.time = clockOf(system).now();
  msg.pt = { ...cursorOf(system) };

  return msg;
}

/**
 * `PostQuitMessage`: not a message in the queue but a flag on it, with the
 * exit code, as USER keeps it.
 *
 * Measured by the `quitord` probe: `WM_QUIT` comes after every message
 * posted -- one posted after the quit as well as one before -- and before the
 * paint and the timer that were also waiting, and it comes once. Measured by
 * `quitin`: it comes before the mouse's and the keyboard's input, a move put
 * in through USER's `MOUSE_EVENT` before the quit or after it, and the move
 * USER makes of its own accord as a window goes from under the cursor. So a
 * program whose window's object is freed with the window, as Borland's
 * ObjectWindows frees its main window's, is handed the quit next and not a
 * move for the freed window.
 */
export function postQuit(system: any, code: number) {
  const task = system.scheduler.task;

  if (task) {
    task.quitCode = code & 0xffff;
  }
}

/** The timer that is due first, if one is due now; `remove` sets it going again. */
function dueTimer(system: any, remove: boolean, match: (timer: Timer) => boolean = () => true) {
  let earliest: Timer | null = null;

  for (const timer of timersOf(system).values()) {
    if (!match(timer)) {
      continue;
    }

    if (!earliest || timer.due < earliest.due) {
      earliest = timer;
    }
  }

  if (!earliest || earliest.due > now(system)) {
    return null;
  }

  if (remove) {
    earliest.due = (system.virtualClock ? earliest.due : clockOf(system).now()) + earliest.interval;
  }

  return earliest;
}

type Filter = { hwnd: number; first: number; last: number } | null;

/** What a wait `nextMessage` was asked to end on a message sent answers. */
export const SENT_ANSWERED = 'sent';

/**
 * Whether a timer of this task's that the filter takes is due now: all
 * `PeekMessage` looks at again after it has let the other tasks run, a due
 * timer sending it back to look at everything (`USER.EXE` seg1 `254b`-
 * `2573`).
 */
export function timerDueNow(system: any, filter: Filter) {
  const { matches, ownTimer } = messageFilter(system, filter);

  return !!dueTimer(
    system,
    false,
    (one) => ownTimer(one) && matches(one.hwnd, one.message ?? User.WM_TIMER)
  );
}

/** Whose messages a look takes, and which: see `nextMessage`. */
function messageFilter(system: any, filter: Filter) {
  const handle = system.scheduler.active;

  /* A window's, or a timer's, own task: only its queue is given its paints
   * and timers. */
  const tasks = system.scheduler?.taskCount ?? Object.keys(system.scheduler?._tasks ?? {}).length;
  const mine = (hwnd: number) =>
    tasks < 2 || !hwnd || (system.scheduler.windowTask?.(hwnd) ?? handle) === handle;
  const ownTimer = (timer: Timer) =>
    tasks < 2 || (timer.hwnd ? mine(timer.hwnd) : (timer.task ?? handle) === handle);

  /* The filter `GetMessage` and `PeekMessage` take (`getmsg`): a window,
   * which takes its children's messages too, and a range of messages, both
   * ends in it, nought to nought for all -- or, first past last, the
   * messages outside it, both ends out. */
  const filtered = !!filter && (!!filter.hwnd || !!filter.first || !!filter.last);
  const inRange = (message: number) => {
    const { first, last } = filter!;

    if (!first && !last) {
      return true;
    }

    return first <= last ? message >= first && message <= last : message > first || message < last;
  };
  const matches = (hwnd: number, message: number) =>
    !filtered ||
    ((!filter!.hwnd || hwnd === filter!.hwnd || !!IsChild.call(system, filter!.hwnd, hwnd)) &&
      inRange(message));

  return { filtered, matches, mine, ownTimer };
}

/**
 * Whether a look that does not wait would find nothing, known without
 * waiting for anything and without changing anything: nothing sent, no
 * activation to deliver, nothing queued that the filter takes, no quit,
 * nothing to paint, no timer due -- each looked at as `nextMessage` looks,
 * and anything uncertain left to it.
 * A program that polls with `PeekMessage` finds nothing nearly every time,
 * and is answered so at once rather than through a promise.
 */
export function noMessageNow(system: any, filter: Filter) {
  const task = system.scheduler.task;

  if (task?.sent?.length || system.rasterDesktop?.pendingActivation) {
    return false;
  }

  const { filtered, matches, ownTimer } = messageFilter(system, filter);

  if (filtered ? task?.find((one: any) => matches(one.hwnd, one.message), false) : task?.peek()) {
    return false;
  }

  /* Input, which is given its window only as a look comes to it; and the
   * playback hooks, asked by a look. */
  if (systemQueue(system).length && looksAtInput(task, filter)) {
    return false;
  }

  if (playing(system) && filterKinds(filter)) {
    return false;
  }

  if (task && task.quitCode !== undefined && task.quitCode !== null) {
    return false;
  }

  /* Nothing to paint: asking which window is due would make it ready to
   * paint (`aboutToPaint`), which asking again undoes, so where anything
   * might be due the look is left to `nextMessage`. */
  const desktop = system.rasterDesktop;

  if (
    desktop &&
    (desktop.backgroundDue || desktop.windows.some((window: any) => window.needsPaint))
  ) {
    return false;
  }

  return !dueTimer(
    system,
    false,
    (one) => ownTimer(one) && matches(one.hwnd, one.message ?? User.WM_TIMER)
  );
}

/**
 * The next message, as `GetMessage` takes it (`wait`) or `PeekMessage` looks
 * at it (`remove` or not): `null` when there is none and not waiting.
 */
export async function nextMessage(
  system: any,
  {
    remove = true,
    wait = true,
    filter = null,
    sentEnds = false,
  }: {
    remove?: boolean;
    wait?: boolean;
    filter?: Filter;
    /** Waiting, a message another task sent answered ends the wait: `SENT_ANSWERED`. */
    sentEnds?: boolean;
  } = {}
): Promise<any> {
  const task = system.scheduler.task;
  const { filtered, matches, mine, ownTimer } = messageFilter(system, filter);

  /* The oldest message posted that the filter takes, taken if asked, the
   * keys' state moving with it. */
  const takePosted = async () => {
    const found = task?.findIn(false, (one: any) => matches(one.hwnd, one.message), remove);

    if (found && remove) {
      await deliverActivation(system);
      noteKey(system, found);
    }

    return found;
  };

  /* The oldest input the filter takes, as USER's system queue gives it out
   * (`system-queue.ts`, `mouse-scan.ts`): looked at only where the filter
   * asks for some of what there is; each event given its window as the look
   * comes to it -- a key the window with the focus then, the mouse
   * hit-tested, the window asked -- and the filter held to the message it
   * then is; one taken handed to the journal hooks and told to the windows
   * it is in, and the window asked to be made active and for the cursor,
   * before it is handed over. An event for another task's window ends the
   * look, and that task is woken to take it. While a journal playback hook
   * plays, the events are the hook's, one at a time. */
  const queue = systemQueue(system);
  const tasks = system.scheduler?.taskCount ?? 0;

  /* Whose window it is: another task's ends the look, its task woken. */
  const elsewhere = (hwnd: number) => {
    const owner = tasks < 2 ? task : queueOf(system, hwnd);

    if (owner && owner !== task) {
      owner.signal?.();
      return true;
    }

    return false;
  };

  /* An event leaving the queue, as it is taken or thrown away (seg1
   * `4e2d`): handed to the journal hooks, and the key-state table moved. */
  const leave = async (one: any, made: any) => {
    const at = queue.indexOf(one);

    if (at >= 0) {
      queue.splice(at, 1);
    }

    await eventTaken(system, one);

    if (made.mouse || one.mouse) {
      noteButton(system, (one.mouse ?? made.mouse).kind);
    } else {
      noteKey(system, made);
    }
  };

  /* What a look does with one event: hands over the message it is, passes
   * over it (`skip`), ends the look (`stop`), or has thrown it away and
   * looks again (`gone`). */
  const consider = async (one: any): Promise<any> => {
    if (one.key) {
      /* Control and Escape, Print Screen and the hot keys, taken by the
       * queue for itself as the look comes to them (`task-list.ts`). */
      if (await queueTakesKey(system, one, () => leave(one, one))) {
        return 'gone';
      }

      const target = keyTarget(system, one);

      if (!target) {
        await leave(one, one);
        return 'gone';
      }

      /* A window outside the system-modal window's: passed over, left for
       * after it (`USER.EXE` seg1 `3204`-`3235`; `keyrep`). */
      const sysModal = GetSysModalWindow.call(system);

      if (sysModal && target.hwnd !== sysModal && !IsChild.call(system, sysModal, target.hwnd)) {
        return 'skip';
      }

      if (elsewhere(target.hwnd)) {
        return 'stop';
      }

      if (!matches(target.hwnd, target.message)) {
        return 'skip';
      }

      const vk = one.wParam & 0xff;
      const wasDown = ((system._keyStates?.[vk] ?? 0) & 0x80) !== 0;
      const made: any = Object.assign(new MSG(), one, {
        hwnd: target.hwnd,
        message: target.message,
      });

      for (const own of ['key', 'event', 'played', 'scan', 'repeat', 'extended']) {
        delete made[own];
      }

      if (remove) {
        await leave(one, made);
      }

      made.lParam = keyLParam(system, one, wasDown);

      if (await keyboardHook(system, remove, vk, made.lParam)) {
        if (!remove) {
          await leave(one, made);
        }

        return 'gone';
      }

      if (remove) {
        one.callback?.();
        await deliverActivation(system);

        if (one.played) {
          typedPlayed(system, made);
        }
      }

      return made;
    }

    if (!one.mouse) {
      if (elsewhere(one.hwnd)) {
        return 'stop';
      }

      if (!matches(one.hwnd, one.message)) {
        return 'skip';
      }

      if (remove) {
        await leave(one, one);
        one.callback?.();
        await deliverActivation(system);

        /* A move over no window, the desktop window's: the arrow. */
        await askForCursor(system, one);
      }

      return one;
    }

    const outcome = await resolveMouse(system, task, one);

    /* Taken meanwhile by a look the window made as it was asked. */
    if (!one.played && queue.indexOf(one) < 0) {
      return 'lost';
    }

    if (outcome.kind === 'again') {
      return consider(one);
    }

    if (outcome.kind === 'gone') {
      return 'gone';
    }

    /* A button over no window, the desktop window's: handed to the hooks
     * and taken as any, the desktop not made active (seg1 `2998`). */
    if (outcome.kind === 'desktop') {
      if (!matches(outcome.hwnd, outcome.message)) {
        return 'skip';
      }

      if (
        await mouseHook(
          system,
          remove,
          outcome.message,
          one.mouse.x,
          one.mouse.y,
          outcome.hwnd,
          1 /* HTCLIENT */
        )
      ) {
        await leave(one, one);
        return 'gone';
      }

      const made: any = Object.assign(new MSG(), one, {
        hwnd: outcome.hwnd,
        message: outcome.message,
        wParam: outcome.wParam,
        lParam: outcome.lParam,
      });

      for (const own of ['mouse', 'event', 'played']) {
        delete made[own];
      }

      if (remove) {
        await noteClick(system, one, outcome);
        await leave(one, one);
        one.callback?.();
      }

      return made;
    }

    if (outcome.kind === 'elsewhere') {
      outcome.owner?.signal?.();
      return 'stop';
    }

    if (outcome.kind === 'refused') {
      /* In its non-client form, `HTERROR` its `wParam` (seg1 `2e03`). */
      const kind = one.mouse.kind - 0x160;

      if (!matches(outcome.window.hwnd, kind)) {
        return 'skip';
      }

      await mouseHook(
        system,
        remove,
        kind,
        one.mouse.x,
        one.mouse.y,
        outcome.window.hwnd,
        outcome.hit
      );
      await leave(one, one);
      await refuseMouse(system, one, outcome.window, outcome.hit);
      return 'gone';
    }

    const { resolved } = outcome;

    if (!matches(resolved.hwnd, resolved.message)) {
      return 'skip';
    }

    if (
      await mouseHook(
        system,
        remove,
        resolved.message,
        one.mouse.x,
        one.mouse.y,
        resolved.hwnd,
        resolved.hit
      )
    ) {
      await leave(one, one);
      return 'gone';
    }

    const made: any = Object.assign(new MSG(), one, {
      hwnd: resolved.hwnd,
      message: resolved.message,
      wParam: resolved.wParam,
      lParam: resolved.lParam,
    });

    for (const own of ['mouse', 'event', 'played']) {
      delete made[own];
    }

    if (!remove) {
      return made;
    }

    const at = queue.indexOf(one);

    if (at >= 0) {
      queue.splice(at, 1);
    }

    one.callback?.();
    await deliverActivation(system);
    noteButton(system, one.mouse?.kind ?? 0);
    await noteClick(system, one, resolved);

    const answer = await mouseTaken(system, one, resolved);

    /* Looked at again, its window at the top disabled as it was made active
     * (seg1 `2f6b`): back where it was, not yet taken. */
    if (answer === 2) {
      if (!one.played) {
        queue.splice(Math.min(Math.max(at, 0), queue.length), 0, one);
      }

      return 'again';
    }

    await eventTaken(system, one);

    /* Thrown away. */
    if (answer === 1) {
      return 'gone';
    }

    return made;
  };

  /* One task at a time reads the input (seg1 `2ab9`-`2ae0`): the first to
   * come to it holds it, at `0F4h`, and another's look finds none meanwhile;
   * the look that holds it notes whether it only looks (`106h`). A look of
   * the holder's that finds nothing for it lets it go (`2b06`-`2b15`), and
   * the task whose event ended it is woken (`elsewhere`). Recorded by
   * `inlock`: a program yielding as it handles a click keeps the key after
   * it from the program with the focus until it looks again. */
  const me = system.scheduler?.active ?? null;
  const holdsInput = () => {
    const lock = system._inputLock ?? null;

    if (
      lock !== null &&
      lock !== me &&
      system.scheduler?.taskAt?.(lock) &&
      !system.scheduler.taskAt(lock).ended
    ) {
      return false;
    }

    system._inputLock = me;
    system._inputFirst = !remove;
    return true;
  };
  const letGo = () => {
    system._inputLock = null;
  };

  const takeInput = async () => {
    if (!task) {
      return null;
    }

    const taken = await readInput();

    if (taken === null || taken === undefined) {
      if (system._inputLock === me) {
        letGo();
      }
    }

    return taken;
  };

  const readInput = async (): Promise<any> => {
    /* While a journal playback hook plays, the hook's events, one at a time
     * (seg1 `827a`): one passed over ends the look. */
    if (playing(system)) {
      if (!filterKinds(filter) || !holdsInput()) {
        return null;
      }

      for (;;) {
        const one = await playedEvent(system);

        if (!one) {
          return null;
        }

        let outcome = await consider(one);

        while (outcome === 'again') {
          outcome = await consider(one);
        }

        if (outcome === 'gone') {
          continue;
        }

        return typeof outcome === 'string' ? null : outcome;
      }
    }

    if (!looksAtInput(task, filter) || !holdsInput()) {
      return null;
    }

    for (let at = 0; at < queue.length;) {
      const one = queue[at];
      const outcome = await consider(one);

      if (outcome === 'skip') {
        at = queue.indexOf(one) + 1;
        continue;
      }

      if (outcome === 'stop') {
        return null;
      }

      /* Thrown away, or to be looked at again: the look goes on from
       * where it was. */
      if (outcome === 'gone' || outcome === 'again') {
        const now = queue.indexOf(one);

        at = now >= 0 ? now : Math.min(at, queue.length);
        continue;
      }

      if (outcome === 'lost') {
        at = 0;
        continue;
      }

      return outcome;
    }

    return null;
  };

  let waited = false;

  /* A look by a task handling a message another sent it lets the input go,
   * for it to take (seg1 `281c`-`2847`; `inlock`). */
  if (task?.inSent) {
    letGo();
  }

  for (;;) {
    /* What other tasks sent this one, answered first. Each waited for only
     * where there is something: a program polling asks millions of times. */
    if (task?.sent?.length) {
      await system.scheduler.takeSent?.(task);

      if (sentEnds && waited) {
        return SENT_ANSWERED;
      }
    }

    /* A press that activated a window: its messages first. */
    if (system.rasterDesktop?.pendingActivation) {
      await deliverActivation(system);
    }

    /* After a look that only looked at the input it holds, the input is
     * read before what was posted (seg1 `24a2`-`24dd`; `keyrep`). */
    if (
      system._inputLock === me &&
      system._inputFirst &&
      (playing(system) ? filterKinds(filter) : looksAtInput(task, filter))
    ) {
      const first = await takeInput();

      if (first) {
        return first;
      }
    }

    /* What was posted, before the quit and after it (`quitord`). */
    const posted = await takePosted();

    if (posted) {
      return posted;
    }

    /* The quit, once, which passes every filter (`getmsg`): after everything
     * posted, and before the mouse's and the keyboard's input -- a move the
     * mouse driver put in before the quit or after it, and the move USER
     * makes of its own accord as a window goes from under the cursor
     * (`quitin`). See `postQuit`. */
    if (task && task.quitCode !== undefined && task.quitCode !== null) {
      const code = task.quitCode;

      if (remove) {
        task.quitCode = null;
      }

      return message_(system, 0, User.WM_QUIT, code, 0);
    }

    const input = await takeInput();

    if (input) {
      return input;
    }

    const unpainted = system.rasterDesktop?.unpaintedWhere(
      (window: any) =>
        mine(window.hwnd) &&
        (!filtered || matches(window.hwnd, paintMessage(system, window.hwnd).message))
    );

    if (unpainted) {
      /* `WM_PAINTICON` for an icon; see `paint-icon.ts`. */
      const { message, wParam } = paintMessage(system, unpainted.hwnd);

      return message_(system, unpainted.hwnd, message, wParam, 0);
    }

    const timer = dueTimer(
      system,
      remove,
      (one) => ownTimer(one) && matches(one.hwnd, one.message ?? User.WM_TIMER)
    );

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

    /* Nothing yet: wait, the processor given up to the other tasks, for
     * anything to arrive -- posted, sent, or due to paint -- or this task's
     * next timer to be due, and look again. */
    let due = Infinity;

    for (const timer of timersOf(system).values()) {
      if (ownTimer(timer)) {
        due = Math.min(due, timer.due);
      }
    }

    /* The playback hooks' wait, after which the look asks them again
     * (`USER.EXE` seg1 `7336`). */
    due = Math.min(due, playbackDue(system) ?? Infinity);

    task.waitingForMessage = true;

    try {
      if (system.scheduler.waitForWake) {
        await system.scheduler.waitForWake(
          due === Infinity ? undefined : due - clockOf(system).now()
        );
      } else {
        const waits: Promise<unknown>[] = [task.arrival()];

        if (due !== Infinity) {
          waits.push(
            new Promise((resolve) =>
              clockOf(system).after(due - clockOf(system).now(), () => resolve(null))
            )
          );
        }

        await Promise.race(waits);
      }
    } finally {
      task.waitingForMessage = false;
    }

    waited = true;

    /* What came due at interrupt time while it waited: called now, with the
     * processor back and nothing else under way (see `atInterrupt`). */
    await system.scheduler.takeInterrupts?.();
  }
}

/**
 * Dispatches a timer's message to its procedure, when it was set with one
 * rather than for a window: `DispatchMessage`'s part in it.
 */
/** The procedure a timer was set with, if any. */
export function timerProcOf(system: any, hwnd: number, id: number) {
  return [...timersOf(system).values()].find((each) => each.hwnd === hwnd && each.id === id)?.proc;
}

export async function callTimerProc(system: any, msg: any) {
  const timer = [...timersOf(system).values()].find(
    (each) => each.hwnd === msg.hwnd && each.id === msg.wParam
  );
  const proc = timer?.proc ?? msg.lParam;

  if (typeof proc === 'function') {
    return proc(msg.hwnd, User.WM_TIMER, msg.wParam, msg.time);
  }

  /* As `DispatchMessage` calls one (seg1 `277c`): see `stackRegisters`. */
  return system.scheduler.callProc(
    proc,
    [
      [msg.hwnd, HWND],
      [User.WM_TIMER, UINT],
      [msg.wParam, UINT],
      [msg.time >>> 0, DWORD],
    ],
    system.scheduler.stackRegisters()
  );
}
