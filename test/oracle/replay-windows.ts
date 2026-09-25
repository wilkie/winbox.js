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
import { PostQuitMessage } from '../../src/win16/user/PostQuitMessage.js';
import { InvalidateRect } from '../../src/win16/user/InvalidateRect.js';
import { ValidateRect } from '../../src/win16/user/ValidateRect.js';
import { SendMessage } from '../../src/win16/user/SendMessage.js';
import { KillTimer, SetTimer } from '../../src/win16/user/SetTimer.js';
import { TrackPopupMenu } from '../../src/win16/user/TrackPopupMenu.js';
import { TranslateMessage } from '../../src/win16/user/TranslateMessage.js';
import { DrawIcon, IsIconic, IsZoomed, LoadIcon } from '../../src/win16/user/icon-api.js';
import { PatBlt } from '../../src/win16/gdi/PatBlt.js';
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
