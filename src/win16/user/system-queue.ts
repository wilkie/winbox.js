'use strict';

import { clockOf } from '../../emulator/clock.js';
import { MSG, User } from '../user.js';

import { callHooksWith, hasHooks } from './hooks.js';
import { queueOf } from './queue.js';
import { GetSysModalWindow } from './userwin.js';

/**
 * USER's system queue: the keyboard's and the mouse's input, one queue for
 * every task, in the order it was put in, given to a window only as a task
 * takes it.
 *
 * **Read out** of `USER.EXE`.
 *
 * * `KEYBD_EVENT` and `MOUSE_EVENT` (seg1 `4b59`, `507a`) put each event in
 *   at the end (`4bd4`, `4d70`, `5480`): a message, `paramL` and `paramH`,
 *   the time, and the cursor. A key's message is `WM_KEYDOWN` or
 *   `WM_KEYUP`, or the system key's, as the keys held then make it; its
 *   `paramL` the virtual key and the scan code above it, its `paramH` the
 *   repeat count and 8000h for an extended key. A button's `paramL` and
 *   `paramH` are the point on the screen. The queue full, the event is lost
 *   and `DoBeep` sounds (`4d99`).
 * * A move is not put in until something else is, or a task looks
 *   (`4bf2`, `4d2d`, `833d`), and then over a move at the end of the queue:
 *   moves not yet taken become one.
 * * A look takes from the head (`2aa2`). Each event is given its window
 *   then: a key the window with the focus, or with none the active window,
 *   and then as a system key (`31a3`-`31db`); with neither, it is thrown
 *   away. The mouse is hit-tested (`2cdc`, `mouse-scan.ts`). An event for a
 *   window of another task ends the look: that task is woken to take it
 *   (`31df`, `2d2c`, `2b2d`). One the look's filter does not take is passed
 *   over, and the look goes on behind it (`3218`, `2e17`).
 * * Taken (`4e2d`), the event is handed to the journal record hooks, or
 *   told to the playback hooks as skipped; the key-state table that
 *   `GetKeyState` reads moves with it; and it leaves the queue.
 * * The keyboard hooks are called for a key after that, with `HC_ACTION`, or
 *   with `HC_NOREMOVE` for a look that leaves it (`32e5`); the mouse hooks
 *   for a button or a move before it (`2e75`). A hook that answers
 *   non-nought in AX throws the event away, taken or only looked at (`2c60`).
 * * While a journal playback hook is in, the queue is not read: the hook is
 *   asked for one event at a time (`827a`), and the keyboard and the mouse
 *   go on filling the queue for after it, all but the mouse's moves, which
 *   are lost (`50cc`).
 *
 * **Recorded** by `sysq`, `jrnlrec`, `jrnlplay` and `inhook`.
 */

export const WH_JOURNALRECORD = 0;
export const WH_JOURNALPLAYBACK = 1;
export const WH_KEYBOARD = 2;
export const WH_MOUSE = 7;

export const HC_ACTION = 0;
export const HC_GETNEXT = 1;
export const HC_SKIP = 2;
export const HC_NOREMOVE = 3;
export const HC_SYSMODALON = 4;
export const HC_SYSMODALOFF = 5;

/** The system queue: one array, which every task's `_input` is. */
export function systemQueue(system: any): any[] {
  return (system._systemQueue ??= []);
}

/** Whether a journal playback hook is in: then the queue is not read. */
export function playing(system: any) {
  return hasHooks(system, WH_JOURNALPLAYBACK);
}

const word = (value: number) => [value & 0xff, (value >>> 8) & 0xff];
const long = (value: number) => [...word(value & 0xffff), ...word((value >>> 16) & 0xffff)];

/**
 * An event as `EVENTMSG` holds it (`USER.EXE` seg1 `827a`, `4e2d`): the
 * message, `paramL`, `paramH` and the time. A key's message is as it was put
 * in, before it was made a system key for want of the focus (`jrnlrec`).
 */
function eventBytes(event: { message: number; paramL: number; paramH: number; time: number }) {
  return [
    ...word(event.message),
    ...word(event.paramL),
    ...word(event.paramH),
    ...long(event.time >>> 0),
  ];
}

/** What an input message was put in as. */
export function eventOf(one: any) {
  if (one.event) {
    return one.event;
  }

  const mouse = one.mouse;

  if (mouse) {
    return { message: mouse.kind, paramL: mouse.x & 0xffff, paramH: mouse.y & 0xffff, time: one.time };
  }

  /* A move made over no window, the desktop window's: the point on the
   * screen. */
  return {
    message: one.message,
    paramL: one.lParam & 0xffff,
    paramH: (one.lParam >>> 16) & 0xffff,
    time: one.time,
  };
}

/**
 * An event taken from the queue (`USER.EXE` seg1 `4e2d`): told to the
 * playback hooks as skipped, a move played back putting the cursor at its
 * point (`4e5c`); or else handed to the record hooks with `HC_ACTION`. Not
 * while a window is system-modal (`4e42`).
 */
