'use strict';

import { LoadCursor, SetCursor } from './cursor-api.js';
import { SendMessage } from './SendMessage.js';
import { RasterWindow } from './raster-window.js';
import { GetActiveWindow, SetActiveWindow } from './placement.js';
import { SetWindowPos } from './window-state.js';
import { MessageBeep } from './enumerate.js';

/**
 * `WM_SETCURSOR`: the window under the mouse asked for the cursor as each
 * mouse message is taken for it, and what `DefWindowProc` answers.
 *
 * **Read out** of `USER.EXE`. The system queue's scan (seg1 `2aa2`) finds
 * the window under the mouse and its hit-test code (`71b9`): with the mouse
 * captured, the capturing window and `HTCLIENT`; else the window under it,
 * passing over a hidden window, and a disabled child, for what lies beneath
 * -- a disabled top-level window is `HTERROR` there and then, without
 * `WM_NCHITTEST`, an icon `HTCAPTION`, a window of another task `HTCLIENT`,
 * and any other window is sent `WM_NCHITTEST`. Then:
 *
 * * `HTERROR` and `HTNOWHERE` (`2ec5`): the window is sent `WM_SETCURSOR`
 *   naming itself, the hit-test code in the low word and the mouse message
 *   as the mouse made it -- `WM_MOUSEMOVE`, `WM_LBUTTONDOWN` and so on, not
 *   the non-client form, a double click as its press -- in the high; and the
 *   message is thrown away, whether the look takes messages or only looks
 *   at them (`PM_NOREMOVE`). Inside a system-modal window's own, no other.
 * * Any other message, taken (`2f59`, `2933`): with the mouse captured,
 *   nothing; else a press is first sent up as `WM_PARENTNOTIFY` from a
 *   child, then `WM_MOUSEACTIVATE` to the window and the activation it asks
 *   for, and then, press or move, `WM_SETCURSOR` as above. A look that only
 *   looks sends none of it: that comes when the message is taken.
 * * A message posted is not the mouse's, and sends nothing.
 *
 * A menu taking the mouse as it starts (seg17 `0177`, after
 * `WM_ENTERMENULOOP`, before `WM_INITMENU`; and seg10 `1f0b`, the mouse
 * taken back from another) sends its window `WM_SETCURSOR` naming itself,
 * `HTCAPTION` and no mouse message.
 *
 * `DefWindowProc` (seg1 `590a`), with the mouse message `M`:
 *
 * * `M` not nought and a border's code, 10 to 17: the sizing cursor its
 *   side calls for, and FALSE, asking no parent.
 * * Else a child asks its parent, with the same `wParam` and `lParam`, and
 *   answers TRUE when that does.
 * * `M` nought: the arrow, FALSE.
 * * `HTERROR` with the left button's press (`597c`): the first window
 *   after this one in the order of windows, going round, that is the same
 *   task's, enabled and shown -- if this window owns it, and it is not the
 *   window in front of all -- is brought up: this window put on top
 *   (`SetWindowPos` with `SWP_NOMOVE`, `SWP_NOSIZE` and `SWP_NOACTIVATE`)
 *   and that one made active. A beep when it was not, or the active window
 *   is the same after; with the right or the middle button's press, the
 *   beep alone. Then the arrow, FALSE.
 * * `HTCLIENT`: the cursor of the class of the window `wParam` names, if
 *   it has one; FALSE.
 * * Anything else: the arrow, FALSE.
 *
 * **Recorded** by `setcur` (moves), `titledis` (the menu's, and a disabled
 * icon's) and `curerr` (the rest).
 */

export const WM_SETCURSOR = 0x0020;

const HTERROR = -2;
const HTCLIENT = 1;

const WM_LBUTTONDOWN = 0x0201;
const WM_RBUTTONDOWN = 0x0204;
const WM_MBUTTONDOWN = 0x0207;

const IDC_ARROW = 32512;
const IDC_SIZENWSE = 32642;
const IDC_SIZENESW = 32643;
const IDC_SIZEWE = 32644;
const IDC_SIZENS = 32645;

