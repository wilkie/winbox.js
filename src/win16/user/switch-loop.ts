'use strict';

import { User } from '../user.js';
import { DeviceBitmap } from '../../raster/device-bitmap.js';

import { keyState } from './accelerators.js';
import { systemBaseUnits } from './dialogs.js';
import { dispatchMessage } from './DispatchMessage.js';
import { GetAsyncKeyState, ownerOf } from './enumerate.js';
import { messageFilter } from './hooks.js';
import { drawIcon, standardIcon } from './icon-api.js';
import { iconOf } from './icon-block.js';
import { GetActiveWindow } from './placement.js';
import { PostMessage } from './PostMessage.js';
import { nextMessage, queueOf } from './queue.js';
import { backgroundOf } from './raster-desktop.js';
import { RasterWindow } from './raster-window.js';
import { SendMessage } from './SendMessage.js';
import { loadParameters } from './system-parameters.js';
import { nextSwitchable } from './task-list.js';
import { TranslateMessage } from './TranslateMessage.js';
import { GetSysModalWindow } from './userwin.js';
import { BeginDeferWindowPos, DeferWindowPos, EndDeferWindowPos } from './defer-window-pos.js';
import { SetWindowPos } from './window-state.js';

/**
 * Alt and Tab, Alt and Escape, Alt and F6: `DefWindowProc` sends the active
 * window `WM_SYSCOMMAND` for each, and carries the command out with a loop
 * of its own that takes the keys until Alt is let go, showing the window Tab
 * comes to in USER's switch window -- its icon and title in a box in the
 * middle of the screen, or, with `CoolSwitch=0`, the window itself drawn
 * over the others -- and switching to it.
 *
 * **Read out** of `USER.EXE`: seg1 `578d`-`57cc` (the command), seg1
 * `047d` (carried out), seg23 `0932`-`0c3c` (the loop), `0c58` (the next
 * window), `052d` (the box), `039a` (its frame), `000e` (the window drawn,
 * and the switch made otherwise), seg13 `0f2b` (F6's next window), seg3
 * `198b`-`1a74` (the switch window). **Recorded** by `alttab`.
 */

export const SC_NEXTWINDOW = 0xf040;
export const SC_PREVWINDOW = 0xf050;
const SC_RESTORE = 0xf120;
const WM_SYSCOMMAND = 0x0112;
const WM_QUERYDRAGICON = 0x0037;

/** The message filters' code for the loop (seg23 `0a56`). */
export const MSGF_NEXTWINDOW = 6;

const VK_TAB = 0x09;
const VK_SHIFT = 0x10;
const VK_MENU = 0x12;
const VK_ESCAPE = 0x1b;
const VK_F6 = 0x75;

const WS_DISABLED = 0x08000000;
const WS_EX_TOPMOST = 0x0008;
const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_NOACTIVATE = 0x0010;
const HWND_TOP = 0;

const SM_CXBORDER = 5;
const SM_CYBORDER = 6;
const SM_CXICON = 11;
const SM_CYICON = 12;

const COLOR_WINDOWFRAME = 6;
const COLOR_BTNFACE = 15;
const COLOR_BTNSHADOW = 16;
const COLOR_BTNTEXT = 18;
const COLOR_BTNHIGHLIGHT = 20;

/** The longest title the box shows: a buffer of 49 (seg23 `071b`). */
const TITLE_LENGTH = 48;

/** The window handle's `RasterWindow`, if it is one. */
function rasterOf(system: any, hwnd: number): RasterWindow | null {
  const window = hwnd ? system.handles.resolve(hwnd) : null;

  return window instanceof RasterWindow ? window : null;
}

/** The window at the top a window lies in (seg2 `0ab8`). */
function topOf(system: any, hwnd: number) {
  let raster = rasterOf(system, hwnd);

  while (raster?.window.parent) {
    raster = rasterOf(system, raster.window.parent.hwnd);
  }

  return raster?.window.hwnd ?? 0;
}

