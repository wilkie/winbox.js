'use strict';

import { B, D, W, buffer } from '../commdlg/api.js';
import {
  D_ARRAY_OWNED,
  D_ARRAY_SENT,
  D_CLASS_CLIENT,
  D_CLASS_DMG,
  D_CLASS_FRAME,
  D_CLASS_HOLDING,
  D_CLASS_MONITOR,
  D_CLASS_SERVER,
  D_HEAP,
  D_HINSTANCE,
  D_HOOK,
  D_INSTANCES,
  D_MADE_ME,
  D_MONITORS,
  D_PROFILE,
  D_PROGMAN,
  D_RETRY,
  D_SERIAL,
  D_SHUTDOWN,
  D_TEXT_3000,
  D_TEXT_30000,
  D_TEXT_DDEML,
  D_TEXT_PROGMAN,
  D_TEXT_RETRY,
  D_TEXT_SHUTDOWN,
  D_TEXT_STAAB,
  D_WHO,
  Dd,
  atol,
  callbackArgs,
  hi,
  lo,
  long,
  off,
  plus,
} from './core.js';
import { free as freeValue, make } from './data.js';
import {
  XTYP_MONITOR,
  addCount,
  callbackNotice,
  deleteAtom,
  hszLength,
  hszNotice,
  queryHsz,
  setError,
  stringAtom,
} from './monitor.js';
import { TERM_DIALOG } from './resources.js';
import { reply } from './xact.js';

/**
 * DDEML's instances: `DdeInitialize` and `DdeUninitialize`, the classes and
 * the first initialization's settings, `DdeNameService`, `DdeEnableCallback`,
 * `DdeGetLastError`, the string handles' calls, the instance's window
 * (`DMGWNDPROC`), the one place every callback is made (`5832`), and the
 * queue of callbacks waiting (`4e66`, `5b60`), as `DDEML.DLL` seg1 has them.
 * As `crates/winbox-win16/src/ddeml/instance.rs`.
 */

export const DMLERR_DLL_USAGE = 0x4004;
export const DMLERR_INVALIDPARAMETER = 0x4006;
export const DMLERR_MEMORY_ERROR = 0x4008;
export const DMLERR_NO_CONV_ESTABLISHED = 0x400a;
export const DMLERR_REENTRANCY = 0x400d;
export const DMLERR_SYS_ERROR = 0x400f;

/** An instance identifier's record, where the check word matches. */
export function instanceOf(d: Dd, id: number): number {
  const instance = lo(id);

  return instance !== 0 && d.i16(instance, 0x30) === hi(id) ? instance : 0;
}

/** `20a0`: the next instance after `from` -- the first for nought -- of the current task. */
export async function taskInstance(d: Dd, from: number): Promise<number> {
  if (d.d16(D_INSTANCES) === 0) {
    return 0;
  }

  let instance = from !== 0 ? d.i16(from, 0) : d.d16(D_INSTANCES);
  const task = await d.currentTask();

  while (instance !== 0) {
    if (d.i16(instance, 0x1e) === task) {
      return instance;
    }

    instance = d.i16(instance, 0);
  }

  return 0;
}

/** The error of a bad handle set in each of the current task's instances. */
export async function errorEach(d: Dd, error: number) {
  let instance = 0;

  for (;;) {
    instance = await taskInstance(d, instance);

    if (instance === 0) {
      return;
    }

    await setError(d, instance, error);
  }
}

/** `2dac`: whether a conversation handle is good. */
export async function convValid(d: Dd, conv: number): Promise<boolean> {
  return (await d.isWindow(lo(conv))) && (await d.windowWord(lo(conv), 4)) === hi(conv);
}

/** `2d84`: a window destroyed, if it is one. */
export async function destroy(d: Dd, hwnd: number): Promise<number> {
  return (await d.isWindow(hwnd)) ? d.destroyWindow(hwnd) : 1;
}

/** `54e8`: a message sent, or posted, to each child of a window. */
export async function eachChild(
  d: Dd,
  hwnd: number,
  message: number,
  wparam: number,
  lparam: number,
  post: boolean
) {
  if (!(await d.isWindow(hwnd))) {
    return;
  }

  let child = await d.getWindow(hwnd, 5);

  while (child !== 0) {
    const next = await d.getWindow(child, 2);

    if (post) {
      await d.post(child, message, wparam, lparam);
    } else {
      await d.send(child, message, wparam, lparam);
    }

    child = next;
  }
}

