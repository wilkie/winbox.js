'use strict';

import { Struct, UINT } from '../types.js';
import { POINT, RECT, User } from '../user.js';

import { activateWindow } from './window-state.js';
import { MoveWindow } from './MoveWindow.js';
import { RasterWindow } from './raster-window.js';
import { ShowWindow } from './ShowWindow.js';
import { SetWindowPos } from './window-state.js';

/**
 * Where a window goes and how it shows: `SetWindowPlacement` and
 * `GetWindowPlacement`, with the `WINDOWPLACEMENT` they share. Documented,
 * not measured. Program Manager places each of its group windows this way,
 * from what `PROGMAN.INI` kept.
 */
export class WINDOWPLACEMENT extends Struct {
  constructor() {
    super([
      ['length', UINT],
      ['flags', UINT],
      ['showCmd', UINT],
      ['ptMinPosition', POINT],
      ['ptMaxPosition', POINT],
      ['rcNormalPosition', RECT],
    ]);
  }
}

/**
 * The window's normal place -- its parent's client coordinates for a child
 * -- set, then shown as `showCmd` says: a window shown maximized or minimized
 * comes back to that place when restored.
 */
export async function SetWindowPlacement(this: any, hwnd: number, lpwndpl: any) {
  const window = this.handles.resolve(hwnd);

  if (!(window instanceof RasterWindow) || !lpwndpl) {
    return 0;
  }

  const rect = lpwndpl.rcNormalPosition;
  const shown = window.window;
  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;

  /* `WPF_SETMINPOSITION`: its icon goes at `ptMinPosition`, in its parent's
   * client area, as Program Manager places a group's icon where its file
   * says (`PROGMAN.EXE` seg4 `1f04`-`1f51`; `pmraw`, `pmfiles`). */
  if (lpwndpl.flags & 1) {
    const parent = shown.parent;

    shown.iconPlace = {
      left:
        ((lpwndpl.ptMinPosition.x << 16) >> 16) + (parent ? parent.left + parent.client.left : 0),
      top: ((lpwndpl.ptMinPosition.y << 16) >> 16) + (parent ? parent.top + parent.client.top : 0),
    };
    shown.iconWas = shown.iconPlace;
  }

  if (shown.state === 'normal') {
    await MoveWindow.call(this, hwnd, rect.left, rect.top, width, height, 0);
  } else {
    const parent = shown.parent;
    const x = parent ? parent.left + parent.client.left : 0;
    const y = parent ? parent.top + parent.client.top : 0;

    shown.restoreRect = { left: rect.left + x, top: rect.top + y, width, height };
  }

  await ShowWindow.call(this, hwnd, lpwndpl.showCmd);

  return 1;
}

/** The window's normal place and how it shows now. */
export function GetWindowPlacement(this: any, hwnd: number, lpwndpl: any) {
  const window = this.handles.resolve(hwnd);

  if (!(window instanceof RasterWindow) || !lpwndpl) {
    return 0;
  }

  const shown = window.window;
  const parent = shown.parent;
  const x = parent ? parent.left + parent.client.left : 0;
  const y = parent ? parent.top + parent.client.top : 0;
  const normal =
    shown.state === 'normal' || !shown.restoreRect
      ? { left: shown.left, top: shown.top, width: shown.width, height: shown.height }
      : shown.restoreRect;

  /* USER's checkpoint (`USER.EXE` seg14 `06a5`-`0738`): the icon's point
   * and the maximized one as they are or last were, -1,-1 for none; the
   * flag to restore to maximized (2) while the window is so. **Recorded**
   * by `wplace`. */
  const icon = shown.state === 'minimized' ? { left: shown.left, top: shown.top } : shown.iconWas;
  const max = shown.state === 'maximized' ? { left: shown.left, top: shown.top } : shown.maxWas;

  lpwndpl.length = 22;
  lpwndpl.flags = shown.state === 'maximized' ? 2 : 0;
  lpwndpl.showCmd =
    shown.state === 'maximized'
      ? User.SW_SHOWMAXIMIZED
      : shown.state === 'minimized'
        ? User.SW_SHOWMINIMIZED
        : User.SW_SHOWNORMAL;
  lpwndpl.ptMinPosition.x = icon ? icon.left - x : -1;
  lpwndpl.ptMinPosition.y = icon ? icon.top - y : -1;
  lpwndpl.ptMaxPosition.x = max ? max.left - x : -1;
  lpwndpl.ptMaxPosition.y = max ? max.top - y : -1;
  lpwndpl.rcNormalPosition.left = normal.left - x;
  lpwndpl.rcNormalPosition.top = normal.top - y;
  lpwndpl.rcNormalPosition.right = normal.left - x + normal.width;
  lpwndpl.rcNormalPosition.bottom = normal.top - y + normal.height;

  return 1;
}

const SWP_NOSIZE = 0x0001;
const SWP_NOZORDER = 0x0004;
const SWP_NOACTIVATE = 0x0010;

/** The corner of a window's parent's client area; the screen's at the top. */
function origin(shown: any) {
  const parent = shown.parent;

  return parent
    ? { x: parent.left + parent.client.left, y: parent.top + parent.client.top }
    : { x: 0, y: 0 };
}

function memory(system: any) {
  return system.machine.cpu.core;
}

