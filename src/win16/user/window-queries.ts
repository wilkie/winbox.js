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
