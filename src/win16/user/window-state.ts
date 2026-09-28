'use strict';

import { deliverActivation } from './activation.js';
import { FALSE, TRUE } from '../consts.js';
import { User, WINDOWPOS } from '../user.js';

import { RasterWindow } from './raster-window.js';
import { eraseDue } from './erase.js';

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
      await eraseDue(system);
      await deliverActivation(system);
      return was ? TRUE : FALSE;

    case User.SW_SHOWMINIMIZED:
    case User.SW_MINIMIZE:
    case User.SW_SHOWMINNOACTIVE:
      /* The windows it owns hidden with it; and a window not active, minimized
       * with `SW_MINIMIZE`, keeps its place (`owners`). */
      desktop.hideOwned(shown, true);
      desktop.minimize(shown);

      if (show === User.SW_MINIMIZE && was && !shown.active) {
        desktop.showInPlace(shown);
      } else {
        desktop.show(shown);
      }

      break;

    case User.SW_SHOWMAXIMIZED:
      desktop.maximize(shown);
      desktop.show(shown);
      break;

    case User.SW_SHOWNORMAL:
    case User.SW_RESTORE:
      desktop.restore(shown);
      desktop.hideOwned(shown, false);
      desktop.show(shown);
      break;

    default:
      desktop.show(shown);
      break;
  }

  /* A window shown active: its messages, and the focus they move. */
  await deliverActivation(system);
  await notifySize(system, hwnd, window);

  /* And erased now, with whatever else is due, as `SetWindowPos` ends; and
   * a mouse move where the cursor is (`mousemv`). */
  await eraseDue(system);
  system.rasterInput?.nudge();

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

/**
 * What `DefWindowProc` does with `WM_WINDOWPOSCHANGED`: `WM_MOVE` when the
 * window moved, then `WM_SIZE` when it was sized, as the structure's flags
 * say (`defer`).
 */
export async function windowPosChanged(system: any, hwnd: number, flags: number) {
  const window = system.handles.resolve(hwnd);

  if (!(window instanceof RasterWindow)) {
    return;
  }

  const { size, origin, kind } = placeOf(window);
  const windowClass = system.handles.retrieve(window.options.windowClass);

  if (!(flags & SWP_NOMOVE)) {
    await system.scheduler.callWndProc(windowClass, hwnd, User.WM_MOVE, 0, origin);
  }

  if (!(flags & SWP_NOSIZE)) {
    await system.scheduler.callWndProc(windowClass, hwnd, User.WM_SIZE, kind, size);
  }
}

/** A window's client size, its client area's origin in its parent, and its state, as `WM_SIZE` and `WM_MOVE` carry them. */
function placeOf(window: RasterWindow) {
  const shown = window.window;
  const kind =
    shown.state === 'maximized'
      ? User.SIZE_MAXIMIZED
      : shown.state === 'minimized'
        ? User.SIZE_MINIMIZED
        : User.SIZE_RESTORED;
  const size = ((shown.clientWidth & 0xffff) | ((shown.clientHeight & 0xffff) << 16)) >>> 0;
  const at = shown.parent
    ? {
        x: shown.left - shown.parent.left - shown.parent.client.left + shown.client.left,
        y: shown.top - shown.parent.top - shown.parent.client.top + shown.client.top,
      }
    : { x: shown.left + shown.client.left, y: shown.top + shown.client.top };
  const origin = ((at.x & 0xffff) | ((at.y & 0xffff) << 16)) >>> 0;

  return { size, origin, kind };
}

/** `WM_SIZE` and `WM_MOVE`, for a window whose place or state changed. */
export async function notifySize(system: any, hwnd: number, window: RasterWindow) {
  const { size, origin, kind } = placeOf(window);
  const windowClass = system.handles.retrieve(window.options.windowClass);

  await system.scheduler.callWndProc(windowClass, hwnd, User.WM_SIZE, kind, size);
  await system.scheduler.callWndProc(windowClass, hwnd, User.WM_MOVE, 0, origin);
}

