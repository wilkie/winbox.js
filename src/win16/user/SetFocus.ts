'use strict';

import { setFocus } from './dialogs.js';
import { RasterWindow } from './raster-window.js';

import { HWND } from '../types.js';

import { NULL } from '../consts.js';

import { User } from '../user.js';

import { FixedWindow } from '../../windows/fixed-window.js';

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

  // Cannot find the dialog; bail.
  if (!dialog) {
    return hwnd;
  }

  // Get the window/class for the handle
  const windowClass = this.handles.retrieve(dialog.options.windowClass);

  // Set the focus on the window (and suppress focus event, since it was not
  // via a user event.)

  // If it already has focus, bail.
  if (dialog.focused) {
    return hwnd;
  }

  // Make sure the dialog has focus.
  dialog.focus(true);

  // Now we determine the messages we are sending.
  const ret = [];

  // If the application is receiving focus
  await this.scheduler.callWndProc(windowClass, hwnd, User.WM_QUERYNEWPALETTE, 0, 0);
  await this.scheduler.callWndProc(windowClass, hwnd, User.WM_WINDOWPOSCHANGING, 0, 0);
  await this.scheduler.callWndProc(windowClass, hwnd, User.WM_ACTIVATEAPP, 0, 0);

  // Now we do the normal activation, if a bordered window
  if (dialog instanceof FixedWindow) {
    await this.scheduler.callWndProc(windowClass, hwnd, User.WM_NCACTIVATE, 0, 0);
    await this.scheduler.callWndProc(windowClass, hwnd, User.WM_GETTEXT, 0, 0);
    // TODO: WA_CLICKACTIVE?
    // TODO: fMinimized/hwnd of deactivated window
    await this.scheduler.callWndProc(windowClass, hwnd, User.WM_ACTIVATE, User.WA_ACTIVE, 0);
  }

  // And the actual focus event
  await this.scheduler.callWndProc(windowClass, hwnd, User.WM_SETFOCUS, 0, 0);

  // And we check invalidated regions and repaint
  /*
    await this.scheduler.callWndProc(windowClass, hwnd, User.WM_NCPAINT, 0, 0);
    await this.scheduler.callWndProc(windowClass, hwnd, User.WM_GETTEXT, 0, 0);
    await this.scheduler.callWndProc(windowClass, hwnd, User.WM_ERASEBKGND, 0, 0);
    await this.scheduler.callWndProc(windowClass, hwnd, User.WM_PAINT, 0, 0);
    */

  // We need to send a few messages depending on what the focus is
  // If it is the main window of an application, we send a
  // WM_QUERYNEWPALETTE, WM_WINDOWPOSCHANGING, WM_ACTIVATEAPP,
  // WM_NCACTIVATE, WM_GETTEXT, WM_ACTIVATE, WM_SETFOCUS in that
  // order.

  // When the window proc returns...
  return NULL;
}
