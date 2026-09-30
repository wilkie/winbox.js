'use strict';

import { User } from '../user.js';

import { Painter } from './painter.js';
import { nextMessage } from './queue.js';
import { RasterWindow } from './raster-window.js';
import { positionRaster } from './window-state.js';

/**
 * A window moved or sized: what `DefWindowProc` does for `SC_MOVE` and
 * `SC_SIZE`, from the keyboard or with the mouse on the caption or the frame.
 *
 * Like a menu, it is modal: the loop takes the program's messages until it
 * ends, with Enter or the mouse's release, or Escape, which leaves the window
 * where it was.
 *
 * Measured by the `sizing` probe on four displays: from the keyboard each
 * arrow moves half of `SM_CXSIZE` or `SM_CYSIZE` -- 9 pixels, or 8 down on the
 * EGA and Hercules -- and sizing, the first arrow picks the edge and the
 * rest move it, an arrow on the other axis adding that edge. Not measured:
 * the outline drawn while the window moves. Windows' loop does not dispatch
 * a timer, so the probe cannot capture from inside it; the outline here is
 * the window's rectangle inverted, a frame's width thick, and is this
 * implementation's.
 */

const SM_CXSIZE = 30;
const SM_CYSIZE = 31;
const SM_CXFRAME = 32;
const SM_CXMINTRACK = 34;
const SM_CYMINTRACK = 35;

const VK_RETURN = 0x0d;
const VK_ESCAPE = 0x1b;
const VK_LEFT = 0x25;
const VK_UP = 0x26;
const VK_RIGHT = 0x27;
const VK_DOWN = 0x28;

export const HTLEFT = 10;
export const HTRIGHT = 11;
export const HTTOP = 12;
export const HTTOPLEFT = 13;
export const HTTOPRIGHT = 14;
export const HTBOTTOM = 15;
export const HTBOTTOMLEFT = 16;
export const HTBOTTOMRIGHT = 17;

/** Which edges a sizing hit moves. */
const EDGES: Record<number, { left?: true; right?: true; top?: true; bottom?: true }> = {
  [HTLEFT]: { left: true },
  [HTRIGHT]: { right: true },
  [HTTOP]: { top: true },
  [HTBOTTOM]: { bottom: true },
  [HTTOPLEFT]: { top: true, left: true },
  [HTTOPRIGHT]: { top: true, right: true },
  [HTBOTTOMLEFT]: { bottom: true, left: true },
  [HTBOTTOMRIGHT]: { bottom: true, right: true },
};

const SWP_NOSIZE = 0x0001;
const SWP_NOZORDER = 0x0004;
const SWP_NOACTIVATE = 0x0010;

export type TrackStart =
  | { mode: 'move' | 'size'; keyboard: true }
  | { mode: 'move'; keyboard: false; x: number; y: number }
  | { mode: 'size'; keyboard: false; x: number; y: number; hit: number };

