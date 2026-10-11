'use strict';

import { User } from '../user.js';
import { BitBlt } from '../gdi/BitBlt.js';
import { CreateBitmap } from '../gdi/CreateBitmap.js';
import { CreateCompatibleBitmap } from '../gdi/CreateCompatibleBitmap.js';
import { CreateCompatibleDC } from '../gdi/CreateCompatibleDC.js';
import { DeleteDC } from '../gdi/DeleteDC.js';
import { SelectObject } from '../gdi/SelectObject.js';
import { WinExec } from '../kernel/WinExec.js';

import { CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData } from './clipboard.js';
import { GetLastActivePopup, ownerOf, topLevel } from './enumerate.js';
import { GetWindowDC } from './GetWindowDC.js';
import { GetActiveWindow } from './placement.js';
import { PostMessage } from './PostMessage.js';
import { RasterWindow } from './raster-window.js';
import { ReleaseDC } from './ReleaseDC.js';
import { SendMessage } from './SendMessage.js';
import { GetSysModalWindow } from './userwin.js';
import { SetWindowPos } from './window-state.js';
import { IsWindow } from './window-queries.js';

/**
 * Switching between programs: the keys USER's system queue takes for
 * itself -- Control and Escape, Print Screen, and the hot keys -- and what
 * they lead to: the Task List, TASKMAN.EXE, started by `DefWindowProc` for
 * `SC_TASKLIST`; a copy of the screen on the clipboard; and
 * `SwitchToThisWindow`.
 *
 * **Read out** of `USER.EXE` (seg1 unless named) and `TASKMAN.EXE`, and
 * **recorded** by `tasklist`, `prtsc` and `hotkey`.
 */

export const SC_TASKLIST = 0xf130;
export const SC_HOTKEY = 0xf150;
const SC_RESTORE = 0xf120;
const WM_SYSCOMMAND = 0x0112;
export const WM_SETHOTKEY = 0x0032;
export const WM_GETHOTKEY = 0x0033;

const VK_SHIFT = 0x10;
const VK_CONTROL = 0x11;
const VK_MENU = 0x12;
const VK_ESCAPE = 0x1b;
const VK_SNAPSHOT = 0x2c;

const CF_BITMAP = 2;
const SRCCOPY = 0x00cc0020;
const WS_EX_TOPMOST = 0x0008;
const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_NOACTIVATE = 0x0010;
const HWND_TOP = 0;
const HWND_BOTTOM = 1;
const SW_SHOWNORMAL = 1;

/** A hot key as `WM_SETHOTKEY` takes it: the virtual key, and Shift, Control and Alt above. */
const HOTKEYF_SHIFT = 0x100;
const HOTKEYF_CONTROL = 0x200;
const HOTKEYF_ALT = 0x400;

interface HotKey {
  hwnd: number;
  key: number;
}

/** USER's table of hot keys, in the order given (`[174h]`, `[176h]` its count). */
function hotKeysOf(system: any): HotKey[] {
  return (system._hotKeys ??= []);
}

function held(system: any, vk: number) {
  return ((system._keyStates?.[vk] ?? 0) & 0x80) !== 0;
}

function windowOf(system: any, hwnd: number): RasterWindow | null {
  const handle = hwnd ? system.handles.resolve(hwnd) : null;

  return handle instanceof RasterWindow ? handle : null;
}

/**
 * The window a hot key is given to, if it is shown (seg14 `04e3`): the
 * first in the table with the key, and none if that one is hidden.
 */
function hotKeyWindow(system: any, key: number) {
  const found = hotKeysOf(system).find((one) => one.key === key);
  const window = found ? windowOf(system, found.hwnd) : null;

  return window?.window.visible ? found!.hwnd : 0;
}

/**
 * `WM_SETHOTKEY`, as `DefWindowProc` answers it (seg14 `0544`): -1, as the
 * low word alone, for Escape, Space or Tab; nought for a child; else the key
 * given the window, in place of the one it had, or taken away for nought,
 * and 1 -- or 2 where another window shown had the key already, which it
 * keeps. Measured by `hotkey`.
 */
