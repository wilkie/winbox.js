'use strict';

import { MSG, User } from '../user.js';
import { IsBadCodePtr } from '../kernel/bad-pointers.js';
import { INQUIRE } from '../keyboard/tables.js';
import { segmentSelector } from '../selectors.js';
import { GetBrushOrg, SetBrushOrg, UnrealizeObject } from '../gdi/CreatePatternBrush.js';
import { GetClipBox } from '../gdi/clipping.js';
import { IsGDIObject } from '../gdi/queries.js';
import { defaultControlColour } from './ctlcolor.js';
import { ClientToScreen } from './ClientToScreen.js';
import { clipboardFormats } from './clipboard.js';
import { FillRect } from './FillRect.js';
import { GetClientRect } from './GetClientRect.js';
import { GetDesktopWindow } from './GetDesktopWindow.js';
import { GetMessage } from './GetMessage.js';
import { GetWindow } from './GetWindow.js';
import { GetLastActivePopup } from './enumerate.js';
import { IntersectRect } from './rect-api.js';
import { nextMessage } from './queue.js';
import { noteTaken } from './queries.js';
import { PeekMessage, WaitMessage } from './PeekMessage.js';
import { PtInRect } from './PtInRect.js';
import { ReleaseCapture, SetCapture } from './SetCapture.js';
import { GetSystemMetrics } from './GetSystemMetrics.js';
import { GetSysModalWindow } from './userwin.js';
import { RasterWindow } from './raster-window.js';
import { GetSubMenu, menuOf } from './menu-api.js';
import { handleOf } from './menu-data.js';
import { screenSaveLook } from './screen-saver.js';
import { SendMessage } from './SendMessage.js';
import { SystemParametersInfo } from './SystemParametersInfo.js';

/**
 * USER's smaller exports: aliases of others, the cores others are made of,
 * and the helpers its controls paint with. **Read out of `USER.EXE`** and
 * **recorded** by `usermisc`. As the Rust engine's `small_calls.rs`.
 */

const GW_HWNDLAST = 1;
const GW_HWNDNEXT = 2;
const GW_HWNDPREV = 3;
const GW_CHILD = 5;
const PM_REMOVE = 1;
const CS_PARENTDC = 0x0080;
const NULLREGION = 1;

/**
 * The extra information of the hardware event the task last took from the
 * system's queue (`USER.EXE` seg1 `81bb`, kept at seg1 `3037`). WinBox's
 * events carry none, so it stays nought.
 */
export function GetMessageExtraInfo(this: any) {
  return 0;
}

/**
 * Messages other tasks sent answered, the processor given to the others, and
 * what was sent meanwhile answered (`USER.EXE` seg1 `3df2`).
 */
export async function UserYield(this: any) {
  const task = this.scheduler?.task;

  if (task?.sent?.length) {
    await this.scheduler.takeSent?.(task);
  }

  await this.scheduler?.yieldTurn?.();
}

/**
 * Whether the user is idle: nought with a mouse button down; else the
 * screen saver started where its delay has passed, as USER's own look every
 * ten seconds starts it, and 1 (`USER.EXE` seg1 `334e`-`33ff`).
 */
export function IsUserIdle(this: any) {
  const buttons: Uint8Array = this._asyncKeys ?? new Uint8Array(256);

  if ([1, 2, 4].some((vk) => buttons[vk] & 0x80)) {
    return 0;
  }

  screenSaveLook(this);

  return 1;
}

/**
 * `GetMessage` and `PeekMessage` are this, with fixed arguments
 * (`USER.EXE` seg1 `2440`, `2446`): waiting, `GetMessage`, removing; not
 * waiting, `PeekMessage` with its flags. Waiting, it answers nought for
 * `WM_QUIT`.
 */
export async function GetMessage2(
  this: any,
  lpmsg: any,
  hwnd: number,
  uMsgFilterMin: number,
  uMsgFilterMax: number,
  flags: number,
  fWait: number
) {
  if (!(fWait & 0xff)) {
    return await PeekMessage.call(this, lpmsg, hwnd, uMsgFilterMin, uMsgFilterMax, flags);
  }

  if (flags & PM_REMOVE) {
    return await GetMessage.call(this, lpmsg, hwnd, uMsgFilterMin, uMsgFilterMax);
  }

  const msg = await nextMessage(this, {
    remove: false,
    filter: { hwnd, first: uMsgFilterMin, last: uMsgFilterMax },
  });

  lpmsg.hwnd = msg.hwnd;
  lpmsg.message = msg.message;
  lpmsg.wParam = msg.wParam;
  lpmsg.lParam = msg.lParam;
  lpmsg.time = msg.time;
  lpmsg.pt.x = msg.pt?.x ?? 0;
  lpmsg.pt.y = msg.pt?.y ?? 0;
  noteTaken(this, msg);

  return msg.message === User.WM_QUIT ? 0 : 1;
}

