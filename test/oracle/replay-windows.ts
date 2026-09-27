'use strict';

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { GetPixel } from '../../src/win16/gdi/GetPixel.js';
import { GlobalAlloc } from '../../src/win16/kernel/GlobalAlloc.js';
import { GlobalLock } from '../../src/win16/kernel/GlobalLock.js';
import { GetTextExtent } from '../../src/win16/gdi/GetTextExtent.js';
import { GetTextMetrics } from '../../src/win16/gdi/GetTextMetrics.js';
import { SelectObject } from '../../src/win16/gdi/SelectObject.js';
import {
  CreateDialogIndirect,
  DialogBoxIndirect,
  EndDialog,
  GetDialogBaseUnits,
  GetDlgCtrlID,
  IsDialogMessage,
} from '../../src/win16/user/dialogs.js';
import { GetDlgItem } from '../../src/win16/user/GetDlgItem.js';
import { GetSysColor, SetSysColors } from '../../src/win16/user/GetSysColor.js';
import { RedrawWindow } from '../../src/win16/user/RedrawWindow.js';
import { GetFocus } from '../../src/win16/user/GetFocus.js';
import { IsWindowEnabled } from '../../src/win16/user/window-queries.js';
import { displayMode } from '../../src/win16/display-modes.js';
import { driverResources } from '../../src/win16/user/driver-resources.js';
import { MSG, User, PAINTSTRUCT, POINT, RECT, WNDCLASS } from '../../src/win16/user.js';
import { CreatePopupMenu } from '../../src/win16/user/CreateMenu.js';
import { DispatchMessage } from '../../src/win16/user/DispatchMessage.js';
import { PeekMessage } from '../../src/win16/user/PeekMessage.js';
import { PostMessage } from '../../src/win16/user/PostMessage.js';
import { DrawText } from '../../src/win16/user/DrawText.js';
import { FillRect } from '../../src/win16/user/FillRect.js';
import { CreateCompatibleDC } from '../../src/win16/gdi/CreateCompatibleDC.js';
import { CreateCompatibleBitmap } from '../../src/win16/gdi/CreateCompatibleBitmap.js';
import { GetStockObject } from '../../src/win16/gdi/GetStockObject.js';
import { SetTextColor } from '../../src/win16/gdi/SetTextColor.js';
import { SetBkColor } from '../../src/win16/gdi/SetBkColor.js';
import { GetDriveType } from '../../src/win16/kernel/GetDriveType.js';
import { WNetGetCaps, WNetGetConnection } from '../../src/win16/user/wnet.js';
import {
  RegCloseKey,
  RegCreateKey,
  RegDeleteKey,
  RegEnumKey,
  RegOpenKey,
  RegQueryValue,
  RegSetValue,
} from '../../src/win16/shell/reg-api.js';
import { EnumFontFamilies, EnumFonts } from '../../src/win16/gdi/EnumFontFamilies.js';
import { ScreenToClient } from '../../src/win16/user/ScreenToClient.js';
import { SetCursorPos } from '../../src/win16/user/cursor-pos.js';
import { GetSystemMetrics } from '../../src/win16/user/GetSystemMetrics.js';
import { PostQuitMessage } from '../../src/win16/user/PostQuitMessage.js';
import { InvalidateRect } from '../../src/win16/user/InvalidateRect.js';
import { ValidateRect } from '../../src/win16/user/ValidateRect.js';
import { SendMessage } from '../../src/win16/user/SendMessage.js';
import { KillTimer, SetTimer } from '../../src/win16/user/SetTimer.js';
import { TrackPopupMenu } from '../../src/win16/user/TrackPopupMenu.js';
import { TranslateMessage } from '../../src/win16/user/TranslateMessage.js';
import { DrawIcon, IsIconic, IsZoomed, LoadIcon } from '../../src/win16/user/icon-api.js';
import { PatBlt } from '../../src/win16/gdi/PatBlt.js';
import { SetPixel } from '../../src/win16/gdi/SetPixel.js';
import { BitBlt } from '../../src/win16/gdi/BitBlt.js';
import { CreateBitmap } from '../../src/win16/gdi/CreateBitmap.js';
import { GetObject } from '../../src/win16/gdi/GetObject.js';
import {
  ExcludeClipRect,
  GetClipBox,
  IntersectClipRect,
  OffsetClipRgn,
  SelectClipRgn,
} from '../../src/win16/gdi/clipping.js';
import { RestoreDC, SaveDC } from '../../src/win16/gdi/SaveDC.js';
import {
  DPtoLP,
  GetMapMode,
  GetViewportExt,
  GetViewportOrg,
  GetWindowExt,
  GetWindowOrg,
  LPtoDP,
  OffsetViewportOrg,
  OffsetWindowOrg,
  ScaleViewportExt,
  ScaleWindowExt,
  SetMapMode,
  SetViewportExt,
  SetViewportOrg,
  SetWindowExt,
  SetWindowOrg,
} from '../../src/win16/gdi/mapping.js';
import { GetTextColor } from '../../src/win16/gdi/SetTextColor.js';
import { GetBkColor } from '../../src/win16/gdi/SetBkColor.js';
import { Rectangle } from '../../src/win16/gdi/Rectangle.js';
import { MoveTo } from '../../src/win16/gdi/MoveTo.js';
import { LineTo } from '../../src/win16/gdi/LineTo.js';
import { DeleteObject } from '../../src/win16/gdi/DeleteObject.js';
import {
  CreatePatternBrush,
  SetBrushOrg,
  UnrealizeObject,
} from '../../src/win16/gdi/CreatePatternBrush.js';
import { GetStretchBltMode, SetStretchBltMode, StretchBlt } from '../../src/win16/gdi/StretchBlt.js';
import { Surface } from '../../src/raster/surface.js';
import { Gdi } from '../../src/win16/gdi.js';
import { AppendMenu } from '../../src/win16/user/AppendMenu.js';
import { BeginPaint } from '../../src/win16/user/BeginPaint.js';
import { ClientToScreen } from '../../src/win16/user/ClientToScreen.js';
import { CreateMenu } from '../../src/win16/user/CreateMenu.js';
import { CreateWindow } from '../../src/win16/user/CreateWindow.js';
import { DefWindowProc } from '../../src/win16/user/DefWindowProc.js';
import { DestroyWindow } from '../../src/win16/user/DestroyWindow.js';
import { EndPaint } from '../../src/win16/user/EndPaint.js';
import { GetClientRect } from '../../src/win16/user/GetClientRect.js';
import { GetDC } from '../../src/win16/user/GetDC.js';
import { GetWindowRect } from '../../src/win16/user/GetWindowRect.js';
import { RegisterClass } from '../../src/win16/user/RegisterClass.js';
import { SendDlgItemMessage } from '../../src/win16/user/SendDlgItemMessage.js';
import { ReleaseDC } from '../../src/win16/user/ReleaseDC.js';
import { ShowWindow } from '../../src/win16/user/ShowWindow.js';
import { UpdateWindow } from '../../src/win16/user/UpdateWindow.js';
import { CreateFontIndirect } from '../../src/win16/gdi/CreateFontIndirect.js';
import { MulDiv } from '../../src/win16/gdi/MulDiv.js';
import { GetDeviceCaps } from '../../src/win16/gdi/GetDeviceCaps.js';
import { SetFocus } from '../../src/win16/user/SetFocus.js';
import { GetActiveWindow, SetActiveWindow } from '../../src/win16/user/placement.js';
import { GetParent, IsWindowVisible } from '../../src/win16/user/window-queries.js';
import { GlobalFree } from '../../src/win16/kernel/GlobalFree.js';
import { CreatePen } from '../../src/win16/gdi/CreatePen.js';
import { CreateSolidBrush } from '../../src/win16/gdi/CreateSolidBrush.js';
import { CreateFont } from '../../src/win16/gdi/CreateFont.js';
import { CreateRectRgn } from '../../src/win16/gdi/gdi-objects.js';
import { Task } from '../../src/win16/task.js';
import { MessageBox } from '../../src/win16/user/MessageBox.js';
import { GetWindowLong } from '../../src/win16/user/window-words.js';
import {
  waveGetDevCaps,
  waveGetErrorText,
  waveInGetNumDevs,
  waveOpen,
  waveOutGetNumDevs,
} from '../../src/win16/mmsystem/devices.js';
import { midiOutGetNumDevs } from '../../src/win16/mmsystem/midiOutGetNumDevs.js';
import {
  AddAtom,
  DeleteAtom,
  FindAtom,
  GetAtomName,
  GlobalAddAtom,
  GlobalDeleteAtom,
  GlobalFindAtom,
  GlobalGetAtomName,
} from '../../src/win16/atoms.js';
import { GetClipboardFormatName, RegisterWindowMessage } from '../../src/win16/user/RegisterWindowMessage.js';
import { GetClassName, GetWindow } from '../../src/win16/user/GetWindow.js';
import { TextOut } from '../../src/win16/gdi/TextOut.js';
import { InvertRect } from '../../src/win16/user/InvertRect.js';
import { CheckRadioButton } from '../../src/win16/user/dialog-items.js';
import { GetCaretBlinkTime, GetCaretPos, HideCaret, ShowCaret } from '../../src/win16/user/caret.js';
import {
  EnableScrollBar,
  GetScrollPos,
  SetScrollPos,
  SetScrollRange,
  ShowScrollBar,
} from '../../src/win16/user/scroll-bars.js';

/**
 * Replaying what a probe did with windows, through the exported calls, on
 * USER's raster desktop.
 *
 * A window is made the way the probe made it -- `RegisterClass`,
 * `CreateWindow`, `ShowWindow`, `UpdateWindow` -- and read back the way the
 * probe read it: `GetWindowRect`, `GetClientRect`, `ClientToScreen`, and
 * `GetPixel` on the screen's device context. The probe's window procedure is
 * written out here as it is in the probe, calling the exports it calls.
 *
 * What stands in for the running system is as thin as it can be: a scheduler
 * that calls that procedure directly, and a window manager with no input to
 * route. Messages Windows would have queued rather than sent are not queued;
 * the probe empties its queue before every capture, so nothing it records
 * depends on the difference.
 */

const DRIVES: Record<string, string> = {
  vga: 'drive-c',
  svga: 'drive-c-svga',
  ega: 'drive-c-ega',
  hercules: 'drive-c-hercules',
};

export class NoDrive extends Error {}

/** The display driver's bitmaps and icons, from the oracle's installation of that display. */
export function driverOf(display: string) {
  const root = join(__dirname, '..', '..', 'oracle', 'build', DRIVES[display] ?? '');
  const ini = join(root, 'WINDOWS', 'SYSTEM.INI');

  if (!existsSync(ini)) {
    throw new NoDrive(`no installation for the ${display}; run the oracle pipeline`);
  }

  const name = /^display\.drv\s*=\s*(\S+)/im.exec(readFileSync(ini, 'latin1'))?.[1] ?? 'VGA.DRV';
  const driver = new Uint8Array(readFileSync(join(root, 'WINDOWS', 'SYSTEM', name.toUpperCase())));

  const user = new Uint8Array(readFileSync(join(root, 'WINDOWS', 'SYSTEM', 'USER.EXE')));

  return driverResources(driver, displayMode(display), user);
}

/** What `chrome` made each window as. */
const CHROME: Record<string, { style: number; menu?: boolean; width?: number; height?: number }> = {
  overlapped: { style: 0x00cf0000 },
  caption: { style: 0x00c80000 },
  scroll: { style: 0x00cf0000 | 0x00200000 | 0x00100000 },
  dialog: { style: 0x80400000 },
  popup: { style: 0x80800000 },
  menu: { style: 0x00cf0000, menu: true },
  inactive: { style: 0x00cf0000 },
  controls: { style: 0x00cf0000, width: 260, height: 190 },
};

/** The controls `chrome` put in its last window: class, text, style, place, identifier. */
const CONTROLS: [string, string, number, number, number, number, number, number][] = [
  ['BUTTON', 'Push', 0x0, 8, 8, 64, 24, 10],
  ['BUTTON', 'Default', 0x1, 80, 8, 72, 24, 11],
  ['BUTTON', 'Check', 0x2, 8, 40, 72, 16, 12],
  ['BUTTON', 'Radio', 0x4, 88, 40, 72, 16, 13],
  ['STATIC', 'Static text', 0x0, 168, 40, 80, 16, 14],
  ['EDIT', 'Edit', 0x00800000, 8, 64, 100, 22, 15],
  ['LISTBOX', '', 0x00800001, 120, 64, 100, 48, 16],
  ['SCROLLBAR', '', 0x0, 8, 124, 200, 16, 17],
];

const WS_CHILD = 0x40000000;
const WS_VISIBLE = 0x10000000;
const BM_SETCHECK = 0x0401;
const LB_ADDSTRING = 0x0401;

/** The sixteen colours of the palette, as `chrome` writes them: a digit each. */
const PALETTE = [
  0x000000, 0x000080, 0x008000, 0x008080, 0x800000, 0x800080, 0x808000, 0xc0c0c0, 0x808080,
  0x0000ff, 0x00ff00, 0x00ffff, 0xff0000, 0xff00ff, 0xffff00, 0xffffff,
];

const captures = new Map<string, Promise<{ rects: string; rows: string[] } | null>>();

/**
 * One of `chrome`'s windows, made and captured as the probe did it, once per
 * display: each of its records asks for a part of the same capture.
 */
export function chromeCapture(context: any, name: string) {
  const key = `${context.display.name}:${name}`;

  if (!captures.has(key)) {
    captures.set(key, capture(context, name));
  }

  return captures.get(key)!;
}

/**
 * The probe's `pump`: every message it would have taken off its queue,
 * dispatched. Nothing is queued here, so what is left is what `PeekMessage`
 * makes when a queue is empty: `WM_PAINT`, for each window due one.
 */
async function pump(system: any) {
  for (
    let window = system.rasterDesktop.unpainted;
    window;
    window = system.rasterDesktop.unpainted
  ) {
    const handle = system.handles.resolve(window.hwnd);
    const windowClass = system.handles.retrieve(handle.options.windowClass);

    await system.scheduler.callWndProc(windowClass, window.hwnd, User.WM_PAINT, 0, 0);
  }
}

async function capture(system: any, name: string) {
  const made = CHROME[name];

  if (!made) {
    return null;
  }

  /* The probe's window procedure: what `DefWindowProc` does, and on
   * `WM_PAINT`, `BeginPaint` and `EndPaint` and nothing between them. */
  async function ProbeProc(hwnd: number, message: number, wParam: number, lParam: number) {
    if (message === User.WM_PAINT) {
      const paint = new PAINTSTRUCT();

      await BeginPaint.call(system, hwnd, paint);
      EndPaint.call(system, hwnd, paint);

      return 0;
    }

    return DefWindowProc.call(system, hwnd, message, wParam, lParam);
  }

  const kind: any = new WNDCLASS();

  kind.style = 0x0003;
  kind.lpfnWndProc = ProbeProc;
  kind.hbrBackground = 5 + 1;
  kind.lpszClassName = 'ProbeFrame';
  await RegisterClass.call(system, kind);

  const make = async (
    style: number,
    menu: number,
    x: number,
    y: number,
    w: number,
    h: number,
    title = 'Probe'
  ) => {
    const hwnd = await CreateWindow.call(
      system,
      'ProbeFrame',
      title,
      style,
      x,
      y,
      w,
      h,
      0,
      menu,
      0,
      0
    );

    await ShowWindow.call(system, hwnd, User.SW_SHOWNORMAL);

    return hwnd;
  };

  let menu = 0;

  if (made.menu) {
    menu = CreateMenu.call(system);
    AppendMenu.call(system, menu, 0, 1, '&File');
    AppendMenu.call(system, menu, 0, 2, '&Edit');
    AppendMenu.call(system, menu, 0, 3, '&Help');
  }

  const hwnd = await make(made.style, menu, 40, 40, made.width ?? 200, made.height ?? 120);

  if (name === 'controls') {
    for (const [type, text, style, x, y, w, h, id] of CONTROLS) {
      await CreateWindow.call(
        system,
        type,
        text,
        WS_CHILD | WS_VISIBLE | style,
        x,
        y,
        w,
        h,
        hwnd,
        id,
        0,
        0
      );
    }

    await SendDlgItemMessage.call(system, hwnd, 12, BM_SETCHECK, 1, 0);
    await SendDlgItemMessage.call(system, hwnd, 13, BM_SETCHECK, 1, 0);
    await SendDlgItemMessage.call(system, hwnd, 16, LB_ADDSTRING, 0, 'First');
    await SendDlgItemMessage.call(system, hwnd, 16, LB_ADDSTRING, 0, 'Second');
  }

  if (name === 'inactive') {
    await make(0x00cf0000, 0, 400, 300, 160, 100, 'Other');
  }

  await UpdateWindow.call(system, hwnd);
  await pump(system);

  const window: any = new RECT();
  const client: any = new RECT();
  const corner: any = new POINT();

  GetWindowRect.call(system, hwnd, window);
  GetClientRect.call(system, hwnd, client);
  ClientToScreen.call(system, hwnd, corner);

  const rects =
    `window=${window.left}:${window.top}:${window.right}:${window.bottom},` +
    `client=${corner.x}:${corner.y}:${corner.x + client.right}:${corner.y + client.bottom}`;

  const screen = GetDC.call(system, 0);
  const rows: string[] = [];

  for (let y = window.top; y < window.bottom; y++) {
    let row = '';

    for (let x = window.left; x < window.right; x++) {
      const index = PALETTE.indexOf(GetPixel.call(system, screen, x, y) & 0xffffff);

      row += index < 0 ? '?' : index.toString(16);
    }

    rows.push(row);
  }

  ReleaseDC.call(system, 0, screen);
  DestroyWindow.call(system, hwnd);

  return { rects, rows };
}

/* ---- menus ---- */

const MENUS_AREA = { left: 32, top: 32, right: 352, bottom: 272 };
const WM_TIMER = 0x0113;
const WM_KEYDOWN = 0x0100;
const WM_SYSCOMMAND = 0x0112;
const SC_KEYMENU = 0xf100;
const VK_ESCAPE = 0x1b;
const VK_DOWN = 0x28;
const MF_STRING = 0x0000;
const MF_GRAYED = 0x0001;
const MF_CHECKED = 0x0008;
const MF_POPUP = 0x0010;
const MF_SEPARATOR = 0x0800;

const menuCaptures = new Map<string, Promise<Map<string, string[]>>>();

/**
 * The `menus` probe, replayed through the exports, once per display: its
 * window with a menu bar, and each menu opened from inside and read back by
 * its window procedure on a timer, as the probe does it. The menu's own loop
 * dispatches the timer; the procedure posts Escape until the menu is gone.
 */
export function menusCapture(context: any) {
  const key = context.display.name;

  if (!menuCaptures.has(key)) {
    menuCaptures.set(key, captureMenus(context));
  }

  return menuCaptures.get(key)!;
}

async function captureMenus(system: any) {
  const captured = new Map<string, string[]>();
  let pending: string | null = null;
  let frame = 0;

  const read = (name: string) => {
    const screen = GetDC.call(system, 0);
    const rows: string[] = [];

    for (let y = MENUS_AREA.top; y < MENUS_AREA.bottom; y++) {
      let row = '';

      for (let x = MENUS_AREA.left; x < MENUS_AREA.right; x++) {
        const index = PALETTE.indexOf(GetPixel.call(system, screen, x, y) & 0xffffff);

        row += index < 0 ? '?' : index.toString(16);
      }

      rows.push(row);
    }

    ReleaseDC.call(system, 0, screen);
    captured.set(name, rows);
  };

  async function ProbeProc(hwnd: number, message: number, wParam: number, lParam: number) {
    if (message === User.WM_PAINT) {
      const paint = new PAINTSTRUCT();

      await BeginPaint.call(system, hwnd, paint);
      EndPaint.call(system, hwnd, paint);
      return 0;
    }

    if (message === WM_TIMER && wParam === 1) {
      KillTimer.call(system, hwnd, 1);

      if (pending) {
        read(pending);
        pending = null;
      }

      PostMessage.call(system, hwnd, WM_KEYDOWN, VK_ESCAPE, 0);
      PostMessage.call(system, hwnd, WM_KEYDOWN, VK_ESCAPE, 0);
      PostMessage.call(system, hwnd, WM_KEYDOWN, VK_ESCAPE, 0);
      return 0;
    }

    return DefWindowProc.call(system, hwnd, message, wParam, lParam);
  }

  /* The probe's pump: every queued message taken and dispatched. */
  const pump = async () => {
    const msg: any = new MSG();

    while (await PeekMessage.call(system, msg, 0, 0, 0, User.PM_REMOVE)) {
      TranslateMessage.call(system, msg);
      await DispatchMessage.call(system, msg);
    }
  };

  const kind: any = new WNDCLASS();

  kind.style = 0x0003;
  kind.lpfnWndProc = ProbeProc;
  kind.hbrBackground = 5 + 1;
  kind.lpszClassName = 'ProbeMenus';
  await RegisterClass.call(system, kind);

  const recent = CreatePopupMenu.call(system);
  AppendMenu.call(system, recent, MF_STRING, 20, '&First');
  AppendMenu.call(system, recent, MF_STRING, 21, '&Second');

  const file = CreatePopupMenu.call(system);
  AppendMenu.call(system, file, MF_STRING, 10, '&New');
  AppendMenu.call(system, file, MF_STRING, 11, '&Open...\tCtrl+O');
  AppendMenu.call(system, file, MF_SEPARATOR, 0, null);
  AppendMenu.call(system, file, MF_STRING | MF_CHECKED, 12, '&Word Wrap');
  AppendMenu.call(system, file, MF_STRING | MF_GRAYED, 13, '&Print');
  AppendMenu.call(system, file, MF_POPUP, recent, '&Recent');
  AppendMenu.call(system, file, MF_SEPARATOR, 0, null);
  AppendMenu.call(system, file, MF_STRING, 14, 'E&xit');

  const edit = CreatePopupMenu.call(system);
  AppendMenu.call(system, edit, MF_STRING, 30, '&Undo');

  const bar = CreateMenu.call(system);
  AppendMenu.call(system, bar, MF_POPUP, file, '&File');
  AppendMenu.call(system, bar, MF_POPUP, edit, '&Edit');
  AppendMenu.call(system, bar, MF_STRING, 40, '&Help');

  frame = await CreateWindow.call(
    system,
    'ProbeMenus',
    'Menus',
    0x00cf0000,
    40,
    40,
    240,
    160,
    0,
    bar,
    0,
    0
  );
  await ShowWindow.call(system, frame, User.SW_SHOWNORMAL);
  await UpdateWindow.call(system, frame);
  await pump();

  read('bar');

  const captureOpen = async (name: string, key: number, down: boolean) => {
    pending = name;
    SetTimer.call(system, frame, 1, 300, 0);

    if (down) {
      PostMessage.call(system, frame, WM_KEYDOWN, VK_DOWN, 0);
    }

    await SendMessage.call(system, frame, WM_SYSCOMMAND, SC_KEYMENU, key);
    await pump();
  };

  await captureOpen('file', 'f'.charCodeAt(0), false);
  await captureOpen('down', 'f'.charCodeAt(0), true);

  const popup = CreatePopupMenu.call(system);
  AppendMenu.call(system, popup, MF_STRING, 50, '&Cut');
  AppendMenu.call(system, popup, MF_STRING, 51, 'C&opy');
  AppendMenu.call(system, popup, MF_STRING | MF_GRAYED, 52, '&Paste');
  pending = 'popup';
  SetTimer.call(system, frame, 1, 300, 0);
  await TrackPopupMenu.call(system, popup, 0, 150, 120, 0, frame, 0);
  await pump();

  await captureOpen('system', ' '.charCodeAt(0), false);

  DestroyWindow.call(system, frame);

  return captured;
}

