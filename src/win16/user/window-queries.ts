'use strict';

import { FALSE, TRUE } from '../consts.js';

import { User } from '../user.js';

import { RasterWindow } from './raster-window.js';

/**
 * What a program asks about a window: whether it is one, whether it shows,
 * whether it takes input -- and `EnableWindow`, which says it does not.
 */

/** Whether a handle is a window's. */
export function IsWindow(this: any, hwnd: number) {
  const window = hwnd ? this.handles.resolve(hwnd) : null;

  return window && window.options?.windowClass !== undefined ? TRUE : FALSE;
}

/** Whether a window shows: it and every window it is inside is visible. */
export function IsWindowVisible(this: any, hwnd: number) {
  const dialog = this.handles.resolve(hwnd);

  if (!(dialog instanceof RasterWindow)) {
    return dialog?.visible ? TRUE : FALSE;
  }

  for (let window: any = dialog.window; window; window = window.parent) {
    if (!window.visible) {
      return FALSE;
    }
  }

  return TRUE;
}

/** Whether a window takes the mouse and the keyboard: not with `WS_DISABLED`. */
export function IsWindowEnabled(this: any, hwnd: number) {
  const dialog = this.handles.resolve(hwnd);

  if (!(dialog instanceof RasterWindow)) {
    return dialog ? TRUE : FALSE;
  }

  return dialog.window.style & User.WS_DISABLED ? FALSE : TRUE;
}

/**
 * Lets a window take input, or stops it: `WS_DISABLED` cleared or set, and
 * `WM_ENABLE` sent when that changes anything. The answer is whether the
 * window was disabled before.
 */
export async function EnableWindow(this: any, hwnd: number, fEnable: number) {
  const dialog = this.handles.resolve(hwnd);

  if (!(dialog instanceof RasterWindow)) {
    return FALSE;
  }

  const window = dialog.window;
  const was = window.style & User.WS_DISABLED ? TRUE : FALSE;
  const now = fEnable ? FALSE : TRUE;

  if (was !== now) {
    window.style = fEnable ? window.style & ~User.WS_DISABLED : window.style | User.WS_DISABLED;

    /* A window that loses the keyboard with its input. */
    if (!fEnable && dialog.desktop.focus === window) {
      dialog.desktop.focus = null;
    }

    const windowClass = this.handles.retrieve(dialog.options.windowClass);

    if (windowClass) {
      await this.scheduler.callWndProc(windowClass, hwnd, User.WM_ENABLE, fEnable ? 1 : 0, 0);
    }
  }

  return was;
}

/** The window a child window is inside; 0 for a top-level one. */
export function GetParent(this: any, hwnd: number) {
  const dialog = this.handles.resolve(hwnd);

  return dialog instanceof RasterWindow ? (dialog.window.parent?.hwnd ?? 0) : 0;
}

/** Whether a window is inside another, at any depth. */
export function IsChild(this: any, hwndParent: number, hwnd: number) {
  const dialog = this.handles.resolve(hwnd);
  const parent = this.handles.resolve(hwndParent);

  if (!(dialog instanceof RasterWindow) || !(parent instanceof RasterWindow)) {
    return FALSE;
  }

  for (let at = dialog.window.parent; at; at = at.parent) {
    if (at === parent.window) {
      return TRUE;
    }
  }

  return FALSE;
}

/**
 * The task a window belongs to: the one that made it. **Recorded** by
 * `minis`, as the task `GetCurrentTask` answers for the probe's own window.
 *
 * @param {Types.HWND} hwnd - The window.
 *
 * @returns {Types.HANDLE} The task, or nought for no window.
 */
export function GetWindowTask(this: any, hwnd: number) {
  const window = this.handles.resolve(hwnd);

  return window?.data?.hInstance ?? 0;
}