/** The owner at the root of a window's owners (seg23 `0000`). */
function rootOwner(system: any, hwnd: number) {
  let root = hwnd;

  for (let owner = ownerOf(system, root); owner; owner = ownerOf(system, owner)) {
    root = owner;
  }

  return root;
}

/** What the loop keeps between the windows it shows: USER's `[1ACh]`, `[1B0h]`. */
interface SwitchState {
  /** The window the switch window last showed (`[1ACh]`): the active one before the first. */
  shown: number;
  /** Whether Tab has been pressed in this loop (`[1B0h]`). */
  tabbing: boolean;
}

function stateOf(system: any): SwitchState {
  return (system._switchState ??= { shown: 0, tabbing: false });
}

/**
 * Alt with Tab, Escape or F6, as `DefWindowProc` takes a system key with Alt
 * down (seg1 `578d`, `57a7`-`57cc`): `WM_SYSCOMMAND` sent to the active
 * window, with the key in `lParam` -- `SC_NEXTWINDOW` with Shift held,
 * `SC_PREVWINDOW` without, as the code has them, the other way about from
 * their names (`alttab`: Alt and Tab gives `F050h`, Alt, Shift and Tab
 * `F040h`). Answers whether the key was one of them.
 */
export async function nextWindowKey(system: any, key: number) {
  if (key !== VK_TAB && key !== VK_ESCAPE && key !== VK_F6) {
    return false;
  }

  const command = keyState(system, VK_SHIFT) & 0x80 ? SC_NEXTWINDOW : SC_PREVWINDOW;

  await SendMessage.call(system, GetActiveWindow.call(system), WM_SYSCOMMAND, command, key);
  return true;
}

/**
 * `SC_NEXTWINDOW` and `SC_PREVWINDOW`, as `DefWindowProc` carries them out
 * (seg1 `047d`): the loop, with the key in `lParam`'s low word, whichever
 * the command. Not while a window is system-modal (`038c`-`03a5`, its table
 * at `03aa`; `alttab`: the keys go on to the window).
 */
export async function nextWindowCommand(system: any, lParam: number) {
  if (GetSysModalWindow.call(system)) {
    return;
  }

  await switchLoop(system, lParam & 0xffff);
}

/**
 * The window F6 goes to from one (seg13 `0f2b`, with `0edd` and `0f07`):
 * the windows at the top walked in the order their owners make, each window
 * followed by those it owns -- front to back, the first it owns, else the
 * next owned by its owner, else the next of its owner's -- or backwards with
 * Shift, round to the first; the next shown and not disabled, that is not an
 * icon's title. None when the walk comes back to where it started.
 */
function f6Next(system: any, hwnd: number, previous: boolean) {
  const tops = system.rasterDesktop.windows.filter(
    (one: any) => !one.parent && one.hwnd && !one.titleOf
  );
  const ownerOfWindow = (window: any) => window?.owner ?? null;

  /* The first window owned by `owner` after `after`, front to back (`0eb2`). */
  const firstOwned = (owner: any, after: any) => {
    const start = after ? tops.indexOf(after) + 1 : 0;

    return tops.slice(start).find((one: any) => ownerOfWindow(one) === owner) ?? null;
  };

  /* The next in the walk (`0edd`). */
  const next = (window: any) => {
    let owner = window;
    let after: any = null;

    for (;;) {
      const found = firstOwned(owner, after);

      if (found) {
        return found;
      }

      if (!owner) {
        return firstOwned(null, null);
      }

      after = owner;
      owner = ownerOfWindow(owner);
    }
  };

  /* The one before in the walk (`0f07`): the one whose next it is. */
  const before = (window: any) => {
    let at: any = null;

    for (let guard = 0; guard <= tops.length; guard++) {
      const following = next(at);

      if (following === window && at) {
        return at;
      }

      at = following;

      if (!at) {
        return null;
      }
    }

    return null;
  };

  const start = rasterOf(system, hwnd)?.window ?? null;
  let at = start;

  for (let guard = 0; guard <= tops.length; guard++) {
    at = start ? (previous ? before(at) : next(at)) : next(null);

    if (!at || at === start) {
      return 0;
    }

    if (at.visible && !(at.style & WS_DISABLED)) {
      return at.hwnd;
    }
  }

  return 0;
}