/** `5990`: DDEML's own strings made readable, `Who` and `Made me?` added as atoms. */
async function signature(d: Dd) {
  let at = D_WHO;

  while ((d.d16(at) & 0xff) !== 0) {
    d.w8(d.near(at), d.r8(d.near(at)) ^ 0x25);
    at++;
  }

  d.sd16(D_WHO, await d.addAtomAt(d.near(D_WHO)));
  d.sd16(D_MADE_ME, await d.addAtomAt(d.near(D_MADE_ME)));
}

/** `62e0`: DDEML's classes, each window procedure an export of its own. */
async function registerClasses(d: Dd) {
  const instance = d.d16(D_HINSTANCE);

  for (const [klass, ordinal, extra] of [
    [D_CLASS_CLIENT, 28, 6],
    [D_CLASS_SERVER, 29, 6],
    [D_CLASS_DMG, 31, 6],
    [D_CLASS_HOLDING, 32, 8],
    [D_CLASS_MONITOR, 33, 4],
    [D_CLASS_FRAME, 30, 4],
  ]) {
    const procedure = d.exportAddress(ordinal);
    const name = d.near(klass);
    const bytes = [
      0,
      0,
      ...le32(procedure),
      0,
      0,
      extra & 0xff,
      extra >> 8,
      instance & 0xff,
      instance >> 8,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      ...le32(name),
    ];

    await d.user('RegisterClass', [B(bytes)]);
  }
}

export function le32(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

export function le16(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff];
}

/** A time-out of `WIN.INI`'s `[DDEML]`, its default if nought (`00be`). */
async function profileTimeout(d: Dd, key: number, defaultText: number, fallback: number) {
  await d.callB('KERNEL', 'GetProfileString', [
    D(d.near(D_TEXT_DDEML)),
    D(d.near(key)),
    D(d.near(defaultText)),
    D(d.near(D_PROFILE)),
    W(0x14),
  ]);

  const bytes = d.read(d.near(D_PROFILE), 0x14);
  const end = bytes.indexOf(0);
  const value = atol(end < 0 ? bytes : bytes.slice(0, end));

  return value === 0 ? fallback : value;
}

