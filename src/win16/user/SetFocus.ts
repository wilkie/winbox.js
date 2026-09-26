'use strict';

import { setFocus } from './dialogs.js';
import { RasterWindow } from './raster-window.js';

import { NULL } from '../consts.js';

import { User } from '../user.js';

export async function SetFocus(hwnd) {
  // Get the window itself
  const dialog = this.handles.resolve(hwnd);

  /* On the raster desktop: `WM_KILLFOCUS` to the window losing the focus,
   * `WM_SETFOCUS` to this one, and the answer is the one that had it. */
  if (dialog instanceof RasterWindow) {
    return setFocus(this, hwnd);
  }

  /* To nothing: `WM_KILLFOCUS` to the window that had it, naming none, and
   * the answer is that window. Recorded by the `activate` probe. */
  if (!hwnd && this.rasterDesktop) {
    const desktop = this.rasterDesktop;
    const previous = desktop.focus?.hwnd ?? 0;

    desktop.focus = null;

    if (previous) {
      const had = this.handles.resolve(previous);
      const kind = had && this.handles.retrieve(had.options.windowClass);

      if (kind) {
        await this.scheduler.callWndProc(kind, previous, User.WM_KILLFOCUS, 0, 0);
      }
    }

    return previous;
  }

  /* Not a window of the desktop's: nothing changes. */
  return NULL;
}
