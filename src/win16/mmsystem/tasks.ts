'use strict';

import { GetCurrentTask } from '../kernel/tasks.js';
import { Yield } from '../kernel/WinExec.js';
import { MSG } from '../user.js';
import { DispatchMessage } from '../user/DispatchMessage.js';
import { GetMessage } from '../user/GetMessage.js';
import { PeekMessage } from '../user/PeekMessage.js';
import { PostAppMessage } from '../user/userwin.js';
import { TranslateMessage } from '../user/TranslateMessage.js';
import { inFrame } from './devices.js';

/**
 * MMSYSTEM's tasks: the calls its drivers make to run a task of their own
 * and to wait on it.
 *
 * **Read out** of `MMSYSTEM.DLL` (seg1 `264`, seg4 `598`-`5f9`); **recorded**
 * by `mmmisc`:
 *
 * * `mmGetCurrentTask` is KERNEL's `GetCurrentTask`, jumped to.
 * * `mmTaskSignal` posts the task `WM_USER` (400h), its `wParam` and
 *   `lParam` nought: `PostAppMessage`'s answer.
 * * `mmTaskYield` looks for a message without taking it, and yields if
 *   there is one.
 * * `mmTaskBlock` takes the task's messages until one for no window from
 *   3A0h up: what it answers. A message for a window is translated and
 *   dispatched; one for no window below 3A0h is dropped. The task it is
 *   given is not looked at, nor is `WM_QUIT`.
 */

const WM_USER = 0x400;
const PM_NOREMOVE = 0;

/** A `MSG` in MMSYSTEM's frame, below the program's stack, for a call that fills it. */
export async function withMsg<T>(system: any, body: (msg: any) => Promise<T>) {
  const [answer] = await inFrame(system, [new Uint8Array(0x12)], async ([far]) => {
    const msg: any = new MSG();

    msg.loadFromMemory(system.machine.memory, far >>> 19, far & 0xffff);

    return body(msg);
  });

  return answer;
}

/** @returns {Types.HANDLE} The task running: `GetCurrentTask`'s answer. */
export function mmGetCurrentTask(this: any) {
  return GetCurrentTask.call(this);
}

/** @returns {Types.BOOL} Whether `WM_USER` was posted to the task. */
export function mmTaskSignal(this: any, hTask: number) {
  return PostAppMessage.call(this, hTask & 0xffff, WM_USER, 0, 0);
}

/** Yields, if the task has a message waiting. */
export async function mmTaskYield(this: any) {
  await withMsg(this, async (msg) => {
    if (await PeekMessage.call(this, msg, 0, 0, 0, PM_NOREMOVE)) {
      await Yield.call(this);
    }
  });
}

/** @returns {Types.UINT} The first message for no window from 3A0h up. */
export async function mmTaskBlock(this: any, _hTask: number) {
  return withMsg(this, async (msg) => {
    for (;;) {
      await GetMessage.call(this, msg, 0, 0, 0);

      if (msg.hwnd) {
        await TranslateMessage.call(this, msg);
        await DispatchMessage.call(this, msg);
        continue;
      }

      if ((msg.message & 0xffff) >= 0x3a0) {
        return msg.message & 0xffff;
      }
    }
  });
}
