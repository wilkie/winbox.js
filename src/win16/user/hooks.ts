'use strict';

import { GlobalAlloc } from '../kernel/GlobalAlloc.js';
import { globalPointer } from '../kernel/GlobalLock.js';
import { INT, LPARAM, WPARAM } from '../types.js';
import { segmentSelector } from '../selectors.js';
import { GetSysModalWindow } from './userwin.js';

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
 * The message hooks, `WH_GETMESSAGE`, are called with each message
 * `GetMessage` or `PeekMessage` hands over, taken or only looked at, once it
 * is in the program's `MSG`: **recorded** by `gmhook`; see `getMessageHook`.
 * The hardware hooks, `WH_HARDWARE`, and the computer-based training hooks'
 * `HCBT_KEYSKIPPED` and `HCBT_CLICKSKIPPED` are called by the system queue
 * (`system-queue.ts`; **recorded** by `hwhook`).
 *
 * The system message filters, `WH_SYSMSGFILTER`, are called before the
 * task's (`sysfilt`; `filters`), and the computer-based training hooks are
 * asked before USER makes, destroys, activates, focuses, minimizes or moves
 * a window and before `DefWindowProc` carries out a system command
 * (`cbthook`; `askCbt`). A debugging hook, `WH_DEBUG`, is kept, and passed
 * on through, and never called: in Windows the first hook called after one
 * is put in calls it for ever, and faults (`dbghook`). Not followed:
 * `HSHELL_ACTIVATESHELLWINDOW`.
 */

export const WH_MSGFILTER = -1;
export const WH_GETMESSAGE = 3;
export const WH_CALLWNDPROC = 4;
export const WH_CBT = 5;
export const WH_SYSMSGFILTER = 6;
export const WH_DEBUG = 9;
export const WH_SHELL = 10;
export const HSHELL_WINDOWCREATED = 1;
export const HSHELL_WINDOWDESTROYED = 2;
export const MSGF_DIALOGBOX = 0;
export const MSGF_MENU = 2;
export const MSGF_SCROLLBAR = 5;
export const HCBT_MOVESIZE = 0;
export const HCBT_MINMAX = 1;
export const HCBT_QS = 2;
export const HCBT_CREATEWND = 3;
export const HCBT_DESTROYWND = 4;
export const HCBT_ACTIVATE = 5;
export const HCBT_SYSCOMMAND = 8;
export const HCBT_SETFOCUS = 9;

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

  /* A journal hook put in makes the mouse move where it is (`USER.EXE` seg1
   * `7e4a`, the kinds' flags at `7c96`, `52e9`). */
  if (kind === 0 || kind === 1) {
    system.rasterInput?.nudge();
  }

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

/** Whether any hook of a kind is in. */
export function hasHooks(system: any, kind: number) {
  return (chains(system).get(kind)?.length ?? 0) > 0;
}

/**
 * Calls a chain with a structure of USER's for its `LPARAM`, laid on the
 * stack below the caller's, as USER passes one of its own frame (`USER.EXE`
 * seg1 `2c4d`, `2eb6`, `82d5`): what the hooks answered, and the structure
 * as they left it. With no structure, the `LPARAM` is the number given.
 */
export async function callHooksWith(
  system: any,
  kind: number,
  code: number,
  wParam: number,
  structure: number[] | number | null
) {
  if (!Array.isArray(structure)) {
    return {
      answer: (await callHooks(system, kind, code, wParam, structure ?? 0)) >>> 0,
      bytes: [],
    };
  }

  const core = system.machine.cpu.core;
  const sp = core.sp;

  const words = (structure.length + 1) >> 1;

  core.sp = (core.sp - words * 2) & 0xffff;

  const at = core.sp;

  for (let index = 0; index < words; index++) {
    const low = structure[index * 2] ?? 0;
    const high = structure[index * 2 + 1] ?? 0;

    core.write16(core.ss, (at + index * 2) & 0xffff, (low & 0xff) | ((high & 0xff) << 8));
  }

  try {
    const answer = await callHooks(system, kind, code, wParam, ((core.ss << 16) | at) >>> 0);
    const bytes = structure.map((_, index) => {
      const value = core.read16(core.ss, (at + (index & ~1)) & 0xffff);

      return index & 1 ? (value >>> 8) & 0xff : value & 0xff;
    });

    return { answer: answer >>> 0, bytes };
  } finally {
    core.sp = sp;
  }
}

/**
 * The computer-based training hooks asked before USER does something, where
 * one is in: what they answered, DX and AX, and the structure handed them,
 * as they left it -- one of USER's own, on the stack (`callHooksWith`). The
 * callers each test the answer as USER's caller of that code does.
 */
export async function askCbt(system: any, code: number, wParam: number, lParam: number[] | number) {
  if (!hasHooks(system, WH_CBT)) {
    return { answer: 0, bytes: [] as number[] };
  }

  return callHooksWith(system, WH_CBT, code, wParam & 0xffff, lParam);
}

/**
 * The computer-based training hooks asked as a window is made,
 * `HCBT_CREATEWND`: the window, and a `CBT_CREATEWND` -- a far pointer to
 * the `CREATESTRUCT`, `CreateWindow`'s own arguments on the stack in
 * Windows (`USER.EXE` seg8 `0459`-`045f`), and the window to put it after,
 * nought (`0467`). Both laid on the stack here, the structure above. What
 * they answered, the `CREATESTRUCT`'s bytes and the window to put it after
 * as they left them.
 */
