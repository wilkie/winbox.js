'use strict';

import { GlobalAlloc } from '../kernel/GlobalAlloc.js';
import { globalPointer } from '../kernel/GlobalLock.js';
import { INT, LPARAM, WPARAM } from '../types.js';

/**
 * Hooks: procedures a program puts in USER's way, called with a code, a
 * `WPARAM` and an `LPARAM` before USER does something.
 *
 * **Recorded** by `hooks`, with three message filters, `WH_MSGFILTER`: two
 * put in with `SetWindowsHook`, each passing on with `DefHookProc`, and one
 * with `SetWindowsHookEx`, passing on with `CallNextHookEx`.
 *
 * * The newest hook is called first, and each passes on to the one put in
 *   before it. A hook that answers without passing on ends the chain, and
 *   its answer is the answer.
 * * `SetWindowsHook` answers neither nought nor the hook before: a value the
 *   program keeps and hands `DefHookProc` to go on with. Here it is the new
 *   hook's own handle, and `DefHookProc` goes on from that hook.
 * * `UnhookWindowsHook` and `UnhookWindowsHookEx` answer `TRUE`, and the
 *   chain closes up.
 * * A modal dialog box's loop calls the filters with `MSGF_DIALOGBOX` for
 *   each message it takes, and a menu's with `MSGF_MENU`; see
 *   `messageFilter`.
 *
 * The shell hooks, `WH_SHELL`, are called with `HSHELL_WINDOWCREATED` once
 * a top-level window with no owner has had its `WM_CREATE`, and with
 * `HSHELL_WINDOWDESTROYED` before its `WM_DESTROY`, the window in `WPARAM`:
 * **recorded** by `shlhook`, with overlapped windows and popups, hidden and
 * shown; a child or an owned popup is not told, nor is showing a window.
 *
 * The window procedure hooks, `WH_CALLWNDPROC`, are called before a window
 * procedure with each message sent it -- by a program or by USER, as
 * creating a window sends its own -- and not with one posted and
 * dispatched: **recorded** by `cwphook`. The code and `WPARAM` are nought
 * and the `LPARAM` points at five words on the stack: the message's
 * `LPARAM`, low word first, its `WPARAM`, the message, the window. What the
 * hook leaves in the first four is what the window procedure is given. A
 * hook sees what its task sends other tasks' windows and the desktop, too.
 * Which task a hook is for is not followed: each is called.
 *
 * Other kinds of hook are kept, and passed on through, and never called: not
 * followed. Nor is `HSHELL_ACTIVATESHELLWINDOW`.
 */

export const WH_MSGFILTER = -1;
export const WH_CALLWNDPROC = 4;
export const WH_SHELL = 10;
export const HSHELL_WINDOWCREATED = 1;
export const HSHELL_WINDOWDESTROYED = 2;
export const MSGF_DIALOGBOX = 0;
export const MSGF_MENU = 2;

interface Hook {
  kind: number;
  proc: any;
  handle: number;
}

/** The hooks of each kind, newest first. */
function chains(system: any): Map<number, Hook[]> {
  return (system._hooks ??= new Map());
}

function install(system: any, kind: number, proc: any) {
  const chain = chains(system).get(kind) ?? [];
  const handle = (system._nextHook = (system._nextHook ?? 0) + 1);

  chain.unshift({ kind, proc, handle });
  chains(system).set(kind, chain);

  return handle;
}

/** Calls one hook's procedure: a program's, at a far address, or one of the replay's functions. */
function callHook(system: any, hook: Hook, code: number, wParam: number, lParam: number) {
  if (typeof hook.proc === 'function') {
    return hook.proc(code, wParam, lParam);
  }

  /* As USER's one hook caller calls one (seg1 `808d`): see `stackRegisters`. */
  return system.scheduler.callProc(
    hook.proc,
    [
      [code, INT],
      [wParam, WPARAM],
      [lParam, LPARAM],
    ],
    system.scheduler.stackRegisters()
  );
}

/** Calls the hook after the one with this handle, or answers nought for none. */
async function callAfter(
  system: any,
  handle: number,
  code: number,
  wParam: number,
  lParam: number
) {
  for (const chain of chains(system).values()) {
    const at = chain.findIndex((hook) => hook.handle === handle);

    if (at >= 0) {
      const next = chain[at + 1];

      return next ? await callHook(system, next, code, wParam, lParam) : 0;
    }
  }

  return 0;
}

