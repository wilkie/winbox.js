'use strict';

import { D, W } from '../commdlg/api.js';
import {
  D_HOOK,
  D_INSTANCES,
  D_MONITORS,
  Dd,
  hi,
  lo,
  long,
  plus,
  registerHeapFull,
} from './core.js';
import { callback } from './instance.js';

/**
 * DDEML's string handles as atoms, its last error, and what it tells the
 * monitors: the notices of `MF_HSZ_INFO`, `MF_ERRORS`, `MF_CALLBACKS`,
 * `MF_LINKS` and `MF_CONV` each a `GMEM_DDESHARE` block sent to every
 * monitor's window, the two hooks of `MF_SENDMSGS` and `MF_POSTMSGS`, and the
 * monitor's window procedure (`DDEML.DLL` seg1 `2ddc`-`3672`, `61a8`). As
 * `crates/winbox-win16/src/ddeml/monitor.rs`.
 */

export const MF_HSZ_INFO = 0x0100;
export const MF_SENDMSGS = 0x0200;
export const MF_POSTMSGS = 0x0400;
export const MF_CALLBACKS = 0x0800;
export const MF_ERRORS = 0x1000;
export const MF_LINKS = 0x2000;
export const MF_CONV = 0x4000;

export const XTYP_MONITOR = 0x80f2;

/** `358a`: a block for a notice, where any monitor takes it: `MAKELONG(100h, block)`. */
export async function noticeBlock(d: Dd, size: number, flag: number): Promise<number> {
  if (d.d16(D_MONITORS) === 0) {
    return 0;
  }

  let seen = 0;
  let instance = d.d16(D_INSTANCES);

  while (instance !== 0 && seen < d.d16(D_MONITORS)) {
    if (d.i16(instance, 0x1c) & flag) {
      const block = await d.share(size, 0, 0);

      return long(0x100, block);
    }

    if (d.i16(instance, 0x1a) & 1) {
      seen++;
    }

    instance = d.i16(instance, 0);
  }

  return 0;
}

/** `3524`: a notice sent to each monitor whose flags take it, then freed. */
export async function sendNotice(d: Dd, block: number, flag: number) {
  let seen = 0;
  let instance = d.d16(D_INSTANCES);

  while (instance !== 0 && seen < d.d16(D_MONITORS)) {
    const window = d.i16(instance, 0x26);

    if (window !== 0) {
      if (d.i16(instance, 0x1c) & flag) {
        await d.send(window, 0x4ca, flag, block);
      }

      seen++;
    }

    instance = d.i16(instance, 0);
  }

  await d.globalUnlock(hi(block));
  await d.globalFree(hi(block));
}

/** `326e`: `MF_HSZ_INFO`, a `MONHSZSTRUCT`: an atom's action and name. */
export async function hszNotice(d: Dd, atom: number, action: number, task: number) {
  const hsz = atom & 0xffff;
  const length = await hszLength(d, hsz);
  const block = await noticeBlock(d, (length + 0x11) & 0xffff, MF_HSZ_INFO);

  if (block === 0) {
    return;
  }

  const at = await d.globalLock(hi(block));

  d.w16(at, length + 0x12);
  d.w32(plus(at, 4), await d.currentTime());
  d.w16(plus(at, 0xc), task);
  d.w16(plus(at, 2), action);
  d.w32(plus(at, 8), hsz);
  await queryHsz(d, hsz, plus(at, 0x10), length + 1);
  await sendNotice(d, block, MF_HSZ_INFO);
}

/** `3304`: an instance's last error set, told to the monitors first where not nought. */
export async function setError(d: Dd, instance: number, error: number) {
  if (error !== 0) {
    const block = await noticeBlock(d, 10, MF_ERRORS);

    if (block !== 0) {
      const at = await d.globalLock(hi(block));

      d.w16(at, 10);
      d.w32(plus(at, 4), await d.currentTime());
      d.w16(plus(at, 8), d.i16(instance, 0x1e));
      d.w16(plus(at, 2), error);
      await sendNotice(d, block, MF_ERRORS);
    }
  }

  d.si16(instance, 0x2a, error);
}

/** `3196`: `MF_CALLBACKS`, a `MONCBSTRUCT`: a callback and its answer. */
export async function callbackNotice(
  d: Dd,
  instance: number,
  kind: number,
  format: number,
  conv: number,
  hsz1: number,
  hsz2: number,
  data: number,
  data1: number,
  data2: number,
  answer: number
) {
  if (instance === 0) {
    return;
  }

  const block = await noticeBlock(d, 0x2a, MF_CALLBACKS);

  if (block === 0) {
    return;
  }

  const at = await d.globalLock(hi(block));

  d.w16(at, 0x2a);
  d.w32(plus(at, 4), await d.currentTime());
  d.w16(plus(at, 8), d.i16(instance, 0x1e));
  d.w32(plus(at, 0xa), answer);
  d.w16(plus(at, 0xe), kind);
  d.w16(plus(at, 0x10), format);
  d.w32(plus(at, 0x12), conv);
  d.w32(plus(at, 0x16), hsz1);
  d.w32(plus(at, 0x1a), hsz2);
  d.w32(plus(at, 0x1e), data);
  d.w32(plus(at, 0x22), data1);
  d.w32(plus(at, 0x26), data2);
  await sendNotice(d, block, MF_CALLBACKS);
}