export function setHotKey(system: any, hwnd: number, key: number) {
  key &= 0xffff;

  const vk = key & 0xff;

  if (vk === VK_ESCAPE || vk === 0x20 || vk === 0x09) {
    return 0xffff;
  }

  const window = windowOf(system, hwnd);

  if (!window || window.window.parent) {
    return 0;
  }

  const table = hotKeysOf(system);
  const other = key ? hotKeyWindow(system, key) : 0;
  const shared = other !== 0 && other !== hwnd;
  const at = table.findIndex((one) => one.hwnd === hwnd);

  if (at < 0) {
    if (key) {
      table.push({ hwnd, key });
    }
  } else if (key) {
    table[at].key = key;
  } else {
    /* The last one moved into its place (`05be`). */
    const last = table.pop()!;

    if (at < table.length) {
      table[at] = last;
    }
  }

  return shared ? 2 : 1;
}

/** `WM_GETHOTKEY` (seg14 `0647`): the window's hot key, or nought. */
export function getHotKey(system: any, hwnd: number) {
  return hotKeysOf(system).find((one) => one.hwnd === hwnd)?.key ?? 0;
}

/** A window at the top destroyed loses its hot key (seg8 `0e09`). */
export function forgetHotKey(system: any, hwnd: number) {
  const table = hotKeysOf(system);
  const at = table.findIndex((one) => one.hwnd === hwnd);

  if (at >= 0) {
    const last = table.pop()!;

    if (at < table.length) {
      table[at] = last;
    }
  }
}

/**
 * The keys USER's system queue takes for itself as a look comes to them
 * (seg1 `3090`-`3178`), before the key is given a window, and whether the
 * look takes it or only looks: a press only.
 *
 * * Any press but Alt's clears the flag that Alt was pressed alone, which
 *   `DefWindowProc` opens the menu by (`30a5`): Print Screen with Alt opens
 *   none.
 * * Escape with Control down, as the key-state table has it: `WM_SYSCOMMAND`
 *   with `SC_TASKLIST` posted to the active window, unless it is the
 *   system-modal window -- none where none is active -- and the key taken
 *   and thrown away (`30b5`-`30eb`). Its release reaches the focus, as a
 *   system key (`3192`).
 * * Print Screen: taken and thrown away, and the screen copied to the
 *   clipboard -- the active window only, for the scan code nought that the
 *   keyboard driver gives it with Alt (`30ee`-`311e`).
 * * A hot key, where no window is system-modal: the key and Shift, Control
 *   and Alt, held as the table has them, of a window shown in the table:
 *   `WM_SYSCOMMAND` with `SC_HOTKEY` and that window posted to the active
 *   window, and the key taken and thrown away (`3121`-`3178`).
 *
 * `leave` takes the event as USER's `4e2d` does: the journal hooks are
 * handed it, and the key-state table moves. Answers whether it was taken.
 * Not followed: USER's own system error box, during which none of these is
 * done -- here it takes the keys itself.
 */
export async function queueTakesKey(system: any, one: any, leave: () => Promise<void>) {
  const message = one.event?.message ?? one.message;

  if (message !== User.WM_KEYDOWN && message !== User.WM_SYSKEYDOWN) {
    return false;
  }

  const vk = one.wParam & 0xff;

  if (vk !== VK_MENU) {
    system._menuAlt = false;
  }

  const active = GetActiveWindow.call(system);
  const sysModal = GetSysModalWindow.call(system);

  if (vk === VK_ESCAPE && held(system, VK_CONTROL)) {
    if (active !== sysModal) {
      PostMessage.call(system, active, WM_SYSCOMMAND, SC_TASKLIST, 0);
    }

    await leave();
    return true;
  }

  if (vk === VK_SNAPSHOT) {
    const scan = ((one.event?.paramL ?? 0) >>> 8) & 0xff;

    await leave();
    await snapshot(system, scan === 1 ? system.desktopWindow : active);
    return true;
  }

  if (!sysModal && hotKeysOf(system).length) {
    const key =
      vk |
      (held(system, VK_MENU) ? HOTKEYF_ALT : 0) |
      (held(system, VK_CONTROL) ? HOTKEYF_CONTROL : 0) |
      (held(system, VK_SHIFT) ? HOTKEYF_SHIFT : 0);
    const window = hotKeyWindow(system, key);

    if (window) {
      PostMessage.call(system, active, WM_SYSCOMMAND, SC_HOTKEY, window);
      await leave();
      return true;
    }
  }

  return false;
}

