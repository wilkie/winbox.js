'use strict';

import { SendMessage } from './SendMessage.js';
import { queueOf } from './queue.js';
import { deliverActivation } from './activation.js';
import { GetActiveWindow } from './placement.js';
import { RasterWindow } from './raster-window.js';

import { type Desktop, type DesktopWindow } from './desktop.js';

/**
 * The mouse as USER's system queue gives it out: each mouse message hit-tested
 * as a look comes to it, the window asked where the point is on it, and, as a
 * press is taken, the windows it is in told and the window asked whether to
 * be made active.
 *
 * **Read out** of `USER.EXE`.
 *
 * * The input is looked at only where the look's filter asks for some of it
 *   and the queue has some (seg1 `24bb`, `2509`): a filter's range asks for
 *   the mouse's moves where it holds `WM_MOUSEMOVE` or `WM_NCMOUSEMOVE`, for
 *   its buttons where it meets `WM_NCLBUTTONDOWN` to `WM_NCMBUTTONDBLCLK` or
 *   `WM_LBUTTONDOWN` to `WM_MBUTTONDBLCLK`, for the keys where it meets
 *   `WM_KEYDOWN` to `WM_SYSDEADCHAR` (`25e8`). Then each mouse message, in
 *   order, is hit-tested before the filter is held to it (`2d0c`, `2e0e`),
 *   until one is taken or looked at.
 * * The hit test (`71b9`): with the mouse captured, the capturing window and
 *   `HTCLIENT`. Else, from the desktop window down, front first: a hidden
 *   window, and one the point is not on, is passed over; a disabled child
 *   is passed over, its children with it; a disabled window at the top is
 *   `HTERROR` there and then; an icon is `HTCAPTION`. Where the point is in
 *   a window's client area, its children are looked at first, and the
 *   window itself after them. A window of another task is `HTCLIENT`, and
 *   its task is left to take the message, hit-testing it again. Any other
 *   window is sent `WM_NCHITTEST`, and answering `HTTRANSPARENT` it is
 *   passed over too, for its brothers behind it and then the window it is
 *   in.
 * * `HTERROR` and `HTNOWHERE` (`2ec5`): the window is sent `WM_SETCURSOR`
 *   and the message is thrown away, taken or only looked at.
 * * Not `HTCLIENT`, the message takes its non-client form, with the
 *   hit-test code for its `wParam` and the point on the screen (`2e03`); a
 *   press is a double click off the client area, or in it where the class
 *   has `CS_DBLCLKS` (`2d69`).
 * * Taken, with the mouse not captured (`2933`): a press is sent up from a
 *   child to each window it is in, as `WM_PARENTNOTIFY` with the mouse
 *   message and the point in that window's client area -- whatever
 *   `WS_EX_NOPARENTNOTIFY` says. Then a press on a window that is not the
 *   active one, in a window at the top that is not the desktop window, is
 *   sent `WM_MOUSEACTIVATE`, naming the window at the top, with the hit-test
 *   code and the mouse message: answered 0, `MA_ACTIVATE` or
 *   `MA_ACTIVATEANDEAT`, that window is made active, `WA_CLICKACTIVE` for a
 *   press in the client area and `WA_ACTIVE` for one off it (`29e6`, `38e4`,
 *   `377e`), and the press thrown away for `MA_ACTIVATEANDEAT`;
 *   `MA_NOACTIVATE` leaves it as it is; `MA_NOACTIVATEANDEAT` throws the
 *   press away. Then the window is sent `WM_SETCURSOR`, press or not, eaten
 *   or not.
 *
 * **Recorded** by `mousemsg`: `HTCAPTION` answered from a client area drags
 * the window; `HTTRANSPARENT` passes the mouse to a brother behind and to
 * the window beneath at the top; two windows up a press is told to each;
 * each answer to `WM_MOUSEACTIVATE`; a `PeekMessage` that only looks asks
 * once, for the first message, and one for the keys asks nothing.
 */

export const WM_NCHITTEST = 0x0084;
export const WM_MOUSEACTIVATE = 0x0021;
export const WM_PARENTNOTIFY = 0x0210;
const WM_SETCURSOR = 0x0020;
const WM_MOUSEMOVE = 0x0200;
const WM_NCMOUSEMOVE = 0x00a0;

const HTTRANSPARENT = -1;
const HTNOWHERE = 0;
const HTCLIENT = 1;
const HTCAPTION = 2;
const HTERROR = -2;

const MA_ACTIVATEANDEAT = 2;
const MA_NOACTIVATEANDEAT = 4;

