'use strict';

import { Struct, UINT } from '../types.js';
import { POINT, RECT, User } from '../user.js';

import { MoveWindow } from './MoveWindow.js';
import { RasterWindow } from './raster-window.js';
import { ShowWindow } from './ShowWindow.js';

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

  lpwndpl.length = 22;
  lpwndpl.flags = 0;
  lpwndpl.showCmd =
    shown.state === 'maximized'
      ? User.SW_SHOWMAXIMIZED
      : shown.state === 'minimized'
        ? User.SW_SHOWMINIMIZED
        : User.SW_SHOWNORMAL;
  lpwndpl.ptMinPosition.x = -1;
  lpwndpl.ptMinPosition.y = -1;
  lpwndpl.ptMaxPosition.x = -1;
  lpwndpl.ptMaxPosition.y = -1;
  lpwndpl.rcNormalPosition.left = normal.left - x;
  lpwndpl.rcNormalPosition.top = normal.top - y;
  lpwndpl.rcNormalPosition.right = normal.left - x + normal.width;
  lpwndpl.rcNormalPosition.bottom = normal.top - y + normal.height;

  return 1;
}

/** The active top-level window: a document window inside one does not count. */
export function GetActiveWindow(this: any) {
  const desktop = this.rasterDesktop;
  const active = desktop?.windows.find((w: any) => w.active && w.visible && !w.parent);

  return active?.hwnd ?? 0;
}