/**
 * The loop (seg23 `0932`), with the key that started it:
 *
 * * The mouse captured to the active window (`0951`), USER's own way, as
 *   the loops that move a window and run a menu take it.
 * * Escape: the window to go to is the next `0c58` finds, leaving out
 *   windows topmost, or the one before with Shift; with none, the active
 *   one. F6: the next of the walk F6 makes that is the active window's
 *   task's (`09b2`-`09dd`). Tab, here and each time it is pressed: the next
 *   `0c58` finds from the window it came to, or the one before with Shift,
 *   shown in the switch window (`09e5`-`0a21`).
 * * Then each message is looked at where it waits, and handed to the
 *   message filters with `MSGF_NEXTWINDOW`; one they take is looked at
 *   again. A change of active window meanwhile cancels (`0a45`).
 * * A key pressed with Alt but Tab, Escape or Shift, once Tab was pressed,
 *   cancels, and is left where it is. Pressed with Alt: Tab goes on to the
 *   next window; Escape, F6 and Shift are taken; any other key, before
 *   Tab, ends the loop at the window it came to, and is left where it is.
 *   Let go: Alt ends it, after Tab; Escape and F6 end it, at the window it
 *   came to -- or cancel, after Tab. A key's press, any release, a
 *   character typed with Alt and a move of the mouse are taken; a button
 *   pressed or let go ends it, and is left where it is (`0a83`-`0bde`).
 *   Anything else is taken, translated and dispatched.
 * * Cancelled: the active window is shown, and switched to (`0b46`).
 *
 * At the end the mouse is let go of, and the window switched to; a window
 * minimized that Tab switched to is posted `SC_RESTORE` (`0b54`-`0c33`).
 *
 * Not followed: in 386 enhanced mode USER calls `1799` either side
 * (`0943`, `0b5b`), and for a minimized window not restored it shows its
 * icon's title again (seg1 `6de3`).
 */
