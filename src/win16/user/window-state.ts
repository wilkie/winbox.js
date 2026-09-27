'use strict';

import { deliverActivation } from './activation.js';
import { FALSE, TRUE } from '../consts.js';
import { User, WINDOWPOS } from '../user.js';

import { RasterWindow } from './raster-window.js';
import { eraseExposed, eraseShown } from './erase.js';

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
      await eraseExposed(system);
      await deliverActivation(system);
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

  /* A window shown active: its messages, and the focus they move. */
  await deliverActivation(system);
  await notifySize(system, hwnd, window);

  /* And erased now, with its children, as `SetWindowPos` ends. */
  await eraseShown(system, window);

  return was ? TRUE : FALSE;
}

/**
 * A window's frame changed where it is: a scroll bar of its own added or
 * taken away, by `ShowScrollBar` or `SetScrollRange`. **Recorded** by
 * `showsb`: the window is sent `WM_WINDOWPOSCHANGING`, `WM_NCCALCSIZE`,
 * `WM_WINDOWPOSCHANGED` and `WM_SIZE`, in that order and nothing else, and
 * then painted: its frame by `WM_NCPAINT` from `BeginPaint`, and its
 * background erased only where a bar went away and left client area that
 * had not been. A style that does not change sends nothing.
 */
export async function changeFrame(system: any, hwnd: number, window: RasterWindow, style: number) {
  const shown = window.window;

  if (style === shown.style) {
    return;
  }

  const windowClass = system.handles.retrieve(window.options.windowClass);
  const send = (message: number, wParam: number, lParam: any) =>
    windowClass
      ? system.scheduler.callWndProc(windowClass, hwnd, message, wParam, lParam)
      : Promise.resolve(0);
  const lost = (shown.style & ~style & 0x00300000) !== 0;
  const windowPos: any = new WINDOWPOS();
  const parent = shown.parent;

  windowPos.hwnd = hwnd;
  windowPos.hwndInsertAfter = 0;
  windowPos.x = parent ? shown.left - parent.left - parent.client.left : shown.left;
  windowPos.y = parent ? shown.top - parent.top - parent.client.top : shown.top;
  windowPos.cx = shown.width;
  windowPos.cy = shown.height;
  windowPos.flags = SWP_NOSIZE | SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED;

  await send(User.WM_WINDOWPOSCHANGING, 0, [windowPos]);

  /* Laid out again, which is not itself a reason to erase. */
  const erasing = shown.needsErase;

  shown.style = style;
  window.desktop.place(shown, shown.left, shown.top, shown.width, shown.height);
  await send(User.WM_NCCALCSIZE, 0, 0);
  await send(User.WM_WINDOWPOSCHANGED, 0, [windowPos]);

  const size = (shown.clientWidth & 0xffff) | ((shown.clientHeight & 0xffff) << 16);

  await send(User.WM_SIZE, User.SIZE_RESTORED, size >>> 0);

  shown.needsPaint = true;
  (shown as any).dirtyRect = undefined;
  (shown as any).needsNcPaint = true;
  shown.needsErase = erasing || lost;
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

/**
 * A window moved, sized, shown, hidden or brought forward on the raster
 * desktop: what `SetWindowPos` does, and `MoveWindow` through it.
 *
 * A child's place is in its parent's client area, as a program gives it.
 * `WM_WINDOWPOSCHANGING` goes first; then the window is placed, and when its
 * place or size changed, `WM_SIZE` and `WM_MOVE` follow. Not measured: the
 * order Windows sends these in beside `WM_WINDOWPOSCHANGED`, which is not sent
 * here, and what `SWP_NOREDRAW` leaves undrawn -- everything is drawn.
 */
export async function positionRaster(
  system: any,
  hwnd: number,
  window: RasterWindow,
  hwndInsertAfter: number,
  x: number,
  y: number,
  cx: number,
  cy: number,
  flags: number
) {
  const shown = window.window;
  const windowClass = system.handles.retrieve(window.options.windowClass);
  const parent = shown.parent;
  const offset = parent
    ? { x: parent.left + parent.client.left, y: parent.top + parent.client.top }
    : { x: 0, y: 0 };

  const windowPos: any = new WINDOWPOS();

  windowPos.hwnd = hwnd;
  windowPos.hwndInsertAfter = hwndInsertAfter;
  windowPos.x = x;
  windowPos.y = y;
  windowPos.cx = cx;
  windowPos.cy = cy;
  windowPos.flags = flags;

  if (windowClass) {
    await system.scheduler.callWndProc(windowClass, hwnd, User.WM_WINDOWPOSCHANGING, 0, [
      windowPos,
    ]);
  }

  const left = flags & SWP_NOMOVE ? shown.left : x + offset.x;
  const top = flags & SWP_NOMOVE ? shown.top : y + offset.y;
  const width = flags & SWP_NOSIZE ? shown.width : cx;
  const height = flags & SWP_NOSIZE ? shown.height : cy;
  const changed =
    left !== shown.left || top !== shown.top || width !== shown.width || height !== shown.height;

  if (changed) {
    window.desktop.place(shown, left, top, width, height);
  }

  let showing = false;

  if (flags & SWP_HIDEWINDOW && shown.visible) {
    window.desktop.hide(shown);
  } else if (flags & SWP_SHOWWINDOW && !shown.visible) {
    window.desktop.show(shown);
    showing = true;
  } else if (!(flags & SWP_NOZORDER) && !parent && shown.visible && !(flags & SWP_NOACTIVATE)) {
    window.desktop.show(shown);
  }

  await deliverActivation(system);

  if (changed) {
    await notifySize(system, hwnd, window);
  }

  await eraseExposed(system);

  if (showing) {
    await eraseShown(system, window);
  }

  return TRUE;
}

const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_NOZORDER = 0x0004;
const SWP_NOACTIVATE = 0x0010;
const SWP_FRAMECHANGED = 0x0020;
const SWP_SHOWWINDOW = 0x0040;
const SWP_HIDEWINDOW = 0x0080;

export async function SetWindowPos(
  this: any,
  hwnd: number,
  hwndInsertAfter: number,
  x: number,
  y: number,
  cx: number,
  cy: number,
  fuFlags: number
) {
  const window = this.handles.resolve(hwnd);

  /* A window of the raster desktop: one with a desktop and a place on it. */
  if (!window?.desktop || !window.window) {
    return FALSE;
  }

  return positionRaster(this, hwnd, window, hwndInsertAfter, x, y, cx, cy, fuFlags);
}

/**
 * Brings a window above the others: a top-level window to the top, made
 * the active one with the focus; a child above its siblings, the focus left
 * where it was. It answers `TRUE`. **Recorded** by `minis`, over two
 * top-level windows and two children.
 *
 * @param {Types.HWND} hwnd - The window.
 *
 * @returns {Types.BOOL} Whether there was such a window.
 */
export async function BringWindowToTop(this: any, hwnd: number) {
  const window = this.handles.resolve(hwnd);

  if (!(window instanceof RasterWindow)) {
    return FALSE;
  }

  if (window.window.parent) {
    window.desktop.raise(window.window);

    return TRUE;
  }

  return positionRaster(this, hwnd, window, 0, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE);
}
