'use strict';

import { GlobalAlloc } from '../kernel/GlobalAlloc.js';
import { GlobalLock } from '../kernel/GlobalLock.js';
import { User } from '../user.js';
import { stringAt } from './control-classes.js';
import { RasterWindow } from './raster-window.js';
import { GetWindowTask } from './window-queries.js';

/**
 * USER's calls that hand a program's procedure each window or property in
 * turn, and the smaller ones found beside them. **Read out of `USER.EXE`**
 * and **recorded** by `minis3`.
 */

const BOOL = 6;
const HWND = 9;
const LPARAM = 16;
const FARPTR = 40;

/**
 * A program's procedure called with arguments, AX, DS and ES the stack's, as
 * USER calls one (seg1 `6525`, seg13 `11b9`); `EnumTaskWindows` sets AX its
 * own way.
 */
async function callBack(
  system: any,
  proc: number,
  args: any[],
  registers: Record<string, number> = {}
) {
  return (
    (await system.scheduler.call(User, (proc >>> 16) & 0xffff, proc & 0xffff, args, BOOL, {
      ...system.scheduler.stackRegisters(),
      ...registers,
    })) & 0xffff
  );
}

/** The windows at the top, front to back, as the desktop's children are. */
export function topLevel(system: any): RasterWindow[] {
  const desktop = system.rasterDesktop;

  return (desktop?.windows ?? [])
    .filter((window: any) => !window.parent && window.hwnd && !window.titleOf)
    .map((window: any) => system.handles.resolve(window.hwnd))
    .filter((window: any) => window instanceof RasterWindow);
}

/** A window's children, and theirs, depth first: each, then its own, then the next. */
function descendants(system: any, parent: RasterWindow): number[] {
  const out: number[] = [];
  const walk = (of: any) => {
    for (const child of of.desktop.windows.filter(
      (other: any) => other.parent === of.window && other.hwnd && !other.titleOf
    )) {
      out.push(child.hwnd);

      const inner = system.handles.resolve(child.hwnd);

      if (inner instanceof RasterWindow) {
        walk(inner);
      }
    }
  };

  walk(parent);

  return out;
}

/**
 * Hands each of a list of windows to a procedure, until it answers nought
 * (seg1 `6556`, `657c`). The list is taken first, and a window destroyed
 * meanwhile is passed over. It answers the procedure's last answer, 1 to
 * start with.
 */
async function each(system: any, hwnds: number[], visit: (hwnd: number) => Promise<number>) {
  let answer = 1;

  for (const hwnd of hwnds) {
    if (!system.handles.resolve(hwnd)) {
      continue;
    }

    answer = await visit(hwnd);

    if (!answer) {
      break;
    }
  }

  return answer;
}

/**
 * Each window at the top, front to back.
 *
 * @param {Types.FARPTR} lpEnumFunc - The procedure, given the window and `lParam`.
 * @param {Types.LPARAM} lParam - Passed on.
 *
 * @returns {Types.BOOL} The procedure's last answer.
 */
export async function EnumWindows(this: any, lpEnumFunc: number, lParam: number) {
  return each(
    this,
    topLevel(this).map((window: any) => window.window.hwnd),
    (hwnd) =>
      callBack(this, lpEnumFunc, [
        [hwnd, HWND],
        [lParam >>> 0, LPARAM],
      ])
  );
}

/**
 * Each of a window's children, and theirs, depth first. **Recorded**: a
 * window with none answers nought (seg1 `657c`).
 *
 * @param {Types.HWND} hwndParent - The window.
 * @param {Types.FARPTR} lpEnumFunc - The procedure.
 * @param {Types.LPARAM} lParam - Passed on.
 *
 * @returns {Types.BOOL} The procedure's last answer, or nought for no children.
 */
export async function EnumChildWindows(
  this: any,
  hwndParent: number,
  lpEnumFunc: number,
  lParam: number
) {
  const parent = this.handles.resolve(hwndParent);

  if (!(parent instanceof RasterWindow)) {
    return 0;
  }

  const hwnds = descendants(this, parent);

  if (!hwnds.length) {
    return 0;
  }

  return each(this, hwnds, (hwnd) =>
    callBack(this, lpEnumFunc, [
      [hwnd, HWND],
      [lParam >>> 0, LPARAM],
    ])
  );
}

/**
 * Each window at the top a task's. **Read out** (seg1 `1ab3`): `EnumWindows`
 * with a procedure of USER's own that passes over another task's window,
 * answering 1, and calls the program's with AX 1 -- so a procedure a
 * program exports that takes its data segment from AX finds none, and one
 * it gives through `MakeProcInstance` its own. **Recorded** both ways.
 *
 * @param {Types.HANDLE} hTask - The task.
 * @param {Types.FARPTR} lpEnumFunc - The procedure.
 * @param {Types.LPARAM} lParam - Passed on.
 *
 * @returns {Types.BOOL} The last answer.
 */
export async function EnumTaskWindows(
  this: any,
  hTask: number,
  lpEnumFunc: number,
  lParam: number
) {
  return each(
    this,
    topLevel(this).map((window: any) => window.window.hwnd),
    async (hwnd) =>
      GetWindowTask.call(this, hwnd) !== (hTask & 0xffff)
        ? 1
        : callBack(
            this,
            lpEnumFunc,
            [
              [hwnd, HWND],
              [lParam >>> 0, LPARAM],
            ],
            { ax: 1 }
          )
  );
}

/** A property's name written for a procedure to read, in a block of its own. */
function nameBlock(system: any, name: string) {
  system._propName ??= GlobalLock.call(system, GlobalAlloc.call(system, 0x42, 256)) >>> 0;

  const far = system._propName;
  const core = system.machine.cpu.core;

  for (let i = 0; i <= Math.min(name.length, 255); i++) {
    core.write8(far >>> 16, (far & 0xffff) + i, i < name.length ? name.charCodeAt(i) & 0xff : 0);
  }

  return far;
}