/** `DdeInitialize` (`0010`, `0048`). */
export async function initialize(
  d: Dd,
  pid: number,
  procedure: number,
  flagsIn: number,
  reserved: number
): Promise<number> {
  if (reserved !== 0) {
    return DMLERR_INVALIDPARAMETER;
  }

  let flags = flagsIn >>> 0;

  if (flags & 1) {
    if (d.d16(D_MONITORS) === 4) {
      return DMLERR_DLL_USAGE;
    }

    flags = (flags | 0x0027f000) >>> 0;
  }

  const existing = d.r16(pid);

  if (existing !== 0) {
    if (d.r16(plus(pid, 2)) !== d.i16(existing, 0x30)) {
      return DMLERR_INVALIDPARAMETER;
    }

    const old = d.i32(existing, 0x1a);

    d.si32(existing, 0x1a, (flags ^ ((old ^ flags) & 0x00c00fff)) >>> 0);
    return 0;
  }

  if (d.d16(D_HEAP) === 0) {
    d.si32(0, D_SHUTDOWN, await profileTimeout(d, D_TEXT_SHUTDOWN, D_TEXT_3000, 3000));
    d.si32(0, D_RETRY, await profileTimeout(d, D_TEXT_RETRY, D_TEXT_30000, 30000));
    d.sd16(D_PROGMAN, await d.addAtomAt(d.near(D_TEXT_PROGMAN)));
    d.sd16(D_HEAP, d.ds());
    await signature(d);
    await registerClasses(d);
  }

  let instance = 0;
  const failed = await (async () => {
    if (d.i32(0, D_ARRAY_OWNED) === 0) {
      const array = await d.arrayNew(d.d16(D_HEAP), 8, 8);

      d.si32(0, D_ARRAY_OWNED, array);

      if (array === 0) {
        return true;
      }
    }

    if (d.i32(0, D_ARRAY_SENT) === 0) {
      const array = await d.arrayNew(d.d16(D_HEAP), 4, 8);

      d.si32(0, D_ARRAY_SENT, array);

      if (array === 0) {
        return true;
      }
    }

    instance = off(await d.alloc(d.d16(D_HEAP), 0x3c));

    if (instance === 0) {
      return true;
    }

    const heap = await d.heapCreate(0x1000);

    d.si16(instance, 0x20, heap);

    if (heap === 0) {
      await d.free(d.near(instance));
      instance = 0;
      return true;
    }

    d.si16(instance, 0, d.d16(D_INSTANCES));
    d.si32(instance, 4, procedure);
    d.si32(instance, 0xc, await d.arrayNew(heap, 4, 0x20));
    d.si32(instance, 0x10, await d.arrayNew(heap, 2, 0x10));
    d.si32(instance, 0x16, await d.listNew(heap, 0x2a));
    d.si32(instance, 0x1a, (flags | 0x20) >>> 0);
    d.si16(instance, 0x1e, await d.currentTask());

    const serial = (d.d16(D_SERIAL) + 1) & 0xffff;

    d.sd16(D_SERIAL, serial);
    d.si16(instance, 0x30, serial);
    d.si32(instance, 0x32, await d.listNew(heap, 0xe));
    d.si32(instance, 0x36, await d.alloc(heap, 0x100));
    d.sd16(D_INSTANCES, instance);
    d.w16(pid, instance);
    d.w16(plus(pid, 2), d.i16(instance, 0x30));

    const window = await d.createWindow(D_CLASS_DMG, 0, 0, d.near(instance));

    d.si16(instance, 0x22, window);

    if (window === 0) {
      return true;
    }

    if (d.i16(instance, 0x1a) & 1) {
      d.si32(instance, 0x1a, (d.i32(instance, 0x1a) | 0x0027f000) >>> 0);

      const monitor = await d.createWindow(D_CLASS_MONITOR, 0, 0, d.near(instance));

      d.si16(instance, 0x26, monitor);

      if (monitor === 0) {
        return true;
      }

      const monitors = (d.d16(D_MONITORS) + 1) & 0xffff;

      d.sd16(D_MONITORS, monitors);

      if (monitors === 1) {
        d.si32(0, D_HOOK, await d.user('SetWindowsHook', [W(3), D(d.exportAddress(35))]));
        d.si32(0, D_HOOK, await d.user('SetWindowsHook', [W(4), D(d.exportAddress(34))]));
      }

      return false;
    }

    if (flags & 0x10) {
      return false;
    }

    const frame = await d.createWindow(D_CLASS_FRAME, 0x80000000, 0, d.near(instance));

    d.si16(instance, 0x24, frame);
    return frame === 0;
  })();

  if (!failed) {
    return 0;
  }

  if (instance !== 0) {
    /* As `DDEML.DLL` cleans up (`0358`): `DdeUninitialize` of the record
     * and DDEML's data segment for its check word. */
    await uninitialize(d, long(instance, d.ds()));
  }

  return DMLERR_SYS_ERROR;
}

/** `TERMDLGPROC` (`036a`). */
export async function termDlgProc(d: Dd, hwnd: number, message: number, wparam: number) {
  if (message === 0x110) {
    return 1;
  }

  if (message === 0x111 && wparam >= 3 && wparam <= 5) {
    await d.user('EndDialog', [W(hwnd), W(wparam)]);
  }

  return 0;
}