/**
 * A copy of a window, or of the screen, put on the clipboard as a bitmap,
 * for Print Screen (seg41 `06b0`): of the window at the top it lies in;
 * nothing where the clipboard is open. The clipboard is opened for the
 * desktop window and emptied; the window's rectangle, as far as it is on
 * the screen, copied from a DC of the whole window into a bitmap compatible
 * with it -- a monochrome one where that cannot be made -- which is put on
 * as `CF_BITMAP`; then closed, and left with no owner (`08ec`). Measured by
 * `prtsc`: the screen at 640 by 480, a window moved part off it as much as
 * shows.
 *
 * Not followed: a palette device's palette, put on as `CF_PALETTE`, and the
 * message box USER shows where the bitmap cannot be made.
 */
async function snapshot(system: any, hwnd: number) {
  if (!hwnd) {
    return;
  }

  const desktop = hwnd === system.desktopWindow;
  let window = desktop ? null : windowOf(system, hwnd);

  if (!desktop) {
    while (window?.window.parent) {
      window = windowOf(system, window.window.parent.hwnd);
    }

    if (!window) {
      return;
    }
  }

  const clipboard = system._clipboard;

  if (clipboard?.open) {
    return;
  }

  if (!OpenClipboard.call(system, system.desktopWindow || 0xffff)) {
    return;
  }

  await EmptyClipboard.call(system);

  const width = system.display.width;
  const height = system.display.height;
  const rect = desktop
    ? { left: 0, top: 0, right: width, bottom: height }
    : {
        left: window!.x,
        top: window!.y,
        right: window!.x + window!.width,
        bottom: window!.y + window!.height,
      };
  const dc = GetWindowDC.call(system, desktop ? 0 : window!.window.hwnd);
  const cx = Math.min(rect.right, width) - Math.max(rect.left, 0);
  const cy = Math.min(rect.bottom, height) - Math.max(rect.top, 0);
  const memory = dc ? CreateCompatibleDC.call(system, dc) : 0;

  if (memory) {
    const bitmap =
      CreateCompatibleBitmap.call(system, dc, cx, cy) || CreateBitmap.call(system, cx, cy, 1, 1, 0);

    if (bitmap) {
      const was = SelectObject.call(system, memory, bitmap);

      BitBlt.call(
        system,
        memory,
        0,
        0,
        cx,
        cy,
        dc,
        rect.left < 0 ? -rect.left : 0,
        rect.top < 0 ? -rect.top : 0,
        SRCCOPY
      );
      SelectObject.call(system, memory, was);
      SetClipboardData.call(system, CF_BITMAP, bitmap);
    }
  }

  if (dc) {
    ReleaseDC.call(system, desktop ? 0 : window!.window.hwnd, dc);
  }

  await CloseClipboard.call(system);

  if (system._clipboard) {
    system._clipboard.owner = 0;
  }

  if (memory) {
    DeleteDC.call(system, memory);
  }
}

/**
 * `SC_TASKLIST`, as `DefWindowProc` carries it out (seg1 `050c`-`05f6`):
 * TASKMAN.EXE in the Windows directory started, shown normally, given the
 * point the command came with -- `x y`, as `" %d %d"` writes `lParam`'s
 * words; and where that fails, TASKMAN.EXE as `WinExec` finds it. The
 * hourglass shows meanwhile. Control and Escape give it (0, 0), which
 * TASKMAN takes as the middle of the screen; a double click on the desktop
 * its point (`tasklist`).
 */
export async function taskList(system: any, lParam: number) {
  const x = (lParam << 16) >> 16;
  const y = lParam >> 16;
  const tail = ` ${x} ${y}`;
  const answer = await WinExec.call(system, `C:\\WINDOWS\\TASKMAN.EXE${tail}`, SW_SHOWNORMAL);

  if ((answer & 0xffff) <= 32) {
    await WinExec.call(system, `TASKMAN.EXE${tail}`, SW_SHOWNORMAL);
  }
}