/* ---- sizing and icons ---- */

/** Every pixel of a rectangle of the screen, a row a string, as the probes write them. */
function readArea(system: any, left: number, top: number, right: number, bottom: number) {
  const screen = GetDC.call(system, 0);
  const rows: string[] = [];

  for (let y = top; y < bottom; y++) {
    let row = '';

    for (let x = left; x < right; x++) {
      const index = PALETTE.indexOf(GetPixel.call(system, screen, x, y) & 0xffffff);

      row += index < 0 ? '?' : index.toString(16);
    }

    rows.push(row);
  }

  ReleaseDC.call(system, 0, screen);

  return rows;
}

/** What a probe that captures areas recorded: each area's bounds and rows, and rectangles. */
export interface Captured {
  areas: Map<string, { bounds: string; rows: string[] }>;
  rects: Map<string, string>;
  loaded: Map<string, string>;
}

const sizingCaptures = new Map<string, Promise<Captured>>();
const iconCaptures = new Map<string, Promise<Captured>>();

/** The `sizing` probe, replayed through the exports once per display. */
export function sizingCapture(context: any) {
  const key = context.display.name;

  if (!sizingCaptures.has(key)) {
    sizingCaptures.set(key, captureSizing(context));
  }

  return sizingCaptures.get(key)!;
}

/** The `icons` probe, replayed through the exports once per display. */
export function iconsCapture(context: any) {
  const key = context.display.name;

  if (!iconCaptures.has(key)) {
    iconCaptures.set(key, captureIcons(context));
  }

  return iconCaptures.get(key)!;
}

/** A class whose procedure paints only what `DefWindowProc` would. */
async function probeClass(system: any, name: string, icon: number) {
  async function ProbeProc(hwnd: number, message: number, wParam: number, lParam: number) {
    if (message === User.WM_PAINT) {
      const paint = new PAINTSTRUCT();

      await BeginPaint.call(system, hwnd, paint);
      EndPaint.call(system, hwnd, paint);
      return 0;
    }

    return DefWindowProc.call(system, hwnd, message, wParam, lParam);
  }

  const kind: any = new WNDCLASS();

  kind.style = 0x0003;
  kind.lpfnWndProc = ProbeProc;
  kind.hIcon = icon;
  kind.hbrBackground = 5 + 1;
  kind.lpszClassName = name;
  await RegisterClass.call(system, kind);
}

async function pumpAll(system: any) {
  const msg: any = new MSG();

  while (await PeekMessage.call(system, msg, 0, 0, 0, User.PM_REMOVE)) {
    TranslateMessage.call(system, msg);
    await DispatchMessage.call(system, msg);
  }
}

async function captureSizing(system: any): Promise<Captured> {
  const captured: Captured = { areas: new Map(), rects: new Map(), loaded: new Map() };
  const width = system.display.width;
  const height = system.display.height;

  await probeClass(system, 'ProbeSizing', await LoadIcon.call(system, 0, 32512));

  const frame = await CreateWindow.call(
    system,
    'ProbeSizing',
    'Probe',
    0x00cf0000,
    40,
    40,
    200,
    120,
    0,
    0,
    0,
    0
  );

  const rects = (name: string) => {
    const window: any = new RECT();
    const client: any = new RECT();
    const corner: any = new POINT();

    GetWindowRect.call(system, frame, window);
    GetClientRect.call(system, frame, client);
    ClientToScreen.call(system, frame, corner);

    captured.rects.set(
      name,
      `window=${window.left}:${window.top}:${window.right}:${window.bottom},` +
        `client=${corner.x}:${corner.y}:${corner.x + client.right}:${corner.y + client.bottom},` +
        `iconic=${IsIconic.call(system, frame)},zoomed=${IsZoomed.call(system, frame)}`
    );
  };

  const area = (name: string, left: number, top: number, right: number, bottom: number) =>
    captured.areas.set(name, {
      bounds: `${left}:${top}:${right}:${bottom}`,
      rows: readArea(system, left, top, right, bottom),
    });

  const show = async (how: number) => {
    await ShowWindow.call(system, frame, how);
    await UpdateWindow.call(system, frame);
    await pumpAll(system);
  };

  await show(User.SW_SHOWNORMAL);
  rects('normal');

  await show(User.SW_SHOWMAXIMIZED);
  rects('maximized');
  area('maximized', 0, 0, width, 24);
  await show(User.SW_RESTORE);
  rects('restored');

  await show(User.SW_SHOWMINIMIZED);
  rects('minimized');

  const icon: any = new RECT();

  GetWindowRect.call(system, frame, icon);
  area(
    'minimized',
    icon.left > 48 ? icon.left - 48 : 0,
    icon.top - 4,
    icon.right + 48 < width ? icon.right + 48 : width,
    height
  );
  await show(User.SW_RESTORE);
  rects('unminimized');

  const track = async (command: number) => {
    for (let step = 0; step < 3; step++) PostMessage.call(system, frame, WM_KEYDOWN, VK_RIGHT, 0);
    for (let step = 0; step < 2; step++) PostMessage.call(system, frame, WM_KEYDOWN, VK_DOWN, 0);
    PostMessage.call(system, frame, WM_KEYDOWN, VK_RETURN, 0);
    await SendMessage.call(system, frame, WM_SYSCOMMAND, command, 0);
    await pumpAll(system);
    await UpdateWindow.call(system, frame);
    await pumpAll(system);
  };

  await track(SC_MOVE);
  rects('moved');
  await track(SC_SIZE);
  rects('sized');

  DestroyWindow.call(system, frame);

  return captured;
}

async function captureIcons(system: any): Promise<Captured> {
  const captured: Captured = { areas: new Map(), rects: new Map(), loaded: new Map() };
  const names: [string, number][] = [
    ['IDI_APPLICATION', 32512],
    ['IDI_HAND', 32513],
    ['IDI_QUESTION', 32514],
    ['IDI_EXCLAMATION', 32515],
    ['IDI_ASTERISK', 32516],
  ];
  const width = system.display.width;
  const height = system.display.height;

  /* The desktop is there before any program runs. */
  void system.rasterDesktop;

  const screen = GetDC.call(system, 0);

  PatBlt.call(system, screen, 0, 0, 240, 56, Gdi.WHITENESS);

  for (const [index, [label, id]] of names.entries()) {
    const handle = await LoadIcon.call(system, 0, id);

    captured.loaded.set(label, handle ? '1' : '0');

    if (handle) {
      DrawIcon.call(system, screen, 8 + index * 44, 8, handle);
    }
  }

  ReleaseDC.call(system, 0, screen);
  captured.areas.set('drawn', { bounds: '0:0:240:56', rows: readArea(system, 0, 0, 240, 56) });

  await probeClass(system, 'ProbeBare', 0);

  const bare = await CreateWindow.call(
    system,
    'ProbeBare',
    'Bare',
    0x00cf0000,
    40,
    40,
    200,
    120,
    0,
    0,
    0,
    0
  );

  await ShowWindow.call(system, bare, User.SW_SHOWMINIMIZED);
  await UpdateWindow.call(system, bare);
  await pumpAll(system);

  const icon: any = new RECT();

  GetWindowRect.call(system, bare, icon);

  const left = icon.left > 48 ? icon.left - 48 : 0;
  const right = icon.right + 48 < width ? icon.right + 48 : width;

  captured.areas.set('bare', {
    bounds: `${left}:${icon.top - 4}:${right}:${height}`,
    rows: readArea(system, left, icon.top - 4, right, height),
  });
  DestroyWindow.call(system, bare);

  return captured;
}

const VK_RETURN = 0x0d;
const VK_RIGHT = 0x27;
const SC_MOVE = 0xf010;
const SC_SIZE = 0xf000;

/**
 * The `quitord` probe, replayed through the exports: two messages posted
 * around a quit, a paint and a timer due, and what `PeekMessage` takes, in
 * turn, as the probe writes it.
 */
export async function quitOrder(system: any) {
  await probeClass(system, 'ProbeQuit', 0);

  const window = await CreateWindow.call(
    system,
    'ProbeQuit',
    'Quit',
    0x00cf0000,
    40,
    40,
    200,
    120,
    0,
    0,
    0,
    0
  );

  await ShowWindow.call(system, window, User.SW_SHOWNORMAL);
  await UpdateWindow.call(system, window);
  await pumpAll(system);

  PostMessage.call(system, window, 0x400, 1, 0);
  PostQuitMessage.call(system, 7);
  PostMessage.call(system, window, 0x400, 2, 0);
  await InvalidateRect.call(system, window, null, 1);
  SetTimer.call(system, window, 1, 55, 0);

  const order: string[] = [];
  const msg: any = new MSG();
  let quits = 0;

  for (
    let index = 0;
    index < 12 && (await PeekMessage.call(system, msg, 0, 0, 0, User.PM_REMOVE));
    index++
  ) {
    order.push(`message=${msg.message.toString(16).padStart(4, '0')},wParam=${msg.wParam}`);

    if (msg.message === User.WM_QUIT) {
      quits++;
    } else if (msg.message === User.WM_PAINT) {
      ValidateRect.call(system, window);
    } else if (msg.message === User.WM_TIMER) {
      KillTimer.call(system, window, 1);
    }
  }

  return { order, quits };
}

/* ---- dialogs ---- */

export interface DialogCaptured {
  records: Map<string, string>;
  rows: Map<string, string[]>;
}

const dialogCaptures = new Map<string, Promise<DialogCaptured>>();

/** The `dialogs` probe, replayed through the exports once per display. */
export function dialogsCapture(context: any) {
  const key = context.display.name;

  if (!dialogCaptures.has(key)) {
    dialogCaptures.set(key, captureDialogs(context));
  }

  return dialogCaptures.get(key)!;
}

/** The probe's dialog template, as its `build` makes it. */
function dialogTemplate(
  font: boolean,
  x = 10,
  controls = true,
  caption = 'Probe Dialog',
  style?: number
) {
  const bytes: number[] = [];
  const word = (value: number) => bytes.push(value & 0xff, (value >> 8) & 0xff);
  const text = (value: string) => {
    for (const c of value) bytes.push(c.charCodeAt(0));
    bytes.push(0);
  };
  const WS_VISIBLE = 0x10000000;
  const base = style ?? 0x80000000 | 0x00c00000 | 0x00080000 | 0x80 | WS_VISIBLE;
  const dialogStyle = (font ? base | 0x40 : base) >>> 0;
  const items: [number, number, number, number, number, number, number, string][] = controls
    ? [
        [6, 8, 30, 8, 100, 0x0, 0x82, '&Name:'],
        [40, 6, 110, 12, 101, 0x0 | 0x00800000 | 0x00010000, 0x81, ''],
        [6, 26, 60, 10, 102, 0x3 | 0x00010000, 0x80, '&Check'],
        [6, 40, 60, 10, 103, 0x9 | 0x00020000 | 0x00010000, 0x80, 'Radio &1'],
        [6, 52, 60, 10, 104, 0x9, 0x80, 'Radio &2'],
        [30, 70, 40, 14, 1, 0x1 | 0x00020000 | 0x00010000, 0x80, 'OK'],
        [90, 70, 40, 14, 2, 0x0 | 0x00010000, 0x80, 'Cancel'],
      ]
    : [];

  word(dialogStyle & 0xffff);
  word(dialogStyle >>> 16);
  bytes.push(items.length);
  word(x);
  word(10);
  word(160);
  word(90);
  bytes.push(0, 0);
  text(caption);

  if (font) {
    word(8);
    text('MS Sans Serif');
  }

  for (const [ix, iy, cx, cy, id, itemStyle, kind, label] of items) {
    const full = (itemStyle | 0x40000000 | WS_VISIBLE) >>> 0;

    word(ix);
    word(iy);
    word(cx);
    word(cy);
    word(id);
    word(full & 0xffff);
    word(full >>> 16);
    bytes.push(kind);
    text(label);
    bytes.push(0);
  }

  return bytes;
}

async function captureDialogs(system: any): Promise<DialogCaptured> {
  const records = new Map<string, string>();
  const rows = new Map<string, string[]>();
  const core = system.machine.cpu.core;

  /* Somewhere in the program's memory to build each template. */
  const memory = GlobalAlloc.call(system, 0x42, 512);
  const far = GlobalLock.call(system, memory);
  const place = (bytes: number[]) => {
    bytes.forEach((value, at) => core.write8((far >>> 16) & 0xffff, (far & 0xffff) + at, value));
  };

  /* The desktop exists before the program does. */
  void system.rasterDesktop;

  await probeClass(system, 'ProbeOwner', 0);
  const owner = await CreateWindow.call(
    system,
    'ProbeOwner',
    'Owner',
    0x00cf0000,
    20,
    20,
    400,
    300,
    0,
    0,
    0,
    0
  );

  await ShowWindow.call(system, owner, User.SW_SHOWNORMAL);
  await UpdateWindow.call(system, owner);
  await pumpAll(system);

  const units = GetDialogBaseUnits.call(system);

  records.set('units:', `x=${units & 0xffff},y=${units >>> 16}`);

  let phase = '';

  const dialogProc = (hwnd: number, message: number, wParam: number) => {
    if (message === User.WM_INITDIALOG) {
      return 1;
    }

    if (message === User.WM_COMMAND && (wParam === 1 || wParam === 2)) {
      records.set(`command:${phase}`, `id=${wParam}`);
      return 1;
    }

    return 0;
  };

  const pumpDialog = async (dialog: number) => {
    const msg: any = new MSG();

    while (await PeekMessage.call(system, msg, 0, 0, 0, User.PM_REMOVE)) {
      if (!(await IsDialogMessage.call(system, dialog, msg))) {
        TranslateMessage.call(system, msg);
        await DispatchMessage.call(system, msg);
      }
    }
  };

  const focusId = () => {
    const focus = GetFocus.call(system);

    return focus ? GetDlgCtrlID.call(system, focus) : -1;
  };

  const rectOf = (hwnd: number) => {
    const rect: any = new RECT();

    GetWindowRect.call(system, hwnd, rect);
    return rect;
  };

  for (const name of ['system', 'font']) {
    place(dialogTemplate(name === 'font'));
    const dialog = await CreateDialogIndirect.call(system, 0, far, owner, dialogProc);

    await pumpDialog(dialog);

    const window = rectOf(dialog);
    const client: any = new RECT();
    const corner: any = new POINT();

    GetClientRect.call(system, dialog, client);
    ClientToScreen.call(system, dialog, corner);
    records.set(
      `rects:${name}`,
      `window=${window.left}:${window.top}:${window.right}:${window.bottom},` +
        `client=${corner.x}:${corner.y}:${corner.x + client.right}:${corner.y + client.bottom}`
    );

    for (const id of [100, 101, 102, 103, 104, 1, 2]) {
      const rect = rectOf(GetDlgItem.call(system, dialog, id));

      records.set(
        `control:${name},id=${id}`,
        `${rect.left - corner.x}:${rect.top - corner.y}:${rect.right - corner.x}:${rect.bottom - corner.y}`
      );
    }

    /* The dialog's font, and the letters in it. */
    const font = await SendMessage.call(system, dialog, User.WM_GETFONT, 0, 0);
    const logfont = font ? system.handles.resolve(font)?.logfont : null;

    records.set(
      `dialogfont:${name}`,
      logfont ? `height=${logfont.height},weight=${logfont.weight},face=${logfont.face}` : 'none'
    );

    const dc = GetDC.call(system, dialog);
    const old = font ? SelectObject.call(system, dc, font) : 0;
    const metrics: any = {};

    GetTextMetrics.call(system, dc, metrics);
    const letters =
      GetTextExtent.call(system, dc, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', 52) &
      0xffff;

    records.set(
      `measure:${name}`,
      `letters=${letters},average=${metrics.tmAveCharWidth},height=${metrics.tmHeight}`
    );

    if (old) {
      SelectObject.call(system, dc, old);
    }

    ReleaseDC.call(system, dialog, dc);
    rows.set(name, readArea(system, window.left, window.top, window.right, window.bottom));

    records.set(`focus:${name},created`, String(focusId()));

    for (let press = 1; press <= 6; press++) {
      PostMessage.call(system, GetFocus.call(system), User.WM_KEYDOWN, 0x09, 0);
      await pumpDialog(dialog);
      records.set(`focus:${name},tab=${press}`, String(focusId()));
    }

    phase = `${name},enter`;
    PostMessage.call(system, GetFocus.call(system), User.WM_KEYDOWN, 0x0d, 0);
    await pumpDialog(dialog);
    phase = `${name},escape`;
    PostMessage.call(system, GetFocus.call(system), User.WM_KEYDOWN, 0x1b, 0);
    await pumpDialog(dialog);

    await DestroyWindow.call(system, dialog);
    await pumpAll(system);
  }

  for (let index = 0; index < 10; index++) {
    place(
      dialogTemplate(false, index, false, 'Place', 0x80000000 | 0x00c00000 | 0x80 | 0x10000000)
    );
    const dialog = await CreateDialogIndirect.call(system, 0, far, owner, dialogProc);

    await pumpDialog(dialog);

    const window = rectOf(dialog);
    const corner: any = new POINT();

    ClientToScreen.call(system, dialog, corner);
    records.set(
      `placement:x=${index}`,
      `window=${window.left}:${window.top},client=${corner.x}:${corner.y}`
    );
    await DestroyWindow.call(system, dialog);
    await pumpAll(system);
  }

  /* Modal: a timer ends it, and the owner is asked about while it runs. */
  place(dialogTemplate(false));
  const modalProc = (hwnd: number, message: number) => {
    if (message === User.WM_INITDIALOG) {
      SetTimer.call(system, hwnd, 1, 55, 0);
      return 1;
    }

    if (message === User.WM_TIMER) {
      KillTimer.call(system, hwnd, 1);
      records.set('modal:owner-enabled-during', String(IsWindowEnabled.call(system, owner)));
      EndDialog.call(system, hwnd, 42);
      return 1;
    }

    return 0;
  };

  const answer = await DialogBoxIndirect.call(system, 0, memory, owner, modalProc);

  records.set('modal:answer', String(answer));
  records.set('modal:owner-enabled-after', String(IsWindowEnabled.call(system, owner)));

  await DestroyWindow.call(system, owner);

  return { records, rows };
}

/* ---- dlgcolor ---- */

const dlgColorCaptures = new Map<string, Promise<Map<string, string>>>();

/** The `dlgcolor` probe, replayed through the exports once per display. */
export function dlgColorCapture(context: any) {
  const key = context.display.name;

  if (!dlgColorCaptures.has(key)) {
    dlgColorCaptures.set(key, captureDlgColor(context));
  }

  return dlgColorCaptures.get(key)!;
}

async function captureDlgColor(system: any) {
  const records = new Map<string, string>();
  const core = system.machine.cpu.core;
  const memory = GlobalAlloc.call(system, 0x42, 256);
  const far = GlobalLock.call(system, memory);
  const segment = (far >>> 16) & 0xffff;
  const write = (at: number, bytes: number[]) =>
    bytes.forEach((value, index) => core.write8(segment, at + index, value));

  void system.rasterDesktop;

  /* The probe's dialog: a caption, a system menu, a modal frame, no controls. */
  const style = (0x80000000 | 0x00c00000 | 0x00080000 | 0x80 | 0x10000000) >>> 0;

  write(0, [
    style & 0xff,
    (style >>> 8) & 0xff,
    (style >>> 16) & 0xff,
    style >>> 24,
    0,
    20,
    0,
    20,
    0,
    100,
    0,
    50,
    0,
    0,
    0,
    0x44,
    0,
  ]);

  const dialog = await CreateDialogIndirect.call(system, 0, far, 0, (_: number, message: number) =>
    message === User.WM_INITDIALOG ? 1 : 0
  );

  await pumpAll(system);

  const colours: [string, number][] = [
    ['inactivecaption', 3],
    ['menu', 4],
    ['window', 5],
    ['captiontext', 9],
    ['highlighttext', 14],
    ['btnhighlight', 20],
    ['activecaption', 2],
    ['windowframe', 6],
    ['btnface', 15],
  ];

  const digit = (x: number, y: number) => {
    const screen = GetDC.call(system, 0);
    const index = PALETTE.indexOf(GetPixel.call(system, screen, x, y) & 0xffffff);

    ReleaseDC.call(system, 0, screen);
    return index < 0 ? '?' : index.toString(16);
  };

  for (const [name, index] of colours) {
    const was = GetSysColor.call(system, index);

    const set = async (colour: number) => {
      write(100, [
        index & 0xff,
        index >> 8,
        colour & 0xff,
        (colour >> 8) & 0xff,
        (colour >> 16) & 0xff,
        0,
      ]);
      await SetSysColors.call(system, 1, far + 100, far + 102);
    };

    await set(0x0000ff);
    await RedrawWindow.call(system, dialog, null, 0, 0x0400 | 0x0001 | 0x0004 | 0x0100);
    await pumpAll(system);

    const window: any = new RECT();

    GetWindowRect.call(system, dialog, window);
    records.set(
      name,
      `top=${digit(window.left + 30, window.top + 4)},side=${digit(window.left + 5, window.top + 30)},` +
        `ring=${digit(window.left + 2, window.top + 30)},outline=${digit(window.left, window.top + 30)},` +
        `client=${digit(window.left + 30, window.top + 40)}`
    );

    await set(was);
    await pumpAll(system);
  }

  await DestroyWindow.call(system, dialog);

  return records;
}

/* ---- dlgclamp ---- */

/** The `dlgclamp` probe: an empty dialog with no owner at a place, and where its window went. */
export async function dialogPlace(system: any, x: number, y: number) {
  void system.rasterDesktop;

  const core = system.machine.cpu.core;
  const memory = GlobalAlloc.call(system, 0x42, 64);
  const far = GlobalLock.call(system, memory);
  const style = (0x80000000 | 0x00c00000 | 0x00080000 | 0x80 | 0x10000000) >>> 0;
  const word = (value: number) => [value & 0xff, (value >> 8) & 0xff];
  const bytes = [
    ...word(style & 0xffff),
    ...word(style >>> 16),
    0,
    ...word(x),
    ...word(y),
    ...word(100),
    ...word(50),
    0,
    0,
    0x44,
    0,
  ];

  bytes.forEach((value, at) => core.write8((far >>> 16) & 0xffff, (far & 0xffff) + at, value));

  const dialog = await CreateDialogIndirect.call(system, 0, far, 0, (_: number, message: number) =>
    message === User.WM_INITDIALOG ? 1 : 0
  );
  const window: any = new RECT();

  GetWindowRect.call(system, dialog, window);
  await DestroyWindow.call(system, dialog);

  return `window=${window.left}:${window.top}:${window.right}:${window.bottom}`;
}

/* ---- editctl ---- */

const editCaptures = new Map<string, Promise<Map<string, string>>>();

/** The `editctl` probe, replayed through the exports once per display. */
export function editCapture(context: any) {
  const key = context.display.name;

  if (!editCaptures.has(key)) {
    editCaptures.set(key, captureEdit(context));
  }

  return editCaptures.get(key)!;
}

async function captureEdit(system: any) {
  const records = new Map<string, string>();
  let notes = '';
  const WM_CHAR = 0x0102;
  const WM_KEYDOWN = 0x0100;
  const WM_KEYUP = 0x0101;
  const EM_GETSEL = 0x0400;
  const EM_SETSEL = 0x0401;
  const EM_LIMITTEXT = 0x0415;

  void system.rasterDesktop;

  async function HostProc(hwnd: number, message: number, wParam: number, lParam: number) {
    /* As the probe keeps them: nothing more once 240 characters are written. */
    if (message === User.WM_COMMAND && (lParam & 0xffff) !== 0) {
      if (notes.length < 240) {
        notes += `${notes ? ':' : ''}${((lParam >>> 16) & 0xffff).toString(16)}`;
      }

      return 0;
    }

    if (message === User.WM_PAINT) {
      const paint = new PAINTSTRUCT();

      await BeginPaint.call(system, hwnd, paint);
      EndPaint.call(system, hwnd, paint);
      return 0;
    }

    return DefWindowProc.call(system, hwnd, message, wParam, lParam);
  }

  const kind: any = new WNDCLASS();

  kind.style = 0;
  kind.lpfnWndProc = HostProc;
  kind.hbrBackground = 5 + 1;
  kind.lpszClassName = 'EditHost';
  await RegisterClass.call(system, kind);

  const host = await CreateWindow.call(system, 'EditHost', 'Edit', 0x00cf0000 | 0x10000000, 40, 40, 300, 160, 0, 0, 0, 0);
  const editStyle = 0x40000000 | 0x10000000 | 0x00800000 | 0x0080;
  const first = await CreateWindow.call(system, 'EDIT', '', editStyle, 8, 8, 120, 20, host, 100, 0, 0);
  const second = await CreateWindow.call(system, 'EDIT', 'Sans', editStyle, 8, 40, 120, 20, host, 101, 0, 0);

  const screen = GetDC.call(system, 0);
  const font = CreateFontIndirect.call(system, {
    lfHeight: -MulDiv(8, GetDeviceCaps.call(system, screen, 90), 72),
    lfWidth: 0,
    lfEscapement: 0,
    lfOrientation: 0,
    lfWeight: 700,
    lfItalic: 0,
    lfUnderline: 0,
    lfStrikeOut: 0,
    lfCharSet: 0,
    lfOutPrecision: 0,
    lfClipPrecision: 0,
    lfQuality: 0,
    lfPitchAndFamily: 0x22,
    lfFaceName: 'MS Sans Serif',
  });

  ReleaseDC.call(system, 0, screen);
  await SendMessage.call(system, second, User.WM_SETFONT, font, 0);
  await UpdateWindow.call(system, host);
  await pumpAll(system);
  notes = '';

  records.set('blink:', String(GetCaretBlinkTime.call(system)));

  const state = async (edit: number, step: string) => {
    const caret: any = new POINT();
    const selection = (await SendMessage.call(system, edit, EM_GETSEL, 0, 0)) >>> 0;

    GetCaretPos.call(system, caret);
    records.set(`caret:${step}`, `${caret.x}:${caret.y}`);
    records.set(`sel:${step}`, `${selection & 0xffff}:${selection >>> 16}`);
    records.set(`text:${step}`, await windowText(system, edit));
    records.set(`notes:${step}`, notes);
    notes = '';
  };

  const read = (edit: number) => {
    const window: any = new RECT();
    const dc = GetDC.call(system, 0);
    const rows: string[] = [];

    GetWindowRect.call(system, edit, window);

    for (let y = 0; y < 24 && window.top + y < window.bottom; y++) {
      let row = '';

      for (let x = 0; x < 120 && window.left + x < window.right; x++) {
        const index = PALETTE.indexOf(GetPixel.call(system, dc, window.left + x, window.top + y) & 0xffffff);

        row += index < 0 ? '?' : index.toString(16);
      }

      rows.push(row);
    }

    ReleaseDC.call(system, 0, dc);
    return rows;
  };

  const capture = (edit: number, name: string) => {
    HideCaret.call(system, edit);
    ShowCaret.call(system, edit);
    const shown = read(edit);

    HideCaret.call(system, edit);
    const hidden = read(edit);
    const pixels: string[] = [];

    hidden.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        if (shown[y][x] !== row[x]) {
          pixels.push(`${x}:${y}=${shown[y][x]}`);
        }
      }
    });

    records.set(`caretpix:${name}`, pixels.join(','));
    hidden.forEach((row, y) => records.set(`rows:${name},y=${y}`, row));
    ShowCaret.call(system, edit);
  };

  const type = async (edit: number, text: string) => {
    for (const character of text) {
      await SendMessage.call(system, edit, WM_CHAR, character.charCodeAt(0), 1);
    }
  };

  const key = async (edit: number, vk: number) => {
    await SendMessage.call(system, edit, WM_KEYDOWN, vk, 1);
    await SendMessage.call(system, edit, WM_KEYUP, vk, 0xc0000001);
  };

  await SetFocus.call(system, first);
  await pumpAll(system);
  await state(first, 'focus');
  capture(first, 'empty');

  for (let index = 0; index < 5; index++) {
    await type(first, 'Hello'[index]);
    await state(first, `type${index + 1}`);
  }

  capture(first, 'hello');

  await key(first, 0x24);
  await state(first, 'home');
  await key(first, 0x27);
  await key(first, 0x27);
  await state(first, 'right2');
  await key(first, 0x23);
  await state(first, 'end');
  await key(first, 0x25);
  await state(first, 'left');
  await key(first, 0x23);

  await type(first, '\b');
  await state(first, 'backspace');
  await key(first, 0x24);
  await key(first, 0x2e);
  await state(first, 'delete');

  await SendMessage.call(system, first, EM_SETSEL, 0, 1 | (3 << 16));
  await state(first, 'setsel');
  capture(first, 'selected');
  await type(first, 'X');
  await state(first, 'replace');

  await key(first, 0x23);
  await type(first, 'abcdefghijklmnopqrstuvwxyz');
  await state(first, 'long');
  capture(first, 'long');
  await key(first, 0x24);
  await state(first, 'longhome');
  capture(first, 'longhome');

  await SendMessage.call(system, first, User.WM_SETTEXT, 0, '');
  await state(first, 'cleared');
  await SendMessage.call(system, first, EM_LIMITTEXT, 3, 0);
  await type(first, 'abcd');
  await state(first, 'limited');

  await SetFocus.call(system, second);
  await pumpAll(system);
  await state(second, 'focus2');
  capture(second, 'sans');
  await key(second, 0x23);
  await type(second, 'Hi');
  await state(second, 'sanstype');
  capture(second, 'sanshi');

  for (let index = 0; index < 8; index++) {
    const x = 6 + index * 2;

    await SendMessage.call(system, first, 0x0201, 0x0001, x | (10 << 16));
    await SendMessage.call(system, first, 0x0202, 0, x | (10 << 16));
    await state(first, `click${x}`);

    const focus = GetFocus.call(system);

    records.set(`focused:click${x}`, focus === first ? '1' : focus === second ? '2' : '0');
  }

  await DestroyWindow.call(system, host);
  await pumpAll(system);

  return records;
}