const CS_DBLCLKS = 0x0008;
const WS_CHILD = 0x40000000;
const WS_POPUP = 0x80000000;
const WS_DISABLED = 0x08000000;

const QS_KEY = 0x01;
const QS_MOUSEMOVE = 0x02;
const QS_MOUSEBUTTON = 0x04;

/** The mouse as it was put in: where on the screen, which message, and the keys and buttons down. */
export interface MouseInput {
  x: number;
  y: number;
  /** The mouse message in its client form: `WM_MOUSEMOVE`, or a button's press or release. */
  kind: number;
  /** A press the mouse made the second of a double click. */
  double: boolean;
  /** The `MK_` flags, for a message in the client area. */
  keys: number;
}

/** A mouse message hit-tested: the window it is for, its form, and the hit-test code. */
export interface Resolved {
  window: DesktopWindow;
  hwnd: number;
  message: number;
  wParam: number;
  lParam: number;
  hit: number;
}

type Filter = { hwnd: number; first: number; last: number } | null;

/** Whether a range, as a look's filter gives it, meets another (seg1 `2652`). */
function meets(first: number, last: number, low: number, high: number) {
  return first <= last ? high >= first && low <= last : low > first || high < last;
}

/** Whether a range holds a message (seg1 `2863`). */
function holds(first: number, last: number, message: number) {
  return meets(first, last, message, message);
}

/** What kinds of input a look's filter asks for, as `QS_` bits (seg1 `25e8`). */
function filterKinds(filter: Filter) {
  if (!filter || (!filter.first && !filter.last)) {
    return QS_KEY | QS_MOUSEMOVE | QS_MOUSEBUTTON;
  }

  const { first, last } = filter;
  let kinds = 0;

  if (holds(first, last, WM_MOUSEMOVE) || holds(first, last, WM_NCMOUSEMOVE)) {
    kinds |= QS_MOUSEMOVE;
  }

  if (meets(first, last, 0x00a1, 0x00a9) || meets(first, last, 0x0201, 0x0209)) {
    kinds |= QS_MOUSEBUTTON;
  }

  if (meets(first, last, 0x0100, 0x0107)) {
    kinds |= QS_KEY;
  }

  return kinds;
}

/** What kinds of input a task's queue holds, as `QS_` bits. */
function inputKinds(task: any) {
  let kinds = 0;

  for (const message of task?._input ?? []) {
    const kind = message.mouse?.kind ?? message.message;

    kinds |=
      kind >= 0x100 && kind <= 0x108
        ? QS_KEY
        : kind === WM_MOUSEMOVE || kind === WM_NCMOUSEMOVE
          ? QS_MOUSEMOVE
          : QS_MOUSEBUTTON;
  }

  return kinds;
}

/** Whether a look looks at the input at all (seg1 `24bb`). */
export function looksAtInput(task: any, filter: Filter) {
  return (filterKinds(filter) & inputKinds(task)) !== 0;
}

function within(window: DesktopWindow, x: number, y: number) {
  return (
    x >= window.left &&
    x < window.left + window.width &&
    y >= window.top &&
    y < window.top + window.height
  );
}

function inClient(window: DesktopWindow, x: number, y: number) {
  const { left, top, right, bottom } = window.client;

  return (
    x >= window.left + left &&
    x < window.left + right &&
    y >= window.top + top &&
    y < window.top + bottom
  );
}

/** A child, as USER tells one: `WS_CHILD` without `WS_POPUP`. */
function isChild(window: DesktopWindow) {
  return ((window.style >>> 0) & (WS_CHILD | WS_POPUP)) === WS_CHILD;
}

/** A window's brothers, itself among them, the front first: windows of the program, with handles. */
function brothers(desktop: Desktop, window: DesktopWindow) {
  return desktop.windows.filter((other) => other.parent === window.parent && other.hwnd);
}

/**
 * The window the scan comes to first in one the point is on: where the point
 * is in its client area and not an icon's, the first of its children shown
 * under the point, and so on down.
 */
function descend(desktop: Desktop, window: DesktopWindow, x: number, y: number): DesktopWindow {
  if (window.state === 'minimized' || !inClient(window, x, y)) {
    return window;
  }

  const child = desktop.windows.find(
    (other) => other.parent === window && other.hwnd && other.visible && within(other, x, y)
  );

  return child ? descend(desktop, child, x, y) : window;
}

/**
 * The window the scan comes to after one it passed over: the next of its
 * brothers behind it that is shown under the point, or else the window it is
 * in -- none, the desktop's, past the windows at the top.
 */