export async function switchLoop(system: any, startKey: number) {
  const state = stateOf(system);
  const input = system.rasterInput;
  const active = GetActiveWindow.call(system);
  const activeRaster = rasterOf(system, active);
  const activations = system._activations ?? 0;
  const queue = queueOf(system, active);
  const shift = () => (keyState(system, VK_SHIFT) & 0x80) !== 0;
  let escapeFound = false;
  let key = startKey & 0xff;
  let from = active;
  let current = active;

  /* The mouse captured to the active window, USER's own way (seg1 `28cd`
   * with 4): its messages at the point on the screen. */
  if (input && activeRaster) {
    input.capture = activeRaster.window;
    input.captureKind = 'switch';
  }

  /* Where the loop starts from, for the key: Escape's window, F6's, Tab's
   * (`0973`-`0a25`). */
  const start = async () => {
    if (key === VK_ESCAPE) {
      const next = nextSwitchable(system, topOf(system, from), shift(), true);

      if (next) {
        escapeFound = true;
        current = next;
      } else {
        current = from;
      }

      return;
    }

    current = from;

    if (key === VK_F6) {
      const own = queue;

      for (let guard = 0; guard < 256; guard++) {
        const next = f6Next(system, current, shift());

        if (!next) {
          return;
        }

        current = next;

        if (queueOf(system, current) === own) {
          return;
        }
      }

      return;
    }

    state.tabbing = true;

    const next = nextSwitchable(system, topOf(system, current), shift(), false);

    if (next && next !== current) {
      await showSwitch(system, next, true, 0, false);
      current = next;
    }
  };

  let mode: number | null = null;
  let cancelled = false;

  await start();

  while (mode === null && !cancelled) {
    const ahead = await nextMessage(system, { remove: false });

    if (!ahead) {
      cancelled = true;
      break;
    }

    if ((system._activations ?? 0) !== activations) {
      cancelled = true;
      break;
    }

    if (await messageFilter(system, ahead, MSGF_NEXTWINDOW)) {
      continue;
    }

    const message = ahead.message;
    const wParam = ahead.wParam & 0xffff;

    /* Any other key with Alt, after Tab: cancelled, the key left (`0a61`). */
    if (
      message === User.WM_SYSKEYDOWN &&
      state.tabbing &&
      wParam !== VK_TAB &&
      wParam !== VK_ESCAPE &&
      wParam !== VK_SHIFT
    ) {
      cancelled = true;
      break;
    }

    switch (message) {
      case User.WM_KEYDOWN:
      case User.WM_KEYUP:
      case User.WM_SYSKEYUP:
      case User.WM_SYSCHAR:
      case User.WM_MOUSEMOVE: {
        await nextMessage(system, { wait: false });

        if (message !== User.WM_KEYUP && message !== User.WM_SYSKEYUP) {
          break;
        }

        key = wParam;

        if (key === VK_MENU) {
          if (state.tabbing) {
            mode = 0;
          }
        } else if (key === VK_ESCAPE || key === VK_F6) {
          if (state.tabbing) {
            cancelled = true;
          } else {
            mode = key === VK_ESCAPE ? 1 : 2;
          }
        }

        break;
      }

      case User.WM_SYSKEYDOWN:
        key = wParam;

        if (key === VK_F6 || key === VK_TAB || key === VK_SHIFT || key === VK_ESCAPE) {
          await nextMessage(system, { wait: false });

          if (key === VK_TAB) {
            from = current;
            await start();
          }

          break;
        }

        state.tabbing = false;
        mode = escapeFound ? 1 : 0;
        break;

      case User.WM_LBUTTONDOWN:
      case User.WM_LBUTTONUP:
      case User.WM_RBUTTONDOWN:
      case User.WM_RBUTTONUP:
      case User.WM_MBUTTONDOWN:
      case User.WM_MBUTTONUP:
        mode = 0;
        break;

      default: {
        const msg = await nextMessage(system, { wait: false });

        if (msg) {
          TranslateMessage.call(system, msg);
          await dispatchMessage.call(system, msg);
        }
      }
    }
  }

  /* Cancelled: the active window shown, and switched to (`0b46`). */
  if (cancelled) {
    current = GetActiveWindow.call(system);
    await showSwitch(system, current, true, 0, false);
    mode = 0;
  }

  /* Out of it (`0b54`-`0c33`): the mouse let go of, which makes it move
   * where it is, as `ReleaseCapture` does (seg1 `28bd`, `28d0`). */
  if (input) {
    const had = input.capture;

    input.capture = null;
    input.captureKind = 'set';

    if (had) {
      input.nudge();
    }
  }

  const wasTabbing = state.tabbing;

  state.tabbing = false;
  await showSwitch(system, current, false, mode ?? 0, shift());

  const now = GetActiveWindow.call(system);

  if (rasterOf(system, now)?.window.state === 'minimized' && mode === 0 && wasTabbing) {
    PostMessage.call(system, now, WM_SYSCOMMAND, SC_RESTORE, 0);
  }
}

/**
 * The window Tab came to, shown or switched to (seg23 `052d`): with
 * `CoolSwitch` on and `mode` nought, in the box; otherwise as `000e` does.
 * `show`: shown; else switched to -- `mode` 1 by Escape, 2 by F6, 0
 * otherwise.
 */
async function showSwitch(system: any, hwnd: number, show: boolean, mode: number, shift: boolean) {
  const fast = (await loadParameters(system)).fastTaskSwitch;

  if (!fast || mode !== 0) {
    await showWindowItself(system, hwnd, show, mode, shift);
    return;
  }

  if (show) {
    await showBox(system, hwnd);
    return;
  }

  /* The switch: the box taken away, and the window brought to the top and
   * made active (`0868`-`0915`). */
  closeSwitch(system);
  await SetWindowPos.call(system, hwnd, HWND_TOP, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE);
  stateOf(system).shown = 0;
}

