'use strict';

import { ClipRegion } from '../../raster/clip-region.js';
import { paintMessage } from './paint-icon.js';
import { RasterWindow } from './raster-window.js';
import { paintsItself, type Desktop, type DesktopWindow } from './desktop.js';
import { cutToParents } from './invalidate-through.js';

/**
 * The **UpdateWindow** function updates the client area of the given window by
 * sending a `WM_PAINT` message to the window if the update region for the
 * window is not empty. The function sends a `WM_PAINT` message directly to the
 * window procedure of the given window, bypassing the application queue. If the
 * update region is empty, no message is sent.
 *
 * **Read out** (`USER.EXE` seg1 `a95d`, `4404`, `441d`, `444c`; `invchild`):
 * the windows in it are painted after it the same way, each and the windows
 * in it in turn, front to back. A window with `WS_EX_TRANSPARENT` that is
 * due waits while a window behind it is due (`4424`-`443e`, `44d8`-`4503`).
 * Before a window with an update region is painted, each window it is in
 * that is due, up to one with `WS_CLIPCHILDREN`, is validated where the
 * window is (`4515`), so as not to paint over it after.
 *
 * **See also**:
 * {@link User.ExcludeUpdateRgn ExcludeUpdateRgn}
 * {@link User.GetUpdateRect GetUpdateRect}
 * {@link User.GetUpdateRgn GetUpdateRgn}
 * {@link User.InvalidateRect InvalidateRect}
 * {@link User.InvalidateRgn InvalidateRgn}
 *
 * @static
 * @function UpdateWindow
 * @memberof User
 *
 * @param {Types.HWND} hwnd - Identifies the window to be updated.
 */
export async function UpdateWindow(hwnd) {
  const dialog = this.handles.resolve(hwnd);

  /* Only the raster desktop keeps what is due to be painted. */
  if (!(dialog instanceof RasterWindow)) {
    return;
  }

  if (dialog.window.exStyle & WS_EX_TRANSPARENT && behindDue(dialog.desktop, dialog.window)) {
    return;
  }

  await paintTree(this, dialog.desktop, dialog.window);
}

const WS_EX_TRANSPARENT = 0x00000020;
const WS_CLIPCHILDREN = 0x02000000;

const windowRect = (window: DesktopWindow): [number, number, number, number] => [
  window.left,
  window.top,
  window.left + window.width,
  window.top + window.height,
];

/** Whether a window behind this one among its siblings is due a paint. */
function behindDue(desktop: Desktop, window: DesktopWindow) {
  const siblings = desktop.windows.filter((other) => other.parent === window.parent);

  return siblings.slice(siblings.indexOf(window) + 1).some((other) => other.needsPaint);
}

/** Whether a window and every window it is in are shown, none of those minimized. */
function showing(window: DesktopWindow) {
  for (let at: DesktopWindow | null = window; at; at = at.parent) {
    if (!at.visible || (at !== window && at.state === 'minimized')) {
      return false;
    }
  }

  return true;
}

/**
 * Each window it is in that is due, up to one with `WS_CLIPCHILDREN`,
 * validated where it is (seg1 `4515`): its window rectangle cut to the client
 * areas it is in, through `RedrawWindow`'s walk with `RDW_VALIDATE` and
 * `RDW_NOCHILDREN`.
 */
function validateUnder(desktop: Desktop, window: DesktopWindow) {
  let region: ClipRegion | null = null;

  for (let up = window.parent; up; up = up.parent) {
    if (up.style & WS_CLIPCHILDREN) {
      return;
    }

    if (!up.needsPaint) {
      continue;
    }

    if (!region) {
      const rect = cutToParents(window, windowRect(window));

      if (!rect) {
        return;
      }

      region = ClipRegion.rect(rect[0], rect[1], rect[2], rect[3]);
    }

    if (!cutToParents(up, windowRect(up))) {
      return;
    }

    desktop.validThrough(up, region);
  }
}

/** A window painted where it is due, then the windows in it (seg1 `444c`). */
async function paintTree(system: any, desktop: Desktop, window: DesktopWindow) {
  if (paintsItself(window) && window.needsPaint && showing(window)) {
    const hwnd = window.hwnd;
    const dialog = system.handles.resolve(hwnd);
    const windowClass = system.handles.retrieve(dialog.options.windowClass);

    validateUnder(desktop, window);
    desktop.aboutToPaint(window);

    const { message, wParam } = paintMessage(system, hwnd);

    await system.scheduler.callWndProc(windowClass, hwnd, message, wParam, 0);

    /* Destroyed in its paint, nothing more (`44ac`). */
    const still = system.handles.resolve(hwnd);

    if (!(still instanceof RasterWindow) || still.window !== window) {
      return;
    }
  }

  for (const child of desktop.windows.filter((other) => other.parent === window)) {
    if (child.parent !== window) {
      continue;
    }

    if (child.exStyle & WS_EX_TRANSPARENT && child.needsPaint && behindDue(desktop, child)) {
      continue;
    }

    await paintTree(system, desktop, child);
  }
}