/** Passes a call on from the hook with this handle, as `DefHookProc` does. */
export function passOn(system: any, handle: number, code: number, wParam: number, lParam: number) {
  return callAfter(system, handle, code, wParam, lParam);
}

/** Calls a chain from its newest hook; nought for no hooks. */
export async function callHooks(
  system: any,
  kind: number,
  code: number,
  wParam: number,
  lParam: number
) {
  const first = chains(system).get(kind)?.[0];

  return first ? await callHook(system, first, code, wParam, lParam) : 0;
}

/**
 * Puts a hook in: the newest, called first.
 *
 * @param {Types.INT} idHook - What kind of hook.
 * @param {Types.FARPTR} lpfn - Its procedure.
 *
 * @returns {Types.DWORD} What to hand `DefHookProc`: this hook's handle.
 */
export function SetWindowsHook(this: any, idHook: number, lpfn: any) {
  return install(this, (idHook << 16) >> 16, lpfn);
}

/**
 * Puts a hook in, as `SetWindowsHook` does, for the task given or all.
 *
 * @param {Types.INT} idHook - What kind of hook.
 * @param {Types.FARPTR} lpfn - Its procedure.
 * @param {Types.HINSTANCE} hInstance - The module it is in.
 * @param {Types.HANDLE} hTask - The task it is for, or nought for all.
 *
 * @returns {Types.DWORD} Its handle.
 */
export function SetWindowsHookEx(
  this: any,
  idHook: number,
  lpfn: any,
  _hInstance: number,
  _hTask: number
) {
  return install(this, (idHook << 16) >> 16, lpfn);
}

/**
 * Takes out the hook put in with `SetWindowsHook` for this procedure.
 *
 * @param {Types.INT} idHook - What kind of hook.
 * @param {Types.FARPTR} lpfn - Its procedure.
 *
 * @returns {Types.BOOL} Whether there was one.
 */
export function UnhookWindowsHook(this: any, idHook: number, lpfn: any) {
  const chain = chains(this).get((idHook << 16) >> 16) ?? [];
  const at = chain.findIndex((hook) => hook.proc === lpfn);

  if (at < 0) {
    return 0;
  }

  chain.splice(at, 1);

  return 1;
}

/**
 * Takes out a hook by its handle.
 *
 * @param {Types.DWORD} hhook - The hook.
 *
 * @returns {Types.BOOL} Whether there was one.
 */
export function UnhookWindowsHookEx(this: any, hhook: number) {
  for (const chain of chains(this).values()) {
    const at = chain.findIndex((hook) => hook.handle === hhook);

    if (at >= 0) {
      chain.splice(at, 1);

      return 1;
    }
  }

  return 0;
}

/**
 * Passes a hook's call on to the hook put in before it.
 *
 * @param {Types.DWORD} hhook - The hook passing it on.
 * @param {Types.INT} nCode - The code.
 * @param {Types.WPARAM} wParam - As the hook was given it.
 * @param {Types.LPARAM} lParam - As the hook was given it.
 *
 * @returns {Types.LRESULT} The next hook's answer, or nought for none.
 */
export async function CallNextHookEx(
  this: any,
  hhook: number,
  nCode: number,
  wParam: number,
  lParam: number
) {
  return await callAfter(this, hhook, nCode, wParam, lParam);
}

/**
 * As `CallNextHookEx`, for a hook put in with `SetWindowsHook`: the value
 * `SetWindowsHook` answered is at `lplpfnNextHook`.
 *
 * @param {Types.INT} nCode - The code.
 * @param {Types.WPARAM} wParam - As the hook was given it.
 * @param {Types.LPARAM} lParam - As the hook was given it.
 * @param {Types.FARPTR} lplpfnNextHook - Where the program keeps that value.
 *
 * @returns {Types.DWORD} The next hook's answer, or nought for none.
 */
