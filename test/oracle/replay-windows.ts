'use strict';

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { GetPixel } from '../../src/win16/gdi/GetPixel.js';
import { displayMode } from '../../src/win16/display-modes.js';
import { driverResources } from '../../src/win16/user/driver-resources.js';
import { MSG, User, PAINTSTRUCT, POINT, RECT, WNDCLASS } from '../../src/win16/user.js';
import { CreatePopupMenu } from '../../src/win16/user/CreateMenu.js';
import { DispatchMessage } from '../../src/win16/user/DispatchMessage.js';
import { PeekMessage } from '../../src/win16/user/PeekMessage.js';
import { PostMessage } from '../../src/win16/user/PostMessage.js';
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