/**
 * `SystemParametersInfo` without its checks, `WIN.INI` not written: Windows
 * 3.0's form of it (`USER.EXE` seg41 `1716`, calling `0ed6` as
 * `SystemParametersInfo` does).
 */
export async function ControlPanelInfo(
  this: any,
  uAction: number,
  uParam: number,
  lpvParam: number
) {
  return await SystemParametersInfo.call(this, uAction, uParam, lpvParam, 0);
}

const SPI_SETDESKPATTERN = 21;

/**
 * The desktop's pattern made again from `WIN.INI`'s, as USER makes it at
 * start: its own `SetDeskPattern` with -1 for the pattern (`USER.EXE`
 * seg41 `0a51`, the work at `0a61`-`0c03`, which `SPI_SETDESKPATTERN`
 * calls too, seg41 `141f`) -- the brush made, `WM_SYSCOLORCHANGE` sent
 * round and the screen drawn again. Its answer is that function's.
 */
export async function OldSetDeskPattern(this: any) {
  return await SystemParametersInfo.call(this, SPI_SETDESKPATTERN, 0xffff, 0, 0);
}

/**
 * Windows left at once, nothing asked: `INT 21h` function 4Ch with nought
 * (`USER.EXE` seg3 `0059`-`005e`). WinBox ends as its `ExitWindows` ends,
 * once every program agrees: the task that asked ends.
 */
export function OldExitWindows(this: any) {
  this.scheduler.task?.end();
}

/**
 * The whole screen painted again: the desktop and every window,
 * invalidated and erased (`USER.EXE` seg1 `77a7`).
 */
export async function RepaintScreen(this: any) {
  this.rasterDesktop?.repaintAll(false);
}

/**
 * The first format of a list that is on the clipboard: nought with nothing
 * on it, -1 where none of the list is; noughts in the list are passed over
 * (`USER.EXE` seg39 `0080`-`00ea`).
 */
export function GetPriorityClipboardFormat(this: any, lpList: number, cFormats: number) {
  const formats: Set<number> = new Set(clipboardFormats(this));

  if (!formats.size) {
    return 0;
  }

  const core = this.machine.cpu.core;

  for (let at = 0, count = (cFormats << 16) >> 16; count > 0; count--, at += 2) {
    const format = core.read16(lpList >>> 16, ((lpList & 0xffff) + at) & 0xffff);

    if (format && formats.has(format)) {
      return format;
    }
  }

  return 0xffff;
}

/**
 * The next window as Alt and Escape takes it, or the one before (`USER.EXE`
 * seg23 `0c3f`-`0ce6`): from the window's top-level window, round the
 * desktop's children in turn, the first shown whose last active pop-up is
 * enabled and is the last active pop-up of the window at the root of its
 * owners; USER's task list is passed over. Nought where it comes back to
 * where it started.
 */
export function GetNextQueueWindow(this: any, hwnd: number, fPrevious: number) {
  const window = this.handles.resolve(hwnd);

  if (!(window instanceof RasterWindow)) {
    return 0;
  }

  let top = window;

  while (top.window.style & User.WS_CHILD && top.window.parent?.hwnd) {
    top = this.handles.resolve(top.window.parent.hwnd);
  }

  const start = top.window.hwnd;
  const desktop = GetDesktopWindow.call(this);
  let at = start;

  for (let guard = 0; guard < 4096; guard++) {
    let next = GetWindow.call(this, at, fPrevious ? GW_HWNDPREV : GW_HWNDNEXT);

    if (!next) {
      const first = GetWindow.call(this, desktop, GW_CHILD);

      next = fPrevious ? GetWindow.call(this, first, GW_HWNDLAST) : first;
    }

    at = next;

    if (!at || at === start) {
      return 0;
    }

    const candidate = this.handles.resolve(at);

    /* USER's task list, its window of class 8003h, is passed over
     * (`[1AAh]`); WinBox's has no window a program can find. */
    if (!(candidate instanceof RasterWindow)) {
      continue;
    }

    if (!(candidate.window.style & User.WS_VISIBLE)) {
      continue;
    }

    const last = this.handles.resolve(GetLastActivePopup.call(this, at));

    if (last instanceof RasterWindow && last.window.style & User.WS_DISABLED) {
      continue;
    }

    let root = candidate.window.owner;

    if (!root) {
      if (GetLastActivePopup.call(this, at) === at) {
        return at;
      }

      continue;
    }

    while (root.owner) {
      root = root.owner;
    }

    if (GetLastActivePopup.call(this, root.hwnd) === at) {
      return at;
    }
  }

  return 0;
}

