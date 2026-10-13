'use strict';

import { setFocus } from './dialogs.js';
import { askCbt, HCBT_SETFOCUS } from './hooks.js';
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

  if (!hwnd && this.rasterDesktop) {
    return setFocusNothing(this);
  }

  /* Not a window of the desktop's: nothing changes. */
  return NULL;
}

/**
 * `SetFocus` with nought, as USER calls it itself too (`USER.EXE` seg1
 * `381d`): the computer-based training hooks asked first, `HCBT_SETFOCUS`
 * with nought and the window that has the focus, if any; non-nought in AX,
 * nothing changes and the answer is nought (`382f`-`3840`; **recorded** by
 * `cbthook`, through `SetFocus` and as a window with the focus in it is
 * minimized).
 */
export async function setFocusNothing(system: any) {
  const had = system.rasterDesktop?.focus?.hwnd ?? 0;

  if ((await askCbt(system, HCBT_SETFOCUS, 0, had)).answer & 0xffff) {
    return NULL;
  }

  return focusNothing(system);
}

/**
 * The focus taken to nothing: `WM_KILLFOCUS` to the window that had it,
 * naming none, and the answer is that window. Recorded by the `activate`
 * probe.
 */
export async function focusNothing(system: any) {
  const desktop = system.rasterDesktop;
  const previous = desktop?.focus?.hwnd ?? 0;

  if (desktop) {
    desktop.focus = null;
  }

  if (previous) {
    const had = system.handles.resolve(previous);
    const kind = had && system.handles.retrieve(had.options.windowClass);

    if (kind) {
      await system.scheduler.callWndProc(kind, previous, User.WM_KILLFOCUS, 0, 0);
    }
  }

  return previous;
}