export async function eventTaken(system: any, one: any) {
  if (sysModal(system)) {
    return;
  }

  if (one.played) {
    await callHooksWith(system, WH_JOURNALPLAYBACK, HC_SKIP, 0, null);

    if (one.event.message === User.WM_MOUSEMOVE && system.rasterInput) {
      system.rasterInput.cursor = { x: (one.event.paramL << 16) >> 16, y: (one.event.paramH << 16) >> 16 };
    }

    return;
  }

  if (hasHooks(system, WH_JOURNALRECORD)) {
    await callHooksWith(system, WH_JOURNALRECORD, HC_ACTION, 0, eventBytes(eventOf(one)));
  }
}

/**
 * The next event from the playback hooks, asked for with `HC_GETNEXT` and
 * an `EVENTMSG` whose time is now (`USER.EXE` seg1 `827a`): the event, or
 * null where the hook asks for a wait first. The wait is kept, and the
 * look's task woken when it has passed (`72c6`, `7336`); asked again, the
 * hook answers what is left of it.
 */
export async function playedEvent(system: any) {
  const now = clockOf(system).now();
  const { answer, bytes } = await callHooksWith(
    system,
    WH_JOURNALPLAYBACK,
    HC_GETNEXT,
    0,
    eventBytes({ message: 0, paramL: 0, paramH: 0, time: Math.floor(now) })
  );
  const read = (at: number) => bytes[at] | (bytes[at + 1] << 8);
  const event = {
    message: read(0),
    paramL: read(2),
    paramH: read(4),
    time: (read(6) | (read(8) << 16)) >>> 0,
  };

  if (answer >>> 0) {
    system._playbackDue = now + (answer >>> 0);
    return null;
  }

  system._playbackDue = null;

  return input(system, event, true);
}

/** When the playback hooks' wait is over, if one is being kept. */
export function playbackDue(system: any): number | null {
  return playing(system) ? (system._playbackDue ?? null) : null;
}

/**
 * An event made input, as a look takes it: a key's message with its
 * virtual key and `lParam`, which the look gives a window; the mouse's put
 * in at its point, to be hit-tested.
 */
export function input(system: any, event: any, played: boolean) {
  const msg: any = new MSG();
  const message = event.message;

  msg.event = event;
  msg.played = played;
  msg.time = event.time;
  msg.pt = { ...(system.rasterInput?.cursor ?? { x: 0, y: 0 }) };

  if (message >= User.WM_KEYDOWN && message <= User.WM_SYSKEYUP) {
    msg.key = true;
    msg.hwnd = 0;
    msg.message = message;
    msg.wParam = event.paramL & 0xff;
    msg.scan = (event.paramL >>> 8) & 0xff;
    msg.repeat = event.paramH & 0x7fff;
    msg.extended = (event.paramH & 0x8000) !== 0;
    msg.lParam = 0;

    return msg;
  }

  if (message >= User.WM_MOUSEMOVE && message <= User.WM_MBUTTONDBLCLK) {
    const x = (event.paramL << 16) >> 16;
    const y = (event.paramH << 16) >> 16;
    const keys = buttonKeys(system, message);

    msg.hwnd = 0;
    msg.message = message;
    msg.wParam = keys;
    msg.lParam = ((y & 0xffff) << 16) | (x & 0xffff);
    msg.pt = { x, y };
    msg.mouse = { x, y, kind: message, keys };

    return msg;
  }

  /* Anything else is given as it is to the window its extra information
   * names, which played back is none, and so to the active window
   * (`2b9d`-`2baa`, `82e3`). */
  msg.hwnd = system.rasterDesktop?.active?.hwnd ?? 0;
  msg.message = message;
  msg.wParam = event.paramL;
  msg.lParam = event.paramH;

  return msg;
}

/**
 * The window a key is for, as a look takes it (`USER.EXE` seg1 `3188`-
 * `31db`): the window with the focus; with none, the active window, and the
 * key then a system key. F10 is always one (`3188`). Null for neither: the
 * key is thrown away (`31bb`).
 */
export function keyTarget(system: any, one: any) {
  const desktop = system.rasterDesktop;
  let message = one.message;

  if ((one.wParam & 0xff) === User.VK_F10) {
    message |= 4;
  }

  const focus = desktop?.focus ?? null;
  const window = focus ?? desktop?.active ?? null;

  if (!window) {
    return null;
  }

  if (!focus && message >= User.WM_KEYDOWN && message <= User.WM_KEYUP + 2) {
    message += 4;
  }

  return { window, hwnd: window.hwnd, message };
}

/**
 * A key's `lParam` as a look makes it from the event (`USER.EXE` seg1
 * `3263`-`32db`): the repeat count; the scan code; 100h above it for an
 * extended key; Alt down, as the key-state table says once the key has
 * moved it; the key down before, as the table said before; and 8000h for a
 * release. A key from the keyboard keeps what was put in with it.
 */