/** The switch window taken off the screen, if it is up: what it covered put back. */
function closeSwitch(system: any) {
  const desktop = system.rasterDesktop;
  const box = system._switchWindow;

  if (box && desktop) {
    system._switchWindow = null;
    desktop.destroy(box);
    system.rasterInput?.nudge();
  }
}

/** The switch window put up over every window, where asked. */
function openSwitch(system: any, left: number, top: number, width: number, height: number) {
  const desktop = system.rasterDesktop;

  system._switchWindow = desktop.openSwitch(left, top, width, height);
  system.rasterInput?.nudge();

  return system._switchWindow;
}

/**
 * The box (seg23 `060e`-`0865`), `50` of the System font's average widths
 * across and the larger of `SM_CYICON` and eight borders, and five of its
 * heights, down, in the middle of the screen. Put up only while Alt is
 * down, as `GetAsyncKeyState` has it: keys put in all at once switch
 * without it (`alttab`). Its first showing in a loop draws its frame: a
 * pixel of `COLOR_WINDOWFRAME`, `COLOR_BTNFACE` within, and three borders
 * in a sunken edge a border wide (`039a`). Within that, nine borders in,
 * the title of the window's root owner in `COLOR_BTNTEXT` on
 * `COLOR_BTNFACE`, in the middle of what the icon leaves -- the icon's part
 * a quarter of the width, or two borders and `SM_CXICON` if more -- and down
 * in the middle of the box; the root owner's class's icon in the middle of
 * its part, or the one `WM_QUERYDRAGICON` answers, or the Windows flag.
 */