function writeWords(system: any, far: number, words: number[]) {
  words.forEach((word, index) => {
    memory(system).write16(far >>> 16, ((far & 0xffff) + 2 * index) & 0xffff, word & 0xffff);
  });
}

function readWords(system: any, far: number, count: number) {
  return Array.from(
    { length: count },
    (_, index) =>
      (memory(system).read16(far >>> 16, ((far & 0xffff) + 2 * index) & 0xffff) << 16) >> 16
  );
}

/**
 * Ordinal 460: what `GetWindowPlacement` gives, three parts of it -- its
 * `showCmd` the answer, its normal place written to a `RECT` and its
 * icon's point to a `POINT`, each where given (**read out of `USER.EXE`**,
 * seg14 `0a85`-`0aec`, which fills a `WINDOWPLACEMENT` by seg14 `06a5`).
 * **Recorded** by `intpos`: 1, 2 or 3 as the window shows; the point
 * -1,-1 until it has been an icon, then where its icon is or last was,
 * in its parent's client area.
 */
export function GetInternalWindowPos(this: any, hwnd: number, lprc: number, lppt: number) {
  const window = this.handles.resolve(hwnd);

  if (!(window instanceof RasterWindow)) {
    return 0;
  }

  const shown = window.window;
  const { x, y } = origin(shown);
  const normal =
    shown.state === 'normal' || !shown.restoreRect
      ? { left: shown.left, top: shown.top, width: shown.width, height: shown.height }
      : shown.restoreRect;
  const icon = shown.state === 'minimized' ? { left: shown.left, top: shown.top } : shown.iconWas;

  if (lprc) {
    writeWords(this, lprc >>> 0, [
      normal.left - x,
      normal.top - y,
      normal.left - x + normal.width,
      normal.top - y + normal.height,
    ]);
  }

  if (lppt) {
    writeWords(this, lppt >>> 0, icon ? [icon.left - x, icon.top - y] : [-1, -1]);
  }

  return shown.state === 'minimized'
    ? User.SW_SHOWMINIMIZED
    : shown.state === 'maximized'
      ? User.SW_SHOWMAXIMIZED
      : User.SW_SHOWNORMAL;
}

/**
 * Ordinal 461: the window's normal place and its icon's point set, then
 * shown as `nCmdShow` says; 1 (**read out of `USER.EXE`**, seg14
 * `0aef`-`0bef`). The rectangle, where given, is its place restored. The
 * point, where given and its x not -1, is where its icon goes; else it
 * has none. An icon with a point goes there (`SWP_NOSIZE`,
 * `SWP_NOZORDER`, `SWP_NOACTIVATE`); a window neither an icon nor
 * maximized goes to the rectangle (`SWP_NOZORDER`). **Recorded** by
 * `intpos`.
 */
export async function SetInternalWindowPos(
  this: any,
  hwnd: number,
  nCmdShow: number,
  lprc: number,
  lppt: number
) {
  const window = this.handles.resolve(hwnd);

  if (!(window instanceof RasterWindow)) {
    return 0;
  }

  const shown = window.window;
  const { x, y } = origin(shown);
  const rect = lprc ? readWords(this, lprc >>> 0, 4) : null;
  const point = lppt ? readWords(this, lppt >>> 0, 2) : null;

  if (rect && shown.state !== 'normal') {
    shown.restoreRect = {
      left: rect[0] + x,
      top: rect[1] + y,
      width: rect[2] - rect[0],
      height: rect[3] - rect[1],
    };
  }

  /* The point -1 in x is none (`0b3c`). */
  if (point && point[0] !== -1) {
    shown.iconPlace = { left: point[0] + x, top: point[1] + y };
    shown.iconWas = shown.iconPlace;
  } else {
    shown.iconPlace = null;
    shown.iconWas = null;
  }

  if (shown.state === 'minimized') {
    if (point && point[0] !== -1) {
      await SetWindowPos.call(
        this,
        hwnd,
        0,
        point[0],
        point[1],
        0,
        0,
        SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE
      );
    }
  } else if (shown.state !== 'maximized' && rect) {
    await SetWindowPos.call(
      this,
      hwnd,
      0,
      rect[0],
      rect[1],
      rect[2] - rect[0],
      rect[3] - rect[1],
      SWP_NOZORDER
    );
  }

  await ShowWindow.call(this, hwnd, nCmdShow);

  return 1;
}

/**
 * Makes a top-level window the active one, brought to the top, with the
 * messages that go with it (see `activation.ts`); answers the window that was
 * active. Recorded by the `activate` probe. A window hidden is made active
 * hidden: USER asks only that it is not a child (`USER.EXE` seg1 `38c5`,
 * `38f2`, then `3514`).
 */
export async function SetActiveWindow(this: any, hwnd: number) {
  const previous = GetActiveWindow.call(this);
  const window = this.handles.resolve(hwnd);

  /* Brought to the front between the two windows' messages where the first
   * window that shows is not it (`3674`-`3697`; `enddlg`: W, under O, is
   * asked and told 3). */
  if (window instanceof RasterWindow && !window.window.parent) {
    await activateWindow(this, window.window);
  }

  return previous;
}

/**
 * The active top-level window, shown or hidden: USER's word for it, as it is
 * (`USER.EXE` seg1 `818d`). A document window inside one does not count.
 */
export function GetActiveWindow(this: any) {
  return this.rasterDesktop?.activeTop?.hwnd ?? 0;
}