/** The window a control asks for its colours: a pop-up's owner, any other's parent, else itself. */
function colourParent(system: any, hwnd: number) {
  const window = system.handles.resolve(hwnd);

  if (!(window instanceof RasterWindow)) {
    return hwnd;
  }

  const kind = (window.window.style >>> 24) & 0xc0;
  const other =
    kind === 0x80 || kind === 0xc0
      ? window.window.owner?.hwnd
      : (window.window.parent?.hwnd ?? GetDesktopWindow.call(system));

  return other || hwnd;
}

/**
 * The brush a control paints with: `WM_CTLCOLOR` sent to the window given,
 * and `DefWindowProc`'s answer where it answers no GDI object (`USER.EXE`
 * seg6 `028c`).
 */
async function controlColour(system: any, parent: number, hwnd: number, hdc: number, type: number) {
  const lParam = ((hwnd & 0xffff) | ((type & 0xffff) << 16)) >>> 0;
  const answer = (await SendMessage.call(system, parent, User.WM_CTLCOLOR, hdc, lParam)) & 0xffff;

  return IsGDIObject.call(system, answer)
    ? answer
    : defaultControlColour(system, hdc, type & 0xffff);
}

/**
 * The brush a control of a kind paints with, asked of its parent -- a
 * pop-up's owner -- as the control asks as it paints (`USER.EXE` seg6
 * `02d2`).
 */
export async function GetControlBrush(this: any, hwnd: number, hdc: number, wType: number) {
  return await controlColour(this, colourParent(this, hwnd), hwnd, hdc, wType);
}

/**
 * A rectangle filled with a brush, or for a number under 8 with the brush
 * the parent answers `WM_CTLCOLOR` of that type with; the brush's pattern
 * set to start at the parent's client area's corner, the desktop's where no
 * parent is given (`USER.EXE` seg1 `76eb`-`7763`).
 */
export async function PaintRect(
  this: any,
  hwndParent: number,
  hwnd: number,
  hdc: number,
  hbr: number,
  lprc: any
) {
  const parent = hwndParent || GetDesktopWindow.call(this);
  const brush = (hbr & 0xffff) < 8 ? await controlColour(this, parent, hwnd, hdc, hbr) : hbr;
  const was = GetBrushOrg.call(this, hdc) >>> 0;
  const origin = { x: 0, y: 0 };

  ClientToScreen.call(this, parent, origin);

  SetBrushOrg.call(this, hdc, origin.x, origin.y);
  UnrealizeObject.call(this, brush);
  FillRect.call(this, hdc, lprc, brush);
  SetBrushOrg.call(this, hdc, (was << 16) >> 16, was >> 16);
}

/**
 * What a device context draws in of a window filled as `PaintRect` fills,
 * the window its own parent where none is given (`USER.EXE` seg1 `7766`):
 * the device context's clip box, within the window's client area for a
 * class of `CS_PARENTDC`; nothing where it clips everything (`78be`).
 */
export async function FillWindow(
  this: any,
  hwndParent: number,
  hwnd: number,
  hdc: number,
  hbr: number
) {
  const rect: any = { left: 0, top: 0, right: 0, bottom: 0 };

  if (GetClipBox.call(this, hdc, rect) === NULLREGION) {
    return;
  }

  const window = this.handles.resolve(hwnd);
  const windowClass = window?.options?.windowClass;
  const classStyle = windowClass ? (this.handles.retrieve(windowClass)?.style ?? 0) : 0;

  if (hwnd && classStyle & CS_PARENTDC) {
    const client: any = { left: 0, top: 0, right: 0, bottom: 0 };

    GetClientRect.call(this, hwnd, client);
    IntersectRect.call(this, rect, { ...rect }, client);
  }

  await PaintRect.call(this, hwndParent || hwnd, hwnd, hdc, hbr, rect);
}

/** What kind of USER object a local handle is: nought, whatever it is (`USER.EXE` seg1 `1d38`). */
export function GetUserLocalObjType(this: any, _handle: number) {
  return 0;
}

/**
 * Ordinal 285: USER's data segment's selector, left in AX as USER loads DS
 * and puts it back (`USER.EXE` seg41 `1736`). **Recorded** by `userint`:
 * one more than the desktop's instance.
 */
