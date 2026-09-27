'use strict';

import { User, WNDCLASS } from '../user.js';

import { CreateWindow } from './CreateWindow.js';
import { DefWindowProc } from './DefWindowProc.js';
import { DestroyWindow } from './DestroyWindow.js';
import { MenuData } from './menu-data.js';
import { MoveWindow } from './MoveWindow.js';
import { PostMessage } from './PostMessage.js';
import { RasterWindow } from './raster-window.js';
import { SendMessage } from './SendMessage.js';
import { SetFocus } from './SetFocus.js';
import { ShowWindow } from './ShowWindow.js';
import { changeFrame } from './window-state.js';
import {
  type ClientScroll,
  postRecalc,
  recalc,
  scrollChildren,
  WM_MDIRECALC,
} from './mdi-scroll.js';

/**
 * The multiple document interface: a frame window, an `MDIClient` window
 * filling its client area, and document windows inside that.
 *
 * **Read out of `USER.EXE`**, segment 15 for the client and the default
 * procedures and segment 20 for the Window menu. Not measured.
 *
 * The client keeps its children, the active one, the maximized one, the
 * Window menu and the first child's identifier (from its
 * `CLIENTCREATESTRUCT`). A child is made through it with `WM_MDICREATE`, given
 * the identifier after the last, and listed in the Window menu: a separator,
 * then "&1 Title" and on, the active one checked, "&More Windows..." after
 * nine. `DefFrameProc` keeps the client the size of the frame's client area
 * and hands it the Window menu's commands; `DefMDIChildProc` activates a
 * child as it is clicked or focused, closes it through the client, and
 * maximizes it to the client's area.
 *
 * The client's scroll bars are `mdi-scroll.ts`. Not followed: a maximized
 * child's system menu and restore button in the frame's menu bar, and the
 * frame's title while one is; the "More Windows" dialog; arranging
 * minimized children's icons; and `WM_MENUCHAR`.
 */

export const WM_MDICREATE = 0x0220;
export const WM_MDIDESTROY = 0x0221;
export const WM_MDIACTIVATE = 0x0222;
export const WM_MDIRESTORE = 0x0223;
export const WM_MDINEXT = 0x0224;
export const WM_MDIMAXIMIZE = 0x0225;
export const WM_MDITILE = 0x0226;
export const WM_MDICASCADE = 0x0227;
export const WM_MDIICONARRANGE = 0x0228;
export const WM_MDIGETACTIVE = 0x0229;
export const WM_MDISETMENU = 0x0230;
const WM_CHILDACTIVATE = 0x0022;
const WM_NCACTIVATE = 0x0086;
const WM_PARENTNOTIFY = 0x0210;
const WM_MENUCHAR = 0x0120;

const SC_SIZE = 0xf000;
const SC_MOVE = 0xf010;
const SC_MINIMIZE = 0xf020;
const SC_MAXIMIZE = 0xf030;
const SC_NEXTWINDOW = 0xf040;
const SC_PREVWINDOW = 0xf050;
const SC_CLOSE = 0xf060;
const SC_RESTORE = 0xf120;
const SC_KEYMENU = 0xf100;

const WS_VSCROLL = 0x00200000;
const WS_HSCROLL = 0x00100000;
const WS_MAXIMIZE = 0x01000000;
const WS_MINIMIZE = 0x20000000;
const WS_DISABLED = 0x08000000;
const WS_VISIBLE = 0x10000000;
const CW_USEDEFAULT = 0x8000;
const MF_SEPARATOR = 0x0800;
const MF_CHECKED = 0x0008;

const SM_CXFRAME = 32;
const SM_CYFRAME = 33;
const SM_CXSIZE = 30;
const SM_CYSIZE = 31;

const MORE_WINDOWS = '&More Windows...';

interface Client {
  children: number[];
  active: number;
  maxed: number;
  windowMenu: number;
  first: number;
  cascade: number;
  scroll: ClientScroll;
}

function windowOf(system: any, hwnd: number): RasterWindow | null {
  const window = system.handles.resolve(hwnd);

  return window instanceof RasterWindow ? window : null;
}