/** `3376`: `MF_LINKS`, a `MONLINKSTRUCT`: an advise link made or ended. */
export async function linkNotice(
  d: Dd,
  instance: number,
  established: number,
  noData: number,
  service: number,
  topic: number,
  item: number,
  format: number,
  server: number,
  convServer: number,
  convClient: number
) {
  const block = await noticeBlock(d, 0x24, MF_LINKS);

  if (block === 0) {
    return;
  }

  const at = await d.globalLock(hi(block));

  d.w16(at, 0x24);
  d.w32(plus(at, 2), await d.currentTime());
  d.w16(plus(at, 6), d.i16(instance, 0x1e));
  d.w16(plus(at, 8), established);
  d.w16(plus(at, 0xa), noData);
  d.w32(plus(at, 0xc), service);
  d.w32(plus(at, 0x10), topic);
  d.w32(plus(at, 0x14), item);
  d.w16(plus(at, 0x18), format);
  d.w16(plus(at, 0x1a), server);
  d.w32(plus(at, 0x1c), convServer);
  d.w32(plus(at, 0x20), convClient);
  await sendNotice(d, block, MF_LINKS);
}

/** A conversation's handle from its window: `MAKELONG(window, its word 4)`, nought for none. */
export async function convOf(d: Dd, hwnd: number): Promise<number> {
  if (await d.isWindow(hwnd)) {
    const tag = await d.windowWord(hwnd, 4);

    return long(hwnd, tag);
  }

  return 0;
}

/** `3438`: `MF_CONV`, a `MONCONVSTRUCT`: a conversation made or ended. */
export async function convNotice(
  d: Dd,
  instance: number,
  service: number,
  topic: number,
  client: number,
  server: number,
  connect: number
) {
  const block = await noticeBlock(d, 0x1a, MF_CONV);

  if (block === 0) {
    return;
  }

  const at = await d.globalLock(hi(block));

  d.w16(at, 0x1a);
  d.w32(plus(at, 4), await d.currentTime());
  d.w16(plus(at, 8), d.i16(instance, 0x1e));
  d.w16(plus(at, 0xa), service);
  d.w16(plus(at, 0xc), 0);
  d.w16(plus(at, 0xe), topic);
  d.w16(plus(at, 0x10), 0);
  d.w32(plus(at, 0x12), await convOf(d, client));
  d.w32(plus(at, 0x16), await convOf(d, server));
  d.w16(plus(at, 2), connect);
  await sendNotice(d, block, MF_CONV);
}

// The atoms.

/** `2ddc`: an atom deleted, told to the monitors first (7): 1 where `GlobalDeleteAtom` answered nought. */
export async function deleteAtom(d: Dd, atom: number): Promise<number> {
  if (atom === 0) {
    return 1;
  }

  if (d.d16(D_MONITORS) !== 0) {
    await hszNotice(d, atom, 7, await d.currentTask());
  }

  return (await d.deleteAtomRaw(atom)) === 0 ? 1 : 0;
}

/** `2e18`: a count added to an atom by adding its name again, told to the monitors first (6). */
export async function addCount(d: Dd, atom: number): Promise<number> {
  if (atom === 0) {
    return 1;
  }

  if (d.d16(D_MONITORS) !== 0) {
    await hszNotice(d, atom, 6, await d.currentTask());
  }

  const [length, name] = await d.atomName(atom, 0xff);

  if (length === 0) {
    return 0;
  }

  return d.addAtomText(name);
}

/** `2e72`: the length of a string handle's name, seven more where it has a window. */
export async function hszLength(d: Dd, hsz: number): Promise<number> {
  if (lo(hsz) === 0) {
    return 0;
  }

  const [length] = await d.atomName(lo(hsz), 0xff);

  if (length === 0) {
    return 0;
  }

  return hi(hsz) !== 0 ? length + 7 : length;
}

/** `2eb6`: a string handle's name written to a buffer, `:(hhhh)` after it where there is room. */
export async function queryHsz(d: Dd, hsz: number, at: number, size: number): Promise<number> {
  if (lo(hsz) === 0) {
    if (size !== 0) {
      d.w8(at, 0);
    }

    return 0;
  }

  let length = await d.atomNameAt(lo(hsz), at, size);

  if (length !== 0 && hi(hsz) !== 0 && ((size - 7) & 0xffff) > length) {
    const suffix = `:(${hi(hsz).toString(16).padStart(4, '0')})`;

    d.write(plus(at, length), [...Array.from(suffix, (c) => c.charCodeAt(0)), 0]);
    length += 7;
  }

  return length;
}