export function Bear285(this: any, _a: number, _b: number) {
  return this._moduleData?.USER ?? 0;
}

/**
 * Ordinal 86: the icon's width and height as USER read them from the
 * display driver's resources as it started (`[68Ah]`, `[68Ch]`, seg3
 * `0e2c`-`0e68`; seg13 `0229`) -- `SM_CXICON` and `SM_CYICON`.
 * **Recorded** by `userint`: 32 and 32.
 */
export function Bear86(this: any) {
  const width = GetSystemMetrics.call(this, 11) & 0xffff;
  const height = GetSystemMetrics.call(this, 12) & 0xffff;

  return ((height << 16) | width) >>> 0;
}

/**
 * Ordinal 51: whether a byte leads a double-byte character, by the two
 * ranges the keyboard driver's `Inquire` gave as Windows started
 * (`[98Eh]`, `[990h]`, seg1 `1a6c`-`1a96`): its low byte, and 1 in the high
 * byte, where it is in one; else nought. The US driver gives none.
 */
export function Bear51(this: any, wByte: number) {
  const byte = wByte & 0xff;
  const [low1, low2, high1, high2] = INQUIRE;

  if (byte < low1 || byte > high2) {
    return 0;
  }

  return byte <= low2 || byte >= high1 ? 0x100 | byte : 0;
}

/**
 * The procedure the mouse driver tells USER of events by: `Mouse_Event`'s
 * own address (`USER.EXE` seg1 `530a`, `CS:507A`). **Recorded** by
 * `userint`.
 */
export function GetMouseEventProc(this: any) {
  const info = this.modules.load(User).lookup(299);

  return ((segmentSelector(info.segment) << 16) | info.offset) >>> 0;
}

/**
 * A procedure set for USER's keyboard events to go through before they are
 * queued, and the one it replaces answered (`USER.EXE` seg1 `5028`): kept
 * in USER's fixed data at E2h, which `keybd_event`'s path calls (seg1
 * `4b95`). A pointer that is not nought and is no code's is refused, and
 * nought answered (`aeca`). **Recorded** by `userint`.
 *
 * Not followed: calling it, as WinBox's keyboard input does not go
 * through USER's event procedure.
 */
export function SetEventHook(this: any, lpfnEventHook: number) {
  const hook = lpfnEventHook >>> 0;

  if (hook && IsBadCodePtr.call(this, hook)) {
    return 0;
  }

  const old = this._eventHook ?? 0;

  this._eventHook = hook;

  return old >>> 0;
}

/**
 * For WINOLDAP: with 0 and 1 a flag of USER's menus set (`[170h]`, read by
 * seg10 `065f`, `1aa3`); nought answered in DX:AX (`USER.EXE` seg41
 * `0e6e`). **Recorded** by `userint`.
 */
export function WinOldAppHackomatic(this: any, w1: number, w2: number) {
  if ((w2 & 0xffff) === 1 && !(w1 & 0xffff)) {
    this._winOldApHack = 1;
  }

  return 0;
}

/**
 * Whether the mouse, pressed at a point, is dragged (`USER.EXE` seg14
 * `035e`-`03ec`): the mouse captured, and its messages taken until a move
 * leaves the rectangle about the point -- twice `SM_CXBORDER` and
 * `SM_CYBORDER` each way (`[6A0h]`, `[6B4h]`, seg3 `191b`-`192a`) -- which
 * answers 1, or the left button comes up, which answers nought; capture let
 * go either way. **Recorded** by `userint`: two pixels across inside, three
 * out; one up inside, two out.
 */
export async function DragDetect(this: any, hwnd: number, pt: number) {
  const x = signed16(pt);
  const y = pt >> 16;
  const dx = signed16(GetSystemMetrics.call(this, 5) * 2);
  const dy = signed16(GetSystemMetrics.call(this, 6) * 2);
  const rect = { left: x - dx, top: y - dy, right: x + dx, bottom: y + dy };

  SetCapture.call(this, hwnd);

  for (;;) {
    const msg: any = new MSG();

    if (!(await PeekMessage.call(this, msg, 0, WM_MOUSEMOVE, WM_MOUSELAST, PM_REMOVE))) {
      await WaitMessage.call(this);
      continue;
    }

    if (msg.message === WM_MOUSEMOVE) {
      const at = ((msg.pt.x & 0xffff) | ((msg.pt.y & 0xffff) << 16)) >>> 0;

      if (!PtInRect.call(this, rect, at)) {
        ReleaseCapture.call(this);
        return 1;
      }
    } else if (msg.message === WM_LBUTTONUP) {
      ReleaseCapture.call(this);
      return 0;
    }
  }
}