function clientOf(system: any, hwnd: number): Client | null {
  return (windowOf(system, hwnd) as any)?._mdi ?? null;
}

function metric(window: RasterWindow, index: number) {
  return window.desktop.environment.metric(index);
}

/** A string at a far pointer. */
function textAt(system: any, far: number) {
  if (!far) {
    return '';
  }

  const core = system.machine.cpu.core;
  let text = '';

  for (let at = 0; ; at++) {
    const byte = core.read8((far >>> 16) & 0xffff, ((far & 0xffff) + at) & 0xffff);

    if (!byte) {
      return text;
    }

    text += String.fromCharCode(byte);
  }
}

/** The `MDIClient` class, registered the first time a window of it is asked for (seg3 `1595`). */
export function mdiClientClass(system: any, name: string) {
  if (system._mdiClass) {
    if (!system.handles.retrieve(name)) {
      system.handles.register(system._mdiClass, name);
    }

    return system.handles.resolve(system._mdiClass);
  }

  const windowClass: any = new WNDCLASS();

  windowClass.style = 0;
  windowClass.cbWndExtra = 0x10;

  /* The application workspace colour. */
  windowClass.hbrBackground = 0x0d;
  windowClass.lpszClassName = 'MDIClient';
  windowClass.lpfnWndProc = (hwnd: number, message: number, wParam: number, lParam: any) =>
    clientProc(system, hwnd, message, wParam, lParam);

  const handle = system.handles.allocate(windowClass);

  system._mdiClass = handle;

  for (const each of new Set(['MDICLIENT', 'MDIClient', name])) {
    system.handles.register(handle, each);
  }

  return windowClass;
}

/** Both of the client's bars hidden. */
async function hideBars(system: any, hwnd: number, window: RasterWindow) {
  await changeFrame(system, hwnd, window, window.window.style & ~(WS_VSCROLL | WS_HSCROLL));
}

/** The place a new child goes by default, the `i`th step of a cascade (seg15 `0746`). */
function cascadeRect(client: RasterWindow, i: number, iconSpace: number) {
  const shown = client.window;
  const height = shown.clientHeight - iconSpace;
  const xs = metric(client, SM_CXFRAME) + metric(client, SM_CXSIZE);
  const ys = metric(client, SM_CYFRAME) + metric(client, SM_CYSIZE);
  const n = Math.max(0, Math.trunc(height / (3 * ys)));
  const k = i % (n + 1);

  return { x: k * xs, y: k * ys, cx: shown.clientWidth - n * xs, cy: height - n * ys };
}