export async function askCbtCreate(system: any, hwnd: number, create: number[]) {
  if (!hasHooks(system, WH_CBT)) {
    return { answer: 0, create, after: 0 };
  }

  const core = system.machine.cpu.core;
  const sp = core.sp;
  const size = (create.length + 1) & ~1;

  core.sp = (core.sp - size) & 0xffff;

  const lpcs = core.sp;

  create.forEach((byte, index) => core.write8(core.ss, (lpcs + index) & 0xffff, byte & 0xff));
  core.sp = (core.sp - 6) & 0xffff;

  const at = core.sp;

  core.write16(core.ss, at, lpcs);
  core.write16(core.ss, (at + 2) & 0xffff, core.ss);
  core.write16(core.ss, (at + 4) & 0xffff, 0);

  try {
    const answer =
      (await callHooks(
        system,
        WH_CBT,
        HCBT_CREATEWND,
        hwnd & 0xffff,
        ((core.ss << 16) | at) >>> 0
      )) >>> 0;

    return {
      answer,
      create: create.map((_, index) => core.read8(core.ss, (lpcs + index) & 0xffff)),
      after: core.read16(core.ss, (at + 4) & 0xffff),
    };
  } finally {
    core.sp = sp;
  }
}

/**
 * A journal playback hook taken out: the queue is read again, the running
 * task woken to look at it (`USER.EXE` seg1 `7e7c`-`7e97`).
 */
function hookGone(system: any, kind: number) {
  if (kind !== 1) {
    return;
  }

  system._playbackDue = null;
  system.scheduler?.task?.signal?.();
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
  hTask: number
) {
  const kind = (idHook << 16) >> 16;

  /* A kind no task may have for itself -- the journal hooks and the system
   * message filters -- asked for one task is refused (`USER.EXE` seg1
   * `7db7`-`7dc4`, the kinds' flags at `7c96`; **recorded** by `sysfilt`). */
  if (hTask && SYSTEM_ONLY.has(kind)) {
    return 0;
  }

  return install(this, kind, lpfn);
}

/** The kinds of hook that are everyone's or none (`USER.EXE` seg1 `7c96`, bit 0 clear). */
const SYSTEM_ONLY = new Set([0, 1, WH_SYSMSGFILTER]);

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
  hookGone(this, (idHook << 16) >> 16);

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
      const [gone] = chain.splice(at, 1);

      hookGone(this, gone.kind);

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
 * @returns {Types.BOOL} What the filter that ended it answered, in AX.
 */
export async function CallMsgFilter(this: any, lpMsg: number, nCode: number) {
  return filters(this, (nCode << 16) >> 16, lpMsg);
}

/**
 * USER's one caller of the message filters (`USER.EXE` seg1 `80cd`): none
 * while a window is system-modal (`80d8`); else the system's,
 * `WH_SYSMSGFILTER`, first, and the task's, `WH_MSGFILTER`, only where
 * the system's answered nought (`80e8`-`8103`). The answer is the last
 * chain's AX alone, whatever is left in DX (`80f0`): File Manager's filter
 * leaves its own there, and every key in its Copy box was taken as
 * filtered. **Recorded** by `sysfilt`.
 */
async function filters(system: any, code: number, far: number) {
  if (GetSysModalWindow.call(system)) {
    return 0;
  }

  const first = (await callHooks(system, WH_SYSMSGFILTER, code, 0, far)) & 0xffff;

  if (first) {
    return first;
  }

  return (await callHooks(system, WH_MSGFILTER, code, 0, far)) & 0xffff;
}

/**
 * Calls the message filters with a message a loop of USER's has taken:
 * written where a program can read it, and answering whether a filter
 * took it, and so it is not to be handled.
 */
export async function messageFilter(system: any, msg: any, code: number) {
  if (!hasHooks(system, WH_MSGFILTER) && !hasHooks(system, WH_SYSMSGFILTER)) {
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

  return (await filters(system, code, far)) !== 0;
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

/**
 * The message hooks called with a message a look hands over (`USER.EXE`
 * seg1 `2597`-`25b7`): `HC_ACTION`, the look's flags as the program gave
 * them -- `PM_REMOVE` for `GetMessage` -- with `PM_NOYIELD` added where the
 * task has locked itself with `LockMyTask` (`245b`-`2462`), and the
 * program's own `MSG`, which the message is read from again after. So what
 * a hook leaves there is the message handed over, and `GetMessage` answers
 * nought where it is then `WM_QUIT` (`25bc`-`25cf`). Called for a message
 * only looked at too, which stays in the queue as it was (`gmhook`).
 */
export async function getMessageHook(system: any, lpmsg: any, flags: number) {
  if (!lpmsg || !hasHooks(system, WH_GETMESSAGE)) {
    return;
  }

  /* Where the program's structure is: its first field's place. */
  const offset = lpmsg._offsets[0] & 0xffff;
  const far = ((segmentSelector(lpmsg._segment) << 16) | offset) >>> 0;

  await callHooks(system, WH_GETMESSAGE, 0, lookFlags(system, flags), far);
  lpmsg.loadFromMemory(system.machine.memory, lpmsg._segment, offset);
}

/**
 * A look's flags, `PM_NOYIELD` added where the task has locked itself with
 * `LockMyTask`, the word at `0DEh` of USER's data (`USER.EXE` seg1 `245b`-
 * `2462`).
 */
export function lookFlags(system: any, flags: number) {
  return (flags | (system._lockMyTask ? 2 : 0)) & 0xffff;
}