/** `2f26`, `2f50`: the atom of a string -- added, told to the monitors after (5), or found. */
export async function stringAtom(d: Dd, string: number, add: boolean): Promise<number> {
  if (string === 0 || d.r8(string) === 0) {
    return 0;
  }

  const atom = add ? await d.addAtomAt(string) : await d.findAtomAt(string);

  if (add && d.d16(D_MONITORS) !== 0) {
    await hszNotice(d, atom, 5, await d.currentTask());
  }

  return atom;
}

// The hooks.

async function messageNotice(
  d: Dd,
  flag: number,
  hwnd: number,
  time: number | null,
  message: number,
  wparam: number,
  lparam: number
) {
  if (message < 0x3e0 || message > 0x3e8) {
    return;
  }

  const block = await noticeBlock(d, 0x12, flag);

  if (block === 0) {
    return;
  }

  const at = await d.globalLock(hi(block));

  d.w16(at, 0x12);
  d.w32(plus(at, 4), time ?? (await d.currentTime()));
  d.w16(plus(at, 2), hwnd);
  d.w16(plus(at, 8), await d.windowTask(hwnd));
  d.w16(plus(at, 0xa), message);
  d.w16(plus(at, 0xc), wparam);
  d.w32(plus(at, 0xe), lparam);
  await sendNotice(d, block, flag);
}

async function passOn(d: Dd, code: number, wparam: number, lparam: number): Promise<number> {
  return d.user('DefHookProc', [W(code), W(wparam), D(lparam), D(d.near(D_HOOK))]);
}

/** `DDESENDHOOKPROC` (`2fb0`), `WH_CALLWNDPROC`: each DDE message sent, `MF_SENDMSGS`. */
export async function sendHook(
  d: Dd,
  code: number,
  wparam: number,
  lparam: number
): Promise<number> {
  if (d.d16(D_MONITORS) !== 0 && lparam !== 0) {
    const message = d.r16(plus(lparam, 6));

    if (message >= 0x3e0 && message <= 0x3e8) {
      await messageNotice(
        d,
        MF_SENDMSGS,
        d.r16(plus(lparam, 8)),
        null,
        message,
        d.r16(plus(lparam, 4)),
        d.r32(lparam)
      );
    }
  }

  return passOn(d, code, wparam, lparam);
}

/** `DDEPOSTHOOKPROC` (`309e`), `WH_GETMESSAGE`: each DDE message taken, `MF_POSTMSGS`. */
export async function postHook(
  d: Dd,
  code: number,
  wparam: number,
  lparam: number
): Promise<number> {
  if (d.d16(D_MONITORS) !== 0 && lparam !== 0) {
    const message = d.r16(plus(lparam, 2));

    if (message >= 0x3e0 && message <= 0x3e8) {
      await messageNotice(
        d,
        MF_POSTMSGS,
        d.r16(lparam),
        d.r32(plus(lparam, 0xa)),
        message,
        d.r16(plus(lparam, 4)),
        d.r32(plus(lparam, 6))
      );
    }
  }

  return passOn(d, code, wparam, lparam);
}

/** `MONITORWNDPROC` (`35f2`). */
export async function monitorProc(
  d: Dd,
  hwnd: number,
  message: number,
  wparam: number,
  lparam: number
): Promise<number> {
  switch (message) {
    case 1:
      return d.setWindowWord(hwnd, 0, d.r16(lparam));
    case 0x4ca: {
      const instance = await d.windowWord(hwnd, 0);

      await callback(d, instance, 0, 0, 0, 0, XTYP_MONITOR, lparam, 0, long(0, wparam));
      return 0;
    }
    default:
      return d.user('DefWindowProc', [W(hwnd), W(message), W(wparam), D(lparam)]);
  }
}

/** `61a8`: an instance's heap full: its 256 bytes let go, `XTYP_ERROR`, kept again later. */
export async function heapFull(d: Dd, heap: number): Promise<number> {
  let instance = d.d16(D_INSTANCES);

  while (instance !== 0 && d.i16(instance, 0x20) !== heap) {
    instance = d.i16(instance, 0);
  }

  if (instance === 0 || d.i32(instance, 0x36) === 0) {
    return 0;
  }

  await d.free(d.i32(instance, 0x36));
  d.si32(instance, 0x36, 0);
  await setError(d, instance, 0x4007);
  await callback(d, instance, 0, 0, 0, 0, 0x8002, 0, 0x4007, 0);

  if ((await d.post(d.i16(instance, 0x22), 0x4d0, 0, d.near(instance))) === 0) {
    await setError(d, instance, 0x400f);
    return 0;
  }

  return 1;
}

registerHeapFull(heapFull);