async function clientProc(system: any, hwnd: number, message: number, wParam: number, lParam: any) {
  const window = windowOf(system, hwnd);
  const shown = window?.window;

  switch (message) {
    case User.WM_CREATE: {
      /* The `CLIENTCREATESTRUCT` the `CREATESTRUCT` points at: the Window
       * menu and the first child's identifier (seg15 `10ff`). */
      const cs = Array.isArray(lParam) ? lParam[0] : null;
      const far = cs?.lpCreateParams ?? 0;
      const core = system.machine.cpu.core;
      const read = (at: number) =>
        far ? core.read16((far >>> 16) & 0xffff, ((far & 0xffff) + at) & 0xffff) : 0;

      (window as any)._mdi = {
        children: [],
        active: 0,
        maxed: 0,
        windowMenu: read(0),
        first: read(2),
        cascade: 0,
        scroll: {
          bars: (shown && shown.style & WS_VSCROLL ? 1 : 0) | (shown && shown.style & WS_HSCROLL ? 2 : 0),
          busy: false,
          pending: false,
        },
      } as Client;

      /* The scroll bars start hidden, shown only when the children reach past
       * the client's edges (`mdi-scroll.ts`). */
      if (shown && shown.style & (WS_VSCROLL | WS_HSCROLL)) {
        shown.style &= ~(WS_VSCROLL | WS_HSCROLL);
        window!.desktop.place(shown, shown.left, shown.top, shown.width, shown.height);
      }

      return 0;
    }

    case User.WM_SETFOCUS: {
      const state = clientOf(system, hwnd);
      const active = state?.active ? windowOf(system, state.active) : null;

      if (active && active.window.state !== 'minimized') {
        await SetFocus.call(system, state!.active);
      }

      return 0;
    }

    case WM_NCACTIVATE: {
      const state = clientOf(system, hwnd);

      if (state?.active) {
        await SendMessage.call(system, state.active, WM_NCACTIVATE, wParam, lParam);
      }

      return DefWindowProc.call(system, hwnd, message, wParam, lParam);
    }

    case User.WM_SIZE: {
      const state = clientOf(system, hwnd);

      if (state?.maxed) {
        await fitMaximized(system, hwnd, state.maxed);
      } else {
        postRecalc(system, hwnd, state?.scroll ?? null);
      }

      return DefWindowProc.call(system, hwnd, message, wParam, lParam);
    }

    /* Its bars scrolled: the children moved, with nothing posted for it. */
    case User.WM_HSCROLL:
    case User.WM_VSCROLL: {
      const state = clientOf(system, hwnd);

      if (state) {
        state.scroll.busy = true;
        await scrollChildren(system, hwnd, message, wParam, lParam);
        state.scroll.busy = false;
      }

      return 0;
    }

    case WM_MDIRECALC: {
      const state = clientOf(system, hwnd);

      if (state) {
        await recalc(system, hwnd, state.scroll);
      }

      return 0;
    }

    /* A press on a child that is not the active one activates it. */
    case WM_PARENTNOTIFY: {
      const state = clientOf(system, hwnd);

      if (wParam === User.WM_LBUTTONDOWN && state && window) {
        const x = (lParam << 16) >> 16;
        const y = lParam >> 16;
        const origin = window.clientOrigin;
        const hit = state.children.find((child) => {
          const w = windowOf(system, child)?.window;

          return (
            w?.visible &&
            origin.x + x >= w.left &&
            origin.x + x < w.left + w.width &&
            origin.y + y >= w.top &&
            origin.y + y < w.top + w.height
          );
        });

        if (hit && hit !== state.active) {
          await activate(system, hwnd, hit);
        }
      }

      return 0;
    }

    case WM_MDICREATE:
      return create(system, hwnd, lParam >>> 0);

    case WM_MDIDESTROY:
      await destroy(system, hwnd, wParam);
      postRecalc(system, hwnd, clientOf(system, hwnd)?.scroll ?? null);
      return 0;

    case WM_MDIACTIVATE:
      if (wParam && wParam !== clientOf(system, hwnd)?.active) {
        await activate(system, hwnd, wParam);
      }

      return 0;

    case WM_MDIRESTORE:
      await ShowWindow.call(system, wParam, User.SW_SHOWNORMAL);
      return 0;

    case WM_MDIMAXIMIZE:
      await ShowWindow.call(system, wParam, User.SW_SHOWMAXIMIZED);
      return 0;

    case WM_MDINEXT:
      await next(system, hwnd, wParam, lParam !== 0);
      return 0;

    case WM_MDITILE:
    case WM_MDICASCADE: {
      const scroll = clientOf(system, hwnd)?.scroll;

      if (scroll) scroll.busy = true;

      try {
        return message === WM_MDITILE ? await tile(system, hwnd, wParam) : await cascade(system, hwnd);
      } finally {
        if (scroll) scroll.busy = false;
      }
    }

    case WM_MDIICONARRANGE:
      postRecalc(system, hwnd, clientOf(system, hwnd)?.scroll ?? null);
      return 0;

    case WM_MDIGETACTIVE: {
      const state = clientOf(system, hwnd);

      return ((state?.active ?? 0) | ((state?.maxed ? 1 : 0) << 16)) >>> 0;
    }

    case WM_MDISETMENU:
      return setMenu(system, hwnd, wParam !== 0, lParam & 0xffff, (lParam >>> 16) & 0xffff);
  }

  return DefWindowProc.call(system, hwnd, message, wParam, lParam);
}