/** A window's text, as `GetWindowText` reads it into a buffer of `size`. */
async function windowText(system: any, hwnd: number, size = 80) {
  const length = await SendMessage.call(system, hwnd, User.WM_GETTEXTLENGTH, 0, 0);
  const buffer = GlobalLock.call(system, GlobalAlloc.call(system, 0x42, size + 16));
  const count = await SendMessage.call(system, hwnd, User.WM_GETTEXT, Math.min(length + 1, size), buffer);
  const core = system.machine.cpu.core;
  let text = '';

  for (let at = 0; at < count; at++) {
    text += String.fromCharCode(core.read8((buffer >>> 16) & 0xffff, (buffer & 0xffff) + at));
  }

  return text;
}

/* ---- mledit ---- */

const mlCaptures = new Map<string, Promise<Map<string, string>>>();

/** The `mledit` probe, replayed through the exports once per display. */
export function mlEditCapture(context: any) {
  const key = context.display.name;

  if (!mlCaptures.has(key)) {
    mlCaptures.set(key, captureMlEdit(context));
  }

  return mlCaptures.get(key)!;
}

async function captureMlEdit(system: any) {
  const records = new Map<string, string>();
  let notes = '';
  const WM_CHAR = 0x0102;
  const EM = {
    GETSEL: 0x0400,
    SETSEL: 0x0401,
    GETLINECOUNT: 0x040a,
    LINEINDEX: 0x040b,
    LINELENGTH: 0x0411,
    GETLINE: 0x0414,
    LINEFROMCHAR: 0x0419,
    GETFIRSTVISIBLELINE: 0x041e,
  };

  void system.rasterDesktop;

  async function HostProc(hwnd: number, message: number, wParam: number, lParam: number) {
    /* As the probe keeps them: nothing more once 240 characters are written. */
    if (message === User.WM_COMMAND && (lParam & 0xffff) !== 0) {
      if (notes.length < 240) {
        notes += `${notes ? ':' : ''}${((lParam >>> 16) & 0xffff).toString(16)}`;
      }

      return 0;
    }

    if (message === User.WM_PAINT) {
      const paint = new PAINTSTRUCT();

      await BeginPaint.call(system, hwnd, paint);
      EndPaint.call(system, hwnd, paint);
      return 0;
    }

    return DefWindowProc.call(system, hwnd, message, wParam, lParam);
  }

  const kind: any = new WNDCLASS();

  kind.style = 0;
  kind.lpfnWndProc = HostProc;
  kind.hbrBackground = 5 + 1;
  kind.lpszClassName = 'MlHost';
  await RegisterClass.call(system, kind);

  const child = 0x40000000 | 0x10000000;
  const host = await CreateWindow.call(system, 'MlHost', 'Lines', 0x00cf0000 | 0x10000000, 20, 20, 360, 220, 0, 0, 0, 0);
  const pad = await CreateWindow.call(system, 'EDIT', '', child | 0x00200000 | 0x00100000 | 0x0004 | 0x0080 | 0x0040, 8, 8, 200, 80, host, 100, 0, 0);
  const wrap = await CreateWindow.call(system, 'EDIT', '', child | 0x00800000 | 0x0004 | 0x0040, 220, 8, 120, 60, host, 101, 0, 0);

  await UpdateWindow.call(system, host);
  await pumpAll(system);
  notes = '';

  const send = (edit: number, message: number, wParam = 0, lParam: any = 0) =>
    SendMessage.call(system, edit, message, wParam, lParam);
  const signed = (value: number) => ((value & 0xffff) << 16) >> 16;

  const state = async (edit: number, step: string) => {
    const caret: any = new POINT();
    const selection = (await send(edit, EM.GETSEL)) >>> 0;

    GetCaretPos.call(system, caret);
    records.set(`caret:${step}`, `${caret.x}:${caret.y}`);
    records.set(`sel:${step}`, `${selection & 0xffff}:${selection >>> 16}`);
    records.set(`text:${step}`, (await windowText(system, edit, 600)).replace(/\r/g, '\\r').replace(/\n/g, '\\n'));
    records.set(
      `lines:${step}`,
      `count=${signed(await send(edit, EM.GETLINECOUNT))},first=${signed(await send(edit, EM.GETFIRSTVISIBLELINE))},` +
        `line=${signed(await send(edit, EM.LINEFROMCHAR, 0xffff))},index=${signed(await send(edit, EM.LINEINDEX, 0xffff))},` +
        `length=${signed(await send(edit, EM.LINELENGTH, 0xffff))},v=${GetScrollPos.call(system, edit, 1)},h=${GetScrollPos.call(system, edit, 0)}`
    );
    records.set(`notes:${step}`, notes);
    notes = '';
  };

  const read = (edit: number) => {
    const window: any = new RECT();
    const dc = GetDC.call(system, 0);
    const rows: string[] = [];

    GetWindowRect.call(system, edit, window);

    for (let y = 0; y < 80 && window.top + y < window.bottom; y++) {
      let row = '';

      for (let x = 0; x < 200 && window.left + x < window.right; x++) {
        const index = PALETTE.indexOf(GetPixel.call(system, dc, window.left + x, window.top + y) & 0xffffff);

        row += index < 0 ? '?' : index.toString(16);
      }

      rows.push(row);
    }

    ReleaseDC.call(system, 0, dc);
    return rows;
  };

  const capture = (edit: number, name: string) => {
    HideCaret.call(system, edit);
    ShowCaret.call(system, edit);
    const shown = read(edit);

    HideCaret.call(system, edit);
    const hidden = read(edit);
    const pixels: string[] = [];

    hidden.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        if (shown[y][x] !== row[x]) {
          pixels.push(`${x}:${y}=${shown[y][x]}`);
        }
      }
    });

    records.set(`caretpix:${name}`, pixels.join(','));
    hidden.forEach((row, y) => records.set(`rows:${name},y=${y}`, row));
    ShowCaret.call(system, edit);
  };

  const type = async (edit: number, text: string) => {
    for (const character of text) {
      await send(edit, WM_CHAR, character.charCodeAt(0), 1);
    }
  };

  const key = async (edit: number, vk: number) => {
    await send(edit, 0x0100, vk, 1);
    await send(edit, 0x0101, vk, 0xc0000001);
  };

  const line = async (edit: number, index: number, step: string) => {
    const core = system.machine.cpu.core;
    const buffer = GlobalLock.call(system, GlobalAlloc.call(system, 0x42, 128));
    const segment = (buffer >>> 16) & 0xffff;
    const offset = buffer & 0xffff;

    core.write16(segment, offset, 79);

    const count = signed(await send(edit, EM.GETLINE, index, buffer));
    let text = '';

    for (let at = 0; at < count; at++) {
      text += String.fromCharCode(core.read8(segment, offset + at));
    }

    records.set(`line:${step},${index}`, `${count}:${text}`);
  };

  await SetFocus.call(system, pad);
  await pumpAll(system);
  await state(pad, 'focus');
  capture(pad, 'empty');

  await type(pad, 'Hello');
  await state(pad, 'hello');
  await type(pad, '\r');
  await state(pad, 'enter');
  await type(pad, 'World');
  await state(pad, 'world');
  capture(pad, 'two');
  await line(pad, 0, 'two');
  await line(pad, 1, 'two');

  await key(pad, 0x26);
  await state(pad, 'up');
  await key(pad, 0x23);
  await state(pad, 'upend');
  await key(pad, 0x28);
  await state(pad, 'down');
  await key(pad, 0x24);
  await state(pad, 'home');
  await key(pad, 0x25);
  await state(pad, 'leftwrap');
  await key(pad, 0x27);
  await state(pad, 'rightwrap');

  await type(pad, '\b');
  await state(pad, 'join');
  await type(pad, '\r');
  await state(pad, 'split');

  await key(pad, 0x23);

  for (let index = 3; index <= 9; index++) {
    await type(pad, `\rLine ${index}`);
  }

  await state(pad, 'nine');
  capture(pad, 'nine');
  await key(pad, 0x21);
  await state(pad, 'pageup');
  await key(pad, 0x21);
  await state(pad, 'pageup2');
  capture(pad, 'top');
  await key(pad, 0x22);
  await state(pad, 'pagedown');

  await key(pad, 0x23);
  await type(pad, ' and a line that is much longer than the control is wide');
  await state(pad, 'long');
  capture(pad, 'long');
  await key(pad, 0x24);
  await state(pad, 'longhome');

  await send(pad, EM.SETSEL, 0, 2 | (9 << 16));
  await state(pad, 'setsel');
  capture(pad, 'selected');
  await type(pad, 'X');
  await state(pad, 'replace');

  for (let index = 0; index < 4; index++) {
    const x = 10 + index * 12;
    const y = 6 + index * 8;

    await send(pad, 0x0201, 0x0001, x | (y << 16));
    await send(pad, 0x0202, 0, x | (y << 16));
    await state(pad, `click${index}`);
  }

  await SetFocus.call(system, wrap);
  await pumpAll(system);
  await state(wrap, 'wrapfocus');
  await type(wrap, 'The quick brown fox jumps over the lazy dog again and again');
  await state(wrap, 'wrapped');
  capture(wrap, 'wrapped');
  await line(wrap, 0, 'wrapped');
  await line(wrap, 1, 'wrapped');
  await line(wrap, 2, 'wrapped');
  await key(wrap, 0x26);
  await state(wrap, 'wrapup');
  await key(wrap, 0x24);
  await state(wrap, 'wraphome');
  await type(wrap, '\r');
  await state(wrap, 'wrapenter');
  await type(wrap, 'Averyveryverylongwordthatcannotfitonanyline');
  await state(wrap, 'wrapword');
  capture(wrap, 'wrapword');

  await DestroyWindow.call(system, host);
  await pumpAll(system);

  return records;
}

/* ---- groupbox ---- */

const groupCaptures = new Map<string, Promise<Map<string, string>>>();

/** The `groupbox` probe, replayed through the exports once per display. */
export function groupboxCapture(context: any) {
  const key = context.display.name;

  if (!groupCaptures.has(key)) {
    groupCaptures.set(key, captureGroupbox(context));
  }

  return groupCaptures.get(key)!;
}

async function captureGroupbox(system: any) {
  const records = new Map<string, string>();
  const core = system.machine.cpu.core;
  const memory = GlobalAlloc.call(system, 0x42, 1024);
  const far = GlobalLock.call(system, memory);

  void system.rasterDesktop;

  /* The probe's template: a group box, two radio buttons in it, two more,
   * and a group box made after them. */
  const template = (font: boolean) => {
    const bytes: number[] = [];
    const word = (value: number) => bytes.push(value & 0xff, (value >> 8) & 0xff);
    const text = (value: string) => {
      for (const c of value) bytes.push(c.charCodeAt(0));
      bytes.push(0);
    };
    const base = (0x80000000 | 0x00c00000 | 0x00080000 | 0x80 | 0x10000000) >>> 0;
    const style = (font ? base | 0x40 : base) >>> 0;
    const items: [number, number, number, number, number, number, string][] = [
      [6, 6, 70, 34, 100, 0x7, 'Direction'],
      [12, 18, 26, 12, 101, 0x9 | 0x00020000, '&Up'],
      [42, 18, 30, 12, 102, 0x9, '&Down'],
      [88, 18, 26, 12, 103, 0x9 | 0x00020000, '&Left'],
      [118, 18, 30, 12, 104, 0x9, '&Right'],
      [82, 6, 70, 34, 105, 0x7, 'After'],
    ];

    word(style & 0xffff);
    word(style >>> 16);
    bytes.push(items.length);
    word(10);
    word(10);
    word(160);
    word(90);
    bytes.push(0, 0);
    text('Groups');

    if (font) {
      word(8);
      text('MS Sans Serif');
    }

    for (const [ix, iy, cx, cy, id, itemStyle, label] of items) {
      const full = (itemStyle | 0x40000000 | 0x10000000) >>> 0;

      word(ix);
      word(iy);
      word(cx);
      word(cy);
      word(id);
      word(full & 0xffff);
      word(full >>> 16);
      bytes.push(0x80);
      text(label);
      bytes.push(0);
    }

    return bytes;
  };

  for (const [pass, name] of [
    [0, 'sans'],
    [1, 'system'],
  ] as const) {
    template(pass === 0).forEach((value, at) =>
      core.write8((far >>> 16) & 0xffff, (far & 0xffff) + at, value)
    );

    const dialog = await CreateDialogIndirect.call(system, 0, far, 0, (_: number, message: number) =>
      message === User.WM_INITDIALOG ? 1 : 0
    );

    await CheckRadioButton.call(system, dialog, 101, 102, 102);
    await CheckRadioButton.call(system, dialog, 103, 104, 104);
    await pumpAll(system);

    const window: any = new RECT();
    const client: any = new RECT();
    const corner: any = new POINT();

    GetWindowRect.call(system, dialog, window);
    GetClientRect.call(system, dialog, client);
    ClientToScreen.call(system, dialog, corner);
    records.set(
      `rects:${name}`,
      `window=${window.left}:${window.top}:${window.right}:${window.bottom},` +
        `client=${corner.x}:${corner.y}:${corner.x + client.right}:${corner.y + client.bottom}`
    );

    for (let id = 100; id <= 105; id++) {
      const rect: any = new RECT();

      GetWindowRect.call(system, GetDlgItem.call(system, dialog, id), rect);
      records.set(
        `control:${name},id=${id}`,
        `${rect.left - corner.x}:${rect.top - corner.y}:${rect.right - corner.x}:${rect.bottom - corner.y}`
      );
    }

    const dc = GetDC.call(system, 0);

    for (let y = window.top; y < window.bottom; y++) {
      let row = '';

      for (let x = window.left; x < window.right; x++) {
        const index = PALETTE.indexOf(GetPixel.call(system, dc, x, y) & 0xffffff);

        row += index < 0 ? '?' : index.toString(16);
      }

      records.set(`pixels:${name},y=${y - window.top}`, row);
    }

    ReleaseDC.call(system, 0, dc);
    await DestroyWindow.call(system, dialog);
    await pumpAll(system);
  }

  return records;
}

/* ---- listbox ---- */

