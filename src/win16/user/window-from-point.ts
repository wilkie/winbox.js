'use strict';

import { User } from '../user.js';
import { GetDesktopWindow } from './GetDesktopWindow.js';
import { RasterWindow } from './raster-window.js';

/**
 * Which window a point is on. **Recorded** by `winpoint`:
 *
 * * `WindowFromPoint` answers the top-level window that shows at the point
 *   of the screen -- disabled or not, frame and caption as well -- then the
 *   child under it, and that child's, and so on. A hidden child, a disabled
 *   one, a static control and a group box are passed over, and what lies
 *   beneath answers; nothing inside a disabled window is looked at. Where no
 *   window shows it answers the desktop window, and off the screen nought.
 * * `ChildWindowFromPoint` looks only at a window's own children, hidden,
 *   disabled or not: the first whose rectangle holds the point, a point of
 *   the window's client area, or else the window itself; nought for a point
 *   outside the client area.
 */

const signed = (value: number) => (value << 16) >> 16;

const BS_GROUPBOX = 7;

/** The window's children, those in front first. */
function childrenOf(desktop: any, window: any) {
  return desktop.windows.filter((other: any) => other.parent === window);
}

const holds = (window: any, x: number, y: number) =>
  x >= window.left &&
  y >= window.top &&
  x < window.left + window.width &&
  y < window.top + window.height;

/** A child `WindowFromPoint` passes over: hidden, or a control that lets the mouse through. */
function passedOver(window: any) {
  const kind = window.control?.className;

  return (
    !window.visible ||
    kind === 'STATIC' ||
    (kind === 'BUTTON' && (window.control.style & 0x0f) === BS_GROUPBOX)
  );
}

export function WindowFromPoint(this: any, pt: number) {
  const desktop = this.rasterDesktop;
  const x = signed(pt & 0xffff);
  const y = signed((pt >>> 16) & 0xffff);

  if (!desktop || x < 0 || y < 0 || x >= desktop.screen.width || y >= desktop.screen.height) {
    return 0;
  }

  let found = desktop.windowAt(x, y);

  if (!found) {
    return GetDesktopWindow.call(this);
  }

  while (found.parent) {
    found = found.parent;
  }

  /* Nothing inside a disabled window is looked at, the top-level one too. */
  while (!(found.style & User.WS_DISABLED)) {
    const next = childrenOf(desktop, found).find(
      (child: any) => !passedOver(child) && holds(child, x, y)
    );

    if (!next || next.style & User.WS_DISABLED) {
      break;
    }

    found = next;
  }

  return found.hwnd ?? 0;
}

export function ChildWindowFromPoint(this: any, hwnd: number, pt: number) {
  const window = this.handles.resolve(hwnd);

  if (!(window instanceof RasterWindow)) {
    return 0;
  }

  const shown = window.window;
  const x = signed(pt & 0xffff);
  const y = signed((pt >>> 16) & 0xffff);

  if (x < 0 || y < 0 || x >= shown.clientWidth || y >= shown.clientHeight) {
    return 0;
  }

  const sx = shown.left + shown.client.left + x;
  const sy = shown.top + shown.client.top + y;
  const child = childrenOf(window.desktop, shown).find((other: any) => holds(other, sx, sy));

  return (child ?? shown).hwnd ?? 0;
}