/** `WM_MDICREATE` (seg15 `0ddb`): the child made and activated; its window, or 0. */
async function create(system: any, hwnd: number, far: number) {
  const window = windowOf(system, hwnd);
  const state = clientOf(system, hwnd);

  if (!window || !state || !far) {
    return 0;
  }

  const core = system.machine.cpu.core;
  const segment = (far >>> 16) & 0xffff;
  const offset = far & 0xffff;
  const word = (at: number) => core.read16(segment, (offset + at) & 0xffff);
  const signed = (at: number) => (word(at) << 16) >> 16;
  const dword = (at: number) => (word(at) | (word(at + 2) << 16)) >>> 0;
  const classFar = dword(0);
  const className = (classFar >>> 16) === 0 ? classFar : textAt(system, classFar);
  const title = textAt(system, dword(4));
  const owner = word(8);
  let [x, y, cx, cy] = [signed(10), signed(12), signed(14), signed(16)];

  /* The styles a document window always has, whatever it asked for, but for
   * those it keeps (seg15 `0ddb`). */
  let style = (dword(18) | User.WS_CHILD | User.WS_CLIPSIBLINGS) >>> 0;
  const high = ((style >>> 16) & 0x2b30) | 0x54cf;

  style = ((high << 16) | (style & 0xffff)) >>> 0;

  /* The next step of the cascade, for what it did not say (seg15 `0d72`). */
  const place = cascadeRect(window, state.cascade, 0);

  if ((cx & 0xffff) === CW_USEDEFAULT || cx === 0) cx = place.cx;
  if ((cy & 0xffff) === CW_USEDEFAULT || cy === 0) cy = place.cy;
  if ((x & 0xffff) === CW_USEDEFAULT) {
    x = place.x;
    y = place.y;
  }

  /* A maximized child gives way to the new one. */
  if (state.maxed && windowOf(system, state.maxed)) {
    await ShowWindow.call(system, state.maxed, User.SW_SHOWNORMAL);
  }

  const child = await CreateWindow.call(
    system,
    className,
    title,
    style & ~WS_VISIBLE,
    x,
    y,
    cx,
    cy,
    hwnd,
    state.first + state.children.length,
    owner,
    far
  );

  if (!child) {
    return 0;
  }

  state.children.push(child);
  state.cascade = state.cascade >= 0x7ffe ? 0 : state.cascade + 1;

  if (style & WS_VISIBLE && !(style & WS_DISABLED) && state.children.length <= 10) {
    await setMenu(system, hwnd, true, 0, 0);
  }

  if (style & WS_VISIBLE) {
    if (style & WS_MINIMIZE && state.active) {
      await ShowWindow.call(system, child, User.SW_SHOWMINNOACTIVE);
    } else {
      await ShowWindow.call(
        system,
        child,
        style & WS_MAXIMIZE ? User.SW_SHOWMAXIMIZED : style & WS_MINIMIZE ? User.SW_SHOWMINIMIZED : User.SW_SHOWNORMAL
      );
      await activate(system, hwnd, child);
    }
  }

  return child;
}

/** `WM_MDIDESTROY` (seg15 `0fd7`). */
async function destroy(system: any, hwnd: number, child: number) {
  const state = clientOf(system, hwnd);

  if (!state || !state.children.includes(child)) {
    return;
  }

  /* The identifiers after it close up, and it takes the last. */
  const at = state.children.indexOf(child);

  state.children.splice(at, 1);
  state.children.forEach((each, index) => {
    const w = windowOf(system, each);

    if (w) {
      w.window.controlId = state.first + index;
    }
  });

  if (state.active === child) {
    await next(system, hwnd, child, false);

    if (state.active === child) {
      await ShowWindow.call(system, child, User.SW_HIDE);
      state.active = 0;
    }
  }

  if (state.maxed === child) {
    state.maxed = 0;
  }

  await setMenu(system, hwnd, true, 0, 0);
  await DestroyWindow.call(system, child);
}

/**
 * A child made the active one (seg15 `0b01`): the one before told it is not,
 * this one brought to the top of its siblings, its caption drawn active while
 * the frame is, the focus handed to it, and it told.
 */