function beneath(desktop: Desktop, window: DesktopWindow, x: number, y: number) {
  const all = brothers(desktop, window);

  for (const other of all.slice(all.indexOf(window) + 1)) {
    if (other.visible && within(other, x, y)) {
      return descend(desktop, other, x, y);
    }
  }

  return window.parent;
}

/** The outermost disabled window a window is, or is in; none if none is. */
function disabledAround(window: DesktopWindow) {
  let found: DesktopWindow | null = null;

  for (let at: DesktopWindow | null = window; at; at = at.parent) {
    if (at.style & WS_DISABLED) {
      found = at;
    }
  }

  return found;
}

/** Whether a window is the running task's, as a look tells its own. */
function mine(system: any, hwnd: number) {
  const scheduler = system.scheduler;
  const tasks = scheduler?.taskCount ?? 0;

  return tasks < 2 || (scheduler.windowTask?.(hwnd) ?? scheduler.active) === scheduler.active;
}

const signed = (value: number) => (value << 16) >> 16;

/**
 * The window under the point and the part of it the point is on, as USER's
 * hit test finds them (seg1 `71b9`): `WM_NCHITTEST` sent to the windows of
 * the running task it comes to. `other` where the window is another task's.
 */
async function hitTest(system: any, x: number, y: number) {
  const desktop: Desktop = system.rasterDesktop;
  let candidate: DesktopWindow | null = desktop.windowAt(x, y);

  while (candidate) {
    const disabled = disabledAround(candidate);

    if (disabled) {
      if (!isChild(disabled)) {
        return { window: disabled, hit: HTERROR, other: false };
      }

      candidate = beneath(desktop, disabled, x, y);
      continue;
    }

    /* An icon is all caption, and so is its title, whose procedure answers
     * `WM_NCHITTEST` so (seg1 `6dbd`). */
    if (candidate.state === 'minimized' || candidate.titleOf) {
      return { window: candidate, hit: HTCAPTION, other: false };
    }

    if (!mine(system, candidate.hwnd)) {
      return { window: candidate, hit: HTCLIENT, other: true };
    }

    const hit = signed(
      await SendMessage.call(
        system,
        candidate.hwnd,
        WM_NCHITTEST,
        0,
        ((y & 0xffff) << 16) | (x & 0xffff)
      )
    );

    if (hit !== HTTRANSPARENT) {
      return { window: candidate, hit, other: false };
    }

    candidate = beneath(desktop, candidate, x, y);
  }

  return null;
}

function classStyle(system: any, hwnd: number) {
  const handle = system.handles.resolve(hwnd);
  const windowClass =
    handle instanceof RasterWindow ? system.handles.retrieve(handle.options.windowClass) : null;

  return windowClass?.style ?? 0;
}

/**
 * What a look does with a mouse message it comes to: `resolved` where it
 * is a message for a window of this task, in the form it takes;
 * `refused` where it is to be thrown away, its window told; `elsewhere`
 * where it is another task's, or the desktop window's, and has been handed
 * on to that task's queue.
 */
export async function resolveMouse(
  system: any,
  task: any,
  msg: any
): Promise<
  | { kind: 'resolved'; resolved: Resolved }
  | { kind: 'refused'; window: DesktopWindow; hit: number }
  | { kind: 'elsewhere' }
> {
  const input = system.rasterInput;
  const mouse: MouseInput = msg.mouse;
  const { x, y } = mouse;
  const capture: DesktopWindow | null = input?.capture ?? null;
  const kind = capture ? (input.captureKind ?? 'set') : 'set';
  const found = capture
    ? { window: capture, hit: HTCLIENT, other: !mine(system, capture.hwnd) }
    : await hitTest(system, x, y);

  if (!found || found.other) {
    /* Over no window, the desktop window's: a move makes the cursor the
     * arrow as its task takes it; a button over no window is no one's. */
    const hwnd = found ? found.window.hwnd : system.desktopWindow;
    const owner = hwnd ? queueOf(system, hwnd) : null;
    const at = task._input.indexOf(msg);

    if (at >= 0) {
      task._input.splice(at, 1);
    }

    if (!found) {
      if (mouse.kind === WM_MOUSEMOVE && owner) {
        msg.hwnd = hwnd;
        msg.message = WM_MOUSEMOVE;
        msg.wParam = 0;
        msg.lParam = ((y & 0xffff) << 16) | (x & 0xffff);
        delete msg.mouse;
        owner.push(msg, true);
      }
    } else if (owner) {
      msg.hwnd = hwnd;
      owner.push(msg, true);
    }

    return { kind: 'elsewhere' };
  }

  const { window, hit } = found;

  if (hit === HTERROR || hit === HTNOWHERE) {
    return { kind: 'refused', window, hit };
  }

  const client = hit === HTCLIENT;
  let message = mouse.kind;

  /* A press is a double click off the client area, or in it for a class that
   * asks for them, or in a menu's loop (seg1 `2d69`). */
  if (
    mouse.double &&
    (!client || kind === 'menu' || classStyle(system, window.hwnd) & CS_DBLCLKS)
  ) {
    message += 2;
  }

  /* The non-client forms are the client ones moved down by 160h. */
  if (!client) {
    message -= WM_MOUSEMOVE - WM_NCMOUSEMOVE;
  }

  /* In the client area, as the window's; off it, and taken by a loop of
   * USER's, as the screen's (seg1 `2e21`, `2e0e`). */
  const at =
    client && kind === 'set'
      ? { x: x - window.left - window.client.left, y: y - window.top - window.client.top }
      : { x, y };

  return {
    kind: 'resolved',
    resolved: {
      window,
      hwnd: window.hwnd,
      message,
      wParam: client ? mouse.keys : hit & 0xffff,
      lParam: ((at.y & 0xffff) << 16) | (at.x & 0xffff),
      hit,
    },
  };
}