/** Moves or sizes a window until let go; answers whether it changed. */
export async function trackWindow(system: any, hwnd: number, start: TrackStart) {
  const owner = system.handles.resolve(hwnd);

  if (!(owner instanceof RasterWindow)) {
    return false;
  }

  const desktop = owner.desktop;
  const window = owner.window;
  const input = system.rasterInput;
  const metric = (index: number) => desktop.environment.metric(index);
  const rect = {
    left: window.left,
    top: window.top,
    right: window.left + window.width,
    bottom: window.top + window.height,
  };
  const original = { ...rect };
  const edges: { left?: true; right?: true; top?: true; bottom?: true } =
    start.mode === 'move'
      ? { left: true, right: true, top: true, bottom: true }
      : 'hit' in start
        ? { ...EDGES[start.hit] }
        : {};
  let last = 'x' in start ? { x: start.x, y: start.y } : null;
  let done = false;
  let cancelled = false;

  /* The outline, drawn by inverting: drawing it again takes it away. */
  const thickness = metric(SM_CXFRAME);
  let drawn: typeof rect | null = null;

  const outline = (box: typeof rect) => {
    const painter = new Painter(
      desktop.screen,
      0,
      0,
      desktop.screen.width,
      desktop.screen.height,
      desktop.environment
    );
    const t = Math.min(thickness, (box.right - box.left) >> 1, (box.bottom - box.top) >> 1);

    painter.invert(box.left, box.top, box.right, box.top + t);
    painter.invert(box.left, box.bottom - t, box.right, box.bottom);
    painter.invert(box.left, box.top + t, box.left + t, box.bottom - t);
    painter.invert(box.right - t, box.top + t, box.right, box.bottom - t);
  };

  const redraw = () => {
    if (drawn) {
      outline(drawn);
    }

    drawn = { ...rect };
    outline(drawn);
  };

  const shift = (dx: number, dy: number) => {
    if (edges.left) rect.left += dx;
    if (edges.right) rect.right += dx;
    if (edges.top) rect.top += dy;
    if (edges.bottom) rect.bottom += dy;

    /* Sized no smaller than the least a window may be tracked to. */
    if (start.mode === 'size') {
      const minWidth = metric(SM_CXMINTRACK);
      const minHeight = metric(SM_CYMINTRACK);

      if (rect.right - rect.left < minWidth) {
        if (edges.left) rect.left = rect.right - minWidth;
        else rect.right = rect.left + minWidth;
      }

      if (rect.bottom - rect.top < minHeight) {
        if (edges.top) rect.top = rect.bottom - minHeight;
        else rect.bottom = rect.top + minHeight;
      }
    }

    redraw();
  };

  const previousCapture = input?.capture ?? null;

  if (input) {
    input.capture = window;
  }

  redraw();

  while (!done) {
    const msg = await nextMessage(system);

    if (!msg) {
      break;
    }

    if (msg.message === User.WM_KEYDOWN || msg.message === User.WM_SYSKEYDOWN) {
      key(msg.wParam);
      continue;
    }

    /* The pointer, in either form: the page posts each mouse event as it
     * happens, hit-tested then, so a release that came before this loop took
     * the capture is still the non-client message it was posted as. Windows
     * hit-tests when a message is taken, and has no such case. */
    const moved = msg.message === User.WM_MOUSEMOVE || msg.message === User.WM_NCMOUSEMOVE;
    const released = msg.message === User.WM_LBUTTONUP || msg.message === User.WM_NCLBUTTONUP;

    if (moved || released) {
      if (last) {
        shift(msg.pt.x - last.x, msg.pt.y - last.y);
        last = { x: msg.pt.x, y: msg.pt.y };
      }

      if (released) {
        done = true;
      }

      continue;
    }

    if (
      msg.message === User.WM_KEYUP ||
      msg.message === User.WM_SYSKEYUP ||
      msg.message === User.WM_CHAR ||
      msg.message === User.WM_LBUTTONDOWN
    ) {
      continue;
    }

    const target = system.handles.resolve(msg.hwnd);

    if (target) {
      await system.scheduler.callWndProc(
        system.handles.retrieve(target.options.windowClass),
        msg.hwnd,
        msg.message,
        msg.wParam,
        msg.lParam
      );
    }
  }

  if (drawn) {
    outline(drawn);
  }

  if (input) {
    input.capture = previousCapture;
  }

  const final = cancelled ? original : rect;
  const changed =
    final.left !== window.left ||
    final.top !== window.top ||
    final.right - final.left !== window.width ||
    final.bottom - final.top !== window.height;

  /* Put where it was let go as `SetWindowPos` puts it, and told so by that:
   * moved and not sized, it gets `WM_MOVE` and no `WM_SIZE` (`iconclk`). */
  if (changed) {
    const parent = window.parent;
    const x = parent ? parent.left + parent.client.left : 0;
    const y = parent ? parent.top + parent.client.top : 0;
    const width = final.right - final.left;
    const height = final.bottom - final.top;
    const sized = width !== window.width || height !== window.height;

    await positionRaster(
      system,
      hwnd,
      owner,
      0,
      final.left - x,
      final.top - y,
      width,
      height,
      SWP_NOZORDER | SWP_NOACTIVATE | (sized ? 0 : SWP_NOSIZE)
    );
  }

  return changed;

  function key(code: number) {
    const stepX = metric(SM_CXSIZE) >> 1;
    const stepY = metric(SM_CYSIZE) >> 1;

    switch (code) {
      case VK_RETURN:
        done = true;
        return;

      case VK_ESCAPE:
        cancelled = true;
        done = true;
        return;

      case VK_LEFT:
      case VK_RIGHT: {
        /* Sizing: the first arrow on an axis picks its edge; the rest move it. */
        if (start.mode === 'size' && !edges.left && !edges.right) {
          if (code === VK_LEFT) edges.left = true;
          else edges.right = true;
          redraw();
          return;
        }

        shift(code === VK_LEFT ? -stepX : stepX, 0);
        return;
      }

      case VK_UP:
      case VK_DOWN: {
        if (start.mode === 'size' && !edges.top && !edges.bottom) {
          if (code === VK_UP) edges.top = true;
          else edges.bottom = true;
          redraw();
          return;
        }

        shift(0, code === VK_UP ? -stepY : stepY);
      }
    }
  }
}