export function keyLParam(system: any, one: any, wasDown: boolean) {
  if (!one.played) {
    return one.lParam >>> 0;
  }

  const table: Uint8Array | undefined = system._keyStates;
  const alt = ((table?.[User.VK_MENU] ?? 0) & 0x80) !== 0;
  const up = (one.message & 1) !== 0;

  return (
    ((one.repeat & 0xffff) |
      ((one.scan & 0xff) << 16) |
      (one.extended ? 1 << 24 : 0) |
      (alt ? 1 << 29 : 0) |
      (wasDown ? 1 << 30 : 0) |
      (up ? 1 << 31 : 0)) >>>
    0
  );
}

/** The window made system-modal, if it is still there. */
function sysModal(system: any) {
  return GetSysModalWindow.call(system);
}

/**
 * The `MK_` flags a mouse message played back carries, as a look makes them
 * from the key-state table once the message has moved it (`USER.EXE` seg1
 * `2fb1`-`2ff5`): the buttons, Shift and Control.
 */
function buttonKeys(system: any, message: number) {
  const table: Uint8Array = system._keyStates ?? new Uint8Array(256);
  const held = (vk: number) => (table[vk] & 0x80) !== 0;
  const pressed: Record<number, [number, boolean]> = {
    0x201: [0x01, true],
    0x202: [0x01, false],
    0x204: [0x02, true],
    0x205: [0x02, false],
    0x207: [0x10, true],
    0x208: [0x10, false],
  };
  let keys =
    (held(0x01) ? 0x01 : 0) |
    (held(0x02) ? 0x02 : 0) |
    (held(0x04) ? 0x10 : 0) |
    (held(User.VK_SHIFT) ? 0x04 : 0) |
    (held(User.VK_CONTROL) ? 0x08 : 0);
  const change = pressed[message];

  if (change) {
    keys = change[1] ? keys | change[0] : keys & ~change[0];
  }

  return keys;
}

/**
 * What a key played back types, for `TranslateMessage`, which hands the
 * keyboard driver's `ToAscii` the key-state table (`USER.EXE` seg1
 * `26b6`-`26d9`): the US keyboard's, as `Keybd_Event` has it -- a letter
 * shifted or not, a control character with Control down, the digits, Space
 * and the keys that type a control character.
 */
export function typedPlayed(system: any, msg: any) {
  if (msg.message !== User.WM_KEYDOWN && msg.message !== User.WM_SYSKEYDOWN) {
    return;
  }

  const table: Uint8Array = system._keyStates ?? new Uint8Array(256);
  const held = (vk: number) => (table[vk] & 0x80) !== 0;
  const vk = msg.wParam & 0xff;
  let typed: number | undefined;

  if (vk >= 0x41 && vk <= 0x5a) {
    typed = held(User.VK_CONTROL) ? vk & 0x1f : held(User.VK_SHIFT) ? vk : vk + 0x20;
  } else if ((vk >= 0x30 && vk <= 0x39) || vk === 0x20 || [0x08, 0x09, 0x0d, 0x1b].includes(vk)) {
    typed = vk;
  } else if (vk === 0xbd) {
    typed = held(User.VK_SHIFT) ? 0x5f : 0x2d;
  }

  if (typed === undefined) {
    system.rasterInput?.typed.delete(vk);
  } else {
    system.rasterInput?.typed.set(vk, typed);
  }
}

/** The task whose window this is, as a look tells it from its own. */
export function taskOfWindow(system: any, hwnd: number) {
  return queueOf(system, hwnd);
}

/**
 * The keyboard hooks asked about a key a look has come to (`USER.EXE` seg1
 * `32e5`, `8112`): `HC_ACTION` as it is taken, `HC_NOREMOVE` as it is only
 * looked at, the virtual key, and the `lParam` it goes with. Whether a hook
 * answered non-nought in AX: the key is thrown away.
 */
export async function keyboardHook(system: any, remove: boolean, vk: number, lParam: number) {
  if (sysModal(system) || !hasHooks(system, WH_KEYBOARD)) {
    return false;
  }

  const { answer } = await callHooksWith(
    system,
    WH_KEYBOARD,
    remove ? HC_ACTION : HC_NOREMOVE,
    vk & 0xffff,
    lParam >>> 0
  );

  return (answer & 0xffff) !== 0;
}

/**
 * The mouse hooks asked about a mouse message a look has come to (`USER.EXE`
 * seg1 `2e75`-`2ebe`): `HC_ACTION` or `HC_NOREMOVE`, the message as it is
 * then, and a `MOUSEHOOKSTRUCT` -- the point on the screen, the window, the
 * hit-test code and the extra information. Whether a hook answered
 * non-nought in AX: the message is thrown away.
 */
export async function mouseHook(
  system: any,
  remove: boolean,
  message: number,
  x: number,
  y: number,
  hwnd: number,
  hit: number
) {
  if (sysModal(system) || !hasHooks(system, WH_MOUSE)) {
    return false;
  }

  const { answer } = await callHooksWith(
    system,
    WH_MOUSE,
    remove ? HC_ACTION : HC_NOREMOVE,
    message & 0xffff,
    [...word(x), ...word(y), ...word(hwnd), ...word(hit), ...long(0)]
  );

  return (answer & 0xffff) !== 0;
}
