'use strict';

import { activateWindow, SetWindowPos, showRaster } from './window-state.js';

import { eraseDue } from './erase.js';
import { forgetActivePopup } from './enumerate.js';

import { askCbt, callHooks, HCBT_DESTROYWND, HSHELL_WINDOWDESTROYED, WH_SHELL } from './hooks.js';
import { deliverActivation } from './activation.js';
import { GlobalFree } from '../kernel/GlobalFree.js';
import { TRUE, FALSE } from '../consts.js';

import { User } from '../user.js';

import { killTimersOf } from './queue.js';
import { forgetHotKey } from './task-list.js';
import { RasterWindow } from './raster-window.js';
import { LockMyTask } from './lock-input.js';
import { SetSysModalWindow } from './userwin.js';
import { WS_EX_NOPARENTNOTIFY } from './CreateWindow.js';

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

  /* A task locked by `LockMyTask` is let go by any window destroyed,
   * before the hooks are asked (`USER.EXE` seg8 `0a3f`-`0a48`). **Recorded** by `sysdlg`: a
   * system-modal dialog made shown, which locks its task, and destroyed
   * without `EndDialog`, leaves no task locked. */
  if (this._lockMyTask) {
    LockMyTask.call(this, 0);
  }

  /* The computer-based training hooks asked first, `HCBT_DESTROYWND` and the
   * window; non-nought in AX, nothing is destroyed and the answer is nought
   * (`USER.EXE` seg8 `0a4d`-`0a5d`; **recorded** by `cbthook`). */
  if ((await askCbt(this, HCBT_DESTROYWND, hwnd, 0)).answer & 0xffff) {
    return FALSE;
  }

  const desktop = dialog.desktop;
  const window = dialog.window;

  forgetActivePopup(this, hwnd);

  /* A window at the top loses its hot key (`USER.EXE` seg8 `0e09`;
   * `hotkey`). */
  if (!window.parent) {
    forgetHotKey(this, hwnd);
  }

  /* The windows it owns first, then it (documented; `owners`). */
  for (const owned of desktop.windows.filter(
    (other: any) => other.owner === window && other.hwnd
  )) {
    await DestroyWindow.call(this, owned.hwnd);
  }

  /* The window and everything under it, the window first. */
  const tree: number[] = [];
  const gather = (of: any) => {
    tree.push(of.hwnd);

    for (const child of desktop.windows.filter((other: any) => other.parent === of && other.hwnd)) {
      gather(child);
    }
  };

  gather(window);

  /* A child tells its parent it is going, unless it was made
   * `WS_EX_NOPARENTNOTIFY`, as a dialog's controls are. */
  if (window.parent?.hwnd && !(window.exStyle & WS_EX_NOPARENTNOTIFY)) {
    await send(window.parent.hwnd, User.WM_PARENTNOTIFY, User.WM_DESTROY, hwnd & 0xffff);
  }

  /* Off the screen first, which makes another window the active one, with
   * its messages -- to this window too -- before `WM_DESTROY`: its owner,
   * for a window destroyed (`actnext`). */
  if (window.parent || window.titleOf) {
    (window as any).destroying = true;

    if (window.visible) {
      /* Hidden as `ShowWindow` hides a child (`USER.EXE` seg8 `0afd`), not
       * told with `WM_SHOWWINDOW` (`showseq`). */
      await showRaster(this, hwnd, dialog, User.SW_HIDE, false);
    } else {
      desktop.hide(window);
      await eraseDue(this);
      await deliverActivation(this);
    }
  } else {
    /* A window at the top is hidden with `SetWindowPos`, 97h, which makes no
     * other window active (seg8 `0b0d`-`0b33`); then, where it was the
     * active window, or no window is, the next window is made active, as
     * `ActivateWindow` makes one, before its `WM_DESTROY` (`0b86`-`0bd3`,
     * seg1 `38e4` with 2 and its owner for a pop-up that has one, else with
     * 3). With none to make active, no window is, and none has the focus.
     * **Recorded** by `enddlg`: a dialog destroyed while active is asked and
     * told 97h first, then the window made active is brought to the front,
     * asked and told 3; a dialog with no owner, ended, leaves no window
     * active, and its destruction makes the window active before it active.
     * Not followed: a task's windows destroyed as it ends (`[0E4h]`), whose
     * flags are 2097h and which makes none active. */
    if (window.visible) {
      await SetWindowPos.call(this, hwnd, 0, 0, 0, 0, 0, 0x97);
    }

    (window as any).destroying = true;

    if (desktop.activeTop === window || !desktop.activeTop) {
      const next = desktop.nextActiveOf(window);

      if (next) {
        await activateWindow(this, next, false, false);
      } else if (desktop.activeTop === window) {
        desktop.leaveNoneActive(window);
      }
    }

    await eraseDue(this);
  }

  if (this.rasterInput?.capture && tree.includes(this.rasterInput.capture.hwnd)) {
    this.rasterInput.capture = null;
  }

  /* The shell hooks are told of a window CreateWindow told them of, before
   * its `WM_DESTROY` (`shlhook`). */
  if (dialog.shellWindow) {
    await callHooks(this, WH_SHELL, HSHELL_WINDOWDESTROYED, hwnd, 0);
  }

  /* WM_DESTROY to the window, then to what is under it; WM_NCDESTROY to
   * each window's children, in their order, before it, the window last
   * (`enddlg`: a dialog's two controls, then the dialog). */
  for (const each of tree) {
    await send(each, User.WM_DESTROY);
  }

  const freed: number[] = [];
  const free = (of: any) => {
    for (const child of desktop.windows.filter((other: any) => other.parent === of && other.hwnd)) {
      free(child);
    }

    freed.push(of.hwnd);
  };

  free(window);

  for (const each of freed.filter((one) => tree.includes(one))) {
    await send(each, User.WM_NCDESTROY);
    killTimersOf(this, each);

    /* The system-modal window, gone, leaves none (seg8 `0cbc`-`0cc3`). */
    if ((this._sysModal ?? 0) === each) {
      await SetSysModalWindow.call(this, 0);
    }

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
