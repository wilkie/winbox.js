'use strict';

import { User } from '../user.js';
import { RasterWindow } from './raster-window.js';
import { GetDC } from './GetDC.js';
import { ReleaseDC } from './ReleaseDC.js';
import { paintsIcon, WM_ICONERASEBKGND } from './paint-icon.js';

/**
 * Erasing a window's background, as USER does it (`USER.EXE` seg1 `7a83`,
 * the only place `WM_ERASEBKGND` is sent from). **Read out** and recorded by
 * the `nobrush` probe.
 *
 * * An erase not done -- the window procedure answered nought -- is noted on
 *   the window, and `BeginPaint` hands the note back as `fErase`, 4 (seg1
 *   `7afa`, `76ac`). The note stays until the next erase is tried.
 * * For a program made for a Windows before 3.1, an erase not done is still
 *   to be done: `BeginPaint` asks again (seg1 `7afe`; `CreateWindow` marks a
 *   window of a 3.1 program at seg8 `42d`).
 */

/** Sends the window its erase message, on `hdc`, and notes what came of it. */
export async function sendErase(system: any, hwnd: number, dialog: RasterWindow, hdc: number) {
  const window: any = dialog.window;
  const windowClass = system.handles.retrieve(dialog.options.windowClass);
  const message = paintsIcon(system, hwnd) ? WM_ICONERASEBKGND : User.WM_ERASEBKGND;

  window.needsErase = false;
  window.unerased = false;

  const answer = await system.scheduler.callWndProc(windowClass, hwnd, message, hdc, 0);

  if ((answer & 0xffff) === 0) {
    window.unerased = true;
    window.needsErase = expectedVersion(system, dialog) < 0x30a;
  }
}

/** `PAINTSTRUCT.fErase` for a window: 4 when its last erase was not done. */
export function eraseNotDone(dialog: RasterWindow) {
  return (dialog.window as any).unerased ? 4 : 0;
}

/**
 * The erase a window is due, done now rather than at `BeginPaint`: what the
 * end of `SetWindowPos` does for the windows it showed or uncovered (seg7
 * `28d`, seg1 `7913`). A window of another task is left to its `BeginPaint`
 * -- USER sends it `WM_SYNCPAINT` instead, not followed here.
 */
export async function eraseNow(system: any, hwnd: number) {
  const dialog = system.handles.resolve(hwnd);

  if (!(dialog instanceof RasterWindow) || !dialog.window.needsErase || !dialog.window.visible) {
    return;
  }

  const task = system.scheduler.windowTask?.(hwnd);

  if (task && task !== system.scheduler.active) {
    return;
  }

  const hdc = GetDC.call(system, hwnd);

  await sendErase(system, hwnd, dialog, hdc);
  ReleaseDC.call(system, hwnd, hdc);
}

/**
 * The windows a hide, a move or a destroy uncovered, drawn at once as
 * `SetWindowPos` ends: each is sent `WM_NCPAINT` where its frame was
 * uncovered, then erased where it was. Its `WM_PAINT` waits for its program
 * to take its messages. **Recorded** by `uncover`.
 */
export async function eraseExposed(system: any) {
  const desktop = system.rasterDesktop;

  for (const window of [...(desktop?.windows ?? [])]) {
    if (!window.exposed || !window.hwnd) {
      continue;
    }

    window.exposed = false;

    const dialog = system.handles.resolve(window.hwnd);
    const task = system.scheduler.windowTask?.(window.hwnd);

    if (!(dialog instanceof RasterWindow) || !window.visible) {
      continue;
    }

    /* A window of another task is sent `WM_SYNCPAINT`, and draws itself in
     * its own task (`syncpnt`). What it is sent with is not recorded. */
    if (task && task !== system.scheduler.active) {
      const windowClass = system.handles.retrieve(dialog.options.windowClass);

      await system.scheduler.callWndProc(windowClass, window.hwnd, WM_SYNCPAINT, 0, 0);
      continue;
    }

    await syncPaint(system, window.hwnd);
  }
}

/**
 * What an uncovered window is due, drawn now: `WM_NCPAINT` where its frame
 * was uncovered, then its erase, clipped to what was uncovered, as
 * `BeginPaint`'s is. `DefWindowProc` does this for `WM_SYNCPAINT`.
 */
export async function syncPaint(system: any, hwnd: number) {
  const dialog = system.handles.resolve(hwnd);

  if (!(dialog instanceof RasterWindow) || !dialog.window.visible) {
    return;
  }

  const window: any = dialog.window;

  if (window.needsNcPaint) {
    window.needsNcPaint = false;

    const windowClass = system.handles.retrieve(dialog.options.windowClass);

    await system.scheduler.callWndProc(windowClass, hwnd, User.WM_NCPAINT, 1, 0);
  }

  const clip = window.paintClip;

  window.paintClip = window.dirtyRect;
  await eraseNow(system, hwnd);
  window.paintClip = clip;
}

export const WM_SYNCPAINT = 0x0088;

/** A window just shown, and the children shown with it, erased now. */
export async function eraseShown(system: any, window: RasterWindow) {
  const shown = window.window;

  for (const member of window.desktop.windows.filter((one: any) => within(one, shown))) {
    if (member.hwnd) {
      await eraseNow(system, member.hwnd);
    }
  }
}

function within(window: any, ancestor: any) {
  for (let at = window; at; at = at.parent) {
    if (at === ancestor) {
      return true;
    }
  }

  return false;
}

/** The Windows version the window's program was made for, from its module. */
function expectedVersion(system: any, dialog: RasterWindow) {
  const instance = dialog.data?.hInstance ?? 0;

  return system.handles.resolve(instance)?.executable?.neHeader?.expectedWindowsVersion ?? 0x30a;
}
