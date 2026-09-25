'use strict';

import { FALSE, TRUE } from '../consts.js';
import { User } from '../user.js';

import { type RasterWindow } from './raster-window.js';

/**
 * `ShowWindow` on the raster desktop: showing, hiding, maximizing, minimizing
 * and restoring a window, and what the window is told after -- `WM_SIZE` with
 * its client area's size and how it got it, and `WM_MOVE` with where its
 * client area is. How each looks is measured by the `sizing` probe; what the
 * window is sent, and in what order, is as documented, not recorded.
 */
export async function showRaster(system: any, hwnd: number, window: RasterWindow, show: number) {
  const desktop = window.desktop;
  const shown = window.window;
  const was = shown.visible;

  switch (show) {
    case User.SW_HIDE:
      desktop.hide(shown);
      return was ? TRUE : FALSE;

    case User.SW_SHOWMINIMIZED:
    case User.SW_MINIMIZE:
    case User.SW_SHOWMINNOACTIVE:
      desktop.minimize(shown);
      desktop.show(shown);
      break;

    case User.SW_SHOWMAXIMIZED:
      desktop.maximize(shown);
      desktop.show(shown);
      break;

    case User.SW_SHOWNORMAL:
    case User.SW_RESTORE:
      desktop.restore(shown);
      desktop.show(shown);
      break;

    default:
      desktop.show(shown);
      break;
  }

  await notifySize(system, hwnd, window);

  return was ? TRUE : FALSE;
}

/** `WM_SIZE` and `WM_MOVE`, for a window whose place or state changed. */
export async function notifySize(system: any, hwnd: number, window: RasterWindow) {
  const shown = window.window;
  const windowClass = system.handles.retrieve(window.options.windowClass);
  const kind =
    shown.state === 'maximized'
      ? User.SIZE_MAXIMIZED
      : shown.state === 'minimized'
        ? User.SIZE_MINIMIZED
        : User.SIZE_RESTORED;
  const size = (shown.clientWidth & 0xffff) | ((shown.clientHeight & 0xffff) << 16);
  const origin = shown.parent
    ? {
        x: shown.left - shown.parent.left - shown.parent.client.left + shown.client.left,
        y: shown.top - shown.parent.top - shown.parent.client.top + shown.client.top,
      }
    : { x: shown.left + shown.client.left, y: shown.top + shown.client.top };

  await system.scheduler.callWndProc(windowClass, hwnd, User.WM_SIZE, kind, size >>> 0);
  await system.scheduler.callWndProc(
    windowClass,
    hwnd,
    User.WM_MOVE,
    0,
    ((origin.x & 0xffff) | ((origin.y & 0xffff) << 16)) >>> 0
  );
}