const listCaptures = new Map<string, Promise<Map<string, string>>>();

/** The `listbox` probe, replayed through the exports once per display. */
export function listboxCapture(context: any) {
  const key = context.display.name;

  if (!listCaptures.has(key)) {
    listCaptures.set(key, captureListbox(context));
  }

  return listCaptures.get(key)!;
}

async function captureListbox(system: any) {
  const records = new Map<string, string>();
  const core = system.machine.cpu.core;
  let notes = '';
  let measured = 0;
  let drawn = 0;
  const LB = {
    ADDSTRING: 0x401,
    INSERTSTRING: 0x402,
    DELETESTRING: 0x403,
    RESETCONTENT: 0x405,
    SETSEL: 0x406,
    SETCURSEL: 0x407,
    GETSEL: 0x408,
    GETCURSEL: 0x409,
    GETTEXT: 0x40a,
    GETTEXTLEN: 0x40b,
    GETCOUNT: 0x40c,
    GETTOPINDEX: 0x40f,
    FINDSTRING: 0x410,
    GETSELCOUNT: 0x411,
    SETTOPINDEX: 0x418,
    GETITEMHEIGHT: 0x422,
    FINDSTRINGEXACT: 0x423,
    GETCARETINDEX: 0x420,
  };
  const scratch = GlobalLock.call(system, GlobalAlloc.call(system, 0x42, 256));
  const seg = (scratch >>> 16) & 0xffff;
  const off = scratch & 0xffff;
  const word = (far: number, at: number) => core.read16((far >>> 16) & 0xffff, (far & 0xffff) + at);
  const signed = (value: number) => ((value & 0xffff) << 16) >> 16;
  const place = (text: string) => {
    for (let at = 0; at < text.length; at++) core.write8(seg, off + at, text.charCodeAt(at));
    core.write8(seg, off + text.length, 0);
    return scratch;
  };
  const textAt = (far: number) => {
    let text = '';

    for (let at = 0; ; at++) {
      const byte = core.read8((far >>> 16) & 0xffff, (far & 0xffff) + at);

      if (!byte) break;
      text += String.fromCharCode(byte);
    }

    return text;
  };

  void system.rasterDesktop;

  let host = 0;

  async function HostProc(hwnd: number, message: number, wParam: number, lParam: number) {
    if (message === User.WM_COMMAND && (lParam & 0xffff) !== 0) {
      if (notes.length < 240) {
        notes += `${notes ? ',' : ''}${wParam}:${((lParam >>> 16) & 0xffff).toString(16)}`;
      }

      return 0;
    }

    if (message === 0x002c) {
      records.set(
        `measure:${measured++}`,
        `type=${word(lParam, 0)},id=${word(lParam, 2)},item=${word(lParam, 4)},width=${word(lParam, 6)},height=${word(lParam, 8)}`
      );
      core.write16((lParam >>> 16) & 0xffff, (lParam & 0xffff) + 8, 14);
      return 1;
    }

    if (message === 0x002b) {
      const item = signed(word(lParam, 4));
      const action = word(lParam, 6);
      const state = word(lParam, 8);
      const box = word(lParam, 10);
      const hdc = word(lParam, 12);
      const rect = [14, 16, 18, 20].map((at) => signed(word(lParam, at)));
      const data = (word(lParam, 22) | (word(lParam, 24) << 16)) >>> 0;
      let text = '';

      if (item >= 0) {
        await SendMessage.call(system, box, LB.GETTEXT, item, place(''));
        text = textAt(scratch);
      }

      records.set(
        `draw:${drawn++}`,
        `type=${word(lParam, 0)},id=${word(lParam, 2)},item=${item},action=${action.toString(16)},` +
          `state=${state.toString(16)},rect=${rect.join(':')},data=${data.toString(16)},text=${text}`
      );

      if (item >= 0 && action & 3) {
        TextOut.call(system, hdc, rect[0] + 2, rect[1], text, text.length);

        if (state & 1) {
          const r: any = new RECT();

          [r.left, r.top, r.right, r.bottom] = rect;
          InvertRect.call(system, hdc, r);
        }
      }

      return 1;
    }

    if (message === User.WM_PAINT) {
      const paint = new PAINTSTRUCT();

      await BeginPaint.call(system, hwnd, paint);
      EndPaint.call(system, hwnd, paint);
      return 0;
    }

    return DefWindowProc.call(system, hwnd, message, wParam, lParam);
  }

  const kind: any = new WNDCLASS();

  kind.style = 0;
  kind.lpfnWndProc = HostProc;
  kind.hbrBackground = 5 + 1;
  kind.lpszClassName = 'ListHost';
  await RegisterClass.call(system, kind);

  host = await CreateWindow.call(system, 'ListHost', 'Lists', 0x00cf0000 | 0x10000000, 20, 20, 400, 200, 0, 0, 0, 0);

  const style = 0x40000000 | 0x10000000 | 0x00800000 | 0x00200000 | 0x0001;
  const a = await CreateWindow.call(system, 'LISTBOX', '', style | 0x0002, 8, 8, 100, 84, host, 100, 0, 0);
  const b = await CreateWindow.call(system, 'LISTBOX', '', style | 0x0008, 120, 8, 100, 84, host, 101, 0, 0);
  const c = await CreateWindow.call(system, 'LISTBOX', '', style | 0x0002 | 0x0010 | 0x0040, 232, 8, 100, 84, host, 102, 0, 0);

  await UpdateWindow.call(system, host);
  await pumpAll(system);
  notes = '';

  const send = (box: number, message: number, wParam = 0, lParam: any = 0) =>
    SendMessage.call(system, box, message, wParam, lParam);
  const answer = (what: string, value: number) => records.set(`answer:${what}`, String(signed(value)));
  const state = async (box: number, step: string, multiple: boolean) => {
    records.set(
      `state:${step}`,
      `count=${signed(await send(box, LB.GETCOUNT))},sel=${signed(await send(box, LB.GETCURSEL))},` +
        `top=${signed(await send(box, LB.GETTOPINDEX))},caret=${signed(await send(box, LB.GETCARETINDEX))},` +
        `v=${GetScrollPos.call(system, box, 1)},selcount=${multiple ? signed(await send(box, LB.GETSELCOUNT)) : -1}`
    );
    records.set(`notes:${step}`, notes);
    notes = '';
  };
  const capture = (box: number, name: string) => {
    const window: any = new RECT();
    const dc = GetDC.call(system, 0);

    GetWindowRect.call(system, box, window);

    for (let y = window.top; y < window.bottom; y++) {
      let row = '';

      for (let x = window.left; x < window.right; x++) {
        const index = PALETTE.indexOf(GetPixel.call(system, dc, x, y) & 0xffffff);

        row += index < 0 ? '?' : index.toString(16);
      }

      records.set(`rows:${name},y=${y - window.top}`, row);
    }

    ReleaseDC.call(system, 0, dc);
  };
  const key = async (box: number, vk: number) => {
    await send(box, 0x0100, vk, 1);
    await send(box, 0x0101, vk, 0xc0000001);
  };
  const click = async (box: number, x: number, y: number) => {
    await send(box, 0x0201, 0x0001, x | (y << 16));
    await send(box, 0x0202, 0, x | (y << 16));
  };
  const WORDS = ['pear', 'apple', 'fig', 'banana', 'cherry', 'grape', 'kiwi', 'lemon', 'mango', 'olive', 'peach', 'plum', 'date', 'lime'];

  for (let index = 0; index < WORDS.length; index++) {
    answer(`add${index}`, await send(a, LB.ADDSTRING, 0, WORDS[index]));
    await send(b, LB.ADDSTRING, 0, WORDS[index]);
    await send(c, LB.ADDSTRING, 0, WORDS[index]);
  }

  await pumpAll(system);
  await state(a, 'filled', false);
  capture(a, 'filled');
  capture(c, 'cfilled');

  answer('insert', await send(a, LB.INSERTSTRING, 2, 'zzz'));
  answer('findstring', await send(a, LB.FINDSTRING, 0xffff, 'ch'));
  answer('findexact', await send(a, LB.FINDSTRINGEXACT, 0xffff, 'lime'));
  answer('textlen', await send(a, LB.GETTEXTLEN, 3));
  await send(a, LB.GETTEXT, 3, place(''));
  records.set('text:3', textAt(scratch));
  answer('delete', await send(a, LB.DELETESTRING, 2));
  answer('itemheight', await send(a, LB.GETITEMHEIGHT));

  answer('setcursel', await send(a, LB.SETCURSEL, 9));
  await pumpAll(system);
  await state(a, 'setcursel', false);
  capture(a, 'selected');

  await SetFocus.call(system, a);
  await pumpAll(system);
  await state(a, 'focus', false);
  capture(a, 'focused');

  await key(a, 0x28);
  await state(a, 'down', false);
  await key(a, 0x22);
  await state(a, 'pagedown', false);
  await key(a, 0x23);
  await state(a, 'end', false);
  capture(a, 'end');
  await key(a, 0x24);
  await state(a, 'home', false);
  await send(a, 0x0102, 'm'.charCodeAt(0), 1);
  await state(a, 'char', false);

  await click(a, 20, 20);
  await state(a, 'click', false);
  await send(a, 0x0115, 1, 0);
  await state(a, 'linedown', false);
  await send(a, 0x0115, 3, 0);
  await state(a, 'vpagedown', false);
  capture(a, 'scrolled');
  answer('settopindex', await send(a, LB.SETTOPINDEX, 3));
  await state(a, 'settopindex', false);

  await send(b, LB.SETSEL, 1, 1);
  await send(b, LB.SETSEL, 1, 3);
  await state(b, 'multi', true);
  await click(b, 20, 40);
  await state(b, 'multiclick', true);
  answer('getsel3', await send(b, LB.GETSEL, 3));
  capture(b, 'multi');

  await send(c, LB.SETCURSEL, 2);
  await pumpAll(system);
  await SetFocus.call(system, c);
  await pumpAll(system);
  await key(c, 0x28);
  await pumpAll(system);
  await state(c, 'owner', false);
  capture(c, 'owner');

  answer('resetcontent', await send(a, LB.RESETCONTENT));
  await pumpAll(system);
  await state(a, 'reset', false);

  await DestroyWindow.call(system, host);
  await pumpAll(system);

  return records;
}

/* ---- combobox ---- */

const comboCaptures = new Map<string, Promise<Map<string, string>>>();

/** The `combobox` probe, replayed through the exports once per display. */
export function comboboxCapture(context: any) {
  const key = context.display.name;

  if (!comboCaptures.has(key)) {
    comboCaptures.set(key, captureCombobox(context));
  }

  return comboCaptures.get(key)!;
}

async function captureCombobox(system: any) {
  const records = new Map<string, string>();
  const core = system.machine.cpu.core;
  let notes = '';
  let measured = 0;
  let drawn = 0;
  const CB = {
    GETEDITSEL: 0x400,
    ADDSTRING: 0x403,
    GETCOUNT: 0x406,
    GETCURSEL: 0x407,
    GETLBTEXT: 0x408,
    GETLBTEXTLEN: 0x409,
    RESETCONTENT: 0x40b,
    FINDSTRING: 0x40c,
    SETCURSEL: 0x40e,
    SETEDITSEL: 0x402,
    SHOWDROPDOWN: 0x40f,
    GETDROPPEDSTATE: 0x417,
    GETITEMHEIGHT: 0x414,
  };
  const scratch = GlobalLock.call(system, GlobalAlloc.call(system, 0x42, 256));
  const seg = (scratch >>> 16) & 0xffff;
  const off = scratch & 0xffff;
  const word = (far: number, at: number) => core.read16((far >>> 16) & 0xffff, (far & 0xffff) + at);
  const signed = (value: number) => ((value & 0xffff) << 16) >> 16;
  const textAt = (far: number) => {
    let text = '';

    for (let at = 0; ; at++) {
      const byte = core.read8((far >>> 16) & 0xffff, (far & 0xffff) + at);

      if (!byte) break;
      text += String.fromCharCode(byte);
    }

    return text;
  };

  void system.rasterDesktop;

  async function HostProc(hwnd: number, message: number, wParam: number, lParam: number) {
    if (message === User.WM_COMMAND && (lParam & 0xffff) !== 0) {
      if (notes.length < 240) {
        notes += `${notes ? ',' : ''}${wParam}:${((lParam >>> 16) & 0xffff).toString(16)}`;
      }

      return 0;
    }

    if (message === 0x002c) {
      records.set(
        `measure:${measured++}`,
        `type=${word(lParam, 0)},id=${word(lParam, 2)},item=${signed(word(lParam, 4))},width=${word(lParam, 6)},height=${word(lParam, 8)}`
      );
      core.write16((lParam >>> 16) & 0xffff, (lParam & 0xffff) + 8, 14);
      return 1;
    }

    if (message === 0x002b) {
      const type = word(lParam, 0);
      const item = signed(word(lParam, 4));
      const action = word(lParam, 6);
      const state = word(lParam, 8);
      const box = word(lParam, 10);
      const hdc = word(lParam, 12);
      const rect = [14, 16, 18, 20].map((at) => signed(word(lParam, at)));
      const data = (word(lParam, 22) | (word(lParam, 24) << 16)) >>> 0;
      let text = '';

      if (item >= 0) {
        core.write8(seg, off, 0);
        await SendMessage.call(system, box, type === 3 ? CB.GETLBTEXT : 0x40a, item, scratch);
        text = textAt(scratch);
      }

      records.set(
        `draw:${drawn++}`,
        `type=${type},id=${word(lParam, 2)},item=${item},action=${action.toString(16)},` +
          `state=${state.toString(16)},rect=${rect.join(':')},data=${data.toString(16)},text=${text}`
      );

      if (item >= 0 && action & 3) {
        TextOut.call(system, hdc, rect[0] + 2, rect[1], text, text.length);

        if (state & 1) {
          const r: any = new RECT();

          [r.left, r.top, r.right, r.bottom] = rect;
          InvertRect.call(system, hdc, r);
        }
      }

      return 1;
    }

    if (message === User.WM_PAINT) {
      const paint = new PAINTSTRUCT();

      await BeginPaint.call(system, hwnd, paint);
      EndPaint.call(system, hwnd, paint);
      return 0;
    }

    return DefWindowProc.call(system, hwnd, message, wParam, lParam);
  }

  const kind: any = new WNDCLASS();

  kind.style = 0;
  kind.lpfnWndProc = HostProc;
  kind.hbrBackground = 5 + 1;
  kind.lpszClassName = 'ComboHost';
  await RegisterClass.call(system, kind);

  const host = await CreateWindow.call(system, 'ComboHost', 'Combos', 0x00cf0000 | 0x10000000, 20, 20, 520, 280, 0, 0, 0, 0);
  const style = 0x40000000 | 0x10000000 | 0x00200000 | 0x0100;
  const a = await CreateWindow.call(system, 'COMBOBOX', '', style | 0x3, 8, 8, 100, 90, host, 100, 0, 0);
  const b = await CreateWindow.call(system, 'COMBOBOX', '', style | 0x2, 130, 8, 100, 90, host, 101, 0, 0);
  const c = await CreateWindow.call(system, 'COMBOBOX', '', style | 0x1, 250, 8, 100, 90, host, 102, 0, 0);
  const d = await CreateWindow.call(system, 'COMBOBOX', '', style | 0x3 | 0x10 | 0x200, 370, 8, 100, 90, host, 103, 0, 0);

  await UpdateWindow.call(system, host);
  await pumpAll(system);
  notes = '';

  const send = (box: number, message: number, wParam = 0, lParam: any = 0) =>
    SendMessage.call(system, box, message, wParam, lParam);
  const answer = (what: string, value: number) => records.set(`answer:${what}`, String(value | 0));
  const corner: any = new POINT();

  ClientToScreen.call(system, host, corner);

  const rect = (name: string, window: number) => {
    const r: any = new RECT();

    GetWindowRect.call(system, window, r);
    records.set(`rect:${name}`, `${r.left - corner.x}:${r.top - corner.y}:${r.right - corner.x}:${r.bottom - corner.y}`);
  };
  const parts = (name: string, box: number) => {
    rect(name, box);

    let index = 0;

    for (let child = GetWindow.call(system, box, 5); child; child = GetWindow.call(system, child, 2)) {
      core.write8(seg, off, 0);
      GetClassName.call(system, child, scratch, 16);
      rect(`${name},child${index++},${textAt(scratch)}`, child);
    }
  };
  const state = async (box: number, step: string) => {
    records.set(
      `state:${step}`,
      `count=${signed(await send(box, CB.GETCOUNT))},sel=${signed(await send(box, CB.GETCURSEL))},` +
        `text=${await windowText(system, box, 40)},dropped=${signed(await send(box, CB.GETDROPPEDSTATE))}`
    );
    records.set(`notes:${step}`, notes);
    notes = '';
  };
  const capture = (box: number, name: string) => {
    const r: any = new RECT();
    const dc = GetDC.call(system, 0);

    GetWindowRect.call(system, box, r);
    records.set(`area:${name}`, `${r.left}:${r.top}`);

    for (let y = r.top; y < r.top + 110; y++) {
      let row = '';

      for (let x = r.left; x < r.left + 104; x++) {
        const index = PALETTE.indexOf(GetPixel.call(system, dc, x, y) & 0xffffff);

        row += index < 0 ? '?' : index.toString(16);
      }

      records.set(`rows:${name},y=${y - r.top}`, row);
    }

    ReleaseDC.call(system, 0, dc);
  };
  const key = async (box: number, vk: number) => {
    await send(box, 0x0100, vk, 1);
    await send(box, 0x0101, vk, 0xc0000001);
  };
  const WORDS = ['pear', 'apple', 'fig', 'banana', 'cherry', 'grape', 'kiwi', 'lemon'];

  parts('a', a);
  parts('b', b);
  parts('c', c);
  parts('d', d);

  for (let index = 0; index < WORDS.length; index++) {
    answer(`add${index}`, signed(await send(a, CB.ADDSTRING, 0, WORDS[index])));
    await send(b, CB.ADDSTRING, 0, WORDS[index]);
    await send(c, CB.ADDSTRING, 0, WORDS[index]);
    await send(d, CB.ADDSTRING, 0, WORDS[index]);
  }

  await pumpAll(system);
  await state(a, 'filled');

  answer('setcursel', signed(await send(a, CB.SETCURSEL, 2)));
  await send(b, CB.SETCURSEL, 3);
  await send(c, CB.SETCURSEL, 4);
  await send(d, CB.SETCURSEL, 1);
  await pumpAll(system);
  await state(a, 'setcursel');
  await state(b, 'bsetcursel');
  await state(c, 'csetcursel');
  await state(d, 'dsetcursel');
  answer('findstring', signed(await send(a, CB.FINDSTRING, 0xffff, 'ki')));
  answer('lbtextlen', signed(await send(a, CB.GETLBTEXTLEN, 5)));
  answer('itemheight', signed(await send(a, CB.GETITEMHEIGHT, 0)));
  answer('editheight', signed(await send(a, CB.GETITEMHEIGHT, 0xffff)));

  capture(a, 'a');
  capture(b, 'b');
  capture(c, 'c');
  capture(d, 'd');

  await SetFocus.call(system, a);
  await pumpAll(system);
  await state(a, 'focus');
  capture(a, 'afocus');
  await key(a, 0x28);
  await pumpAll(system);
  await state(a, 'down');
  await send(a, 0x0102, 'k'.charCodeAt(0), 1);
  await pumpAll(system);
  await state(a, 'char');

  answer('showdropdown', await send(a, CB.SHOWDROPDOWN, 1));
  await pumpAll(system);
  await state(a, 'dropped');
  capture(a, 'adropped');
  await key(a, 0x28);
  await pumpAll(system);
  await state(a, 'droppeddown');
  await key(a, 0x0d);
  await pumpAll(system);
  await state(a, 'enter');
  capture(a, 'aclosed');

  await SetFocus.call(system, b);
  await pumpAll(system);
  await SendMessage.call(system, b, User.WM_SETTEXT, 0, 'melon');
  await pumpAll(system);
  await state(b, 'settext');
  answer('seleditsel', await send(b, CB.SETEDITSEL, 0, 1 | (3 << 16)));
  answer('geteditsel', await send(b, CB.GETEDITSEL));
  capture(b, 'bedit');

  await SetFocus.call(system, d);
  await pumpAll(system);
  await send(d, CB.SHOWDROPDOWN, 1);
  await pumpAll(system);
  await state(d, 'ddropped');
  capture(d, 'ddropped');
  await send(d, CB.SHOWDROPDOWN, 0);
  await pumpAll(system);
  await state(d, 'dclosed');

  answer('resetcontent', await send(a, CB.RESETCONTENT));
  await pumpAll(system);
  await state(a, 'reset');

  await DestroyWindow.call(system, host);
  await pumpAll(system);

  return records;
}

/* ---- noscroll ---- */

const noScrollCaptures = new Map<string, Promise<Map<string, string>>>();

/** The `noscroll` probe, replayed through the exports once per display. */
export function noscrollCapture(context: any) {
  const key = context.display.name;

  if (!noScrollCaptures.has(key)) {
    noScrollCaptures.set(key, captureNoScroll(context));
  }

  return noScrollCaptures.get(key)!;
}