/**
 * Each of a window's properties, in the order they were first set, to a
 * procedure given the window, the name -- a string, or nought and the atom
 * -- and the handle kept. **Read out** (seg13 `114a`): it answers -1 for no
 * properties, and otherwise nought, or 1 once the procedure answers
 * nought, which stops it.
 *
 * @param {Types.HWND} hwnd - The window.
 * @param {Types.FARPTR} lpEnumFunc - The procedure.
 *
 * @returns {Types.INT} -1, nought or 1.
 */
export async function EnumProps(this: any, hwnd: number, lpEnumFunc: number) {
  const window = this.handles.resolve(hwnd);
  const props: Map<string, { name: string | number; data: number }> | undefined = window?.propNames;
  let answer = -1;

  for (const [key, entry] of [...(props ?? new Map()).entries()]) {
    if (!window.props?.has(key)) {
      continue;
    }

    answer = 0;

    const name = typeof entry.name === 'number' ? entry.name & 0xffff : nameBlock(this, entry.name);
    const result = await callBack(this, lpEnumFunc, [
      [hwnd, HWND],
      [name >>> 0, FARPTR],
      [window.props.get(key) ?? 0, HWND],
    ]);

    if (!result) {
      answer = 1;
      break;
    }
  }

  return answer;
}

/** The name a property was first set by, kept for `EnumProps`. */
export function noteProp(system: any, hwnd: number, key: string, lpsz: number) {
  const window = system.handles.resolve(hwnd);

  if (!window) {
    return;
  }

  window.propNames ??= new Map();

  if (!window.propNames.has(key)) {
    const far = lpsz >>> 0;

    window.propNames.set(key, { name: far >>> 16 ? stringAt(system, far) : far & 0xffff, data: 0 });
  }
}

/** A property taken away: its place in the order goes with it. */
export function forgetProp(system: any, hwnd: number, key: string) {
  system.handles.resolve(hwnd)?.propNames?.delete(key);
}

/**
 * The owned window last active of a window's, or the window itself.
 * **Read out** (seg2 `09a0`): a field of the window's, which activating a
 * window sets on the window at the root of its owners, and destroying one
 * puts back to its owner on the owner.
 *
 * @param {Types.HWND} hwnd - The window.
 *
 * @returns {Types.HWND} The window last active.
 */
export function GetLastActivePopup(this: any, hwnd: number) {
  const window = this.handles.resolve(hwnd);

  if (!window) {
    return 0;
  }

  return window.lastActivePopup || hwnd;
}

/** The window that owns one: the parent a pop-up was made with. */
export function ownerOf(system: any, hwnd: number) {
  const window = system.handles.resolve(hwnd);

  if (!(window instanceof RasterWindow) || window.window.parent) {
    return 0;
  }

  const owner = window._createStruct?.hwndParent ?? 0;

  return owner && system.handles.resolve(owner) ? owner : 0;
}

/** A window made active: the root of its owners remembers it (seg1 `3740`). */
export function noteActivePopup(system: any, hwnd: number) {
  let root = hwnd;

  for (let owner = ownerOf(system, root); owner; owner = ownerOf(system, owner)) {
    root = owner;
  }

  const window = system.handles.resolve(root);

  if (window) {
    window.lastActivePopup = hwnd;
  }
}

/** A window destroyed: its owner, if it remembers it, remembers itself (seg8 `0caa`). */
export function forgetActivePopup(system: any, hwnd: number) {
  const owner = ownerOf(system, hwnd);
  const window = owner ? system.handles.resolve(owner) : null;

  if (window && window.lastActivePopup === hwnd) {
    window.lastActivePopup = owner;
  }
}

/**
 * Swaps the mouse's buttons, or puts them back. **Read out** (and
 * **recorded**): the value given is kept as it is, answered by
 * `GetSystemMetrics(SM_SWAPBUTTON)`, and the one before is answered.
 *
 * @param {Types.BOOL} fSwap - Whether to swap them.
 *
 * @returns {Types.BOOL} What it was.
 */
export function SwapMouseButton(this: any, fSwap: number) {
  const before = this._swapButtons ?? 0;

  this._swapButtons = fSwap & 0xffff;

  return before;
}

/**
 * A key as it is now: 8000h while it is down, and 1 if it has gone down
 * since last asked, which asking clears. **Read out**; only the low byte of
 * the key is looked at. **Recorded**: no key answers anything with none
 * pressed.
 *
 * @param {Types.INT} vKey - The virtual key.
 *
 * @returns {Types.INT} Its state.
 */
export function GetAsyncKeyState(this: any, vKey: number) {
  const table: Uint8Array = (this._asyncKeys ??= new Uint8Array(256));
  const vk = vKey & 0xff;
  const state = (table[vk] & 0x80 ? 0x8000 : 0) | (table[vk] & 0x01);

  table[vk] &= ~0x01;

  return state;
}

/** A key or button gone down or up, for `GetAsyncKeyState`. */
export function noteAsyncKey(system: any, vk: number, down: boolean) {
  const table: Uint8Array = (system._asyncKeys ??= new Uint8Array(256));

  if (down) {
    table[vk & 0xff] |= 0x81;
  } else {
    table[vk & 0xff] &= ~0x80;
  }
}

/**
 * A beep of a kind. The sound driver plays it; winbox.js has none to play
 * it with, and nothing is answered.
 *
 * @param {Types.UINT} uAlert - The kind.
 */
export function MessageBeep(this: any, _uAlert: number) {}