export async function activate(system: any, hwnd: number, child: number) {
  const window = windowOf(system, hwnd);
  const state = clientOf(system, hwnd);

  if (!window || !state || child === state.active) {
    return;
  }

  const target = child ? windowOf(system, child) : null;

  if (target && target.window.style & WS_DISABLED) {
    return;
  }

  const frame = window.window.parent;
  const frameActive = !!frame?.active;
  const old = state.active;

  if (old) {
    const was = windowOf(system, old);

    if (was) {
      was.window.active = false;
      was.desktop.paintFrame(was.window);
    }

    await SendMessage.call(system, old, WM_MDIACTIVATE, 0, ((child & 0xffff) | (old << 16)) >>> 0);
    await checkItem(system, state, old, false);
  }

  if (state.maxed && state.maxed !== child && child) {
    state.active = child;
    await ShowWindow.call(system, child, User.SW_SHOWMAXIMIZED);
  }

  state.active = child;

  if (!target) {
    if (frameActive) {
      await SetFocus.call(system, hwnd);
    }

    return;
  }

  await checkItem(system, state, child, true);
  target.desktop.showOnTop?.(target.window);

  if (frameActive) {
    target.window.active = true;
    target.desktop.paintFrame(target.window);
    await SetFocus.call(system, hwnd);
  }

  await SendMessage.call(system, child, WM_MDIACTIVATE, 1, ((child & 0xffff) | (old << 16)) >>> 0);
}

/** `WM_MDINEXT` (seg15 `0c7f`): the next child, or the one before, that is enabled and shows. */
async function next(system: any, hwnd: number, from: number, back: boolean) {
  const state = clientOf(system, hwnd);

  if (!state || !state.children.length) {
    return;
  }

  const start = from || state.active;
  const order = state.children;
  let at = order.indexOf(start);

  for (let step = 0; step < order.length; step++) {
    at = (at + (back ? -1 : 1) + order.length) % order.length;

    const candidate = windowOf(system, order[at]);

    if (candidate && candidate.window.visible && !(candidate.window.style & WS_DISABLED) && order[at] !== start) {
      await activate(system, hwnd, order[at]);
      return;
    }
  }
}

/** The children that tiling and cascading move (seg15 `06de`). */
function arrangeable(system: any, state: Client, skipDisabled: boolean) {
  return state.children
    .map((hwnd) => ({ hwnd, window: windowOf(system, hwnd) }))
    .filter(
      ({ window }) =>
        window &&
        window.window.visible &&
        window.window.state === 'normal' &&
        !(skipDisabled && window.window.style & WS_DISABLED)
    );
}

/** `WM_MDICASCADE` (seg15 `0875`): the bottom child first, each a step down and in. */
async function cascade(system: any, hwnd: number) {
  const window = windowOf(system, hwnd);
  const state = clientOf(system, hwnd);

  if (!window || !state) {
    return 0;
  }

  /* The bars hidden, and nothing posted while arranging (the client is
   * busy): they stay hidden until something else asks. */
  await hideBars(system, hwnd, window);

  if (state.maxed) {
    await ShowWindow.call(system, state.maxed, User.SW_SHOWNORMAL);
  }

  const children = arrangeable(system, state, false).reverse();

  for (let i = 0; i < children.length; i++) {
    const r = cascadeRect(window, i, 0);
    const shown = children[i].window!.window;
    const sizable = (shown.style & User.WS_THICKFRAME) !== 0;

    await MoveWindow.call(system, children[i].hwnd, r.x, r.y, sizable ? r.cx : shown.width, sizable ? r.cy : shown.height, 1);
  }

  return 1;
}