/** `DdeUninitialize` (`03ae`). */
export async function uninitialize(d: Dd, id: number): Promise<number> {
  const instance = instanceOf(d, id);

  if (instance === 0) {
    return 0;
  }

  d.si16(instance, 0x2a, 0);

  if (d.i32(instance, 8) !== 0) {
    await nameService(d, id, 0, 0, 2);
  }

  await eachChild(d, d.i16(instance, 0x22), 0x4ce, 0x2000, 0, false);

  if (d.i16(instance, 2) !== 0) {
    await waitForPartners(d, instance);
  }

  if (d.i16(instance, 0x28) !== 0) {
    d.si16(instance, 0x3a, d.i16(instance, 0x3a) | 2);
    await d.post(d.i16(instance, 0x28), 0x113, 1, 0);
  }

  if (d.i16(instance, 0x26) !== 0) {
    await destroy(d, d.i16(instance, 0x26));

    const monitors = (d.d16(D_MONITORS) - 1) & 0xffff;

    d.sd16(D_MONITORS, monitors);

    if (monitors === 0) {
      await d.user('UnhookWindowsHook', [W(3), D(d.exportAddress(35))]);
      await d.user('UnhookWindowsHook', [W(4), D(d.exportAddress(34))]);
    }
  }

  unlink(d, instance);
  await destroy(d, d.i16(instance, 0x22));
  await destroy(d, d.i16(instance, 0x24));

  for (;;) {
    const record = await d.arrayPop(d.i32(instance, 0xc));

    if (!record) {
      break;
    }

    const value = (record[0] | (record[1] << 8) | (record[2] << 16) | (record[3] << 24)) >>> 0;

    await freeValue(d, instance, value, false);
  }

  await d.arrayFree(d.i32(instance, 0xc));

  for (;;) {
    const record = await d.arrayPop(d.i32(instance, 0x10));

    if (!record) {
      break;
    }

    const atom = record[0] | (record[1] << 8);

    if (d.d16(D_MONITORS) !== 0) {
      await hszNotice(d, atom, 4, d.i16(instance, 0x1e));
    }

    await deleteAtom(d, atom);
  }

  await d.arrayFree(d.i32(instance, 0x10));
  await d.arrayFree(d.i32(instance, 8));
  await d.listFree(d.i32(instance, 0x32));
  await d.heapFree(d.i16(instance, 0x20));
  d.si16(instance, 0x30, d.i16(instance, 0x30) - 1);
  await d.free(d.near(instance));

  if (d.d16(D_INSTANCES) === 0) {
    await d.arrayFree(d.i32(0, D_ARRAY_OWNED));
    await d.arrayFree(d.i32(0, D_ARRAY_SENT));
    d.si32(0, D_ARRAY_OWNED, 0);
    d.si32(0, D_ARRAY_SENT, 0);
    await d.deleteAtomRaw(d.d16(D_PROGMAN));
  }

  return 1;
}

/** `DdeUninitialize`'s wait for its partners (`0418`-`0519`). */
async function waitForPartners(d: Dd, instance: number) {
  const window = d.i16(instance, 0x22);
  let periods = d.d16(D_SHUTDOWN + 2);

  await d.setTimer(window, 2, d.d16(D_SHUTDOWN));

  while (d.i16(instance, 2) !== 0) {
    await d.kernel('Yield', []);

    const called = await d.callB('USER', 'GetMessage', [buffer(18), W(0), W(0), W(0xffff)]);
    const msg = called.buffers[0];
    const word = (at: number) => msg[at] | (msg[at + 1] << 8);

    if (word(2) === 0x113 && word(4) === 2 && word(0) === d.i16(instance, 0x22)) {
      const left = periods;

      periods = (periods - 1) & 0xffff;

      if (left !== 0) {
        await d.setTimer(window, 2, 0xffff);
      } else {
        await d.killTimer(window, 2);

        if (d.i16(instance, 2) === 0) {
          break;
        }

        const answer = await termDialog(d);

        if (answer === 3 || answer === 0xffff) {
          d.si16(instance, 2, 0);
          break;
        }

        if (answer === 4) {
          periods = d.d16(D_RETRY + 2);
          await d.setTimer(window, 2, d.d16(D_RETRY));
        }
      }
    }

    await d.user('DispatchMessage', [B(msg)]);
  }
}

/** `TermDialog` (`049c`-`04cb`), from DDEML's own template. */
async function termDialog(d: Dd): Promise<number> {
  const block = await d.globalAlloc(0x0042, TERM_DIALOG.length);
  const at = await d.globalLock(block);

  d.write(at, TERM_DIALOG);
  await d.globalUnlock(block);

  const answer =
    (await d.user('DialogBoxIndirect', [
      W(d.d16(D_HINSTANCE)),
      W(block),
      W(0),
      D(d.exportAddress(39)),
    ])) & 0xffff;

  await d.globalFree(block);
  return answer;
}

/** `20f4`: an instance taken out of the list. */
function unlink(d: Dd, instance: number) {
  if (d.d16(D_INSTANCES) === instance) {
    d.sd16(D_INSTANCES, d.i16(instance, 0));
    return;
  }

  let at = d.d16(D_INSTANCES);

  while (at !== 0 && d.i16(at, 0) !== instance) {
    at = d.i16(at, 0);
  }

  if (at !== 0) {
    d.si16(at, 0, d.i16(instance, 0));
  }
}