/** The cursor each border shows, by hit-test code. */
const BORDERS = new Map([
  [10, IDC_SIZEWE],
  [11, IDC_SIZEWE],
  [12, IDC_SIZENS],
  [15, IDC_SIZENS],
  [13, IDC_SIZENWSE],
  [17, IDC_SIZENWSE],
  [14, IDC_SIZENESW],
  [16, IDC_SIZENESW],
]);

const WS_CHILD = 0x40000000;
const WS_DISABLED = 0x08000000;

const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_NOACTIVATE = 0x0010;

async function show(system: any, id: number) {
  SetCursor.call(system, await LoadCursor.call(system, 0, id));
}

/**
 * Before the mouse's input taken is handed over, where it is not the
 * mouse's as hit-tested (`mouse-scan.ts` asks for those): a move over no
 * window, the desktop window's, shows the arrow.
 */
export async function askForCursor(system: any, message: any) {
  const kind = message?.message ?? 0;

  if (kind !== 0x200 || system.rasterInput?.capture) {
    return;
  }

  if (!message.hwnd || message.hwnd === system.desktopWindow) {
    await show(system, IDC_ARROW);
  }
}

/**
 * The window a press on a disabled window brings up (seg1 `5745`): the
 * first after it in the order of windows, going round, of the same task,
 * enabled and shown -- if the disabled window owns it; else none.
 */
function ownedToBringUp(system: any, window: any) {
  const desktop = window.desktop;
  const tops = desktop.windows.filter((one: any) => !one.parent && one.hwnd);
  const at = tops.indexOf(window.window);
  const task = system.scheduler?.windowTask?.(window.window.hwnd);

  if (at < 0) {
    return null;
  }

  for (let step = 1; step < tops.length; step++) {
    const other = tops[(at + step) % tops.length];

    if (
      system.scheduler?.windowTask?.(other.hwnd) !== task ||
      other.style & WS_DISABLED ||
      !other.visible
    ) {
      continue;
    }

    for (let owner = other.owner; owner; owner = owner.owner) {
      if (owner === window.window) {
        return { found: other, front: tops[0] === other };
      }
    }

    return null;
  }

  return null;
}

/** What `DefWindowProc` does with `WM_SETCURSOR`; its answer, whether a parent set one. */
export async function defaultSetCursor(system: any, hwnd: number, wParam: number, lParam: number) {
  const window = system.handles.resolve(hwnd);

  if (!(window instanceof RasterWindow)) {
    return 0;
  }

  const hit = (lParam << 16) >> 16;
  const mouse = (lParam >>> 16) & 0xffff;

  if (mouse && BORDERS.has(hit)) {
    await show(system, BORDERS.get(hit)!);
    return 0;
  }

  const parent = window.window.parent?.hwnd;

  if (window.window.style & WS_CHILD && parent) {
    if (await SendMessage.call(system, parent, WM_SETCURSOR, wParam, lParam)) {
      return 1;
    }
  }

  if (mouse && hit === HTERROR) {
    if (mouse === WM_LBUTTONDOWN) {
      const up = ownedToBringUp(system, window);
      let beep = true;

      if (up && !up.front) {
        const active = GetActiveWindow.call(system);

        await SetWindowPos.call(
          system,
          hwnd,
          0,
          0,
          0,
          0,
          0,
          SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE
        );
        await SetActiveWindow.call(system, up.found.hwnd);
        beep = GetActiveWindow.call(system) === active;
      }

      if (beep) {
        MessageBeep.call(system, 0);
      }
    } else if (mouse === WM_RBUTTONDOWN || mouse === WM_MBUTTONDOWN) {
      MessageBeep.call(system, 0);
    }
  } else if (mouse && hit === HTCLIENT) {
    const named = system.handles.resolve(wParam);
    const windowClass =
      named instanceof RasterWindow ? system.handles.retrieve(named.options.windowClass) : null;
    const cursor = windowClass?.hCursor ?? 0;

    if (cursor) {
      SetCursor.call(system, cursor);
    }

    return 0;
  }

  await show(system, IDC_ARROW);
  return 0;
}