export async function DefHookProc(
  this: any,
  nCode: number,
  wParam: number,
  lParam: number,
  lplpfnNextHook: number
) {
  if (!lplpfnNextHook) {
    return 0;
  }

  const core = this.machine.cpu.core;
  const segment = (lplpfnNextHook >>> 16) & 0xffff;
  const offset = lplpfnNextHook & 0xffff;
  const handle =
    (core.read16(segment, offset) | (core.read16(segment, (offset + 2) & 0xffff) << 16)) >>> 0;

  return await callAfter(this, handle, nCode, wParam, lParam);
}

/**
 * Calls the message filters with a program's own message.
 *
 * @param {Types.FARPTR} lpMsg - The message.
 * @param {Types.INT} nCode - The code the filters are given.
 *
 * @returns {Types.BOOL} Whether a filter answered non-nought.
 */
export async function CallMsgFilter(this: any, lpMsg: number, nCode: number) {
  /* In AX alone (`USER.EXE` seg1 `80f0`, `messageFilter`). */
  return (await callHooks(this, WH_MSGFILTER, (nCode << 16) >> 16, 0, lpMsg)) & 0xffff ? 1 : 0;
}

/**
 * Calls the message filters with a message a loop of USER's has taken:
 * written where a program can read it, and answering whether a filter
 * took it, and so it is not to be handled.
 */
export async function messageFilter(system: any, msg: any, code: number) {
  if (!chains(system).get(WH_MSGFILTER)?.length) {
    return false;
  }

  system._hookMessage ??= globalPointer.call(system, GlobalAlloc.call(system, 0x42, 32));

  const far = system._hookMessage >>> 0;
  const core = system.machine.cpu.core;
  const segment = far >>> 16;
  const at = far & 0xffff;
  const words = [
    msg.hwnd ?? 0,
    msg.message ?? 0,
    msg.wParam ?? 0,
    (msg.lParam ?? 0) & 0xffff,
    ((msg.lParam ?? 0) >>> 16) & 0xffff,
    (msg.time ?? 0) & 0xffff,
    ((msg.time ?? 0) >>> 16) & 0xffff,
    msg.pt?.x ?? 0,
    msg.pt?.y ?? 0,
  ];

  words.forEach((word, index) => core.write16(segment, (at + index * 2) & 0xffff, word & 0xffff));

  /* A filter answers in AX alone, what is in DX besides is no answer
   * (`USER.EXE` seg1 `80f0`): File Manager's leaves its own there, and every
   * key in its Copy box was taken as filtered. */
  return ((await callHooks(system, WH_MSGFILTER, code, 0, far)) & 0xffff) !== 0;
}

/**
 * Calls the window procedure hooks with a message about to be sent: the
 * message as the hooks leave it, or as it was with none. An `LPARAM` that
 * is a structure winbox.js lays out as it calls is put on the stack first,
 * under the hook's words, so a hook can read it.
 */
export async function sentMessageHook(
  system: any,
  hwnd: number,
  message: number,
  wParam: number,
  lParam: any
) {
  if (!chains(system).get(WH_CALLWNDPROC)?.length) {
    return { message, wParam, lParam };
  }

  const core = system.machine.cpu.core;
  const sp = core.sp;
  const structure = lParam instanceof Array ? lParam[0] : null;
  let far = lParam;

  if (structure) {
    core.sp = (core.sp - structure.structSize) & 0xfffe;
    structure.storeToMemory(system.machine.memory, core.ss >> 3, core.sp);
    far = ((core.ss << 16) | core.sp) >>> 0;
  }

  core.sp = (core.sp - 10) & 0xffff;

  const at = core.sp;
  const words = [far & 0xffff, (far >>> 16) & 0xffff, wParam, message, hwnd];

  words.forEach((word, index) => core.write16(core.ss, (at + index * 2) & 0xffff, word & 0xffff));

  await callHooks(system, WH_CALLWNDPROC, 0, 0, ((core.ss << 16) | at) >>> 0);

  const read = (index: number) => core.read16(core.ss, (at + index * 2) & 0xffff);
  const left = (read(0) | (read(1) << 16)) >>> 0;

  if (structure) {
    structure.loadFromMemory(system.machine.memory, core.ss >> 3, (at + 10) & 0xffff);
  }

  core.sp = sp;

  return {
    message: read(3),
    wParam: read(2),
    lParam: structure && left === far >>> 0 ? lParam : left,
  };
}
