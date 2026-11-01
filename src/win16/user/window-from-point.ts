'use strict';

import { GetDesktopWindow } from './GetDesktopWindow.js';
import { RasterWindow } from './raster-window.js';
import { hitWalk } from './mouse-scan.js';

/**
 * Which window a point is on. **Recorded** by `winpoint`:
 *
 * * `WindowFromPoint` answers the top-level window that shows at the point
 *   of the screen -- disabled or not, frame and caption as well -- then the
 *   child under it, and that child's, and so on. A hidden child, a disabled
 *   one, a static control and a group box are passed over, and what lies
 *   beneath answers; nothing inside a disabled window is looked at. Where no
 *   window shows it answers the desktop window, and off the screen nought.
 *   A minimized window answers for all its icon, its children visible or
 *   not (`iconkid`).
 * * `ChildWindowFromPoint` looks only at a window's own children, hidden,
 *   disabled or not: the first whose rectangle holds the point, a point of
 *   the window's client area, or else the window itself; nought for a point
 *   outside the client area.
 *
 * **Read out**: `WindowFromPoint` (`USER.EXE` seg1 `713c`) is USER's hit
 * test (`71b9`, `Desktop.hitSteps`) from the desktop window, with nowhere to
 * keep the hit-test code: the windows of the calling task it comes to are
 * asked `WM_NCHITTEST` as the mouse's are, a static control and a group box
 * passed over by their answer, `HTTRANSPARENT` (seg25 `24f2`, `1c9b`); a
 * window of another task answers without being asked. `ChildWindowFromPoint`
 * (seg1 `715b`) takes the point into the screen's terms by the window's
 * client area (`7166`-`7172`), answers nought for a point outside it
 * (`7175`-`7187`), and else the first child, front to back, whose
 * rectangle holds it, hidden and disabled alike (`7189`-`71a8`), or the
 * window.
 */

const signed = (value: number) => (value << 16) >> 16;

/** The window's children, those in front first. */
function childrenOf(desktop: any, window: any) {
  return desktop.windows.filter((other: any) => other.parent === window);
}

const holds = (window: any, x: number, y: number) =>
  x >= window.left &&
  y >= window.top &&
  x < window.left + window.width &&
  y < window.top + window.height;

export async function WindowFromPoint(this: any, pt: number) {
  const desktop = this.rasterDesktop;
  const x = signed(pt & 0xffff);
  const y = signed((pt >>> 16) & 0xffff);

  if (!desktop || x < 0 || y < 0 || x >= desktop.screen.width || y >= desktop.screen.height) {
    return 0;
  }

  const found = await hitWalk(this, x, y);

  /* The walk ended at no window: the system-modal window it began at
   * answered `HTTRANSPARENT` (seg1 `7282`-`7285`, `71c6`). */
  if (found === undefined) {
    return 0;
  }

  return found ? (found.window.hwnd ?? 0) : GetDesktopWindow.call(this);
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