/** `DdeNameService` (`1ed4`). */
export async function nameService(
  d: Dd,
  id: number,
  hsz: number,
  _reserved: number,
  command: number
): Promise<number> {
  const instance = instanceOf(d, id);

  if (instance === 0) {
    return 0;
  }

  d.si16(instance, 0x2a, 0);

  if (command & 4) {
    d.si16(instance, 0x1a, d.i16(instance, 0x1a) | 0x20);
  }

  if (command & 8) {
    d.si16(instance, 0x1a, d.i16(instance, 0x1a) & ~0x20);
  }

  if ((command & 3) === 0) {
    return 0;
  }

  if (d.i16(instance, 0x1a) & 0x10) {
    await setError(d, instance, DMLERR_DLL_USAGE);
    return 0;
  }

  let names = d.i32(instance, 8);

  if (hsz === 0) {
    if (command & 1) {
      await setError(d, instance, DMLERR_INVALIDPARAMETER);
      return 0;
    }

    for (;;) {
      const record = await d.arrayPop(names);

      if (!record) {
        break;
      }

      const name = (record[0] | (record[1] << 8) | (record[2] << 16) | (record[3] << 24)) >>> 0;
      let other = d.d16(D_INSTANCES);

      while (other !== 0) {
        if (other !== instance && (d.i16(other, 0x1c) & 0x10) === 0) {
          await d.send(d.i16(other, 0x22), 0x4c9, d.i16(instance, 0x24), name);
        }

        other = d.i16(other, 0);
      }

      await deleteAtom(d, lo(name));
      names = d.i32(instance, 8);
    }

    return 1;
  }

  const register = (command & 1) !== 0;
  const [key, saved] = d.key(le32(hsz));

  if (register) {
    if (names === 0) {
      names = await d.arrayNew(d.i16(instance, 0x20), 4, 8);
      d.si32(instance, 8, names);
    }

    await addCount(d, lo(hsz));
    await d.arrayAdd(names, key, null);
  } else {
    await d.arrayFind(names, 'dword', key, true);
  }

  d.release(saved);

  const mask = register ? 0x0008 : 0x0010;
  let other = d.d16(D_INSTANCES);

  while (other !== 0) {
    if ((d.i16(other, 0x1c) & mask) === 0) {
      await d.send(d.i16(other, 0x22), register ? 0x4c8 : 0x4c9, d.i16(instance, 0x24), hsz);
    }

    other = d.i16(other, 0);
  }

  if (command & 2) {
    await deleteAtom(d, lo(hsz));
  }

  return 1;
}

/** `DdeEnableCallback` (`1d98`). */
export async function enableCallback(d: Dd, id: number, conv: number, command: number) {
  const instance = instanceOf(d, id);

  if (instance === 0) {
    return 0;
  }

  d.si16(instance, 0x2a, 0);

  if ((conv !== 0 && !(await convValid(d, conv))) || command & 0xff75) {
    await setError(d, instance, DMLERR_INVALIDPARAMETER);
    return 0;
  }

  if (command & 2) {
    let item = d.r32(d.i32(instance, 0x16));

    if (conv === 0) {
      return item !== 0 ? 1 : 0;
    }

    while (item !== 0) {
      if (d.r32(plus(item, 4)) === conv >>> 0) {
        return 1;
      }

      item = d.r32(item);
    }

    return 0;
  }

  if (conv === 0) {
    const disabled = d.i16(instance, 0x2c);

    d.si16(instance, 0x2c, command & 8 ? disabled | 1 : disabled & ~1);
    await eachChild(d, d.i16(instance, 0x22), 0x4cf, command, 0, false);
  } else {
    await d.send(lo(conv), 0x4cf, command, 0);
  }

  if (command & 8) {
    return 1;
  }

  if (d.i16(instance, 0x2e) !== 0) {
    await setError(d, instance, DMLERR_REENTRANCY);
    return 0;
  }

  await d.send(d.i16(instance, 0x22), 0x4cc, 0, d.near(instance));
  return 1;
}

/** `DdeGetLastError` (`14a8`). */
export function getLastError(d: Dd, id: number): number {
  const instance = lo(id);

  if (instance === 0) {
    return 0x4003;
  }

  if (d.i16(instance, 0x30) !== hi(id)) {
    return DMLERR_INVALIDPARAMETER;
  }

  const error = d.i16(instance, 0x2a);

  d.si16(instance, 0x2a, 0);
  return error;
}

/** Whether a code page is one DDEML takes (`19d2`-`19e7`). */
async function codePageGood(d: Dd, page: number): Promise<boolean> {
  if (page === 0 || page === 0x3ec) {
    return true;
  }

  return ((await d.call('KEYBOARD', 'GetKbCodePage', [])) & 0xffff) === page;
}