/** `WM_MDITILE` (seg15 `0956`): rows and columns, the last columns a row longer. */
async function tile(system: any, hwnd: number, how: number) {
  const window = windowOf(system, hwnd);
  const state = clientOf(system, hwnd);

  if (!window || !state) {
    return 0;
  }

  /* The bars hidden, and nothing posted while arranging (the client is
   * busy): they stay hidden until something else asks. */
  await hideBars(system, hwnd, window);

  if (state.maxed) {
    await ShowWindow.call(system, state.maxed, User.SW_SHOWNORMAL);
  }

  const children = arrangeable(system, state, (how & 2) !== 0);
  const n = children.length;

  if (!n) {
    return 1;
  }

  let b = 2;

  while (b * b <= n) {
    b++;
  }

  let cols: number;
  let rows: number;

  if (how & 1) {
    cols = b - 1;
    rows = Math.trunc(n / cols);
  } else {
    rows = b - 1;
    cols = Math.trunc(n / rows);
  }

  let extra = n % (b - 1);
  const width = window.window.clientWidth;
  const height = window.window.clientHeight;

  if (width <= 0 || height <= 0) {
    return 0;
  }

  let index = 0;

  for (let col = 0; col < cols; col++) {
    const more = cols - col <= extra;

    if (more) {
      rows++;
    }

    for (let row = 0; row < rows && index < n; row++, index++) {
      const w = Math.trunc(width / cols);
      const h = Math.trunc(height / rows);

      await MoveWindow.call(system, children[index].hwnd, col * w, row * h, w, h, 1);
    }

    if (more) {
      rows--;
      extra--;
    }
  }

  return 1;
}

/** A child maximized to the client's area, its frame and caption just outside it. */
async function fitMaximized(system: any, hwnd: number, child: number) {
  const client = windowOf(system, hwnd);
  const target = windowOf(system, child);

  if (!client || !target) {
    return;
  }

  const insets = target.desktop.frameInsets(target.window.style & ~(WS_VSCROLL | WS_HSCROLL), false, false);

  await MoveWindow.call(
    system,
    child,
    -insets.left,
    -insets.top,
    client.window.clientWidth + insets.left + insets.right,
    client.window.clientHeight + insets.top + insets.bottom,
    1
  );
}

/** The Window menu's item for a child, checked or not. */
async function checkItem(system: any, state: Client, child: number, checked: boolean) {
  const menu = state.windowMenu ? system.handles.resolve(state.windowMenu) : null;
  const w = windowOf(system, child);

  if (!(menu instanceof MenuData) || !w) {
    return;
  }

  const item = menu.items.find((each) => each.id === w.window.controlId);

  if (item) {
    item.flags = checked ? item.flags | MF_CHECKED : item.flags & ~MF_CHECKED;
  }
}

/**
 * `WM_MDISETMENU` (seg20 `02f9`): the frame's menu and the Window menu set,
 * the list of children written into the Window menu again after its last
 * separator. Answers the old menus.
 */
async function setMenu(system: any, hwnd: number, refresh: boolean, frameMenu: number, windowMenu: number) {
  const window = windowOf(system, hwnd);
  const state = clientOf(system, hwnd);

  if (!window || !state) {
    return 0;
  }

  const frame = window.window.parent ? windowOf(system, window.window.parent.hwnd) : null;
  const oldFrame = frame?.options?.menu ?? 0;
  const old = { frame: oldFrame, window: state.windowMenu };

  if (!refresh && frameMenu && frameMenu !== oldFrame && frame) {
    const menu = system.handles.resolve(frameMenu);

    if (menu instanceof MenuData) {
      frame.options.menu = frameMenu;
      frame.window.menu = menu.labels;
    }
  }

  if (!refresh && windowMenu === state.windowMenu) {
    return ((old.frame & 0xffff) | (old.window << 16)) >>> 0;
  }

  /* The list taken out of the old Window menu, from its last separator. */
  const previous = state.windowMenu ? system.handles.resolve(state.windowMenu) : null;

  if (previous instanceof MenuData) {
    let last = -1;

    previous.items.forEach((item, index) => {
      if (item.flags & MF_SEPARATOR) {
        last = index;
      }
    });

    if (last >= 0 && previous.items[last + 1]?.id === state.first) {
      previous.items.splice(last);
    }
  }

  if (!refresh) {
    state.windowMenu = windowMenu;
  }

  const menu = state.windowMenu ? system.handles.resolve(state.windowMenu) : null;

  if (menu instanceof MenuData) {
    const listed = state.children.filter((child) => {
      const w = windowOf(system, child);

      return w && !(w.window.style & WS_DISABLED);
    });

    listed.slice(0, 10).forEach((child, index) => {
      const w = windowOf(system, child)!;

      if (index === 0) {
        menu.items.push({ flags: MF_SEPARATOR, id: 0 } as any);
      }

      const title = String(w.caption ?? '').replace(/&/g, '&&').substring(0, 0x9f);
      const text = index < 9 ? `&${index + 1} ${title}` : MORE_WINDOWS;

      menu.items.push({
        flags: child === state.active && index < 9 ? MF_CHECKED : 0,
        id: state.first + index,
        text,
      } as any);
    });
  }

  return ((old.frame & 0xffff) | (old.window << 16)) >>> 0;
}

