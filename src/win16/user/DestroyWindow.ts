'use strict';

import { eraseDue } from './erase.js';
import { forgetActivePopup } from './enumerate.js';

import { callHooks, HSHELL_WINDOWDESTROYED, WH_SHELL } from './hooks.js';
import { deliverActivation } from './activation.js';
import { GlobalFree } from '../kernel/GlobalFree.js';
import { TRUE, FALSE } from '../consts.js';

import { User } from '../user.js';

import { killTimersOf } from './queue.js';
import { RasterWindow } from './raster-window.js';

/**
 * The **DestroyWindow** function destroys the specified window. The function
 * sends appropriate messages to the window to deactivate it and remove the
 * input focus. It also destroys the window's menu, flushes the application
 * queue, destroys outstanding timers, removes clipboard ownership, and breaks
 * the clipboard-viewer chain (if the window is at the top of the viewer chain).
 * It sends `WM_DESTROY` and `WM_NCDESTROY` messages to the window.
 *
 * If the given window is the parent of any windows, **DestroyWindow**
 * automatically destroys these child windows when it destroys the parent
 * window. The function destroys child windows first, and then the window
 * itself.
 *
 * The **DestroyWindow** function also destroys modeless dialog boxes created by
 * the {@link User.CreateDialog CreateDialog} function.
 *
 * Applications should always call the **DestroyWindow** function to destroy
 * their top-level windows before terminating.
 *
 * If the window being destroyed is a child window and does not have the
 * `WS_NOPARENTNOTIFY` style set, a `WM_PARENTNOTIFY` message is sent to the
 * parent.
 *
 * **See also**:
 * {@link User.CreateDialog CreateDialog}
 * {@link User.CreateWindow CreateWindow}
 * {@link User.CreateWindowEx CreateWindowEx}
 *
 * @static
 * @function DestroyWindow
 * @memberof User
 *
 * @param {Types.HWND} hwnd - Identifies the window to be destroyed.
 *
 * @return {Types.BOOL} The return value is nonzero if the function is
 *                      successful. Otherwise it is zero.
 */
export async function DestroyWindow(hwnd) {
  const dialog = this.handles.resolve(hwnd);

  if (!dialog) {
    return FALSE;
  }

  const send = (target: number, message: number, wParam = 0, lParam = 0) => {
    const window = this.handles.resolve(target);
    const windowClass = window && this.handles.retrieve(window.options.windowClass);

    return windowClass
      ? this.scheduler.callWndProc(windowClass, target, message, wParam, lParam)
      : Promise.resolve(0);
  };

  if (!(dialog instanceof RasterWindow)) {
    return FALSE;
  }

  const desktop = dialog.desktop;
  const window = dialog.window;

  forgetActivePopup(this, hwnd);

  /* The window and everything under it, the window first. */
  const tree: number[] = [];
  const gather = (of: any) => {
    tree.push(of.hwnd);

    for (const child of desktop.windows.filter((other: any) => other.parent === of && other.hwnd)) {
      gather(child);
    }
  };

  gather(window);

  /* A child tells its parent it is going. */
  if (window.parent?.hwnd) {
    await send(window.parent.hwnd, User.WM_PARENTNOTIFY, User.WM_DESTROY, hwnd & 0xffff);
  }

  /* Off the screen first, which makes another window the active one, with
   * its messages -- to this window too -- before `WM_DESTROY`. */
  desktop.hide(window);
  await eraseDue(this);
  await deliverActivation(this);

  if (this.rasterInput?.capture && tree.includes(this.rasterInput.capture.hwnd)) {
    this.rasterInput.capture = null;
  }

  /* The shell hooks are told of a window CreateWindow told them of, before
   * its `WM_DESTROY` (`shlhook`). */
  if (dialog.shellWindow) {
    await callHooks(this, WH_SHELL, HSHELL_WINDOWDESTROYED, hwnd, 0);
  }

  /* WM_DESTROY to the window, then to what is under it; WM_NCDESTROY the
   * other way, the window last. */
  for (const each of tree) {
    await send(each, User.WM_DESTROY);
  }

  for (const each of [...tree].reverse()) {
    await send(each, User.WM_NCDESTROY);
    killTimersOf(this, each);

    const gone = this.handles.resolve(each);

    /* The block its name was copied into, if USER made one (see `CreateWindow`). */
    if ((gone as any)?._nameBlock) {
      GlobalFree.call(this, (gone as any)._nameBlock);
      (gone as any)._nameBlock = 0;
    }

    if (gone instanceof RasterWindow) {
      gone.window.visible = false;
      desktop.destroy(gone.window);
    }

    this.handles.free(each);
  }

  return TRUE;
}