async function captureNoScroll(system: any) {
  const records = new Map<string, string>();
  const signed = (value: number) => ((value & 0xffff) << 16) >> 16;

  void system.rasterDesktop;

  async function HostProc(hwnd: number, message: number, wParam: number, lParam: number) {
    if (message === User.WM_PAINT) {
      const paint = new PAINTSTRUCT();

      await BeginPaint.call(system, hwnd, paint);
      EndPaint.call(system, hwnd, paint);
      return 0;
    }

    return DefWindowProc.call(system, hwnd, message, wParam, lParam);
  }

  const kind: any = new WNDCLASS();

  kind.style = 0;
  kind.lpfnWndProc = HostProc;
  kind.hbrBackground = 5 + 1;
  kind.lpszClassName = 'NoScroll';
  await RegisterClass.call(system, kind);

  const child = 0x40000000 | 0x10000000;
  const host = await CreateWindow.call(system, 'NoScroll', 'Scroll', 0x00cf0000 | 0x10000000, 20, 20, 440, 220, 0, 0, 0, 0);
  const list = await CreateWindow.call(system, 'LISTBOX', '', child | 0x00800000 | 0x00200000 | 0x0001 | 0x1000, 8, 8, 100, 84, host, 100, 0, 0);
  const vertical = await CreateWindow.call(system, 'SCROLLBAR', '', child | 0x0001, 120, 8, 16, 100, host, 101, 0, 0);
  const horizontal = await CreateWindow.call(system, 'SCROLLBAR', '', child | 0x0000, 148, 8, 100, 16, host, 102, 0, 0);
  const own = await CreateWindow.call(system, 'NoScroll', '', child | 0x00800000 | 0x00200000, 260, 8, 80, 100, host, 103, 0, 0);

  await UpdateWindow.call(system, host);
  await pumpAll(system);

  const send = (box: number, message: number, wParam = 0, lParam: any = 0) =>
    SendMessage.call(system, box, message, wParam, lParam);
  const answer = (what: string, value: number) => records.set(`answer:${what}`, String(signed(value)));
  const state = async (step: string) =>
    records.set(
      `state:${step}`,
      `count=${signed(await send(list, 0x40c))},top=${signed(await send(list, 0x40f))},v=${GetScrollPos.call(system, list, 1)}`
    );
  const capture = (box: number, name: string) => {
    const window: any = new RECT();
    const dc = GetDC.call(system, 0);

    GetWindowRect.call(system, box, window);

    for (let y = window.top; y < window.bottom; y++) {
      let row = '';

      for (let x = window.left; x < window.right; x++) {
        const index = PALETTE.indexOf(GetPixel.call(system, dc, x, y) & 0xffffff);

        row += index < 0 ? '?' : index.toString(16);
      }

      records.set(`rows:${name},y=${y - window.top}`, row);
    }

    ReleaseDC.call(system, 0, dc);
  };
  const WORDS = ['pear', 'apple', 'fig', 'banana', 'cherry', 'grape', 'kiwi', 'lemon', 'mango', 'olive', 'peach', 'plum', 'date', 'lime'];

  capture(list, 'made');
  await state('made');

  await send(list, 0x401, 0, WORDS[0]);
  await send(list, 0x401, 0, WORDS[1]);
  await pumpAll(system);
  await state('few');
  capture(list, 'few');

  for (let index = 2; index < WORDS.length; index++) {
    await send(list, 0x401, 0, WORDS[index]);
  }

  await pumpAll(system);
  await state('many');
  capture(list, 'many');

  await send(list, 0x405);
  await pumpAll(system);
  await state('empty');
  capture(list, 'empty');

  SetScrollRange.call(system, vertical, 2, 0, 10, 0);
  SetScrollPos.call(system, vertical, 2, 3, 1);
  SetScrollRange.call(system, horizontal, 2, 0, 10, 0);
  SetScrollPos.call(system, horizontal, 2, 3, 1);
  await pumpAll(system);
  capture(vertical, 'v-on');
  capture(horizontal, 'h-on');

  const steps: [number, string][] = [
    [1, 'ltup'],
    [2, 'rtdn'],
    [3, 'both'],
    [3, 'again'],
    [0, 'enable'],
  ];

  for (const [step, name] of steps) {
    answer(`v-${name}`, await EnableScrollBar.call(system, vertical, 2, step));
    await pumpAll(system);
    capture(vertical, `v-${name}`);

    answer(`h-${name}`, await EnableScrollBar.call(system, horizontal, 2, step));
    await pumpAll(system);
    capture(horizontal, `h-${name}`);
  }

  await EnableScrollBar.call(system, vertical, 2, 3);
  answer('v-setpos', SetScrollPos.call(system, vertical, 2, 7, 1));
  answer('v-getpos', GetScrollPos.call(system, vertical, 2));
  await pumpAll(system);
  capture(vertical, 'v-moved');

  SetScrollRange.call(system, own, 1, 0, 10, 1);
  await pumpAll(system);
  capture(own, 'w-on');
  answer('w-both', await EnableScrollBar.call(system, own, 1, 3));
  await pumpAll(system);
  capture(own, 'w-both');

  await DestroyWindow.call(system, host);
  await pumpAll(system);

  return records;
}

/* ---- sbtrack ---- */

const sbTrackCaptures = new Map<string, Promise<Map<string, string>>>();

/** The `sbtrack` probe, replayed through the exports once per display. */
export function sbtrackCapture(context: any) {
  const key = context.display.name;

  if (!sbTrackCaptures.has(key)) {
    sbTrackCaptures.set(key, captureSbTrack(context));
  }

  return sbTrackCaptures.get(key)!;
}

async function captureSbTrack(system: any) {
  const records = new Map<string, string>();
  const area = { left: 0, top: 0, right: 0, bottom: 0 };
  let notes = '';
  let step = '';
  let captured = false;

  void system.rasterDesktop;

  const capture = (name: string) => {
    const dc = GetDC.call(system, 0);

    for (let y = area.top; y < area.bottom; y++) {
      let row = '';

      for (let x = area.left; x < area.right; x++) {
        const index = PALETTE.indexOf(GetPixel.call(system, dc, x, y) & 0xffffff);

        row += index < 0 ? '?' : index.toString(16);
      }

      records.set(`rows:${name},y=${y - area.top}`, row);
    }

    ReleaseDC.call(system, 0, dc);
  };
  const note = (text: string) => {
    if (notes.length + text.length < 380) {
      notes += (notes ? ',' : '') + text;
    }
  };

  async function HostProc(hwnd: number, message: number, wParam: number, lParam: number) {
    if (message === 0x0115) {
      note(`v:${wParam}:${((lParam & 0xffff) << 16) >> 16}:${(lParam >>> 16) & 0xffff ? 1 : 0}`);

      if (!captured) {
        captured = true;
        capture(`${step}-held`);
      }

      return 0;
    }

    if (message === User.WM_SYSCOMMAND) {
      note(`s:${wParam.toString(16)}`);
    }

    if (message === User.WM_PAINT) {
      const paint = new PAINTSTRUCT();

      await BeginPaint.call(system, hwnd, paint);
      EndPaint.call(system, hwnd, paint);
      return 0;
    }

    return DefWindowProc.call(system, hwnd, message, wParam, lParam);
  }

  const kind: any = new WNDCLASS();

  kind.style = 0;
  kind.lpfnWndProc = HostProc;
  kind.hbrBackground = 5 + 1;
  kind.lpszClassName = 'SbTrack';
  await RegisterClass.call(system, kind);

  const host = await CreateWindow.call(system, 'SbTrack', 'Track', 0x00cf0000 | 0x00200000 | 0x10000000, 20, 20, 300, 200, 0, 0, 0, 0);
  const control = await CreateWindow.call(system, 'SCROLLBAR', '', 0x40000000 | 0x10000000 | 0x0001, 20, 8, 16, 100, host, 101, 0, 0);

  SetScrollRange.call(system, control, 2, 0, 10, 0);
  SetScrollPos.call(system, control, 2, 3, 1);
  SetScrollRange.call(system, host, 1, 0, 10, 0);
  SetScrollPos.call(system, host, 1, 3, 1);
  await UpdateWindow.call(system, host);
  await pumpAll(system);

  const onScreen = (hwnd: number, x: number, y: number) => {
    const point: any = new POINT();

    point.x = x;
    point.y = y;
    ClientToScreen.call(system, hwnd, point);

    return { x: point.x, y: point.y };
  };
  const begin = (name: string) => {
    step = name;
    notes = '';
    captured = false;
  };
  const finish = async (name: string) => {
    await pumpAll(system);
    records.set(`notes:${name}`, notes);
    capture(`${name}-after`);
  };
  const lparam = (x: number, y: number) => ((x & 0xffff) | ((y & 0xffff) << 16)) >>> 0;

  const pressControl = async (name: string, x: number, y: number, toY: number, moves: number) => {
    const at = onScreen(control, x, y);

    begin(name);

    for (let index = 1; index <= moves; index++) {
      const stepY = y + Math.trunc(((toY - y) * index) / moves);
      const to = onScreen(control, x, stepY);

      SetCursorPos.call(system, to.x, to.y);
      PostMessage.call(system, control, 0x0200, 0x0001, lparam(x, stepY));
    }

    const to = onScreen(control, x, toY);

    SetCursorPos.call(system, to.x, to.y);
    PostMessage.call(system, control, 0x0202, 0, lparam(x, toY));
    SetCursorPos.call(system, at.x, at.y);
    await SendMessage.call(system, control, 0x0201, 0x0001, lparam(x, y));
    await finish(name);
  };

  const pressOwn = async (name: string, at: { x: number; y: number }) => {
    begin(name);

    const client: any = new POINT();

    client.x = at.x;
    client.y = at.y;
    ScreenToClient.call(system, host, client);
    SetCursorPos.call(system, at.x, at.y);
    PostMessage.call(system, host, 0x0202, 0, lparam(client.x, client.y));
    SetCursorPos.call(system, at.x, at.y);
    await SendMessage.call(system, host, 0x00a1, 7, lparam(at.x, at.y));
    await finish(name);
  };

  const window: any = new RECT();

  GetWindowRect.call(system, control, window);
  Object.assign(area, { left: window.left, top: window.top, right: window.right, bottom: window.bottom });

  await pressControl('c-up', 8, 5, 5, 0);
  await pressControl('c-down', 8, 94, 94, 0);
  await pressControl('c-pageup', 8, 22, 22, 0);
  await pressControl('c-pagedown', 8, 70, 70, 0);
  await pressControl('c-drag', 8, 38, 68, 3);
  await pressControl('c-away', 8, 38, 68, 0);

  await EnableScrollBar.call(system, control, 2, 1);
  await pumpAll(system);
  await pressControl('c-off', 8, 5, 5, 0);
  await EnableScrollBar.call(system, control, 2, 0);
  await pumpAll(system);

  const client: any = new RECT();

  GetClientRect.call(system, host, client);

  const corner = onScreen(host, client.right, client.bottom);

  area.left = corner.x;
  area.right = corner.x + GetSystemMetrics.call(system, 2);
  area.top = corner.y - client.bottom - 1;
  area.bottom = corner.y + 1;

  await pressOwn('w-down', { x: corner.x + 8, y: area.bottom - 6 });
  await pressOwn('w-pagedown', { x: corner.x + 8, y: area.bottom - 40 });

  await DestroyWindow.call(system, host);
  await pumpAll(system);

  return records;
}

/* ---- enumfam ---- */

const enumFamCaptures = new Map<string, Promise<Map<string, string>>>();

/** The `enumfam` probe, replayed through the exports once per display. */
export function enumfamCapture(context: any) {
  const key = context.display.name;

  if (!enumFamCaptures.has(key)) {
    enumFamCaptures.set(key, captureEnumFam(context));
  }

  return enumFamCaptures.get(key)!;
}

async function captureEnumFam(system: any) {
  const records = new Map<string, string>();
  const screen = GetDC.call(system, 0);
  const families: string[] = [];
  let calls = 0;
  let styles = false;
  let current = '';

  /* The probe's `describe`, field for field. */
  const describe = (elf: any, ntm: any, type: number) => {
    const tt = (type & 4) !== 0;
    const lf = [
      elf.lfHeight,
      elf.lfWidth,
      elf.lfEscapement,
      elf.lfOrientation,
      elf.lfWeight,
      elf.lfItalic,
      elf.lfUnderline,
      elf.lfStrikeOut,
      elf.lfCharSet,
      elf.lfOutPrecision,
      elf.lfClipPrecision,
      elf.lfQuality,
      elf.lfPitchAndFamily,
      elf.lfFaceName,
    ].join(':');
    const tm = [
      ntm.tmHeight,
      ntm.tmAscent,
      ntm.tmDescent,
      ntm.tmInternalLeading,
      ntm.tmExternalLeading,
      ntm.tmAveCharWidth,
      ntm.tmMaxCharWidth,
      ntm.tmWeight,
      ntm.tmItalic,
      ntm.tmUnderlined,
      ntm.tmStruckOut,
      ntm.tmFirstChar,
      ntm.tmLastChar,
      ntm.tmDefaultChar,
      ntm.tmBreakChar,
      ntm.tmPitchAndFamily,
      ntm.tmCharSet,
      ntm.tmOverhang,
      ntm.tmDigitizedAspectX,
      ntm.tmDigitizedAspectY,
    ].join(':');
    const flags = tt ? (ntm.ntmFlags >>> 0).toString(16) : '0';

    return (
      `type=${type},lf=${lf},full=${tt ? elf.elfFullName : ''},style=${tt ? elf.elfStyle : ''},` +
      `tm=${tm},ntm=${flags}:${tt ? ntm.ntmSizeEM : 0}:${tt ? ntm.ntmCellHeight : 0}:${tt ? ntm.ntmAvgWidth : 0}`
    );
  };

  const family = (elf: any, ntm: any, type: number, data: number) => {
    calls++;

    const result = describe(elf, ntm, type);

    if (styles) {
      records.set(`style:${current},${calls - 1}`, result);
    } else {
      records.set(`family:${calls - 1}`, result);
      families.push(elf.lfFaceName);
    }

    return data;
  };
  const stop = () => {
    calls++;
    return 0;
  };

  calls = 0;
  let answer = await EnumFontFamilies.call(system, screen, null, family, 7);

  records.set('answer:all', `${answer},calls=${calls}`);
  styles = true;

  for (const name of families) {
    current = name;
    calls = 0;
    answer = await EnumFontFamilies.call(system, screen, name, family, 1);
    records.set(`answer:family:${name}`, `${answer},calls=${calls}`);
  }

  current = 'Nothing';
  calls = 0;
  answer = await EnumFontFamilies.call(system, screen, 'Nothing', family, 1);
  records.set('answer:nothing', `${answer},calls=${calls}`);

  calls = 0;
  answer = await EnumFontFamilies.call(system, screen, null, stop, 0);
  records.set('answer:stop', `${answer},calls=${calls}`);

  /* The older call, the probe's `FontProc`: the LOGFONT and TEXTMETRIC alone. */
  const faces: string[] = [];
  let byName = false;
  const font = (lf: any, tm: any, type: number, data: number) => {
    calls++;

    const full = describe(lf, tm, type);
    const result = full.replace(/,full=[^,]*,style=[^,]*/, '').replace(/,ntm=.*$/, '');

    if (byName) {
      records.set(`fontname:${current},${calls - 1}`, result);
    } else {
      records.set(`font:${calls - 1}`, result);
      faces.push(lf.lfFaceName);
    }

    return data;
  };

  calls = 0;
  answer = await EnumFonts.call(system, screen, null, font, 5);
  records.set('oldanswer:all', `${answer},calls=${calls}`);
  byName = true;

  for (const name of faces) {
    current = name;
    calls = 0;
    answer = await EnumFonts.call(system, screen, name, font, 1);
    records.set(`oldanswer:face:${name}`, `${answer},calls=${calls}`);
  }

  ReleaseDC.call(system, 0, screen);

  return records;
}

/* ---- registry ---- */

const registryCaptures = new Map<string, Promise<Map<string, string>>>();

/** The `registry` probe, replayed through SHELL's calls once. */
export function registryCapture(context: any) {
  const key = context.display.name;

  if (!registryCaptures.has(key)) {
    registryCaptures.set(key, captureRegistry(context));
  }

  return registryCaptures.get(key)!;
}

async function captureRegistry(system: any) {
  const records = new Map<string, string>();
  const core = system.machine.cpu.core;
  const scratch = GlobalLock.call(system, GlobalAlloc.call(system, 0x42, 256));
  const seg = (scratch >>> 16) & 0xffff;
  const off = scratch & 0xffff;
  const buffer = scratch;
  const cbAt = (scratch + 100) >>> 0;
  const keyAt = (scratch + 110) >>> 0;
  const text = (far: number) => {
    let out = '';

    for (let at = 0; ; at++) {
      const byte = core.read8((far >>> 16) & 0xffff, (far & 0xffff) + at);

      if (!byte) break;
      out += String.fromCharCode(byte);
    }

    return out;
  };
  const dword = (far: number) =>
    (core.read16((far >>> 16) & 0xffff, far & 0xffff) | (core.read16((far >>> 16) & 0xffff, (far & 0xffff) + 2) << 16)) >>> 0;
  const setDword = (far: number, value: number) => {
    core.write16((far >>> 16) & 0xffff, far & 0xffff, value & 0xffff);
    core.write16((far >>> 16) & 0xffff, (far & 0xffff) + 2, (value >>> 16) & 0xffff);
  };
  const signed = (value: number) => value | 0;
  const answer = (what: string, value: number) => records.set(`answer:${what}`, String(signed(value)));
  const HKCR = 1;

  const query = async (key: number, name: string, path: string | null, size: number) => {
    for (let i = 0; i < 80; i++) core.write8(seg, off + i, 0x23);
    core.write8(seg, off + 79, 0);
    setDword(cbAt, size);

    const result = await RegQueryValue.call(system, key, path, buffer, cbAt);

    core.write8(seg, off + 40, 0);
    records.set(`query:${name},${path === null ? 'NULL' : path || '(empty)'},${size}`, `${signed(result)},cb=${signed(dword(cbAt))},text=${text(buffer)}`);
  };
  const enumerate = async (key: number, label: string, index: number) => {
    core.write8(seg, off, 0);

    const result = await RegEnumKey.call(system, key, index, buffer, 80);

    records.set(`enum:${label}`, `${signed(result)},${text(buffer)}`);

    return result;
  };

  for (let index = 0; index < 64; index++) {
    if ((await enumerate(HKCR, String(index), index)) !== 0) {
      break;
    }
  }

  await query(HKCR, 'root', '.txt', 80);
  await query(HKCR, 'root', '.TXT', 80);
  await query(HKCR, 'root', '.txt', 4);
  await query(HKCR, 'root', '.txt', 1);
  await query(HKCR, 'root', 'txtfile\\shell\\open\\command', 80);
  await query(HKCR, 'root', 'txtfile\\shell', 80);
  await query(HKCR, 'root', 'nothing', 80);
  await query(HKCR, 'root', 'txtfile\\', 80);
  await query(HKCR, 'root', '', 80);
  await query(HKCR, 'root', null, 80);

  answer('open-txtfile', await RegOpenKey.call(system, HKCR, 'txtfile', keyAt));

  const txtfile = dword(keyAt);

  await query(txtfile, 'txtfile', 'shell\\print\\command', 80);
  await query(txtfile, 'txtfile', null, 80);
  answer('open-missing', await RegOpenKey.call(system, HKCR, 'nothing', keyAt));

  for (let index = 0; index < 8; index++) {
    if ((await enumerate(txtfile, `txtfile,${index}`, index)) !== 0) {
      break;
    }
  }

  answer('close-txtfile', await RegCloseKey.call(system, txtfile));

  answer('create', await RegCreateKey.call(system, HKCR, 'ProbeKey\\Sub', keyAt));

  const made = dword(keyAt);

  answer('set', await RegSetValue.call(system, made, null, 1, 'Probe value', 11));
  answer('set-type', await RegSetValue.call(system, made, null, 7, 'Other', 5));
  answer('set-path', await RegSetValue.call(system, HKCR, 'ProbeKey\\Other', 1, 'Second', 6));
  await query(HKCR, 'made', 'ProbeKey\\Sub', 80);
  await query(HKCR, 'made', 'probekey\\other', 80);
  answer('set-empty', await RegSetValue.call(system, made, null, 1, '', 0));
  await query(HKCR, 'emptied', 'ProbeKey\\Sub', 80);

  for (let index = 0; index < 4; index++) {
    await enumerate(HKCR, `after,${index}`, index);
  }

  answer('close-made', await RegCloseKey.call(system, made));
  answer('delete', await RegDeleteKey.call(system, HKCR, 'ProbeKey'));
  answer('delete-again', await RegDeleteKey.call(system, HKCR, 'ProbeKey'));
  answer('delete-empty', await RegDeleteKey.call(system, HKCR, ''));
  await query(HKCR, 'deleted', 'ProbeKey\\Sub', 80);
  answer('close-none', await RegCloseKey.call(system, HKCR));

  return records;
}

/* ---- lberr ---- */

const lbErrCaptures = new Map<string, Promise<Map<string, string>>>();

/** The `lberr` probe: what failing list and combo box messages answer, all 32 bits. */
export function lberrCapture(context: any) {
  const key = context.display.name;

  if (!lbErrCaptures.has(key)) {
    lbErrCaptures.set(key, captureLbErr(context));
  }

  return lbErrCaptures.get(key)!;
}

async function captureLbErr(system: any) {
  const records = new Map<string, string>();
  const scratch = GlobalLock.call(system, GlobalAlloc.call(system, 0x42, 128));

  void system.rasterDesktop;

  const kind: any = new WNDCLASS();

  kind.style = 0;
  kind.lpfnWndProc = (hwnd: number, message: number, wParam: number, lParam: number) =>
    DefWindowProc.call(system, hwnd, message, wParam, lParam);
  kind.hbrBackground = 5 + 1;
  kind.lpszClassName = 'LbErr';
  await RegisterClass.call(system, kind);

  const host = await CreateWindow.call(system, 'LbErr', 'Errors', 0x00cf0000, 20, 20, 300, 200, 0, 0, 0, 0);
  const list = await CreateWindow.call(system, 'LISTBOX', '', 0x40000000 | 0x10000000 | 0x00800000 | 0x0001, 8, 8, 100, 80, host, 100, 0, 0);
  const combo = await CreateWindow.call(system, 'COMBOBOX', '', 0x40000000 | 0x10000000 | 0x0003, 120, 8, 100, 80, host, 101, 0, 0);
  const send = (hwnd: number, message: number, wParam: number, lParam: any) =>
    SendMessage.call(system, hwnd, message, wParam, lParam);
  const answer = (what: string, value: number) =>
    records.set(`answer:${what}`, ((value ?? 0) >>> 0).toString(16).toUpperCase().padStart(8, '0'));

  await send(list, 0x401, 0, 'one');
  await send(list, 0x401, 0, 'two');
  await send(combo, 0x403, 0, 'one');

  answer('lb-add', await send(list, 0x401, 0, 'three'));
  answer('lb-getcursel', await send(list, 0x409, 0, 0));
  answer('lb-gettext', await send(list, 0x40a, 99, scratch));
  answer('lb-gettextlen', await send(list, 0x40b, 99, 0));
  answer('lb-setcursel', await send(list, 0x407, 99, 0));
  answer('lb-setcursel-none', await send(list, 0x407, 0xffff, 0));
  answer('lb-deletestring', await send(list, 0x403, 99, 0));
  answer('lb-getitemdata', await send(list, 0x41a, 99, 0));
  answer('lb-findstring', await send(list, 0x410, 0xffff, 'zz'));
  answer('lb-getsel', await send(list, 0x408, 99, 0));
  answer('lb-insert', await send(list, 0x402, 99, 'x'));
  answer('lb-selectstring', await send(list, 0x40d, 0xffff, 'zz'));
  answer('lb-getselcount', await send(list, 0x411, 0, 0));
  answer('lb-gettopindex', await send(list, 0x40f, 0, 0));
  answer('lb-getcount', await send(list, 0x40c, 0, 0));
  answer('cb-getcursel', await send(combo, 0x407, 0, 0));
  answer('cb-getlbtext', await send(combo, 0x408, 99, scratch));
  answer('cb-getlbtextlen', await send(combo, 0x409, 99, 0));
  answer('cb-setcursel', await send(combo, 0x40e, 99, 0));
  answer('cb-findstring', await send(combo, 0x40c, 0xffff, 'zz'));
  answer('cb-getitemdata', await send(combo, 0x410, 99, 0));

  await DestroyWindow.call(system, host);

  return records;
}