/**
 * `SC_HOTKEY` (seg1 `068a`): the window the key is given to, `lParam`, or
 * the pop-up it last had active where that is still a window, switched to
 * as Alt and Tab would.
 */
export async function hotKeyCommand(system: any, lParam: number) {
  const hwnd = lParam & 0xffff;

  if (!IsWindow.call(system, hwnd)) {
    return;
  }

  const popup = GetLastActivePopup.call(system, hwnd);

  await switchToThisWindow(system, IsWindow.call(system, popup) ? popup : hwnd, true);
}

/**
 * The next window at the top Alt and Escape would switch to from one
 * (seg23 `0c58`), front to back from it and round: shown; not topmost,
 * where asked; whose root owner last had it active, and that pop-up not
 * disabled. None where there is no other.
 */
function nextSwitchable(system: any, hwnd: number, previous: boolean, skipTopmost: boolean) {
  const tops = topLevel(system);
  const at = tops.findIndex((one) => one.window.hwnd === hwnd);

  if (at < 0) {
    return 0;
  }

  for (let step = 1; step < tops.length; step++) {
    const index = (at + (previous ? -step : step) + tops.length * 2) % tops.length;
    const candidate = tops[index];
    const own = candidate.window;

    if (!own.visible || (skipTopmost && own.exStyle & WS_EX_TOPMOST)) {
      continue;
    }

    let root = own.hwnd;

    for (let owner = ownerOf(system, root); owner; owner = ownerOf(system, owner)) {
      root = owner;
    }

    const last = GetLastActivePopup.call(system, root);
    const lastWindow = windowOf(system, last);

    if (lastWindow && lastWindow.window.style & User.WS_DISABLED) {
      continue;
    }

    if (last === own.hwnd) {
      return own.hwnd;
    }
  }

  return 0;
}

/**
 * `SwitchToThisWindow` (seg23 `0ceb`): the window brought to the top and
 * made active; for a switch not by Alt and Tab, the window that was active
 * sent to the bottom, unless it is topmost or there is no other to switch
 * to; and for one by Alt and Tab, a window minimized sent `SC_RESTORE`.
 * Measured by `tasklist` and `hotkey`.
 */
export async function switchToThisWindow(system: any, hwnd: number, altTab: boolean) {
  const active = GetActiveWindow.call(system);
  const sendBack = !altTab && active && nextSwitchable(system, active, false, true) !== 0;

  await SetWindowPos.call(system, hwnd, HWND_TOP, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE);

  const was = windowOf(system, active);

  if (sendBack && was && !(was.window.exStyle & WS_EX_TOPMOST) && active !== hwnd) {
    await SetWindowPos.call(
      system,
      active,
      HWND_BOTTOM,
      0,
      0,
      0,
      0,
      SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE
    );
  }

  const window = windowOf(system, hwnd);

  if (altTab && window?.window.state === 'minimized') {
    await SendMessage.call(system, hwnd, WM_SYSCOMMAND, SC_RESTORE, 0);
  }
}

/** `SwitchToThisWindow`, the call. */
export async function SwitchToThisWindow(this: any, hwnd: number, fAltTab: number) {
  await switchToThisWindow(this, hwnd & 0xffff, (fAltTab & 0xffff) !== 0);
}

/**
 * The desktop window's procedure (seg1 `9e6b`), as far as winbox.js has it:
 * a double click on it is `SC_TASKLIST` with its point, which
 * `DefWindowProc` carries out for it as for any window. The rest -- its
 * background painted for `WM_ERASEBKGND`, `WM_PALETTECHANGED` -- is the
 * raster desktop's own.
 */
export async function desktopProc(system: any, message: number, wParam: number, lParam: number) {
  if (message === User.WM_LBUTTONDBLCLK) {
    await taskList(system, lParam);
    return 0;
  }

  if (message === WM_SYSCOMMAND && (wParam & 0xfff0) === SC_TASKLIST) {
    await taskList(system, lParam);
  }

  return 0;
}