async function showBox(system: any, hwnd: number) {
  const desktop = system.rasterDesktop;
  const state = stateOf(system);

  if (!desktop) {
    state.shown = hwnd;
    return;
  }

  const environment = desktop.environment;
  const metric = (index: number) => environment.metric(index);
  const first = !state.shown;

  if (first) {
    state.shown = GetActiveWindow.call(system);
  }

  const base = systemBaseUnits(system);
  const cxBorder = metric(SM_CXBORDER);
  const cyBorder = metric(SM_CYBORDER);
  const width = base.x * 50;
  const height = Math.max(cyBorder * 8 + metric(SM_CYICON), base.y * 5);
  const left = Math.trunc((desktop.screen.width - width) / 2);
  const top = Math.trunc((desktop.screen.height - height) / 2);

  if (!(GetAsyncKeyState.call(system, VK_MENU) & 0x8000)) {
    state.shown = hwnd;
    return;
  }

  if (!system._switchWindow) {
    openSwitch(system, left, top, width, height);
  }

  const root = rootOwner(system, hwnd);
  const rootRaster = rasterOf(system, root);
  const title = (rootRaster?.window.title ?? '').slice(0, TITLE_LENGTH);
  const bitmap = DeviceBitmap.view(desktop.screen, left, top, width, height, (x, y) => {
    const sx = left + x;
    const sy = top + y;

    return sx >= 0 && sy >= 0 && sx < desktop.screen.width && sy < desktop.screen.height;
  });
  const painter = desktop.painterOn(bitmap, width, height);
  const rect = { left: 0, top: 0, right: width, bottom: height };

  /* The frame, the first time (`039a`), and the rectangle within. */
  if (first) {
    const dx = 3 * cxBorder;
    const dy = 3 * cyBorder;
    const inner = {
      left: rect.left + cxBorder,
      top: rect.top + cyBorder,
      right: rect.right - cxBorder,
      bottom: rect.bottom - cyBorder,
    };

    painter.fill(
      rect.left,
      rect.top,
      rect.right,
      rect.top + cyBorder,
      painter.colour(COLOR_WINDOWFRAME)
    );
    painter.fill(
      rect.left,
      rect.top + cyBorder,
      rect.left + cxBorder,
      rect.bottom - cyBorder,
      painter.colour(COLOR_WINDOWFRAME)
    );
    painter.fill(
      rect.left,
      rect.bottom - cyBorder,
      rect.right,
      rect.bottom,
      painter.colour(COLOR_WINDOWFRAME)
    );
    painter.fill(
      rect.right - cxBorder,
      rect.top + cyBorder,
      rect.right,
      rect.bottom - cyBorder,
      painter.colour(COLOR_WINDOWFRAME)
    );
    painter.fill(inner.left, inner.top, inner.right, inner.bottom, painter.colour(COLOR_BTNFACE));

    const shadow = painter.colour(COLOR_BTNSHADOW);
    const light = painter.colour(COLOR_BTNHIGHLIGHT);

    painter.fill(
      inner.left + dx,
      inner.top + dy,
      inner.right - dx,
      inner.top + dy + cyBorder,
      shadow
    );
    painter.fill(
      inner.left + dx,
      inner.top + dy,
      inner.left + dx + cxBorder,
      inner.bottom - dy,
      shadow
    );
    painter.fill(
      inner.left + dx,
      inner.bottom - dy - cyBorder,
      inner.right - dx,
      inner.bottom - dy,
      light
    );
    painter.fill(
      inner.right - dx - cxBorder,
      inner.top + dy,
      inner.right - dx,
      inner.bottom - dy,
      light
    );
  }

  const inX = 3 * cxBorder + 6 * cxBorder;
  const inY = 3 * cyBorder + 6 * cyBorder;
  const text = { left: inX, top: inY, right: width - inX, bottom: height - inY };
  const iconPart = Math.max(
    Math.trunc((text.right - text.left) / 4),
    2 * cxBorder + metric(SM_CXICON)
  );
  const extent = desktop.systemTextWidth(title);
  const x = Math.max(
    iconPart + text.left,
    Math.trunc((text.right - text.left - extent) / 2) + text.left
  );
  const y = Math.trunc((height - base.y) / 2);

  /* `ExtTextOut` with `ETO_OPAQUE` and `ETO_CLIPPED` in the rectangle. */
  painter.fill(text.left, text.top, text.right, text.bottom, painter.colour(COLOR_BTNFACE));
  desktop.systemTextOn(left, top, text, x, y, title, environment.sysColor(COLOR_BTNTEXT));

  /* The icon (`07f7`-`083a`). */
  let icon = null;
  const windowClass = rootRaster ? system.handles.retrieve(rootRaster.options.windowClass) : null;
  let handle = windowClass?.hIcon ?? 0;

  if (!handle && root) {
    handle = (await SendMessage.call(system, root, WM_QUERYDRAGICON, 0, 0)) & 0xffff;
  }

  if (handle) {
    icon = standardIcon(system, handle) ?? iconOf(system, handle);
  }

  /* `IDI_APPLICATION` shows as the Windows flag, as an icon does; nothing
   * at all, as the flag USER keeps (`[528h]`, its icon `7F87h`). */
  if (!icon?.xor || icon === environment.icons?.get(32512)) {
    icon = environment.applicationIcon ?? icon;
  }

  if (icon?.xor) {
    drawIcon(
      bitmap,
      ((iconPart - metric(SM_CXICON)) >> 1) + text.left,
      ((text.bottom - text.top - metric(SM_CYICON)) >> 1) + text.top,
      icon
    );
  }

  bitmap.context?.markRect?.(0, 0, width, height);
  desktop.screen.context.markRect(left, top, left + width, top + height);
  state.shown = hwnd;
}