/**
 * `DefFrameProc` (seg15 `147c`): the client kept to the frame's client area,
 * the focus handed to it, and the Window menu's commands, and a maximized
 * child's system commands, handed on.
 */
export async function DefFrameProc(
  this: any,
  hwnd: number,
  hwndMDIClient: number,
  message: number,
  wParam: number,
  lParam: number
) {
  const state = clientOf(this, hwndMDIClient);

  if (!state) {
    return DefWindowProc.call(this, hwnd, message, wParam, lParam);
  }

  switch (message) {
    case User.WM_SIZE:
      if (wParam !== User.SIZE_MINIMIZED) {
        await MoveWindow.call(this, hwndMDIClient, 0, 0, lParam & 0xffff, (lParam >>> 16) & 0xffff, 1);
      }

      return DefWindowProc.call(this, hwnd, message, wParam, lParam);

    case User.WM_SETFOCUS:
      await SetFocus.call(this, hwndMDIClient);
      return 0;

    case WM_NCACTIVATE:
      await SendMessage.call(this, hwndMDIClient, WM_NCACTIVATE, wParam, lParam);
      return DefWindowProc.call(this, hwnd, message, wParam, lParam);

    case User.WM_COMMAND: {
      const id = wParam & 0xffff;

      if (id >= state.first && id < state.first + state.children.length && id < state.first + 9) {
        const child = state.children[id - state.first];

        await SendMessage.call(this, hwndMDIClient, WM_MDIACTIVATE, child, 0);

        if (windowOf(this, child)?.window.state === 'minimized') {
          await ShowWindow.call(this, child, User.SW_SHOWNORMAL);
        }

        return 0;
      }

      const systemCommands = [SC_SIZE, SC_MOVE, SC_MINIMIZE, SC_MAXIMIZE, SC_NEXTWINDOW, SC_PREVWINDOW, SC_CLOSE, SC_RESTORE];

      if (state.maxed && systemCommands.includes(id & 0xfff0)) {
        return SendMessage.call(this, state.maxed, User.WM_SYSCOMMAND, id, lParam);
      }

      break;
    }
  }

  return DefWindowProc.call(this, hwnd, message, wParam, lParam);
}

/**
 * `DefMDIChildProc` (seg15 `187a`): closing through the client, activating as
 * it is focused, the client's area as its maximized size, and the maximized
 * child kept track of.
 */