/** `DdeCreateStringHandle` (`19a4`). */
export async function createStringHandle(d: Dd, id: number, string: number, page: number) {
  const instance = lo(id);

  if (d.i16(instance, 0x30) !== hi(id)) {
    return 0;
  }

  d.si16(instance, 0x2a, 0);

  if (string === 0 || d.r8(string) === 0) {
    return 0;
  }

  if (!(await codePageGood(d, page))) {
    await setError(d, instance, DMLERR_INVALIDPARAMETER);
    return 0;
  }

  const atom = await stringAtom(d, string, true);

  if (d.d16(D_MONITORS) !== 0) {
    await hszNotice(d, atom, 1, d.i16(instance, 0x1e));
  }

  const [key, saved] = d.key(le16(atom));

  await d.arrayAdd(d.i32(instance, 0x10), key, null);
  d.release(saved);
  return atom;
}

/** `DdeFreeStringHandle` (`1a40`). */
export async function freeStringHandle(d: Dd, id: number, hsz: number) {
  const atom = lo(hsz);
  const instance = instanceOf(d, id);

  if (instance === 0) {
    return 0;
  }

  d.si16(instance, 0x2a, 0);

  if (d.d16(D_MONITORS) !== 0) {
    await hszNotice(d, atom, 3, d.i16(instance, 0x1e));
  }

  const [key, saved] = d.key(le16(atom));

  await d.arrayFind(d.i32(instance, 0x10), 'first', key, true);
  d.release(saved);
  return deleteAtom(d, atom);
}

/** `DdeKeepStringHandle` (`1aac`). */
export async function keepStringHandle(d: Dd, id: number, hsz: number) {
  const atom = lo(hsz);
  const instance = instanceOf(d, id);

  if (instance === 0) {
    return 0;
  }

  d.si16(instance, 0x2a, 0);

  if (d.d16(D_MONITORS) !== 0) {
    await hszNotice(d, atom, 2, d.i16(instance, 0x1e));
  }

  const [key, saved] = d.key(le16(atom));

  await d.arrayAdd(d.i32(instance, 0x10), key, null);
  d.release(saved);
  return addCount(d, atom);
}

/** `DdeQueryString` (`1b14`). */
export async function queryString(
  d: Dd,
  id: number,
  hsz: number,
  at: number,
  size: number,
  page: number
) {
  const instance = instanceOf(d, id);

  if (instance === 0) {
    return 0;
  }

  d.si16(instance, 0x2a, 0);

  if (!(await codePageGood(d, page))) {
    await setError(d, instance, DMLERR_INVALIDPARAMETER);
    return 0;
  }

  if (at !== 0) {
    if (hsz !== 0) {
      return queryHsz(d, hsz, at, lo(size));
    }

    d.w8(at, 0);
    return 0;
  }

  return hsz !== 0 ? hszLength(d, hsz) : 0;
}

/** `DdeCmpStringHandles` (`1bb0`): unsigned. */
export function cmpStringHandles(hsz1: number, hsz2: number): number {
  const a = hsz1 >>> 0;
  const b = hsz2 >>> 0;

  return a < b ? 0xffff : a > b ? 1 : 0;
}

/** `DMGWNDPROC` (`5558`). */
export async function dmgProc(
  d: Dd,
  hwnd: number,
  message: number,
  wparam: number,
  lparam: number
): Promise<number> {
  switch (message) {
    case 1:
      return d.setWindowWord(hwnd, 0, d.r16(lparam));
    case 0x4c8:
    case 0x4c9: {
      const instance = await d.windowWord(hwnd, 0);

      await addCount(d, lo(lparam));

      const own = long(lo(lparam), wparam);
      const kind = message === 0x4c8 ? 0x80a2 : 0x80d2;

      await callback(d, instance, 0, lparam, own, 0, kind, 0, 0, 0);
      await deleteAtom(d, lo(lparam));
      return 0;
    }
    case 0x4cc:
      await runQueue(d, lo(lparam));
      return 0;
    case 0x4d0: {
      const instance = lo(lparam);

      if (d.i16(instance, 0x2e) !== 0) {
        await d.post(hwnd, 0x4d0, 0, lparam);
        return 0;
      }

      await replaceAdviseData(d, instance);

      if (d.i32(instance, 0x36) === 0) {
        d.si32(instance, 0x36, await d.alloc(d.i16(instance, 0x20), 0x100));
      }

      await runQueue(d, instance);
      return 0;
    }
    default:
      return d.user('DefWindowProc', [W(hwnd), W(message), W(wparam), D(lparam)]);
  }
}