const signed16 = (value: number) => (value << 16) >> 16;
const WM_MOUSEMOVE = 0x0200;
const WM_LBUTTONUP = 0x0202;
const WM_MOUSELAST = 0x0209;

/**
 * An icon's or cursor's twelve bytes of header, from where it is locked,
 * copied to a buffer (`USER.EXE` seg12 `1789`, `023f`).
 */
export function GetInternalIconHeader(this: any, lpIcon: number, lpHeader: number) {
  const memory = this.machine.cpu.core;

  for (let at = 0; at < 12; at++) {
    memory.write8(
      lpHeader >>> 16,
      ((lpHeader & 0xffff) + at) & 0xffff,
      memory.read8(lpIcon >>> 16, ((lpIcon & 0xffff) + at) & 0xffff)
    );
  }
}

/**
 * The menu an item of a command is in, the menu given or one it opens,
 * found as USER finds an item by its command -- from the last item to the
 * first, a pop-up's menu searched where the pop-up is; nought for none
 * (`USER.EXE` seg9 `0163`, seg10 `009c`).
 */
export function LookupMenuHandle(this: any, hmenu: number, cmd: number) {
  const found = menuOf(this, hmenu)?.find(cmd & 0xffff, 0);

  return found ? handleOf(this, found.menu) : 0;
}

/**
 * The menu open ended, whatever window's it is (`USER.EXE` seg9 `00fe`-
 * `0162`): the capture let go where the menu's window has it, and the
 * menu's loop told to end, as `WM_CANCELMODE` ends a window's own
 * (`DefWindowProc`, seg1 `5d27`-`5d3a`). Nothing with no menu open.
 * **Recorded** by `endmenu`.
 */
export function EndMenu(this: any) {
  const desktop = this.rasterDesktop;

  if (!desktop?.menuOwner) {
    return;
  }

  if (this.rasterInput?.capture === desktop.menuOwner) {
    this.rasterInput.capture = null;
  }

  desktop.menuCancelled = true;
}

/**
 * Windows ended and a DOS program run after it (`USER.EXE` seg5 `0216`-
 * `02fd`): the program and its parameters written to the buffer the DOS
 * loader that started Windows keeps for it -- asked of `INT 2Fh` function
 * 4B20h -- then `ExitWindows` with `EW_EXITANDEXECAPP`; nought where there
 * is no such buffer, or the names are too long, or a program refuses.
 * WinBox has no DOS loader to ask: nought, and nothing ends.
 */
export function ExitWindowsExec(this: any, _lpszExe: number, _lpszParams: number) {
  return 0;
}

/**
 * A window's system menu given: the menu itself, its first item's pop-up
 * shown and answered by `GetSystemMenu` (`USER.EXE` seg9 `0041`-`007c`,
 * `GetSystemMenu` seg9 `0f44`-`0f54`); nought for a window without
 * `WS_SYSMENU`. **Recorded** by `usermisc`.
 *
 * Not followed: the menu it had destroyed.
 */
export function SetSystemMenu(this: any, hwnd: number, hmenu: number) {
  const window = this.handles.resolve(hwnd);

  if (!(window instanceof RasterWindow) || !(window.window.style & User.WS_SYSMENU)) {
    return 0;
  }

  const popup = this.handles.resolve(GetSubMenu.call(this, hmenu, 0));

  window.window.systemMenuBar = hmenu;
  window.window.systemMenu = popup ?? null;

  return 1;
}

/**
 * What the system is in the middle of, for a debugger (`USER.EXE` seg1
 * `4afb`-`4b58`), as bits: `SDS_MENU` (1) in a menu's loop, USER's word
 * at `[1CAh]`; `SDS_SYSMODAL` (2) with a system-modal window, `[0E2h]`;
 * `SDS_NOTASKQUEUE` (4) where the current task has no queue, which a
 * task here always has; `SDS_DIALOG` (8) while a dialog is active, `[0DAh]`
 * as `DefDlgProc` keeps it (`dialogs.ts`); `SDS_TASKLOCKED` (16h) after
 * `LockMyTask`, `[0DEh]`. **Recorded** by `sysdbg`, through each.
 */
export function GetSystemDebugState(this: any) {
  let state = 0;

  if (this.rasterDesktop?.menuOwner) {
    state |= 0x01;
  }

  if (GetSysModalWindow.call(this)) {
    state |= 0x02;
  }

  if (this._dialogActive) {
    state |= 0x08;
  }

  if (this._lockMyTask) {
    state |= 0x10;
  }

  return state;
}