/* ---- netcaps ---- */

/** The `netcaps` probe: the network calls, with no network. */
export async function netcapsCapture(system: any) {
  const records = new Map<string, string>();

  for (const drive of ['A:', 'C:', 'Z:']) {
    /* Nothing is written, so the size and text are the probe's own. */
    records.set(`answer:connection,${drive}`, `${WNetGetConnection.call(system, drive, 0, 0)},size=64,text=#`);
  }

  for (const index of [...Array(14).keys(), 65535]) {
    records.set(`answer:caps,${index}`, String(WNetGetCaps.call(system, index)));
  }

  return records;
}

/* ---- drivetyp ---- */

/** The `drivetyp` probe: each drive number's type. */
export async function drivetypCapture(system: any) {
  const records = new Map<string, string>();

  for (const drive of [...Array(28).keys(), -1]) {
    records.set(`answer:${drive}`, String(GetDriveType.call(system, drive & 0xffff)));
  }

  return records;
}

/* ---- drawtext ---- */

const drawTextCaptures = new Map<string, Promise<Map<string, string>>>();

/** The `drawtext` probe, replayed through the exports once per display. */
export function drawtextCapture(context: any) {
  const key = context.display.name;

  if (!drawTextCaptures.has(key)) {
    drawTextCaptures.set(key, captureDrawText(context));
  }

  return drawTextCaptures.get(key)!;
}

async function captureDrawText(system: any) {
  const records = new Map<string, string>();
  const WIDTH = 172;
  const HEIGHT = 60;

  void system.rasterDesktop;

  const screen = GetDC.call(system, 0);
  const memory = CreateCompatibleDC.call(system, screen);
  const bitmap = CreateCompatibleBitmap.call(system, screen, WIDTH, HEIGHT);
  const was = SelectObject.call(system, memory, bitmap);

  SetTextColor.call(system, memory, 0x000000);
  SetBkColor.call(system, memory, 0xffffff);

  const draw = (name: string, text: string, count: number, left: number, top: number, right: number, bottom: number, format: number) => {
    const all: any = new RECT();

    all.left = 0;
    all.top = 0;
    all.right = WIDTH;
    all.bottom = HEIGHT;
    FillRect.call(system, memory, all, GetStockObject.call(system, 0));

    const rect: any = new RECT();

    rect.left = left;
    rect.top = top;
    rect.right = right;
    rect.bottom = bottom;

    const answer = DrawText.call(system, memory, text, count & 0xffff, rect, format);

    records.set(`answer:${name}`, `${answer},rect=${rect.left}:${rect.top}:${rect.right}:${rect.bottom}`);

    for (let y = 0; y < HEIGHT; y++) {
      let row = '';

      for (let x = 0; x < WIDTH; x++) {
        const index = PALETTE.indexOf(GetPixel.call(system, memory, x, y) & 0xffffff);

        row += index < 0 ? '?' : index.toString(16);
      }

      records.set(`rows:${name},y=${y}`, row);
    }
  };

  const DT = { LEFT: 0, CENTER: 1, RIGHT: 2, VCENTER: 4, BOTTOM: 8, WORDBREAK: 0x10, SINGLELINE: 0x20, EXPANDTABS: 0x40, TABSTOP: 0x80, NOCLIP: 0x100, EXTERNALLEADING: 0x200, CALCRECT: 0x400, NOPREFIX: 0x800 };

  draw('left', 'Hello', -1, 4, 4, 164, 54, DT.LEFT);
  draw('center', 'Hello', -1, 4, 4, 164, 54, DT.CENTER);
  draw('right', 'Hello', -1, 4, 4, 164, 54, DT.RIGHT);
  draw('vcenter', 'Hello', -1, 4, 4, 164, 54, DT.SINGLELINE | DT.VCENTER | DT.CENTER);
  draw('bottom', 'Hello', -1, 4, 4, 164, 54, DT.SINGLELINE | DT.BOTTOM);
  draw('vcenter-multi', 'Hello', -1, 4, 4, 164, 54, DT.VCENTER);
  draw('count', 'Hello', 3, 4, 4, 164, 54, DT.LEFT);
  draw('crlf', 'Two\r\nlines', -1, 4, 4, 164, 54, 0);
  draw('lf', 'Two\nlines', -1, 4, 4, 164, 54, 0);
  draw('cr', 'Two\rlines', -1, 4, 4, 164, 54, 0);
  draw('lfcr', 'Two\n\rlines', -1, 4, 4, 164, 54, 0);
  draw('single-crlf', 'Two\r\nlines', -1, 4, 4, 164, 54, DT.SINGLELINE);
  draw('center-crlf', 'A\r\nlonger line', -1, 4, 4, 164, 54, DT.CENTER);
  draw('wordbreak', 'The quick brown fox jumps', -1, 4, 4, 84, 54, DT.WORDBREAK);
  draw('longword', 'Unbreakableword x', -1, 4, 4, 44, 54, DT.WORDBREAK);
  draw('spaces', 'Hi   there   now', -1, 4, 4, 44, 54, DT.WORDBREAK);
  draw('wordbreak-center', 'The quick brown fox', -1, 4, 4, 84, 54, DT.WORDBREAK | DT.CENTER);
  draw('prefix', '&File &&x', -1, 4, 4, 164, 54, 0);
  draw('noprefix', '&File', -1, 4, 4, 164, 54, DT.NOPREFIX);
  draw('prefix-end', 'End&', -1, 4, 4, 164, 54, 0);
  draw('prefix-center', 'E&xit', -1, 4, 4, 164, 54, DT.CENTER);
  draw('tabs', 'a\tb\tc', -1, 4, 4, 164, 54, DT.EXPANDTABS);
  draw('tabstop', 'a\tb\tc', -1, 4, 4, 164, 54, DT.EXPANDTABS | DT.TABSTOP | (4 << 8));
  draw('tabs-off', 'a\tb', -1, 4, 4, 164, 54, 0);
  draw('calc-wrap', 'The quick brown fox', -1, 4, 4, 84, 54, DT.CALCRECT | DT.WORDBREAK);
  draw('calc-single', 'Hello', -1, 4, 4, 164, 54, DT.CALCRECT | DT.SINGLELINE);
  draw('calc-lines', 'Two\r\nlonger lines', -1, 4, 4, 164, 54, DT.CALCRECT);
  draw('calc-empty', '', -1, 4, 4, 164, 54, DT.CALCRECT);
  draw('calc-leading', 'Two\r\nlines', -1, 4, 4, 164, 54, DT.CALCRECT | DT.EXTERNALLEADING);
  draw('clip', 'A very long line of text', -1, 4, 4, 44, 14, DT.LEFT);
  draw('noclip', 'A very long line of text', -1, 4, 4, 44, 14, DT.NOCLIP);
  draw('clip-lines', 'One\r\nTwo\r\nThree', -1, 4, 4, 164, 20, 0);

  SelectObject.call(system, memory, was);
  ReleaseDC.call(system, 0, screen);

  return records;
}

/* ---- activate ---- */

const activateCaptures = new Map<string, Promise<Map<string, string>>>();

/** The `activate` probe: the activation and focus messages, and where they leave things. */
export function activateCapture(context: any) {
  const key = context.display.name;

  if (!activateCaptures.has(key)) {
    activateCaptures.set(key, captureActivate(context));
  }

  return activateCaptures.get(key)!;
}

async function captureActivate(system: any) {
  const records = new Map<string, string>();
  const core = system.machine.cpu.core;
  const windows = { A: 0, B: 0, D: 0 };
  let step = '';
  let number = 0;

  void system.rasterDesktop;

  /* The child dialog's template, as the probe's `build` makes it. */
  const bytes: number[] = [];
  const word = (value: number) => bytes.push(value & 0xff, (value >> 8) & 0xff);
  const item = (x: number, y: number, id: number) => {
    const style = 0x0000 | 0x00800000 | 0x00010000 | 0x40000000 | 0x10000000;

    [x, y, 80, 12, id, style & 0xffff, style >>> 16].forEach(word);
    bytes.push(0x81, 0, 0);
  };

  [0x40000000 & 0xffff, 0x40000000 >>> 16].forEach(word);
  bytes.push(2);
  [4, 4, 120, 50].forEach(word);
  bytes.push(0, 0, 0);
  item(6, 6, 101);
  item(6, 24, 102);

  const far = GlobalLock.call(system, GlobalAlloc.call(system, 0x42, 256));

  bytes.forEach((value, at) => core.write8((far >>> 16) & 0xffff, (far & 0xffff) + at, value));

  const name = (hwnd: number) => {
    if (!hwnd) return '0';
    if (hwnd === windows.A) return 'A';
    if (hwnd === windows.B) return 'B';
    if (hwnd === windows.D) return 'D';
    if (windows.D && GetParent.call(system, hwnd) === windows.D) {
      return `E${GetDlgCtrlID.call(system, hwnd) - 100}`;
    }
    return '?';
  };

  const log = (hwnd: number, message: number, wParam: number, lParam: number) => {
    let w: string;
    let l: string;

    switch (message) {
      case 0x001c:
        w = String(wParam & 0xffff);
        l = lParam ? 'task' : '0';
        break;
      case 0x0086:
      case User.WM_ACTIVATE:
        w = String(wParam & 0xffff);
        l =
          `${name(lParam & 0xffff)}:` +
          (message === 0x0086 ? (lParam >>> 16).toString(16) : String(lParam >>> 16));
        break;
      case User.WM_SETFOCUS:
      case User.WM_KILLFOCUS:
      case User.WM_INITDIALOG:
        w = name(wParam & 0xffff);
        l = '-';
        break;
      default:
        return;
    }

    records.set(
      `msg:${step},${number++}`,
      `${name(hwnd)},${message.toString(16).padStart(4, '0')},${w},${l}`
    );
  };

  const kind: any = new WNDCLASS();

  kind.style = 0;
  kind.lpfnWndProc = (hwnd: number, message: number, wParam: number, lParam: number) => {
    log(hwnd, message, wParam, lParam);
    return DefWindowProc.call(system, hwnd, message, wParam, lParam);
  };
  kind.hbrBackground = 5 + 1;
  kind.lpszClassName = 'ProbeActivate';
  await RegisterClass.call(system, kind);

  const dialogProc = (hwnd: number, message: number, wParam: number, lParam: number) => {
    log(hwnd, message, wParam, lParam);
    return 0;
  };

  const begin = (what: string) => {
    step = what;
    number = 0;
  };
  const state = async () => {
    await pumpAll(system);
    records.set(
      `state:${step}`,
      `focus=${name(GetFocus.call(system))},active=${name(GetActiveWindow.call(system))}`
    );
  };

  begin('create');
  windows.A = await CreateWindow.call(system, 'ProbeActivate', 'A', 0x00cf0000, 20, 20, 300, 200, 0, 0, 0, 0);
  await state();

  begin('dialog');
  windows.D = await CreateDialogIndirect.call(system, 0, far, windows.A, dialogProc);
  await state();

  begin('showdialog');
  await ShowWindow.call(system, windows.D, User.SW_SHOW);
  await state();

  begin('showA');
  await ShowWindow.call(system, windows.A, User.SW_SHOWNORMAL);
  await state();

  begin('focusE2');
  await SetFocus.call(system, GetDlgItem.call(system, windows.D, 102));
  await state();

  begin('showB');
  windows.B = await CreateWindow.call(system, 'ProbeActivate', 'B', 0x00cf0000, 60, 60, 300, 200, 0, 0, 0, 0);
  await ShowWindow.call(system, windows.B, User.SW_SHOWNORMAL);
  await state();

  begin('activateA');
  await SetActiveWindow.call(system, windows.A);
  await state();

  begin('focusnone');
  await SetFocus.call(system, 0);
  await state();

  begin('focusA');
  await SetFocus.call(system, windows.A);
  await state();

  begin('activateB');
  await SetActiveWindow.call(system, windows.B);
  await state();

  begin('destroyB');
  await DestroyWindow.call(system, windows.B);
  windows.B = 0;
  await state();

  begin('destroyA');
  await DestroyWindow.call(system, windows.A);
  windows.A = 0;
  windows.D = 0;
  await state();

  return records;
}

/* ---- atoms ---- */

const atomsCaptures = new Map<string, Promise<Map<string, string>>>();

/** The `atoms` probe: global and local atoms, and clipboard formats by name. */
export function atomsCapture(context: any) {
  const key = context.display.name;

  if (!atomsCaptures.has(key)) {
    atomsCaptures.set(key, captureAtoms(context));
  }

  return atomsCaptures.get(key)!;
}

async function captureAtoms(system: any) {
  const records = new Map<string, string>();
  const core = system.machine.cpu.core;
  const far = GlobalLock.call(system, GlobalAlloc.call(system, 0x42, 8192));
  const segment = (far >>> 16) & 0xffff;
  let used = 0;

  /* A string in the program's memory, as the probe passes it. */
  const str = (text: string) => {
    const at = (far & 0xffff) + used;

    for (let i = 0; i < text.length; i++) core.write8(segment, at + i, text.charCodeAt(i));
    core.write8(segment, at + text.length, 0);
    used += text.length + 1;

    return ((segment << 16) | at) >>> 0;
  };
  const buffer = (fill: string) => {
    const at = str(fill.padEnd(300, '\0'));

    for (let i = 0; i < fill.length; i++) core.write8(segment, (at & 0xffff) + i, fill.charCodeAt(i));
    core.write8(segment, (at & 0xffff) + fill.length, 0);

    return at;
  };
  const read = (at: number) => {
    let out = '';

    for (let i = 0; ; i++) {
      const c = core.read8(segment, (at & 0xffff) + i);
      if (!c) return out;
      out += String.fromCharCode(c);
    }
  };

  const seen: number[] = [];
  const describe = (atom: number) => {
    if (!atom) return '0';
    if (atom < 0xc000) return `#${atom}`;
    const index = seen.indexOf(atom);
    if (index >= 0) return `A${index + 1}`;
    seen.push(atom);
    return `new=A${seen.length}`;
  };
  const kind = (atom: number) => (!atom ? '0' : atom < 0xc000 ? `#${atom}` : 'string');
  const record = (fn: string, step: string, atom: number) => records.set(`${fn}:${step}`, describe(atom & 0xffff));
  const named = (step: string, answer: number, text: string) => records.set(`name:${step}`, `${answer},${text}`);

  /* The globals. */
  const one = GlobalAddAtom.call(system, str('WinboxAtomOne'));

  record('global', 'add', one);
  record('global', 'add-again-lower', GlobalAddAtom.call(system, str('winboxatomone')));
  record('global', 'add-other', GlobalAddAtom.call(system, str('WinboxAtomTwo')));
  record('global', 'find-upper', GlobalFindAtom.call(system, str('WINBOXATOMONE')));
  record('global', 'find-missing', GlobalFindAtom.call(system, str('WinboxAtomNone')));

  let b = buffer('');
  named('global-name', GlobalGetAtomName.call(system, one, b, 300), read(b));
  b = buffer('xxxxxxxx');
  named('global-name-short', GlobalGetAtomName.call(system, one, b, 4), read(b));
  b = buffer('xxxxxxxx');
  named('global-name-zero', GlobalGetAtomName.call(system, one, b, 0), read(b));

  record('global', 'delete-1', GlobalDeleteAtom.call(system, one));
  record('global', 'find-after-1', GlobalFindAtom.call(system, str('WinboxAtomOne')));
  record('global', 'delete-2', GlobalDeleteAtom.call(system, one));
  record('global', 'find-after-2', GlobalFindAtom.call(system, str('WinboxAtomOne')));
  record('global', 'delete-3', GlobalDeleteAtom.call(system, one));
  b = buffer('xxxxxxxx');
  named('global-name-deleted', GlobalGetAtomName.call(system, one, b, 300), read(b));

  record('global', 'int-string', GlobalAddAtom.call(system, str('#1234')));
  record('global', 'int-make', GlobalAddAtom.call(system, 77));
  record('global', 'int-find', GlobalFindAtom.call(system, str('#1234')));
  record('global', 'int-find-make', GlobalFindAtom.call(system, 1234));
  record('global', 'int-zero', GlobalAddAtom.call(system, str('#0')));
  record('global', 'int-c000', GlobalAddAtom.call(system, str('#49152')));
  record('global', 'int-bffff', GlobalAddAtom.call(system, str('#49151')));
  record('global', 'int-leading-zero', GlobalAddAtom.call(system, str('#0012')));
  records.set('global:int-sign', kind(GlobalAddAtom.call(system, str('#-5'))));
  records.set('global:int-letters', kind(GlobalAddAtom.call(system, str('#12ab'))));
  record('global', 'int-delete', GlobalDeleteAtom.call(system, 1234));
  b = buffer('');
  named('global-name-int', GlobalGetAtomName.call(system, 1234, b, 300), read(b));
  b = buffer('');
  named('global-name-int77', GlobalGetAtomName.call(system, 77, b, 300), read(b));

  record('global', 'empty', GlobalAddAtom.call(system, str('')));
  record('global', 'hash-only', GlobalAddAtom.call(system, str('#')));

  let text = '';

  for (let index = 0; index < 255; index++) text += String.fromCharCode(0x61 + (index % 26));
  record('global', 'long-255', GlobalAddAtom.call(system, str(text)));
  b = buffer('');
  const answer255 = GlobalGetAtomName.call(system, GlobalFindAtom.call(system, str(text)), b, 300);
  /* The probe's compiler worked out its third argument before the call, and
   * printed the buffer itself. */
  named('global-name-255', answer255, read(b));
  record('global', 'long-256', GlobalAddAtom.call(system, str(`${text}z`)));

  /* The locals. */
  const local = AddAtom.call(system, str('WinboxLocalOne'));

  record('local', 'add', local);
  record('local', 'add-again-upper', AddAtom.call(system, str('WINBOXLOCALONE')));
  record('local', 'find', FindAtom.call(system, str('winboxlocalone')));
  record('local', 'global-find', GlobalFindAtom.call(system, str('WinboxLocalOne')));
  b = buffer('');
  named('local-name', GetAtomName.call(system, local, b, 64), read(b));
  record('local', 'delete-1', DeleteAtom.call(system, local));
  record('local', 'delete-2', DeleteAtom.call(system, local));
  record('local', 'find-after', FindAtom.call(system, str('WinboxLocalOne')));
  records.set('local:delete-3', DeleteAtom.call(system, local) ? 'nonzero' : '0');
  record('local', 'int', AddAtom.call(system, str('#300')));
  b = buffer('');
  named('local-name-int', GetAtomName.call(system, 300, b, 64), read(b));

  /* The clipboard formats. */
  const format = RegisterWindowMessage.call(system, 'WinboxFormat');
  const message = RegisterWindowMessage.call(system, 'WinboxFormat');

  records.set('format:register', format >= 0xc000 ? 'C000+' : 'low');
  records.set('format:same-as-message', format === message ? 'yes' : 'no');
  records.set('format:again-upper', RegisterWindowMessage.call(system, 'WINBOXFORMAT') === format ? 'same' : 'different');
  record('format', 'global-find', GlobalFindAtom.call(system, str('WinboxFormat')));
  b = buffer('');
  records.set('format:name', `${GetClipboardFormatName.call(system, format, b, 64)},${read(b)}`);
  records.set('format:name-cf-text', String(GetClipboardFormatName.call(system, 1, b, 64)));

  return records;
}

/* ---- selinfo ---- */

const selinfoCaptures = new Map<string, Promise<Map<string, string>>>();

/** The `selinfo` probe: what LAR, LSL, VERR and VERW say of the selectors a program is given. */
export function selinfoCapture(context: any) {
  const key = context.display.name;

  if (!selinfoCaptures.has(key)) {
    selinfoCaptures.set(key, captureSelinfo(context));
  }

  return selinfoCaptures.get(key)!;
}

async function captureSelinfo(system: any) {
  const records = new Map<string, string>();
  const machine = system.machine;
  const core = machine.cpu.core;

  /* The instructions run on the processor itself, from a block of their own,
   * as the probe runs them: the selector in AX, the answer in BX. */
  const code = GlobalLock.call(system, GlobalAlloc.call(system, 0x42, 32)) >>> 16;
  const run = (bytes: number[], selector: number) => {
    const saved = { cs: core.cs, ip: core.ip, ax: core.ax, bx: core.bx, zero: core.flags.zero, msw: core.msw };

    /* In protected mode, as a program runs: the replay's machine is not. */
    core.msw = saved.msw | 1;
    bytes.forEach((value, at) => core.write8(code, at, value));
    core.cs = code;
    core.ip = 0;
    core.ax = selector;
    core.bx = 0;
    machine.cpu.step();

    const answer = { zero: core.flags.zero, bx: core.bx };

    /* Back to the replay's mode before its CS is loaded again. */
    core.msw = saved.msw;
    core.cs = saved.cs;
    core.ip = saved.ip;
    core.ax = saved.ax;
    core.bx = saved.bx;
    core.flags.zero = saved.zero;

    return answer;
  };
  const look = (fn: string, name: string, selector: number, limits: boolean) => {
    const lar = run([0x0f, 0x02, 0xd8], selector);
    const lsl = run([0x0f, 0x03, 0xd8], selector);
    const verr = run([0x0f, 0x00, 0xe0], selector).zero ? 1 : 0;
    const verw = run([0x0f, 0x00, 0xe8], selector).zero ? 1 : 0;
    const rights = lar.zero ? lar.bx.toString(16).padStart(4, '0') : '-';
    const limit = lsl.zero ? lsl.bx.toString(16).padStart(4, '0') : '-';

    records.set(
      `${fn}:${name}`,
      limits ? `lar=${rights},lsl=${limit},verr=${verr},verw=${verw}` : `lar=${rights},verr=${verr},verw=${verw}`
    );
  };
  const selectorOf = (handle: number) => GlobalLock.call(system, handle) >>> 16;

  look('sel', 'null', 0, true);
  look('sel', 'null-rpl3', 3, true);

  const moveable = GlobalAlloc.call(system, 0x0002, 100);
  look('sel', 'moveable-locked', selectorOf(moveable), true);
  const fixed = GlobalAlloc.call(system, 0x0000, 100);
  look('sel', 'fixed', selectorOf(fixed), true);
  const discardable = GlobalAlloc.call(system, 0x0102, 1000);
  look('sel', 'discardable', selectorOf(discardable), true);
  const big = GlobalAlloc.call(system, 0x0002, 70000);
  look('sel', 'big', selectorOf(big), true);

  const freed = GlobalAlloc.call(system, 0x0000, 100);
  const freedSelector = selectorOf(freed);

  GlobalFree.call(system, freed);
  look('sel', 'freed', freedSelector, true);

  /* USER's code: winbox.js's USER is not USER.EXE, so its segment is mapped
   * here as the module manager maps it. */
  const globalAllocator = system.allocator.globalAllocator;
  const userCode = globalAllocator.find(100, 1);

  globalAllocator.map(userCode, new DataView(new ArrayBuffer(16)), { code: true });
  look('code', 'user', (userCode << 3) | 7, false);

  return records;
}

