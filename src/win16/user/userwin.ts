'use strict';

import { postMessage } from './queue.js';
import { MenuData } from './menu-data.js';
import { parseMenu } from './LoadMenu.js';
import { OBM_CHECK } from './menus.js';
import { RasterWindow } from './raster-window.js';

/**
 * USER's calls on windows and menus that `userwin` recorded first. See each.
 */

function windowOf(system: any, hwnd: number) {
  const window = hwnd ? system.handles.resolve(hwnd) : null;

  return window instanceof RasterWindow ? window : null;
}

/**
 * A window made the child of another, answering its parent before. It keeps
 * its place in its parent's client area: a child at (10, 12) in `A` is at
 * (10, 12) in `B` after (`userwin`). Nought for the desktop.
 */
export function SetParent(this: any, hwndChild: number, hwndNewParent: number) {
  const child = windowOf(this, hwndChild);

  if (!child) {
    return 0;
  }

  const old = child.window.parent?.hwnd ?? 0;
  const parent = windowOf(this, hwndNewParent);

  child.desktop.reparent(child.window, parent ? parent.window : null);

  return old;
}

/** The pop-ups a window owns hidden, or shown again (`userwin`). */
export function ShowOwnedPopups(this: any, hwnd: number, fShow: number) {
  const window = windowOf(this, hwnd);

  if (window) {
    window.desktop.hideOwned(window.window, !fShow);
  }
}

const QS_POSTMESSAGE = 0x08;
const QS_PAINT = 0x20;

/**
 * What a task's queue holds, in the high word, and what has come since it
 * last asked or took a message, in the low: a message posted is 8 in both,
 * and asked again, 8 in the high word only (`userwin`).
 */
export function GetQueueStatus(this: any, fuFlags: number) {
  const task = this.scheduler?.task;

  if (!task) {
    return 0;
  }

  let now = task._messages?.length ? QS_POSTMESSAGE : 0;

  for (const message of task._input ?? []) {
    now |=
      message.message >= 0x100 && message.message <= 0x108
        ? 0x01
        : message.message === 0x200
          ? 0x02
          : 0x04;
  }

  const desktop = this.rasterDesktop;

  if (
    desktop?.windows.some(
      (window: any) =>
        window.needsPaint &&
        window.hwnd &&
        this.scheduler.windowTask?.(window.hwnd) === this.scheduler.active
    )
  ) {
    now |= QS_PAINT;
  }

  const changed = task.queueChanges ?? 0;

  task.queueChanges = 0;

  return (((now & fuFlags & 0xffff) << 16) | (changed & fuFlags & 0xffff)) >>> 0;
}

/**
 * A message posted to a task rather than a window: `PeekMessage` takes it
 * with no window (`userwin`).
 */
export function PostAppMessage(
  this: any,
  hTask: number,
  uMsg: number,
  wParam: number,
  lParam: number
) {
  const task = hTask ? this.handles.resolve(hTask) : null;

  if (!task?.push) {
    return 0;
  }

  const posted = postMessage(this, 0, uMsg, wParam, lParam);

  return posted ? 1 : 0;
}

/** The window made system-modal, answering the one before: nought for none (`userwin`). */
export function SetSysModalWindow(this: any, hwnd: number) {
  const old = this._sysModal ?? 0;

  this._sysModal = hwnd && windowOf(this, hwnd) ? hwnd : 0;

  return old;
}

export function GetSysModalWindow(this: any) {
  const current = this._sysModal ?? 0;

  return current && windowOf(this, current) ? current : 0;
}

/**
 * A menu from a template in memory, as a menu resource is laid out: a
 * header of two words, then each item's flags, its identifier unless it
 * opens a pop-up, and its text (`userwin`).
 */
export function LoadMenuIndirect(this: any, lpMenuTemplate: number) {
  if (!lpMenuTemplate) {
    return 0;
  }

  const core = this.machine.cpu.core;
  const segment = (lpMenuTemplate >>> 16) & 0xffff;
  const offset = lpMenuTemplate & 0xffff;
  const length = Math.min(0x10000 - offset, 0x4000);
  const data = new Uint8Array(length);

  for (let at = 0; at < length; at++) {
    data[at] = core.read8(segment, (offset + at) & 0xffff);
  }

  const menu = parseMenu(data, length);

  menu.handle = this.handles.allocate(menu);

  return menu.handle;
}

const MF_BYPOSITION = 0x0400;
const MF_HILITE = 0x0080;

/**
 * An item of a window's menu bar lit or put out: `GetMenuState` has
 * `MF_HILITE`, 80h, while it is lit (`userwin`). Answers TRUE.
 */
export function HiliteMenuItem(
  this: any,
  hwnd: number,
  hmenu: number,
  uItem: number,
  fuHilite: number
) {
  const menu = this.handles.resolve(hmenu);

  if (!(menu instanceof MenuData)) {
    return 0;
  }

  const found = menu.find(uItem, fuHilite & MF_BYPOSITION);

  if (!found) {
    return 0;
  }

  found.item.flags = (found.item.flags & ~MF_HILITE) | (fuHilite & MF_HILITE);

  const window = windowOf(this, hwnd);

  if (window) {
    window.desktop.paintFrame(window.window);
  }

  return 1;
}

/**
 * The size of a menu's check mark, the display driver's `OBM_CHECK`, the
 * height in the high word: 14 by 14 on the VGA (`userwin`).
 */
export function GetMenuCheckMarkDimensions(this: any) {
  const check = this.rasterDesktop?.environment?.oem?.get(OBM_CHECK);
  const width = check?.width ?? 14;
  const height = check?.height ?? 14;

  return ((width & 0xffff) | ((height & 0xffff) << 16)) >>> 0;
}

/**
 * The bitmaps an item shows checked and unchecked, kept on the item; not
 * drawn yet. Answers TRUE (`userwin`).
 */
export function SetMenuItemBitmaps(
  this: any,
  hmenu: number,
  uItem: number,
  fuFlags: number,
  hbmUnchecked: number,
  hbmChecked: number
) {
  const menu = this.handles.resolve(hmenu);
  const found = menu instanceof MenuData ? menu.find(uItem, fuFlags & MF_BYPOSITION) : null;

  if (!found) {
    return 0;
  }

  (found.item as any).bitmaps = { unchecked: hbmUnchecked, checked: hbmChecked };

  return 1;
}

/**
 * The rectangle the cursor is kept in: the screen until `ClipCursor` gives
 * one, and again after it gives none (`userwin`). Kept, not yet enforced on
 * the pointer.
 */
export function ClipCursor(this: any, lprc: any) {
  this._cursorClip = lprc
    ? { left: lprc.left, top: lprc.top, right: lprc.right, bottom: lprc.bottom }
    : null;
}

export function GetClipCursor(this: any, lprc: any) {
  if (!lprc) {
    return;
  }

  const screen = this.rasterDesktop?.screen;

  Object.assign(
    lprc,
    this._cursorClip ?? {
      left: 0,
      top: 0,
      right: screen?.width ?? 640,
      bottom: screen?.height ?? 480,
    }
  );
}

/** A thousand, the timer's resolution as USER answers it (`userwin`). */
export function GetTimerResolution(this: any) {
  return 1000;
}

/**
 * A window's icons put in their slots again, from the one at the top, a
 * place set for any of them forgotten; answers how many (`userwin`: 0, 1, 2).
 */
export function ArrangeIconicWindows(this: any, hwnd: number) {
  const desktop = this.rasterDesktop;

  if (!desktop) {
    return 0;
  }

  const window = windowOf(this, hwnd);

  return desktop.arrangeIcons(window ? window.window : null);
}