/** `5600`-`5726`: of two `XTYP_ADVDATA` waiting alike, the older answered busy and dropped. */
async function replaceAdviseData(d: Dd, instance: number) {
  let item = d.r32(d.i32(instance, 0x16));

  for (;;) {
    while (item !== 0 && d.r16(plus(item, 0x12)) !== 0x4010) {
      item = d.r32(item);
    }

    if (item === 0) {
      return;
    }

    let later = d.r32(item);

    if (later === 0) {
      return;
    }

    while (later !== 0) {
      if (
        d.r16(plus(later, 0x12)) === 0x4010 &&
        d.r32(plus(later, 4)) === d.r32(plus(item, 4)) &&
        d.r32(plus(later, 0xc)) === d.r32(plus(item, 0xc)) &&
        d.r16(plus(later, 0x10)) === d.r16(plus(item, 0x10))
      ) {
        break;
      }

      later = d.r32(later);
    }

    if (later !== 0) {
      await reply(d, item, 0x4000);

      const next = d.r32(item);

      await d.listRemove(d.i32(instance, 0x16), item);
      item = next;
    } else {
      item = d.r32(item);
    }
  }
}

/** `5832`: a callback, as every one is made. */
export async function callback(
  d: Dd,
  instance: number,
  conv: number,
  hsz1: number,
  hsz2: number,
  format: number,
  kind: number,
  data: number,
  data1: number,
  data2: number
): Promise<number> {
  const mask = d.r32(d.near(0xa6 + ((kind & 0xf0) >> 2)));

  if ((mask & d.i32(instance, 0x1a)) >>> 0 !== 0) {
    return 0;
  }

  if (
    lo(hsz2) === d.d16(D_MADE_ME) &&
    lo(hsz1) === d.d16(D_WHO) &&
    format === 1 &&
    kind === 0x20b0
  ) {
    return make(d, instance, 0, 1, lo(hsz2), 0, 0x1e, d.near(D_TEXT_STAAB));
  }

  let handed = data >>> 0;
  let saved: number | null = null;

  if (data !== 0) {
    const [record, sp] = d.reserve(6);

    d.w16(record, instance);
    d.w16(plus(record, 2), lo(data) | 0x4000);
    d.w16(plus(record, 4), hi(data));
    handed = record;
    saved = sp;
  }

  d.si16(instance, 0x2e, d.i16(instance, 0x2e) + 1);

  const answer = await d.callFar(
    d.i32(instance, 4),
    callbackArgs(kind, format, conv, hsz1, hsz2, handed, data1, data2)
  );

  if (d.d16(D_MONITORS) !== 0 && kind !== XTYP_MONITOR) {
    await callbackNotice(d, instance, kind, format, conv, hsz1, hsz2, handed, data1, data2, answer);
  }

  d.si16(instance, 0x2e, d.i16(instance, 0x2e) - 1);

  if (saved !== null) {
    d.release(saved);
  }

  if (answer !== 0 && kind & 0x2000 && answer >>> 0 !== 0xffffffff) {
    const value = d.r32(plus(answer, 2));

    if ((lo(value) & 1) === 0) {
      await d.free(answer);
    }

    return value;
  }

  return answer;
}

/** `4e66`: the callbacks waiting made, oldest first. */
export async function runQueue(d: Dd, instance: number) {
  let item = d.r32(d.i32(instance, 0x16));

  while (d.i32(instance, 0x36) !== 0 && item !== 0) {
    const next = d.r32(item);

    if (d.i16(instance, 0x2e) !== 0) {
      return;
    }

    let keep = false;
    const window = d.r16(plus(item, 4));

    if (await d.isWindow(window)) {
      const conv = await d.windowLong(window, 0);
      const status = plus(conv, 0x20);
      const flags = d.r8(status);

      if (flags & 1) {
        if (flags & 8) {
          keep = true;
        } else {
          if (flags & 0x80) {
            d.w8(status, (flags | 8) & 0x7f);
          }

          const answer = await callback(
            d,
            instance,
            d.r32(plus(item, 4)),
            d.r32(plus(item, 8)),
            d.r32(plus(item, 0xc)),
            d.r16(plus(item, 0x10)),
            d.r16(plus(item, 0x12)),
            d.r32(plus(item, 0x14)),
            d.r32(plus(item, 0x18)),
            d.r32(plus(item, 0x1c))
          );

          if (answer >>> 0 === 0xffffffff && (d.r8(plus(item, 0x12)) & 2) === 0) {
            d.w8(status, d.r8(status) | 8);
            keep = true;
          } else {
            await reply(d, item, answer);
          }
        }
      }
    }

    if (!keep) {
      await d.listRemove(d.i32(instance, 0x16), item);
    }

    item = next;
  }
}