/* ---- mmdevs ---- */

const mmdevsCaptures = new Map<string, Promise<Map<string, string>>>();

/** The `mmdevs` probe: an installation with no sound driver. */
export function mmdevsCapture(context: any) {
  const key = context.display.name;

  if (!mmdevsCaptures.has(key)) {
    mmdevsCaptures.set(key, captureMmdevs(context));
  }

  return mmdevsCaptures.get(key)!;
}

async function captureMmdevs(system: any) {
  const records = new Map<string, string>();
  const core = system.machine.cpu.core;
  const far = GlobalLock.call(system, GlobalAlloc.call(system, 0x42, 256));
  const segment = far >>> 16;

  /* The error texts are MMSYSTEM.DLL's: the installation's own file. */
  const bytes = readFileSync(join(__dirname, '..', '..', 'oracle', 'build', 'drive-c', 'WINDOWS', 'SYSTEM', 'MMSYSTEM.DLL'));
  const files = system.dos.files;
  const MMSYSTEM = 0x7fff;

  system.dos.files = {
    ...files,
    open: (path: string) => (/MMSYSTEM\.DLL$/i.test(path) ? MMSYSTEM : files.open(path)),
    resolve: (handle: number) =>
      handle === MMSYSTEM
        ? { read: async (at: number, length: number) => bytes.buffer.slice(bytes.byteOffset + at, bytes.byteOffset + at + length) }
        : files.resolve(handle),
  };

  try {
    records.set('count:waveout', String(waveOutGetNumDevs()));
    records.set('count:wavein', String(waveInGetNumDevs()));
    records.set('count:midiout', String(midiOutGetNumDevs()));
    records.set('count:midiin', '0');
    records.set('count:aux', '0');

    const handle = (writes: boolean, answer: () => number, name: string) => {
      core.write8(segment, far & 0xffff, 0x34);
      core.write8(segment, (far & 0xffff) + 1, 0x12);
      records.set(`open:${name}`, String(answer()));

      if (writes) {
        const value = core.read8(segment, far & 0xffff) | (core.read8(segment, (far & 0xffff) + 1) << 8);

        records.set(`open:${name}-handle`, value === 0x1234 ? 'untouched' : value === 0 ? 'zero' : 'nonzero');
      }
    };

    handle(false, () => waveOpen.call(system, 0), 'out-query-mapper');
    handle(false, () => waveOpen.call(system, 0), 'out-query-0');
    handle(true, () => waveOpen.call(system, far), 'out-open-0');
    handle(true, () => waveOpen.call(system, far), 'out-open-mapper');
    handle(false, () => waveOpen.call(system, 0), 'in-query-mapper');
    handle(true, () => waveOpen.call(system, far), 'in-open-0');
    handle(true, () => waveOpen.call(system, far), 'in-open-mapper');

    records.set('caps:waveout-0', String(waveGetDevCaps()));
    records.set('caps:wavein-0', String(waveGetDevCaps()));

    for (const error of [0, 2, 6, 32]) {
      for (const way of ['out', 'in']) {
        const text = far + 16;
        const answer = await waveGetErrorText.call(system, error, text, 128);
        let out = '';

        for (let at = 0; ; at++) {
          const c = core.read8(segment, (text & 0xffff) + at);

          if (!c) break;
          out += String.fromCharCode(c);
        }

        records.set(`text:${way},${error}`, `${answer},${out}`);
      }
    }
  } finally {
    system.dos.files = files;
  }

  return records;
}

/* ---- handbits ---- */

/** The `handbits` probe: the low two bits of each kind of handle, four of each. */
export async function handbitsCapture(system: any) {
  const records = new Map<string, string>();
  const low = (...handles: number[]) => handles.map((handle) => (handle ?? 0) & 3).join(',');
  const four = <T>(make: (index: number) => T) => [0, 1, 2, 3].map(make);

  void system.rasterDesktop;

  const screen = GetDC.call(system, 0);
  const dcs = four(() => CreateCompatibleDC.call(system, screen));
  const pens = four((index) => CreatePen.call(system, 0, index, index));
  const brushes = four((index) => CreateSolidBrush.call(system, index << 8));
  const fonts = four((index) =>
    CreateFont.call(system, 10 + index, 0, 0, 0, 400, 0, 0, 0, 0, 0, 0, 0, 0, 'System')
  );
  const bitmaps = four((index) => CreateCompatibleBitmap.call(system, screen, 8 + index, 8));
  const regions = four((index) => CreateRectRgn.call(system, 0, 0, 10 + index, 10));
  const menus = four(() => CreateMenu.call(system));
  const globals = four(() => GlobalAlloc.call(system, 0x0002, 16));

  await probeClass(system, 'ProbeBits', 0);

  const windows = [];

  for (let index = 0; index < 4; index++) {
    windows.push(await CreateWindow.call(system, 'ProbeBits', '', 0x00000000, 0, 0, 50, 50, 0, 0, 0, 0));
  }

  records.set('bits:dc', low(...dcs));
  records.set('bits:screen-dc', low(screen, screen, screen, screen));
  records.set('bits:pen', low(...pens));
  records.set('bits:brush', low(...brushes));
  records.set('bits:font', low(...fonts));
  records.set('bits:bitmap', low(...bitmaps));
  records.set('bits:region', low(...regions));
  records.set(
    'bits:stock',
    low(
      GetStockObject.call(system, 0),
      GetStockObject.call(system, 7),
      GetStockObject.call(system, 13),
      GetStockObject.call(system, 15)
    )
  );
  records.set('bits:window', low(...windows));
  records.set('bits:menu', low(...menus));
  records.set('bits:global', low(...globals));

  /* A program's instance: the handle its task is given. */
  const instance = system.handles.allocate(new Task(null, null));

  records.set('bits:instance', low(instance, instance, instance, instance));

  return records;
}

/* ---- msgbox ---- */

const msgboxCaptures = new Map<string, Promise<Map<string, string>>>();

/** The `msgbox` probe: each box, what is in it, its pixels, and what it answered. */
export function msgboxCapture(context: any) {
  const key = context.display.name;

  if (!msgboxCaptures.has(key)) {
    msgboxCaptures.set(key, captureMsgbox(context));
  }

  return msgboxCaptures.get(key)!;
}

async function captureMsgbox(system: any) {
  const records = new Map<string, string>();
  const core = system.machine.cpu.core;
  const scratch = GlobalLock.call(system, GlobalAlloc.call(system, 0x42, 64));
  const textAt = (far: number) => {
    let out = '';

    for (let at = 0; ; at++) {
      const c = core.read8(far >>> 16, (far & 0xffff) + at);

      if (!c) return out;
      out += String.fromCharCode(c);
    }
  };

  void system.rasterDesktop;

  await probeClass(system, 'ProbeOwner', 0);

  const owner = await CreateWindow.call(system, 'ProbeOwner', 'Owner', 0x00cf0000, 10, 10, 200, 120, 0, 0, 0, 0);

  await ShowWindow.call(system, owner, User.SW_SHOWNORMAL);
  await UpdateWindow.call(system, owner);
  await pumpAll(system);

  let phase = '';

  const look = async (box: number) => {
    const window: any = new RECT();
    const client: any = new RECT();
    const corner: any = new POINT();

    GetWindowRect.call(system, box, window);
    GetClientRect.call(system, box, client);
    ClientToScreen.call(system, box, corner);

    const focus = GetFocus.call(system);
    const focusId = focus && GetParent.call(system, focus) === box ? GetDlgCtrlID.call(system, focus) : -1;

    records.set(
      `box:${phase}`,
      `window=${window.left}:${window.top}:${window.right}:${window.bottom},` +
        `client=${corner.x}:${corner.y}:${corner.x + client.right}:${corner.y + client.bottom},` +
        `caption=${await windowText(system, box, 256)},owner-enabled=${IsWindowEnabled.call(system, owner) ? 1 : 0},` +
        `focus=${(focusId << 16) >> 16}`
    );

    let index = 0;

    for (let child = GetWindow.call(system, box, 5); child; child = GetWindow.call(system, child, 2)) {
      const place: any = new RECT();

      GetWindowRect.call(system, child, place);
      core.write8(scratch >>> 16, scratch & 0xffff, 0);
      GetClassName.call(system, child, scratch, 32);

      const topLeft: any = new POINT();
      const bottomRight: any = new POINT();

      topLeft.x = place.left;
      topLeft.y = place.top;
      bottomRight.x = place.right;
      bottomRight.y = place.bottom;
      ScreenToClient.call(system, box, topLeft);
      ScreenToClient.call(system, box, bottomRight);

      const style = GetWindowLong.call(system, child, -16) >>> 0;

      records.set(
        `control:${phase},${index++}`,
        `class=${textAt(scratch)},id=${(GetDlgCtrlID.call(system, child) << 16) >> 16},` +
          `style=${style.toString(16).padStart(8, '0')},text=${await windowText(system, child, 256)},` +
          `rect=${topLeft.x}:${topLeft.y}:${bottomRight.x}:${bottomRight.y}`
      );
    }

    const screen = GetDC.call(system, 0);

    for (let y = window.top; y < window.bottom; y++) {
      let row = '';

      for (let x = window.left; x < window.right && x - window.left < 699; x++) {
        const index = PALETTE.indexOf(GetPixel.call(system, screen, x, y) & 0xffffff);

        row += index < 0 ? '?' : index.toString(16);
      }

      records.set(`rows:${phase},y=${y - window.top}`, row);
    }

    ReleaseDC.call(system, 0, screen);
  };

  const looker = async (_hwnd: number, _message: number, id: number) => {
    KillTimer.call(system, 0, id);

    const box = GetActiveWindow.call(system);

    if (box && box !== owner) {
      await look(box);
    }

    const focus = GetFocus.call(system);

    PostMessage.call(system, focus || box, User.WM_KEYDOWN, 0x0d, 0x001c0001);
    PostMessage.call(system, focus || box, User.WM_KEYUP, 0x0d, 0xc01c0001);
  };

  const box = async (name: string, parent: number, text: string, title: string | null, style: number) => {
    phase = name;
    SetTimer.call(system, 0, 0, 200, looker);
    records.set(`answer:${name}`, String(await MessageBox.call(system, parent, text, title, style)));
  };

  await box('ok', owner, 'Hello', 'Title', 0x0000);
  await box('null-title', owner, 'No title given.', null, 0x0000);
  await box('question', owner, 'Save the changes?', 'Question', 0x0003 | 0x0020 | 0x0100);
  await box(
    'long',
    owner,
    'This message is long enough that it has to be broken into several lines to fit ' +
      'inside the box, which is only so wide, however much there is to say in it.',
    'Long',
    0x0001 | 0x0030
  );
  await box('hand', owner, 'Something failed.', 'Stop', 0x0002 | 0x0010 | 0x0200);
  await box('asterisk', owner, 'First line\nSecond line', 'Lines', 0x0005 | 0x0040);
  await box('no-owner', 0, 'Nobody owns this.', 'Alone', 0x0000);
  await box('yesno', owner, 'Yes or no?', 'Choose', 0x0004);

  await DestroyWindow.call(system, owner);

  return records;
}

/* ---- stretch ---- */

const stretchCaptures = new Map<string, Promise<Map<string, string>>>();

/** The `stretch` probe: columns and rows stretched in each mode, and the modes. */
export function stretchCapture(context: any) {
  const key = context.display.name;

  if (!stretchCaptures.has(key)) {
    stretchCaptures.set(key, captureStretch(context));
  }

  return stretchCaptures.get(key)!;
}

async function captureStretch(system: any) {
  const records = new Map<string, string>();
  const screen = system.handles.allocate(Surface.offscreen(1, 1));
  const HEX = '0123456789abcdef';
  const PALETTE = [
    0x000000, 0x000080, 0x008000, 0x008080, 0x800000, 0x800080, 0x808000, 0xc0c0c0, 0x808080,
    0x0000ff, 0x00ff00, 0x00ffff, 0xff0000, 0xff00ff, 0xffff00, 0xffffff,
  ];
  const digit = (colour: number) => {
    const index = PALETTE.indexOf(colour & 0xffffff);

    return index < 0 ? '?' : HEX[index];
  };

  const modes = CreateCompatibleDC.call(system, screen);

  records.set('mode:new', String(GetStretchBltMode.call(system, modes)));

  for (const set of [0, 1, 3, 4, 5]) {
    SetStretchBltMode.call(system, modes, 3);
    const answer = SetStretchBltMode.call(system, modes, set);

    records.set(`mode:set=${set}`, `${answer},${GetStretchBltMode.call(system, modes)}`);
  }

  const stretch = (axis: string, sw: number, sh: number, dw: number, dh: number, mode: number) => {
    const source = CreateCompatibleDC.call(system, screen);
    const target = CreateCompatibleDC.call(system, screen);
    const width = Math.abs(dw);
    const height = Math.abs(dh);

    SelectObject.call(system, source, CreateCompatibleBitmap.call(system, screen, sw, sh));
    SelectObject.call(system, target, CreateCompatibleBitmap.call(system, screen, width, height));

    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        SetPixel.call(system, source, x, y, PALETTE[(axis === 'x' ? x : y) % 16]);
      }
    }

    SelectObject.call(system, target, GetStockObject.call(system, Gdi.WHITE_BRUSH));
    PatBlt.call(system, target, 0, 0, width, height, Gdi.PATCOPY);
    SetStretchBltMode.call(system, target, mode);
    StretchBlt.call(
      system,
      target,
      dw < 0 ? width - 1 : 0,
      dh < 0 ? height - 1 : 0,
      dw,
      dh,
      source,
      0,
      0,
      sw,
      sh,
      Gdi.SRCCOPY
    );

    for (let y = 0; y < height; y++) {
      let row = '';

      for (let x = 0; x < width && x < 299; x++) {
        row += digit(GetPixel.call(system, target, x, y));
      }

      records.set(`rows:${axis},${sw}:${sh},${dw}:${dh},${mode},y=${y}`, row);
    }
  };

  stretch('x', 58, 1, 37, 1, 3);
  stretch('x', 16, 1, 7, 1, 3);
  stretch('x', 16, 1, 10, 1, 3);
  stretch('x', 7, 1, 16, 1, 3);
  stretch('x', 5, 1, 13, 1, 3);
  stretch('x', 16, 1, -10, 1, 3);
  stretch('y', 1, 58, 1, 37, 3);
  stretch('y', 1, 279, 1, 189, 3);
  stretch('y', 1, 16, 1, 7, 3);
  stretch('y', 1, 7, 1, 16, 3);
  stretch('y', 1, 16, 1, -10, 3);
  stretch('x', 16, 1, 7, 1, 1);
  stretch('x', 16, 1, 7, 1, 2);
  stretch('y', 1, 16, 1, 7, 1);
  stretch('y', 1, 16, 1, 7, 2);
  stretch('x', 58, 20, 37, 13, 3);

  return records;
}

/* ---- patbrush ---- */

const patbrushCaptures = new Map<string, Promise<Map<string, string>>>();

/** The `patbrush` probe: what pattern brushes paint, and where they start. */
export function patbrushCapture(context: any) {
  const key = context.display.name;

  if (!patbrushCaptures.has(key)) {
    patbrushCaptures.set(key, capturePatbrush(context));
  }

  return patbrushCaptures.get(key)!;
}

async function capturePatbrush(system: any) {
  const records = new Map<string, string>();
  const core = system.machine.cpu.core;
  const far = GlobalLock.call(system, GlobalAlloc.call(system, 0x42, 64));
  const segment = far >>> 16;
  const screen = system.handles.allocate(Surface.offscreen(1, 1));
  const HEX = '0123456789abcdef';
  const PALETTE = [
    0x000000, 0x000080, 0x008000, 0x008080, 0x800000, 0x800080, 0x808000, 0xc0c0c0, 0x808080,
    0x0000ff, 0x00ff00, 0x00ffff, 0xff0000, 0xff00ff, 0xffff00, 0xffffff,
  ];
  const BITS = [0x90, 0x40, 0x20, 0x10, 0x08, 0x04, 0x02, 0x01];
  const digit = (colour: number) => {
    const index = PALETTE.indexOf(colour & 0xffffff);

    return index < 0 ? '?' : HEX[index];
  };
  const rect = (left: number, top: number, right: number, bottom: number) => {
    const made: any = new RECT();

    Object.assign(made, { left, top, right, bottom });

    return made;
  };
  const white = GetStockObject.call(system, Gdi.WHITE_BRUSH);

  BITS.forEach((bits, row) => {
    core.write8(segment, (far & 0xffff) + row * 2, bits);
    core.write8(segment, (far & 0xffff) + row * 2 + 1, 0);
  });

  let dc = 0;

  const begin = () => {
    dc = CreateCompatibleDC.call(system, screen);
    SelectObject.call(system, dc, CreateCompatibleBitmap.call(system, screen, 16, 16));
    FillRect.call(system, dc, rect(0, 0, 16, 16), white);
  };
  const end = (name: string) => {
    for (let y = 0; y < 16; y++) {
      let row = '';

      for (let x = 0; x < 16; x++) {
        row += digit(GetPixel.call(system, dc, x, y));
      }

      records.set(`rows:${name},y=${y}`, row);
    }

    SelectObject.call(system, dc, white);
  };
  const monoBitmap = () => CreateBitmap.call(system, 8, 8, 1, 1, far);
  const monoBrush = () => CreatePatternBrush.call(system, monoBitmap());
  const colourBrush = (size: number) => {
    const memory = CreateCompatibleDC.call(system, screen);
    const bitmap = CreateCompatibleBitmap.call(system, screen, size, size);

    SelectObject.call(system, memory, bitmap);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        SetPixel.call(system, memory, x, y, PALETTE[(x + 2 * y) % 16]);
      }
    }

    return CreatePatternBrush.call(system, bitmap);
  };
  const colours = (text: number, back: number) => {
    SetTextColor.call(system, dc, text);
    SetBkColor.call(system, dc, back);
  };

  /* What the brush is. */
  const bitmap = monoBitmap();
  let brush = CreatePatternBrush.call(system, bitmap);
  const logical = (far + 32) >>> 0;
  const size = GetObject.call(system, brush, 8, logical);
  const word = (at: number) => core.read8(segment, (logical & 0xffff) + at) | (core.read8(segment, (logical & 0xffff) + at + 1) << 8);
  const colour = ((word(4) << 16) | word(2)) >>> 0;

  records.set(
    'brush:mono',
    `${size},style=${word(0)},color=${colour.toString(16).padStart(8, '0')},bitmap=${word(6) === bitmap ? 'same' : 'other'}`
  );

  begin();
  SelectObject.call(system, dc, monoBrush());
  colours(0x0000ff, 0xff0000);
  PatBlt.call(system, dc, 0, 0, 16, 16, Gdi.PATCOPY);
  end('mono');

  begin();
  brush = monoBrush();
  colours(0x008000, 0x00ffff);
  SelectObject.call(system, dc, brush);
  colours(0x800080, 0xffff00);
  PatBlt.call(system, dc, 0, 0, 16, 16, Gdi.PATCOPY);
  end('mono-later');

  begin();
  SelectObject.call(system, dc, monoBrush());
  colours(0, 0xffffff);
  PatBlt.call(system, dc, 3, 2, 10, 11, Gdi.PATCOPY);
  end('offset');

  begin();
  brush = monoBrush();
  colours(0, 0xffffff);
  SelectObject.call(system, dc, brush);
  SetBrushOrg.call(system, dc, 3, 1);
  PatBlt.call(system, dc, 0, 0, 16, 8, Gdi.PATCOPY);
  SelectObject.call(system, dc, white);
  UnrealizeObject.call(system, brush);
  SelectObject.call(system, dc, brush);
  PatBlt.call(system, dc, 0, 8, 16, 8, Gdi.PATCOPY);
  end('origin');

  begin();
  brush = monoBrush();
  colours(0, 0xffffff);
  SelectObject.call(system, dc, brush);
  SetBrushOrg.call(system, dc, 3, 1);
  SelectObject.call(system, dc, white);
  SelectObject.call(system, dc, brush);
  PatBlt.call(system, dc, 0, 0, 16, 8, Gdi.PATCOPY);
  SelectObject.call(system, dc, white);
  SelectObject.call(system, dc, monoBrush());
  PatBlt.call(system, dc, 0, 8, 16, 8, Gdi.PATCOPY);
  end('reselect');

  begin();
  SelectObject.call(system, dc, colourBrush(8));
  PatBlt.call(system, dc, 0, 0, 16, 16, Gdi.PATCOPY);
  end('colour');

  begin();
  SelectObject.call(system, dc, colourBrush(16));
  PatBlt.call(system, dc, 0, 0, 16, 16, Gdi.PATCOPY);
  end('colour16');

  begin();
  brush = monoBrush();
  colours(0, 0xffffff);
  FillRect.call(system, dc, rect(2, 1, 14, 15), brush);
  const old = SelectObject.call(system, dc, GetStockObject.call(system, Gdi.BLACK_BRUSH));

  records.set('brush:after-fillrect', old === brush ? 'pattern' : old === white ? 'white' : 'other');
  end('fillrect');

  begin();
  {
    const memory = CreateCompatibleDC.call(system, screen);

    SelectObject.call(system, memory, CreateCompatibleBitmap.call(system, screen, 16, 16));

    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        SetPixel.call(system, memory, x, y, ((x >> 2) + (y >> 2)) % 2 ? 0 : 0xffffff);
      }
    }

    FillRect.call(system, dc, rect(0, 0, 16, 16), GetStockObject.call(system, Gdi.LTGRAY_BRUSH));
    SelectObject.call(system, dc, monoBrush());
    colours(0, 0xffffff);
    BitBlt.call(system, dc, 0, 0, 16, 16, memory, 0, 0, 0xa803a9);
  }
  end('dspoa');

  return records;
}

/* ---- clipdc ---- */