/**
 * `CoolSwitch` off, or a switch by Escape or F6 (seg23 `000e`).
 *
 * * Switched to by Escape or F6: brought to the top and made active; by
 *   Escape without Shift, the window that was active sent to the bottom --
 *   after the last window at the top, or after the last topmost one where
 *   its root owner is topmost; before that one, where it is its root owner
 *   -- unless that is the window switched to (`003a`-`00bd`).
 * * Shown: the window shown before it drawn as not active -- its frame, or
 *   its icon's title -- and then it: the switch window put over the parts of
 *   it that other windows cover, those filled with its class's brush, and
 *   its frame, or its icon's title, drawn active over all of it
 *   (`00c9`-`02ff`).
 * * Switched to by Tab: brought to the top and made active, and the switch
 *   window taken away (`0302`-`038e`).
 */
async function showWindowItself(
  system: any,
  hwnd: number,
  show: boolean,
  mode: number,
  shift: boolean
) {
  const state = stateOf(system);
  const desktop = system.rasterDesktop;

  if (mode !== 0) {
    const active = GetActiveWindow.call(system);
    /* One set of moves: every window asked, then each told (`alttab`). */
    let set = BeginDeferWindowPos.call(system, 4);

    set = DeferWindowPos.call(system, set, hwnd, HWND_TOP, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE);

    if (!shift && mode === 1 && active) {
      const root = rootOwner(system, active);
      const tops = system.rasterDesktop.windows.filter(
        (one: any) => !one.parent && one.hwnd && !one.titleOf
      );
      const rootWindow = rasterOf(system, root)?.window;
      let last = 0;

      if (rootWindow && rootWindow.exStyle & WS_EX_TOPMOST) {
        /* The last of the topmost windows at the front (seg7 `02c9`). */
        for (const one of tops) {
          if (!(one.exStyle & WS_EX_TOPMOST)) {
            break;
          }

          last = one.hwnd;
        }
      } else {
        last = tops[tops.length - 1]?.hwnd ?? 0;
      }

      if (last !== hwnd) {
        if (root === last) {
          const at = tops.findIndex((one: any) => one.hwnd === last);

          last = at > 0 ? tops[at - 1].hwnd : 0;
        }

        set = DeferWindowPos.call(
          system,
          set,
          active,
          last,
          0,
          0,
          0,
          0,
          SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE
        );
      }
    }

    await EndDeferWindowPos.call(system, set);
    return;
  }

  if (!show) {
    await SetWindowPos.call(system, hwnd, HWND_TOP, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE);
    closeSwitch(system);
    state.shown = 0;
    return;
  }

  if (!desktop) {
    state.shown = hwnd;
    return;
  }

  closeSwitch(system);

  if (!state.shown) {
    state.shown = GetActiveWindow.call(system);
  }

  /* The one shown before, drawn as not active. */
  const before = rasterOf(system, state.shown)?.window;

  if (before) {
    if (before.state === 'minimized') {
      if (before.iconTitle) {
        desktop.paintIconTitle(before.iconTitle, false, true);
      }
    } else {
      desktop.paintFrame(before, false);
    }
  }

  const window = rasterOf(system, hwnd)?.window;

  if (!window) {
    state.shown = hwnd;
    return;
  }

  const drawn = window.state === 'minimized' && window.iconTitle ? window.iconTitle : window;
  const covered: [number, number][] = desktop.coveredPoints(drawn);
  let box: [number, number, number, number] | null = null;

  for (const [x, y] of covered) {
    box = box
      ? [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x + 1), Math.max(box[3], y + 1)]
      : [x, y, x + 1, y + 1];
  }

  const place = box ? [box[0], box[1], box[2] - box[0], box[3] - box[1]] : [0, 0, 0, 0];

  openSwitch(system, place[0], place[1], place[2], place[3]);

  if (drawn === window) {
    const raster = rasterOf(system, hwnd);
    const windowClass = raster ? system.handles.retrieve(raster.options.windowClass) : null;

    desktop.fillCovered(
      covered,
      system._switchWindow,
      backgroundOf(system, windowClass?.hbrBackground ?? 0)
    );
    desktop.paintFrameOver(window, true);
  } else {
    desktop.paintIconTitle(drawn, true, false);
  }

  state.shown = hwnd;
}
