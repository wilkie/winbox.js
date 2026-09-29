'use strict';


import { User } from '../user.js';

/**
 * The messages of a change of active window, sent once the desktop has made
 * it. **Recorded** by the `activate` probe:
 *
 * * The window losing the activation gets `WM_NCACTIVATE` with 0, then
 *   `WM_ACTIVATE` with `WA_INACTIVE`; then the window gaining it gets
 *   `WM_NCACTIVATE` with 1, then `WM_ACTIVATE` with `WA_ACTIVE`. Each names
 *   the other window in its `lParam`'s low word -- `WM_NCACTIVATE` too, which
 *   nothing documents -- and 0 when there is none.
 * * `WM_ACTIVATEAPP`, with 1, comes first, when nothing of the task was
 *   active: with nothing active before, its `lParam` is 0.
 * * The focus is not USER's to move here: `DefWindowProc` answers an
 *   activating `WM_ACTIVATE` by giving the window the focus (`USER.EXE` seg1
 *   `5e84`), and a dialog restores its own (see `DefDlgProc`).
 * * A window destroyed with nothing left to activate gets nothing.
 * * A window made active that was not yet at the front is put there
 *   between the two (`showseq`), `between`.
 *
 * Documented, not recorded: `WA_CLICKACTIVE` for a click; `WM_ACTIVATEAPP`
 * with 0, and the other task, to the window losing the activation to another
 * task; the high word of `lParam`, whether the window is minimized.
 */

const WA_INACTIVE = 0;
const WA_ACTIVE = 1;
const WA_CLICKACTIVE = 2;
const WM_ACTIVATEAPP = 0x001c;
const WM_NCACTIVATE = 0x0086;

/** The task a window was made by. */
function taskOf(system: any, hwnd: number) {
  return system.handles.resolve(hwnd)?.data?.hInstance ?? 0;
}

/** Sends a message to a window, if it is still one. */
async function send(system: any, hwnd: number, message: number, wParam: number, lParam: number) {
  const target = system.handles.resolve(hwnd);
  const windowClass = target && system.handles.retrieve(target.options?.windowClass);

  if (windowClass) {
    await system.scheduler.callWndProc(windowClass, hwnd, message, wParam, lParam);
  }
}

/** Sends what the desktop's last change of active window calls for. */
export async function deliverActivation(system: any, between?: () => Promise<void>) {
  const desktop = system.rasterDesktop;
  const pending = desktop?.pendingActivation;

  if (!pending) {
    return;
  }

  desktop.pendingActivation = null;

  const from = pending.from;
  const to = desktop.windows.find((w: any) => w.active && w.visible && !w.parent && !w.titleOf) ?? null;

  if (from !== to && to) {
    const fromHwnd = from?.hwnd ?? 0;
    const toHwnd = to.hwnd ?? 0;
    const minimized = (window: any) => (window.state === 'minimized' ? 0x10000 : 0);
    const fromTask = fromHwnd ? taskOf(system, fromHwnd) : 0;
    const toTask = taskOf(system, toHwnd);

    if (fromHwnd) {
      await send(system, fromHwnd, WM_NCACTIVATE, 0, toHwnd);
      await send(system, fromHwnd, User.WM_ACTIVATE, WA_INACTIVE, (minimized(from) | toHwnd) >>> 0);

      if (fromTask !== toTask) {
        await send(system, fromHwnd, WM_ACTIVATEAPP, 0, toTask);
      }
    }

    /* What the window coming to the front is told as it is put there, when
     * that is still to be done: see `showRaster`. */
    await between?.();

    if (!fromHwnd || fromTask !== toTask) {
      await send(system, toHwnd, WM_ACTIVATEAPP, 1, fromTask);
    }

    await send(system, toHwnd, WM_NCACTIVATE, 1, fromHwnd);
    await send(
      system,
      toHwnd,
      User.WM_ACTIVATE,
      pending.click ? WA_CLICKACTIVE : WA_ACTIVE,
      (minimized(to) | fromHwnd) >>> 0
    );
  }

  /* A focus left on a window no longer shown, by a window procedure that took
   * none, is no focus. */
  const focus = desktop.focus;

  if (focus && (!desktop.windows.includes(focus) || !focus.visible)) {
    desktop.focus = null;
  }
}
