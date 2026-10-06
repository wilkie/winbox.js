'use strict';

import { DesktopHandle } from './desktop-handle.js';

import { FALSE, TRUE } from '../consts.js';

import { User } from '../user.js';

import { RasterWindow } from './raster-window.js';
import { SendMessage } from './SendMessage.js';
import { focusNothing } from './SetFocus.js';

const WS_POPUP = 0x80000000;
const WS_CHILD = 0x40000000;
const WM_CANCELMODE = 0x001f;

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
 * window was disabled before (`USER.EXE` seg1 `6f28`).
 *
 * A window disabled, whether or not it was already, is first sent
 * `WM_CANCELMODE` (`6f63`), which `DefWindowProc` answers by letting the
 * capture go if the window has it. Then, if it has the focus, it loses it,
 * with `WM_KILLFOCUS` naming no window, as `SetFocus(NULL)` takes it
 * (`6f71`), before it is marked disabled: a button losing it so is let go and
 * clicked if it was pushed (`btnkeys`, `space-disabled`). Any window, not
 * only a control.
 *
 * **Recorded** by `btnmore`: a push button and a window of the probe's own
 * class, each disabled with the focus, the capture, both and neither --
 * `WM_CANCELMODE`, `WM_KILLFOCUS` with the focus, then `WM_ENABLE`, and
 * neither the focus nor the capture kept.
 */
export async function EnableWindow(this: any, hwnd: number, fEnable: number) {
  const dialog = this.handles.resolve(hwnd);

  if (!(dialog instanceof RasterWindow)) {
    return FALSE;
  }

  const window = dialog.window;
  const was = window.style & User.WS_DISABLED ? TRUE : FALSE;
  const now = fEnable ? FALSE : TRUE;

  if (!fEnable) {
    await SendMessage.call(this, hwnd, WM_CANCELMODE, 0, 0);

    if (dialog.desktop.focus === window) {
      await focusNothing(this);
    }
  }

  if (was !== now) {
    /* Its icon's title with it, where it has one: USER keeps the two alike
     * (`USER.EXE` seg1 `6f8c`-`6f8f`, `6fac`-`6faf`), so that a title, which
     * sends its presses on to its icon, takes none while the icon is
     * disabled. **Recorded** by `titledis`: the title of a disabled window's
     * icon is disabled, and a press on it sends the window nothing. */
    for (const each of [window, window.iconTitle].filter(Boolean)) {
      each.style = fEnable ? each.style & ~User.WS_DISABLED : each.style | User.WS_DISABLED;
    }

    const windowClass = this.handles.retrieve(dialog.options.windowClass);

    if (windowClass) {
      await this.scheduler.callWndProc(windowClass, hwnd, User.WM_ENABLE, fEnable ? 1 : 0, 0);
    }
  }

  return was;
}

/**
 * The window a child window is inside; for a pop-up, its owner; for an
 * overlapped window, nought, owned or not (`ownerpos`). The Visual Basic
 * runtime places a form by its "parent": given its hidden owner, it
 * placed Four Seasons' form 320 pixels to the left.
 */
export function GetParent(this: any, hwnd: number) {
  const dialog = this.handles.resolve(hwnd);

  if (!(dialog instanceof RasterWindow)) {
    return 0;
  }

  if (dialog.window.parent) {
    return dialog.window.parent.hwnd ?? 0;
  }

  /* A child with no parent here is a child of the desktop window, as a combo
   * box's list is, and its parent is the desktop window (`comboact`). */
  if ((dialog.window.style & (WS_CHILD | WS_POPUP)) === WS_CHILD) {
    return this.desktopWindow ?? 0;
  }

  return dialog.window.style & WS_POPUP ? (dialog.window.owner?.hwnd ?? 0) : 0;
}

/** A child's parent, or the owner of a window at the top: what `GetParent` answers (`owners`). */
export function parentOrOwner(dialog: RasterWindow) {
  return (dialog.window.parent ?? dialog.window.owner)?.hwnd ?? 0;
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

  /* The desktop's is the first program's, the shell's: its `InitApp` takes
   * the desktop's queue for its own (`USER.EXE` seg5 `03ac`), **recorded**
   * by `minis3`. */
  if (window instanceof DesktopHandle) {
    const first = Object.keys(this.scheduler?._tasks ?? {})[0];

    return first ? Number(first) & 0xffff : 0;
  }

  return window?.data?.hInstance ?? 0;
}