const clipdcCaptures = new Map<string, Promise<Map<string, string>>>();

/** The `clipdc` probe: a memory device context's clip region, and SaveDC and RestoreDC. */
export function clipdcCapture(context: any) {
  const key = context.display.name;

  if (!clipdcCaptures.has(key)) {
    clipdcCaptures.set(key, captureClipdc(context));
  }

  return clipdcCaptures.get(key)!;
}

async function captureClipdc(system: any) {
  const records = new Map<string, string>();
  const screen = system.handles.allocate(Surface.offscreen(1, 1));
  const HEX = '0123456789abcdef';
  const PALETTE = [
    0x000000, 0x000080, 0x008000, 0x008080, 0x800000, 0x800080, 0x808000, 0xc0c0c0, 0x808080,
    0x0000ff, 0x00ff00, 0x00ffff, 0xff0000, 0xff00ff, 0xffff00, 0xffffff,
  ];
  const digit = (colour: number) => {
    const index = PALETTE.indexOf(colour & 0xffffff);

    return index < 0 ? '?' : HEX[index];
  };
  const hex6 = (value: number) => (value >>> 0).toString(16).padStart(6, '0');
  let dc = 0;

  const box = (name: string, answer: number) => {
    const rect: any = new RECT();
    const kind = GetClipBox.call(system, dc, rect);

    records.set(`clip:${name}`, `${answer},box=${kind}:${rect.left},${rect.top},${rect.right},${rect.bottom}`);
  };
  const save = (name: string, answer: number) => {
    const rect: any = new RECT();

    GetClipBox.call(system, dc, rect);
    records.set(
      `save:${name}`,
      `${answer},text=${hex6(GetTextColor.call(system, dc))},back=${hex6(GetBkColor.call(system, dc))},` +
        `stretch=${GetStretchBltMode.call(system, dc)},box=${rect.left},${rect.top},${rect.right},${rect.bottom}`
    );
  };
  const begin = () => {
    dc = CreateCompatibleDC.call(system, screen);
    SelectObject.call(system, dc, CreateCompatibleBitmap.call(system, screen, 16, 16));
    PatBlt.call(system, dc, 0, 0, 16, 16, Gdi.WHITENESS);
  };
  const holed = () => {
    IntersectClipRect.call(system, dc, 2, 3, 12, 10);
    ExcludeClipRect.call(system, dc, 4, 5, 7, 7);
  };
  const end = (name: string) => {
    SelectClipRgn.call(system, dc, 0);

    for (let y = 0; y < 16; y++) {
      let row = '';

      for (let x = 0; x < 16; x++) {
        row += digit(GetPixel.call(system, dc, x, y));
      }

      records.set(`rows:${name},y=${y}`, row);
    }
  };

  /* The clip calls. */
  dc = CreateCompatibleDC.call(system, screen);
  box('new', 0);
  const target = CreateCompatibleBitmap.call(system, screen, 16, 16);
  SelectObject.call(system, dc, target);
  box('selected', 0);
  box('intersect', IntersectClipRect.call(system, dc, 2, 3, 12, 10));
  box('intersect-again', IntersectClipRect.call(system, dc, 0, 0, 8, 16));
  box('exclude', ExcludeClipRect.call(system, dc, 4, 5, 6, 7));
  box('exclude-edge', ExcludeClipRect.call(system, dc, 0, 0, 16, 4));
  box('intersect-outside', IntersectClipRect.call(system, dc, 20, 20, 30, 30));
  box('select-null', SelectClipRgn.call(system, dc, 0));
  box('intersect-reversed', IntersectClipRect.call(system, dc, 12, 10, 2, 3));
  SelectClipRgn.call(system, dc, 0);
  const region = CreateRectRgn.call(system, 1, 2, 9, 11);
  box('select-region', SelectClipRgn.call(system, dc, region));
  box('region-changed', 0);
  DeleteObject.call(system, region);
  box('region-deleted', 0);
  IntersectClipRect.call(system, dc, 3, 3, 5, 5);
  SelectObject.call(system, dc, CreateCompatibleBitmap.call(system, screen, 20, 20));
  box('bitmap-changed', 0);
  SelectObject.call(system, dc, target);
  box('offset', OffsetClipRgn.call(system, dc, 2, 1));

  /* Saving and restoring. */
  begin();
  SetTextColor.call(system, dc, 0x0000ff);
  SetBkColor.call(system, dc, 0xff0000);
  SetStretchBltMode.call(system, dc, 3);
  save('before', 0);
  let answer = SaveDC.call(system, dc);
  SetTextColor.call(system, dc, 0x00ff00);
  SetBkColor.call(system, dc, 0x00ffff);
  SetStretchBltMode.call(system, dc, 2);
  IntersectClipRect.call(system, dc, 1, 1, 5, 5);
  save('saved', answer);
  answer = SaveDC.call(system, dc);
  SetTextColor.call(system, dc, 0);
  IntersectClipRect.call(system, dc, 2, 2, 4, 4);
  save('saved-again', answer);
  save('saved-third', SaveDC.call(system, dc));

  const steps: [string, () => number][] = [
    ['restore-minus-one', () => RestoreDC.call(system, dc, -1)],
    ['restore-one', () => RestoreDC.call(system, dc, 1)],
    ['restore-empty', () => RestoreDC.call(system, dc, -1)],
    ['save-after', () => SaveDC.call(system, dc)],
    ['restore-five', () => RestoreDC.call(system, dc, 5)],
    ['restore-zero', () => RestoreDC.call(system, dc, 0)],
    ['restore-minus-two', () => RestoreDC.call(system, dc, -2)],
    ['restore-two', () => RestoreDC.call(system, dc, 2)],
    ['restore-minus-one-after-zero', () => RestoreDC.call(system, dc, -1)],
    ['save-1', () => SaveDC.call(system, dc)],
    ['save-2', () => SaveDC.call(system, dc)],
    ['restore-2-of-2', () => (SetTextColor.call(system, dc, 0x008000), RestoreDC.call(system, dc, 2))],
    ['restore-minus-one-last', () => RestoreDC.call(system, dc, -1)],
    ['save-a', () => SaveDC.call(system, dc)],
    ['save-b', () => SaveDC.call(system, dc)],
    ['save-c', () => SaveDC.call(system, dc)],
    ['restore-minus-two-of-3', () => RestoreDC.call(system, dc, -2)],
    ['restore-minus-one-then', () => RestoreDC.call(system, dc, -1)],
    ['restore-minus-one-empty', () => RestoreDC.call(system, dc, -1)],
    ['save-x', () => SaveDC.call(system, dc)],
    ['save-y', () => (SetTextColor.call(system, dc, 0x008000), SaveDC.call(system, dc))],
    ['restore-zero-of-2', () => (SetTextColor.call(system, dc, 0x000080), RestoreDC.call(system, dc, 0))],
    ['restore-minus-one-after', () => RestoreDC.call(system, dc, -1)],
    ['restore-minus-one-after-2', () => RestoreDC.call(system, dc, -1)],
  ];

  for (const [name, step] of steps) {
    save(name, step());
  }

  end('save');

  /* Drawing through the holed clip. */
  begin();
  holed();
  PatBlt.call(system, dc, 0, 0, 16, 16, Gdi.BLACKNESS);
  end('patblt');

  begin();
  holed();
  const all: any = new RECT();
  Object.assign(all, { left: 0, top: 0, right: 16, bottom: 16 });
  FillRect.call(system, dc, all, GetStockObject.call(system, Gdi.BLACK_BRUSH));
  end('fillrect');

  begin();
  holed();
  SelectObject.call(system, dc, GetStockObject.call(system, Gdi.GRAY_BRUSH));
  Rectangle.call(system, dc, 0, 1, 15, 14);
  SelectObject.call(system, dc, GetStockObject.call(system, Gdi.WHITE_BRUSH));
  MoveTo.call(system, dc, 0, 15);
  LineTo.call(system, dc, 16, 0);
  end('lines');

  begin();
  holed();
  SetBkColor.call(system, dc, 0x00ffff);
  SetTextColor.call(system, dc, 0xff0000);
  TextOut.call(system, dc, 0, 0, 'WM', 2);
  end('text');

  begin();
  holed();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      SetPixel.call(system, dc, x, y, 0x0000ff);
    }
  }
  end('setpixel');

  begin();
  const source = CreateCompatibleDC.call(system, screen);
  SelectObject.call(system, source, CreateCompatibleBitmap.call(system, screen, 8, 8));
  PatBlt.call(system, source, 0, 0, 8, 8, Gdi.BLACKNESS);
  holed();
  BitBlt.call(system, dc, 0, 0, 16, 16, source, 0, 0, Gdi.SRCCOPY);
  SetStretchBltMode.call(system, dc, 3);
  StretchBlt.call(system, dc, 6, 6, 8, 8, source, 0, 0, 4, 4, Gdi.SRCCOPY);
  end('blt');

  return records;
}

/* ---- mapmode ---- */

const mapmodeCaptures = new Map<string, Promise<Map<string, string>>>();

/** The `mapmode` probe: mapping modes, their origins and extents, and drawing through them. */
export function mapmodeCapture(context: any) {
  const key = context.display.name;

  if (!mapmodeCaptures.has(key)) {
    mapmodeCaptures.set(key, captureMapmode(context));
  }

  return mapmodeCaptures.get(key)!;
}

async function captureMapmode(system: any) {
  const records = new Map<string, string>();
  const core = system.machine.cpu.core;
  const far = GlobalLock.call(system, GlobalAlloc.call(system, 0x42, 16));
  const segment = far >>> 16;
  const screen = system.handles.allocate(Surface.offscreen(1, 1));
  const HEX = '0123456789abcdef';
  const PALETTE = [
    0x000000, 0x000080, 0x008000, 0x008080, 0x800000, 0x800080, 0x808000, 0xc0c0c0, 0x808080,
    0x0000ff, 0x00ff00, 0x00ffff, 0xff0000, 0xff00ff, 0xffff00, 0xffffff,
  ];
  const digit = (colour: number) => {
    const index = PALETTE.indexOf(colour & 0xffffff);

    return index < 0 ? '?' : HEX[index];
  };
  const words = (value: number) => `${(value << 16) >> 16}:${value >> 16}`;
  let dc = 0;

  const state = () =>
    `map=${GetMapMode.call(system, dc)},wo=${words(GetWindowOrg.call(system, dc))},` +
    `we=${words(GetWindowExt.call(system, dc))},vo=${words(GetViewportOrg.call(system, dc))},` +
    `ve=${words(GetViewportExt.call(system, dc))}`;
  const setting = (name: string, answer: number) => records.set(`set:${name}`, `${words(answer >>> 0)},${state()}`);
  const points = (name: string) => {
    for (let x = -7; x <= 7; x++) {
      for (const [kind, call] of [
        ['lp', LPtoDP],
        ['dp', DPtoLP],
      ] as const) {
        core.write16(segment, far & 0xffff, x & 0xffff);
        core.write16(segment, (far & 0xffff) + 2, x & 0xffff);
        call.call(system, dc, far, 1);
        const px = (core.read16(segment, far & 0xffff) << 16) >> 16;
        const py = (core.read16(segment, (far & 0xffff) + 2) << 16) >> 16;

        records.set(`point:${name},${kind}=${x}`, `${px},${py}`);
      }
    }
  };
  const begin = () => {
    dc = CreateCompatibleDC.call(system, screen);
    SelectObject.call(system, dc, CreateCompatibleBitmap.call(system, screen, 16, 16));
    PatBlt.call(system, dc, 0, 0, 16, 16, Gdi.WHITENESS);

    /* Lines as this display's driver draws them. */
    const context = system.handles.resolve(dc).context;

    context.lineTie = system.display.lineTie;
    context.clipCaps = system.display.clipCaps;
  };
  const end = (name: string) => {
    SetMapMode.call(system, dc, 1);
    SetWindowOrg.call(system, dc, 0, 0);
    SetViewportOrg.call(system, dc, 0, 0);

    for (let y = 0; y < 16; y++) {
      let row = '';

      for (let x = 0; x < 16; x++) {
        row += digit(GetPixel.call(system, dc, x, y));
      }

      records.set(`rows:${name},y=${y}`, row);
    }
  };

  /* Each mode's origins and extents. */
  dc = CreateCompatibleDC.call(system, screen);
  records.set('mode:new', state());

  for (const mode of [1, 2, 3, 4, 5, 6, 7, 8, 9, 0]) {
    const answer = SetMapMode.call(system, dc, mode);

    records.set(`mode:set=${mode}`, `${answer},${state()}`);
  }

  SetMapMode.call(system, dc, 1);
  setting('text-window-org', SetWindowOrg.call(system, dc, 5, 7));
  setting('text-viewport-org', SetViewportOrg.call(system, dc, -2, 3));
  setting('text-window-ext', SetWindowExt.call(system, dc, 10, 20));
  setting('text-viewport-ext', SetViewportExt.call(system, dc, 30, 40));
  setting('text-offset-window', OffsetWindowOrg.call(system, dc, 1, 1));
  setting('text-offset-viewport', OffsetViewportOrg.call(system, dc, 1, 1));
  SetMapMode.call(system, dc, 8);
  setting('aniso', 0);
  setting('aniso-window-ext', SetWindowExt.call(system, dc, 10, 20));
  setting('aniso-viewport-ext', SetViewportExt.call(system, dc, 30, -40));
  setting('aniso-window-ext-zero', SetWindowExt.call(system, dc, 0, 5));
  setting('aniso-scale-window', ScaleWindowExt.call(system, dc, 2, 3, 1, 2));
  setting('aniso-scale-viewport', ScaleViewportExt.call(system, dc, 3, 2, 5, 4));
  SetMapMode.call(system, dc, 7);
  setting('iso', 0);
  setting('iso-window-ext', SetWindowExt.call(system, dc, 100, 100));
  setting('iso-viewport-ext', SetViewportExt.call(system, dc, 50, 80));
  setting('iso-viewport-ext-neg', SetViewportExt.call(system, dc, 60, -30));
  setting('iso-window-ext-2', SetWindowExt.call(system, dc, 30, 10));
  SetMapMode.call(system, dc, 4);
  setting('loenglish-window-ext', SetWindowExt.call(system, dc, 10, 20));
  setting('loenglish-window-org', SetWindowOrg.call(system, dc, 10, 20));

  /* Points. */
  dc = CreateCompatibleDC.call(system, screen);
  SetMapMode.call(system, dc, 8);
  SetWindowExt.call(system, dc, 3, 3);
  SetViewportExt.call(system, dc, 2, 2);
  points('3to2');
  SetWindowExt.call(system, dc, 7, 7);
  SetViewportExt.call(system, dc, 3, -3);
  points('7to-3');
  SetWindowExt.call(system, dc, 2, 2);
  SetViewportExt.call(system, dc, 5, 5);
  SetWindowOrg.call(system, dc, 1, -2);
  SetViewportOrg.call(system, dc, 3, 4);
  points('2to5-moved');
  SetMapMode.call(system, dc, 2);
  points('lometric');
  SetMapMode.call(system, dc, 1);
  SetWindowOrg.call(system, dc, 3, -1);
  SetViewportOrg.call(system, dc, 2, 2);
  points('text-moved');

  /* Drawing. */
  begin();
  SetWindowOrg.call(system, dc, 3, 2);
  PatBlt.call(system, dc, 3, 2, 4, 3, Gdi.BLACKNESS);
  SelectObject.call(system, dc, GetStockObject.call(system, Gdi.GRAY_BRUSH));
  Rectangle.call(system, dc, 8, 6, 14, 12);
  MoveTo.call(system, dc, 3, 15);
  LineTo.call(system, dc, 17, 8);
  end('window-org');

  begin();
  const source = CreateCompatibleDC.call(system, screen);
  SelectObject.call(system, source, CreateCompatibleBitmap.call(system, screen, 8, 8));
  PatBlt.call(system, source, 0, 0, 8, 8, Gdi.BLACKNESS);
  PatBlt.call(system, source, 2, 2, 4, 4, Gdi.WHITENESS);
  SetWindowOrg.call(system, source, 1, 1);
  SetViewportOrg.call(system, dc, 4, 3);
  BitBlt.call(system, dc, 0, 0, 6, 6, source, 1, 1, Gdi.SRCCOPY);
  end('viewport-org-blt');

  begin();
  SetMapMode.call(system, dc, 8);
  SetWindowExt.call(system, dc, 3, 3);
  SetViewportExt.call(system, dc, 2, 2);
  PatBlt.call(system, dc, 1, 1, 5, 4, Gdi.BLACKNESS);
  SelectObject.call(system, dc, GetStockObject.call(system, Gdi.GRAY_BRUSH));
  Rectangle.call(system, dc, 7, 2, 20, 14);
  MoveTo.call(system, dc, 0, 23);
  LineTo.call(system, dc, 23, 11);
  end('scale');

  begin();
  SetMapMode.call(system, dc, 8);
  SetWindowExt.call(system, dc, 1, 1);
  SetViewportExt.call(system, dc, 3, 2);
  SetStretchBltMode.call(system, dc, 3);
  BitBlt.call(system, dc, 0, 0, 4, 4, source, 1, 1, Gdi.SRCCOPY);
  end('scale-blt');

  begin();
  SetWindowOrg.call(system, dc, -1, -1);
  MoveTo.call(system, dc, 1, 12);
  LineTo.call(system, dc, 13, 6);
  end('tie-inside');

  begin();
  SetWindowOrg.call(system, dc, 5, 0);
  MoveTo.call(system, dc, 6, 12);
  LineTo.call(system, dc, 18, 6);
  end('tie-logical-outside');

  begin();
  SetMapMode.call(system, dc, 8);
  SetViewportExt.call(system, dc, 2, 1);
  MoveTo.call(system, dc, 0, 12);
  LineTo.call(system, dc, 6, 6);
  end('tie-scaled');

  return records;
}

/* ---- showsb ---- */

const showsbCaptures = new Map<string, Promise<Map<string, string>>>();

/** The `showsb` probe: a window's scroll bars shown and hidden. */
export function showsbCapture(context: any) {
  const key = context.display.name;

  if (!showsbCaptures.has(key)) {
    showsbCaptures.set(key, captureShowsb(context));
  }

  return showsbCaptures.get(key)!;
}

async function captureShowsb(system: any) {
  const records = new Map<string, string>();
  const NOTED = new Set([0x03, 0x05, 0x0f, 0x14, 0x24, 0x46, 0x47, 0x83, 0x85]);
  let card = 0;
  let log: string[] = [];
  let logging = false;

  void system.rasterDesktop;

  const host: any = new WNDCLASS();

  host.style = 0;
  host.lpfnWndProc = (hwnd: number, message: number, wParam: number, lParam: number) =>
    DefWindowProc.call(system, hwnd, message, wParam, lParam);
  host.hbrBackground = 5 + 1;
  host.lpszClassName = 'ShowHost';
  await RegisterClass.call(system, host);

  const kind: any = new WNDCLASS();

  kind.style = 0;
  kind.lpfnWndProc = (hwnd: number, message: number, wParam: number, lParam: number) => {
    if (hwnd === card && logging && NOTED.has(message)) {
      log.push(message.toString(16));
    }

    return DefWindowProc.call(system, hwnd, message, wParam, lParam);
  };
  kind.hbrBackground = 5 + 1;
  kind.lpszClassName = 'ShowCard';
  await RegisterClass.call(system, kind);

  const child = 0x40000000 | 0x10000000;
  const frame = await CreateWindow.call(system, 'ShowHost', 'Show', 0x00cf0000 | 0x10000000, 20, 20, 300, 200, 0, 0, 0, 0);

  card = await CreateWindow.call(system, 'ShowCard', '', child | 0x00800000 | 0x00300000, 10, 10, 80, 60, frame, 100, 0, 0);

  const bar = await CreateWindow.call(system, 'SCROLLBAR', '', child | 0x0001, 120, 10, 16, 60, frame, 101, 0, 0);

  await UpdateWindow.call(system, frame);
  await pumpAll(system);

  const shape = (name: string) => {
    const client: any = new RECT();
    const window: any = new RECT();
    const corner: any = new POINT();
    const style = GetWindowLong.call(system, card, -16);

    GetClientRect.call(system, card, client);
    GetWindowRect.call(system, card, window);
    corner.x = window.left;
    corner.y = window.top;
    ScreenToClient.call(system, frame, corner);
    records.set(
      `shape:${name}`,
      `v=${style & 0x00200000 ? 1 : 0},h=${style & 0x00100000 ? 1 : 0},client=${client.right}:${client.bottom},` +
        `window=${corner.x}:${corner.y}:${window.right - window.left}:${window.bottom - window.top}`
    );
  };
  const capture = (name: string) => {
    const window: any = new RECT();
    const dc = GetDC.call(system, 0);

    GetWindowRect.call(system, card, window);

    for (let y = window.top; y < window.bottom; y++) {
      let row = '';

      for (let x = window.left; x < window.right; x++) {
        const index = PALETTE.indexOf(GetPixel.call(system, dc, x, y) & 0xffffff);

        row += index < 0 ? '?' : index.toString(16);
      }

      records.set(`rows:${name},y=${y - window.top}`, row);
    }

    ReleaseDC.call(system, 0, dc);
  };
  const step = async (name: string, call: () => Promise<unknown> | unknown) => {
    log = [];
    logging = true;
    await call();
    records.set(`answer:${name}`, '0');
    records.set(`sent:${name}`, log.join(' '));
    log = [];
    await pumpAll(system);
    records.set(`after:${name}`, log.join(' '));
    logging = false;
    shape(name);
    capture(name);
  };

  shape('made');
  capture('made');

  await step('hide-both', () => ShowScrollBar.call(system, card, 3, 0));
  await step('hide-both-again', () => ShowScrollBar.call(system, card, 3, 0));
  await step('show-vert', () => ShowScrollBar.call(system, card, 1, 1));
  await step('show-horz', () => ShowScrollBar.call(system, card, 0, 1));
  await step('hide-vert', () => ShowScrollBar.call(system, card, 1, 0));
  await step('range-some', () => SetScrollRange.call(system, card, 1, 0, 10, 1));
  await step('range-none', () => SetScrollRange.call(system, card, 1, 0, 0, 1));
  await step('range-some-quiet', () => SetScrollRange.call(system, card, 1, 0, 5, 0));

  await ShowScrollBar.call(system, bar, 2, 0);
  await pumpAll(system);
  records.set('visible:ctl-hide', String(IsWindowVisible.call(system, bar)));
  await ShowScrollBar.call(system, bar, 2, 1);
  await pumpAll(system);
  records.set('visible:ctl-show', String(IsWindowVisible.call(system, bar)));

  return records;
}
