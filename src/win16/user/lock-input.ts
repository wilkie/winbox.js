'use strict';

import { User } from '../user.js';
import { LockCurrentTask } from '../kernel/tasks.js';
import { RasterWindow } from './raster-window.js';
import { GetCapture, SetCapture } from './SetCapture.js';
import { ClipCursor, GetSysModalWindow, SetSysModalWindow } from './userwin.js';

/**
 * Locking the input to one window, as a debugger does: `LockInput`, and
 * the `LockMyTask` and `EnableHardwareInput` it is built on. **Read out** of
 * `USER.EXE` seg1, and **recorded** by `lockinp`.
 */

function windowOf(system: any, hwnd: number) {
  const window = hwnd ? system.handles.resolve(hwnd) : null;

  return window instanceof RasterWindow ? window : null;
}

/**
 * Hardware input switched on or off, the word at `46h` of USER's segment 44
 * exchanged for the one given (`USER.EXE` seg1 `4f36`-`4f45`): answers what
 * it was, 1 at first. While it is nought, the keyboard's and the mouse's
 * events are not put in the system queue (`4be3`; `RasterInput`), and are
 * lost (`lockinp`).
 */
export function EnableHardwareInput(this: any, bEnable: number) {
  const was = this._hardwareInput ?? 1;

  this._hardwareInput = bEnable & 0xffff;
  return was;
}

/**
 * The running task locked, or let go, unless `LockInput` has the input
 * locked (`USER.EXE` seg1 `6eea`-`6f24`, the word at `102h` of USER's data):
 * KERNEL's `LockCurrentTask`, so no other task runs meanwhile; the word at
 * `0DEh` set, so each look of the task's is made without yielding, as with
 * `PM_NOYIELD` (`245b`-`2462`; `gmhook`); and, locking, the input let go
 * by whatever task held it (`6f0c`-`6f1b`).
 */
export function LockMyTask(this: any, fLock: number) {
  if (this._lockedInput) {
    return;
  }

  LockCurrentTask.call(this, fLock);
  this._lockMyTask = fLock & 0xffff;

  if (fLock) {
    this._inputMark = 0;
    this._inputLock = null;
  }
}

/** The window at the top a window is in: itself, unless a child (`USER.EXE` seg2 `0ab8`). */
function topOf(window: any) {
  let at = window;

  while (at.parent && (at.style & (User.WS_CHILD | User.WS_POPUP)) === User.WS_CHILD) {
    at = at.parent;
  }

  return at;
}

/**
 * USER's active window made another without a word to either: its caption
 * left drawn as it was (`USER.EXE` seg1 `4a10`-`4a1a`, `4a93`-`4a9c`).
 */
function makeActive(desktop: any, target: any) {
  const was = desktop.activeTop;

  if (was === target) {
    return;
  }

  if (was) {
    const lit = was.captionLit;

    was.active = false;
    was.lit = lit;
  }

  if (target) {
    const lit = target.captionLit;

    target.active = true;
    target.lit = lit;
  }
}

/**
 * Locks the input to one window, or lets it go (`USER.EXE` seg1 `4983`-
 * `4af8`). Answers nought where the handle given first is not nought; to
 * lock, where it is locked already, the window is none or a child, or the
 * 1Ch bytes kept meanwhile cannot be had; to let go, where it is not
 * locked.
 *
 * Locking, USER locks the running task (`LockMyTask`), so no other runs;
 * then keeps, and sets, without a message to any window: the focus and the
 * active window, both the window given; the capture, let go; the
 * system-modal window, the window given, as `SetSysModalWindow` makes it;
 * the cursor's clip, the screen; and the hardware input, switched on.
 * Letting go puts each back as it was kept, and lets the task go. The
 * words of a menu's and a dialog box's loops at `0DAh`, `1CAh`, `1CEh` and
 * `0D0h`, and the flag of a box of USER's own at `0E0h`, are kept and put
 * back too; winbox.js keeps none of them. As it locks, USER also gives the
 * desktop window to the window's task (seg8 `08c4`), which winbox.js does
 * not.
 *
 * **Recorded** by `lockinp`: no message is sent `W` or `L` as either is
 * done; while locked, a program posted a message does not answer until the
 * lock is let go, and X goes to the window locked to, even with the
 * hardware input switched off before.
 */
export async function LockInput(this: any, hReserved: number, hwndInput: number, fLock: number) {
  if (hReserved) {
    return 0;
  }

  const desktop = this.rasterDesktop;

  if (!fLock) {
    const kept = this._lockedInput;

    if (!kept) {
      return 0;
    }

    ClipCursor.call(this, kept.clip);

    if (desktop) {
      const there = (window: any) => (window && desktop.windows.includes(window) ? window : null);

      desktop.focus = there(kept.focus);
      makeActive(desktop, there(kept.active));
    }

    await SetSysModalWindow.call(this, kept.sysModal);
    SetCapture.call(this, kept.capture);
    EnableHardwareInput.call(this, kept.hardware);
    this._lockedInput = null;
    LockMyTask.call(this, 0);
    return 1;
  }

  const window = windowOf(this, hwndInput);

  if (this._lockedInput || !window || topOf(window.window) !== window.window) {
    return 0;
  }

  LockMyTask.call(this, 1);

  const kept: any = {
    focus: desktop?.focus ?? null,
    active: desktop?.activeTop ?? null,
    capture: GetCapture.call(this),
  };

  this._lockedInput = kept;

  if (desktop) {
    desktop.focus = window.window;
    makeActive(desktop, window.window);
  }

  SetCapture.call(this, 0);
  kept.sysModal = GetSysModalWindow.call(this);
  await SetSysModalWindow.call(this, hwndInput);
  kept.clip = this._cursorClip ?? null;
  ClipCursor.call(this, null);
  kept.hardware = EnableHardwareInput.call(this, 1);

  return 1;
}