export async function DefMDIChildProc(this: any, hwnd: number, message: number, wParam: number, lParam: any) {
  const window = windowOf(this, hwnd);
  const clientWindow = window?.window.parent ? windowOf(this, window.window.parent.hwnd) : null;
  const client = clientWindow?.window.hwnd ?? 0;
  const state = client ? clientOf(this, client) : null;

  if (!state || !window) {
    return DefWindowProc.call(this, hwnd, message, wParam, lParam);
  }

  switch (message) {
    case User.WM_CLOSE:
      await SendMessage.call(this, client, WM_MDIDESTROY, hwnd, 0);
      return 0;

    case User.WM_SETTEXT: {
      const answer = await DefWindowProc.call(this, hwnd, message, wParam, lParam);

      await setMenu(this, client, true, 0, 0);

      return answer;
    }

    case User.WM_MOVE:
      /* Moved, the client's bars worked out again, unless it is maximized. */
      if (state.maxed !== hwnd) {
        postRecalc(this, client, state.scroll);
      }

      return DefWindowProc.call(this, hwnd, message, wParam, lParam);

    case User.WM_SIZE:
      /* Sized, likewise, except maximized again. */
      if (!(state.maxed === hwnd && wParam === User.SIZE_MAXIMIZED)) {
        postRecalc(this, client, state.scroll);
      }

      if (state.maxed === hwnd && wParam !== User.SIZE_MAXIMIZED) {
        state.maxed = 0;
      }

      if (wParam === User.SIZE_MAXIMIZED && state.maxed !== hwnd) {
        const old = state.maxed;

        state.maxed = hwnd;

        if (old) {
          await ShowWindow.call(this, old, User.SW_SHOWNORMAL);
        }
      }

      return DefWindowProc.call(this, hwnd, message, wParam, lParam);

    case User.WM_SETFOCUS:
      if (state.active !== hwnd) {
        await activate(this, client, hwnd);
      }

      return DefWindowProc.call(this, hwnd, message, wParam, lParam);

    case WM_CHILDACTIVATE:
      await activate(this, client, hwnd);
      return 0;

    case User.WM_GETMINMAXINFO: {
      /* Maximized to the client's area, frame and caption outside it (seg15 `16ef`). */
      const mmi = Array.isArray(lParam) ? lParam[0] : null;
      const insets = window.desktop.frameInsets(window.window.style & ~(WS_VSCROLL | WS_HSCROLL), false, false);

      if (mmi?.ptMaxPosition && mmi?.ptMaxSize) {
        mmi.ptMaxPosition.x = -insets.left;
        mmi.ptMaxPosition.y = -insets.top;
        mmi.ptMaxSize.x = clientWindow!.window.clientWidth + insets.left + insets.right;
        mmi.ptMaxSize.y = clientWindow!.window.clientHeight + insets.top + insets.bottom;
      }

      return 0;
    }

    case User.WM_SYSCOMMAND: {
      const command = wParam & 0xfff0;
      const maximized = state.maxed === hwnd;

      if ((command === SC_SIZE || command === SC_MOVE) && maximized) {
        return 0;
      }

      if (command === SC_MAXIMIZE && maximized) {
        const frame = clientWindow!.window.parent;

        return frame?.hwnd ? SendMessage.call(this, frame.hwnd, User.WM_SYSCOMMAND, wParam, lParam) : 0;
      }

      if (command === SC_NEXTWINDOW || command === SC_PREVWINDOW) {
        await SendMessage.call(this, client, WM_MDINEXT, hwnd, command === SC_PREVWINDOW ? 1 : 0);
        return 0;
      }

      break;
    }

    case WM_MENUCHAR: {
      const frame = clientWindow!.window.parent;

      if (frame?.hwnd) {
        PostMessage.call(this, frame.hwnd, User.WM_SYSCOMMAND, SC_KEYMENU, wParam);
      }

      return 0x10000;
    }
  }

  return DefWindowProc.call(this, hwnd, message, wParam, lParam);
}

/**
 * `TranslateMDISysAccel` (seg15 `01d1`): Ctrl+F4 closes the active child,
 * Ctrl+F6 or Ctrl+Tab goes to the next, with Shift the one before.
 */
export async function TranslateMDISysAccel(this: any, hwndClient: number, lpmsg: any) {
  const state = clientOf(this, hwndClient);

  if (!state?.active || !lpmsg || (lpmsg.message !== User.WM_KEYDOWN && lpmsg.message !== User.WM_SYSKEYDOWN)) {
    return 0;
  }

  const keys = this._keyStates ?? [];
  const ctrl = (keys[0x11] ?? 0) & 0x80;
  const alt = (keys[0x12] ?? 0) & 0x80;
  const shift = (keys[0x10] ?? 0) & 0x80;

  if (!ctrl || alt || windowOf(this, state.active)?.window.style & WS_DISABLED) {
    return 0;
  }

  let command = 0;

  if (lpmsg.wParam === 0x73) {
    command = SC_CLOSE;
  } else if (lpmsg.wParam === 0x75 || lpmsg.wParam === 0x09) {
    command = shift ? SC_PREVWINDOW : SC_NEXTWINDOW;
  }

  if (!command) {
    return 0;
  }

  await SendMessage.call(this, state.active, User.WM_SYSCOMMAND, command, lpmsg.wParam);

  return 1;
}