/** A message thrown away as `HTERROR` or `HTNOWHERE`: its window told (seg1 `2ef8`). */
export async function refuseMouse(system: any, msg: any, window: DesktopWindow, hit: number) {
  await SendMessage.call(
    system,
    window.hwnd,
    WM_SETCURSOR,
    window.hwnd,
    ((msg.mouse.kind << 16) | (hit & 0xffff)) >>> 0
  );
}

const PRESSES = new Set([0x0201, 0x0204, 0x0207]);

/**
 * A mouse message taken, before it is handed over (seg1 `2933`): a press
 * told to the windows it is in and the window asked whether to be made
 * active, and the window asked for the cursor. Answers 0 to hand it over, 1
 * to throw it away, 2 to look at it again: the window at the top disabled
 * as it was made active.
 */
export async function mouseTaken(system: any, msg: any, resolved: Resolved) {
  const input = system.rasterInput;
  const desktop: Desktop = system.rasterDesktop;

  if (input?.capture) {
    return 0;
  }

  const mouse: MouseInput = msg.mouse;
  const { window, hit } = resolved;
  const press = PRESSES.has(mouse.kind);
  let top: DesktopWindow | null = window;

  if (press) {
    for (let at = window; isChild(at);) {
      const parent = at.parent;

      /* A child of the desktop window, as a combo box's list dropped down is
       * (`comboact`): told to the desktop window, which does nothing. */
      if (!parent) {
        top = null;
        break;
      }

      await SendMessage.call(
        system,
        parent.hwnd,
        WM_PARENTNOTIFY,
        mouse.kind,
        (((mouse.y - parent.top - parent.client.top) & 0xffff) << 16) |
          ((mouse.x - parent.left - parent.client.left) & 0xffff)
      );
      at = parent;
      top = at;
    }
  }

  let answer = 0;
  const wasActive = !!top?.active;

  if (press && top && window.hwnd !== GetActiveWindow.call(system)) {
    const asked = signed(
      await SendMessage.call(
        system,
        window.hwnd,
        WM_MOUSEACTIVATE,
        top.hwnd,
        ((mouse.kind << 16) | (hit & 0xffff)) >>> 0
      )
    );

    if (asked >= 0 && asked <= MA_ACTIVATEANDEAT) {
      if (!top.active) {
        desktop.show(top);

        /* `WA_CLICKACTIVE` for a press in the client area, `WA_ACTIVE` for
         * one off it (seg1 `29d9`, `377e`). */
        if (desktop.pendingActivation) {
          desktop.pendingActivation.click = hit === HTCLIENT;
        }

        await deliverActivation(system);
        input?.wake();
      }

      answer = top.style & WS_DISABLED ? 2 : asked === MA_ACTIVATEANDEAT ? 1 : 0;
    } else if (asked === MA_NOACTIVATEANDEAT) {
      answer = 1;
    }
  }

  /* A control pressed in the window that was active takes the focus for
   * itself, as the controls' procedures here leave it to be given. */
  if (press && top && wasActive && answer === 0) {
    desktop.focus = window.control ? window : (desktop.focus ?? top);
  }

  await SendMessage.call(
    system,
    window.hwnd,
    WM_SETCURSOR,
    window.hwnd,
    ((mouse.kind << 16) | (hit & 0xffff)) >>> 0
  );

  return answer;
}