/** `5b60`: a callback queued, and the instance's window posted 4CCh unless blocked. */
export async function queueCallback(
  d: Dd,
  conv: number,
  hconv: number,
  hsz1: number,
  hsz2: number,
  format: number,
  kind: number,
  data: number,
  data1: number,
  data2: number,
  message: number,
  status: number,
  partner: number,
  handle: number
): Promise<number> {
  const instance = d.r16(conv);
  const item = await d.listAdd(d.i32(instance, 0x16), 0);

  if (item === 0) {
    await setError(d, instance, DMLERR_MEMORY_ERROR);
    return 0;
  }

  d.w32(plus(item, 4), hconv);
  d.w32(plus(item, 8), hsz1);
  d.w32(plus(item, 0xc), hsz2);
  d.w16(plus(item, 0x10), format);
  d.w16(plus(item, 0x12), kind);
  d.w32(plus(item, 0x14), data);
  d.w32(plus(item, 0x18), data1);
  d.w32(plus(item, 0x1c), data2);
  d.w16(plus(item, 0x20), message);
  d.w16(plus(item, 0x22), status);
  d.w16(plus(item, 0x24), partner);
  d.w16(plus(item, 0x28), handle);
  d.w16(plus(item, 0x26), d.r16(conv));

  if ((d.r8(plus(conv, 0x20)) & 8) === 0) {
    const owner = d.r16(conv);

    if ((await d.post(d.i16(owner, 0x22), 0x4cc, 0, d.near(owner))) === 0) {
      await setError(d, owner, DMLERR_SYS_ERROR);
    }
  }

  return 1;
}

/** `59cc`: a synchronous transaction waited for in DDEML's modal loop. */
export async function modalLoop(d: Dd, instance: number, timeout: number, hwnd: number) {
  let other = 0;

  for (;;) {
    other = await taskInstance(d, other);

    if (other === 0) {
      break;
    }

    if (d.i16(other, 0x28) !== 0) {
      await setError(d, instance, DMLERR_REENTRANCY);
      return 0;
    }
  }

  d.si16(instance, 0x28, hwnd);

  const piece = hi(timeout) !== 0 ? 0xffff : lo(timeout);

  if ((await d.setTimer(hwnd, 1, piece)) === 0) {
    await setError(d, instance, DMLERR_SYS_ERROR);
    return 0;
  }

  let left = timeout >>> 0;

  if (hi(left) < 0xffff) {
    left = (left + 0x10000) >>> 0;
  }

  for (;;) {
    left = (left - 0x10000) >>> 0;

    if (hi(left) === 0) {
      await d.setTimer(hwnd, 1, lo(left));
    }

    d.si16(instance, 0x3a, 0);

    for (;;) {
      const called = await d.callB('USER', 'GetMessage', [buffer(18), W(0), W(0), W(0)]);
      const msg = called.buffers[0];
      const filtered = (await d.user('CallMsgFilter', [B(msg.slice()), W(0x8001)])) & 0xffff;

      if (filtered === 0) {
        await d.user('DispatchMessage', [B(msg)]);
      }

      if (d.i16(instance, 0x3a) !== 0) {
        break;
      }
    }

    if (d.i16(instance, 0x3a) !== 1 || hi(left) === 0) {
      break;
    }
  }

  await d.killTimer(hwnd, 1);

  for (;;) {
    const removed =
      (await d.user('PeekMessage', [buffer(18), W(hwnd), W(0x113), W(0x113), W(3)])) & 0xffff;

    if (removed === 0) {
      break;
    }
  }

  d.si16(instance, 0x28, 0);

  if ((await d.post(d.i16(instance, 0x22), 0x4cc, 0, d.near(instance))) === 0) {
    await setError(d, instance, DMLERR_SYS_ERROR);
  }

  return 1;
}
