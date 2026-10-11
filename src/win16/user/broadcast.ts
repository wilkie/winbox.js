'use strict';

import { GlobalAlloc } from '../kernel/GlobalAlloc.js';
import { GlobalFree } from '../kernel/GlobalFree.js';
import { globalPointer } from '../kernel/GlobalLock.js';
import { topLevel } from './enumerate.js';
import { ownerOf } from './enumerate.js';
import { RasterWindow } from './raster-window.js';

/**
 * A message for every window at the top: `SendMessage` and `PostMessage`
 * with `HWND_BROADCAST`, -1, which both exports pass by without checking
 * it as a window (`USER.EXE` seg1 `a786`, `a7b7`) to the broadcast (seg1
 * `22e3`). **Recorded** by `bcast`.
 *
 * * Sent, each window at the top is sent it as `EnumWindows` takes them,
 *   hidden, disabled, minimized, owned and another program's alike (seg1
 *   `2358`, `6556`); the call answers 10000h, whatever they answered.
 * * Posted, it is posted to each window at the top that has no owner, as
 *   the desktop's children are in order (`232b`-`234e`): an owned one is
 *   passed over. The call answers ABCDh (`2353`).
 * * Either way the windows of USER's classes 8000h (menus), 8003h (the
 *   task list's) and 8004h (icons' titles) are passed over (`2293`).
 * * For `WM_WININICHANGE` and `WM_DEVMODECHANGE` with an `lParam`, the
 *   text it points to is copied into a block of `GlobalAlloc`'s, flags
 *   1000h, and the block's address passed, its offset nought (seg1
 *   `0093`); a block that cannot be had answers 10000h and nothing is
 *   sent. Sent, the block is freed after; posted, it is never freed.
 */

export const HWND_BROADCAST = 0xffff;

const WM_WININICHANGE = 0x001a;
const WM_DEVMODECHANGE = 0x001b;

/** USER's own classes a broadcast passes over (8000h, 8003h, 8004h). */
const PASSED_OVER = new Set(['#32768', '#32771', '#32772']);

/** The windows a broadcast is for, front to back. */
export function broadcastTargets(system: any, posting: boolean): number[] {
  return topLevel(system)
    .filter(
      (window: RasterWindow) =>
        !PASSED_OVER.has(String(window.options?.windowClass ?? '').toUpperCase())
    )
    .map((window: RasterWindow) => window.window.hwnd)
    .filter((hwnd: number) => !posting || !ownerOf(system, hwnd));
}

/**
 * The text a `WM_WININICHANGE` or `WM_DEVMODECHANGE` points to, copied into
 * a block of its own (seg1 `0093`): the block and its address; the block
 * nought where there is no text to copy, null where none could be had.
 */
function copyText(system: any, message: number, lParam: number) {
  if ((message !== WM_WININICHANGE && message !== WM_DEVMODECHANGE) || !lParam) {
    return { block: 0, far: lParam >>> 0 };
  }

  const core = system.machine.cpu.core;
  const bytes: number[] = [];

  for (let at = 0; ; at++) {
    const byte = core.read8((lParam >>> 16) & 0xffff, (lParam + at) & 0xffff);

    bytes.push(byte);

    if (!byte) {
      break;
    }
  }

  const block = GlobalAlloc.call(system, 0x1000, bytes.length);

  if (!block) {
    return null;
  }

  const far = globalPointer.call(system, block) >>> 0;

  bytes.forEach((byte, at) => core.write8(far >>> 16, (far & 0xffff) + at, byte));

  return { block, far };
}

/** `SendMessage` with `HWND_BROADCAST`: 10000h. */
export async function sendBroadcast(
  system: any,
  send: (hwnd: number, message: number, wParam: number, lParam: number) => Promise<unknown>,
  message: number,
  wParam: number,
  lParam: number
) {
  const copied = copyText(system, message, lParam);

  if (copied) {
    for (const hwnd of broadcastTargets(system, false)) {
      if (system.handles.resolve(hwnd) instanceof RasterWindow) {
        await send(hwnd, message, wParam, copied.far);
      }
    }

    if (copied.block) {
      GlobalFree.call(system, copied.block);
    }
  }

  return 0x10000;
}

/** `PostMessage` with `HWND_BROADCAST`: ABCDh, or 0 where no block could be had. */
export function postBroadcast(
  system: any,
  post: (hwnd: number, message: number, wParam: number, lParam: number) => unknown,
  message: number,
  wParam: number,
  lParam: number
) {
  const copied = copyText(system, message, lParam);

  if (!copied) {
    return 0;
  }

  for (const hwnd of broadcastTargets(system, true)) {
    post(hwnd, message, wParam, copied.far);
  }

  return 0xabcd;
}