/**
 * A window moved, sized, shown, hidden or brought forward on the raster
 * desktop: what `SetWindowPos` does, and `MoveWindow` through it.
 *
 * A child's place is in its parent's client area, as a program gives it.
 * It is done in two halves, which `EndDeferWindowPos` runs for all its
 * windows in turn, first halves first (`defer`): `WM_WINDOWPOSCHANGING`,
 * and `WM_NCCALCSIZE` when a size is given; then the window is placed,
 * and `WM_WINDOWPOSCHANGED` follows when its place, size or showing
 * changed, from which `DefWindowProc` sends `WM_MOVE` and `WM_SIZE`. Not
 * measured: what `WM_NCCALCSIZE` carries, sent here as creating a window
 * sends it, and what `SWP_NOREDRAW` leaves undrawn -- everything is drawn.
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
  const move = await positionChanging(system, hwnd, window, hwndInsertAfter, x, y, cx, cy, flags);

  await positionChanged(system, [move]);

  return TRUE;
}

/** The first half of a window's move: what it is told before, and where it is to go. */
export async function positionChanging(
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

  /* As the window procedure left the structure: it may move the window
   * elsewhere, or keep it where it is (documented). Towers of the corpus
   * moves itself to CW_USEDEFAULT and puts itself back on the screen here. */
  if (windowClass) {
    x = (windowPos.x << 16) >> 16;
    y = (windowPos.y << 16) >> 16;
    cx = (windowPos.cx << 16) >> 16;
    cy = (windowPos.cy << 16) >> 16;
    flags = windowPos.flags & 0xffff;
  }

  const left = flags & SWP_NOMOVE ? shown.left : x + offset.x;
  const top = flags & SWP_NOMOVE ? shown.top : y + offset.y;
  const width = flags & SWP_NOSIZE ? shown.width : cx;
  const height = flags & SWP_NOSIZE ? shown.height : cy;

  /* Whenever a size is given, even the one the window has (`defer`). */
  if (windowClass && !(flags & SWP_NOSIZE)) {
    await system.scheduler.callWndProc(windowClass, hwnd, User.WM_NCCALCSIZE, 0, 0);
  }

  return { hwnd, window, windowPos, left, top, width, height, flags };
}

/**
 * The second half of the moves begun, each window placed and then told, in
 * the order they were begun.
 */
export async function positionChanged(
  system: any,
  moves: Awaited<ReturnType<typeof positionChanging>>[]
) {
  const placed: {
    move: (typeof moves)[number];
    moved: boolean;
    sized: boolean;
    showing: boolean;
  }[] = [];

  for (const move of moves) {
    const { window, left, top, width, height, flags } = move;
    const shown = window.window;
    const moved = left !== shown.left || top !== shown.top;
    const sized = width !== shown.width || height !== shown.height;
    const visible = shown.visible;

    if (moved || sized) {
      window.desktop.place(shown, left, top, width, height);
    }

    if (flags & SWP_HIDEWINDOW && shown.visible) {
      window.desktop.hide(shown);
    } else if (flags & SWP_SHOWWINDOW && !shown.visible) {
      window.desktop.show(shown);
    } else if (!shown.parent && shown.visible && !(flags & SWP_NOACTIVATE)) {
      /* Activated, and so brought to the top, unless asked not to be: even
       * with its place in the order left alone, the window moved under the
       * cursor is the one there after (`mousemv`). */
      window.desktop.show(shown);
    }

    placed.push({ move, moved, sized, showing: shown.visible !== visible });
  }

  await deliverActivation(system);

  /* Told only when something changed: a window deferred to where it
   * already was is sent `WM_WINDOWPOSCHANGING` and no more (`defer`). */
  for (const { move, moved, sized, showing } of placed) {
    if (!moved && !sized && !showing) {
      continue;
    }

    const { hwnd, window, flags } = move;
    const shown = window.window;
    const parent = shown.parent;
    const windowClass = system.handles.retrieve(window.options.windowClass);

    /* A structure of its own: the first half's is still tied to where it
     * was laid out, on a stack that has moved on. */
    const windowPos: any = new WINDOWPOS();

    windowPos.hwnd = hwnd;
    windowPos.hwndInsertAfter = move.windowPos.hwndInsertAfter;
    windowPos.x = parent ? shown.left - parent.left - parent.client.left : shown.left;
    windowPos.y = parent ? shown.top - parent.top - parent.client.top : shown.top;
    windowPos.cx = shown.width;
    windowPos.cy = shown.height;
    windowPos.flags = (flags | (moved ? 0 : SWP_NOMOVE) | (sized ? 0 : SWP_NOSIZE)) & 0xffff;

    await system.scheduler.callWndProc(windowClass, hwnd, User.WM_WINDOWPOSCHANGED, 0, [windowPos]);
  }

  await eraseDue(system);
  system.rasterInput?.nudge();
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
