'use strict';

import { MSG, User } from '../user.js';

import { type Desktop, type DesktopWindow } from './desktop.js';
import { RasterWindow } from './raster-window.js';

/**
 * The mouse and keyboard, on the raster desktop: what the page hands in --
 * a pointer at a pixel of the screen, a key -- turned into the messages
 * Windows would put in the queue of the program whose window it is.
 *
 * Nothing here calls into a program. Every message is posted, as the input
 * queue posts it, and the program takes it with `GetMessage` or `PeekMessage`
 * when it runs next. What Windows would have found by sending a window a
 * message first -- `WM_NCHITTEST`, `WM_MOUSEACTIVATE`, `WM_SETCURSOR` -- is
 * answered here as `DefWindowProc` answers it, so a program that answers
 * those itself is not asked. Not measured against a recording: the input
 * queue has no probe yet.
 */

export const HTNOWHERE = 0;
export const HTCLIENT = 1;
export const HTCAPTION = 2;
export const HTSYSMENU = 3;
export const HTMENU = 5;
export const HTHSCROLL = 6;
export const HTVSCROLL = 7;
export const HTMINBUTTON = 8;
export const HTMAXBUTTON = 9;
export const HTLEFT = 10;
export const HTRIGHT = 11;
export const HTTOP = 12;
export const HTTOPLEFT = 13;
export const HTTOPRIGHT = 14;
export const HTBOTTOM = 15;
export const HTBOTTOMLEFT = 16;
export const HTBOTTOMRIGHT = 17;
export const HTBORDER = 18;

const CS_DBLCLKS = 0x0008;

const WS_CAPTION = 0x00c00000;
const WS_THICKFRAME = 0x00040000;
const WS_SYSMENU = 0x00080000;
const WS_MINIMIZEBOX = 0x00020000;
const WS_MAXIMIZEBOX = 0x00010000;
const WS_VSCROLL = 0x00200000;
const WS_HSCROLL = 0x00100000;

const SM_CXVSCROLL = 2;
const SM_CYHSCROLL = 3;
const SM_CYCAPTION = 4;
const SM_CYMENU = 15;
const SM_CXSIZE = 30;
const SM_CYSIZE = 31;
const SM_CXFRAME = 32;
const SM_CYFRAME = 33;

export interface Pointer {
  /** Where, on the screen. */
  x: number;
  y: number;

  /** Which button changed, 0 left, 1 middle, 2 right, and which are down, as bits. */
  button: number;
  buttons: number;

  /** The second press of a double click. */
  double: boolean;

  shift: boolean;
  control: boolean;
}

export interface Key {
  /** The page's name for the key, `KeyA` or `Enter`. */
  code: string;

  /** What it types, if it types one character. */
  key: string;
  repeat: boolean;

  /** Whether Alt is held: the key is then a system key. */
  alt?: boolean;
}

export class RasterInput {
  readonly system: any;

  /** The window the mouse is captured by, with `SetCapture`. */
  capture: DesktopWindow | null = null;

  /** Which buttons are down, as bits: left, right, middle. */
  buttons = 0;

  /** The character each virtual key typed last, for `TranslateMessage`. */
  readonly typed = new Map<number, number>();

  constructor(system: any) {
    this.system = system;
  }

  get desktop(): Desktop {
    return this.system.rasterDesktop;
  }

  /**
   * A pointer pressed, released or moved: `WM_MOUSEMOVE` and the button
   * messages in a client area, their `WM_NC` forms elsewhere on a window.
   * A press on a window that is not active makes it active first.
   */
  pointer(kind: 'down' | 'up' | 'move', pointer: Pointer) {
    this.buttons = pointer.buttons;
    const desktop = this.desktop;
    const target = this.capture ?? desktop.windowAt(pointer.x, pointer.y);

    if (!target) {
      return;
    }

    if (kind === 'down') {
      const top = topLevel(target);

      if (!top.active) {
        desktop.show(top);
        this.wake();
      }

      if (!this.capture) {
        desktop.focus = target.control ? target : (desktop.focus ?? top);
      }
    }

    const hit = this.capture ? HTCLIENT : hitTest(desktop, target, pointer.x, pointer.y);
    const client = hit === HTCLIENT;
    const at = client
      ? {
          x: pointer.x - target.left - target.client.left,
          y: pointer.y - target.top - target.client.top,
        }
      : { x: pointer.x, y: pointer.y };

    let message: number;

    if (kind === 'move') {
      message = client ? User.WM_MOUSEMOVE : User.WM_NCMOUSEMOVE;
    } else {
      /* A double click is one in a client area only for a class that asks
       * for them; on the frame and caption, it always is. */
      const double =
        pointer.double &&
        kind === 'down' &&
        (hit !== HTCLIENT || this.#classStyle(target) & CS_DBLCLKS);
      const base = [
        [User.WM_LBUTTONDOWN, User.WM_LBUTTONUP, User.WM_LBUTTONDBLCLK],
        [User.WM_MBUTTONDOWN, User.WM_MBUTTONUP, User.WM_MBUTTONDBLCLK],
        [User.WM_RBUTTONDOWN, User.WM_RBUTTONUP, User.WM_RBUTTONDBLCLK],
      ][pointer.button] ?? [User.WM_LBUTTONDOWN, User.WM_LBUTTONUP, User.WM_LBUTTONDBLCLK];

      message = base[kind === 'up' ? 1 : double ? 2 : 0];

      /* The non-client forms are the client ones moved up by 0x160. */
      if (!client) {
        message -= User.WM_MOUSEMOVE - User.WM_NCMOUSEMOVE;
      }
    }

    const wParam = client
      ? (pointer.buttons & 1 ? User.MK_LBUTTON : 0) |
        (pointer.buttons & 2 ? User.MK_RBUTTON : 0) |
        (pointer.buttons & 4 ? User.MK_MBUTTON : 0) |
        (pointer.shift ? User.MK_SHIFT : 0) |
        (pointer.control ? User.MK_CONTROL : 0)
      : hit;

    this.#post(target, message, wParam, (at.x & 0xffff) | ((at.y & 0xffff) << 16), pointer);
  }

  /** A key pressed or released, to the window with the focus. */
  key(kind: 'down' | 'up', key: Key) {
    const target = this.desktop.focus ?? this.desktop.active;

    if (!target) {
      return;
    }

    let code: any = key.code;

    if (code === 'AltLeft' || code === 'AltRight') {
      code = User.VK_MENU;
    }

    if (/^Key[A-Z]$/.test(code)) {
      code = code.charCodeAt(3);
    } else if (/^Digit[0-9]$/.test(code)) {
      code = code.charCodeAt(5);
    }

    const virtual = User.VIRTUAL_KEY_TRANSLATE[code] ?? (typeof code === 'number' ? code : 0);

    if (!virtual) {
      return;
    }

    if (kind === 'down' && key.key.length === 1) {
      this.typed.set(virtual, key.key.charCodeAt(0) & 0xff);
    }

    /* The repeat count, and bit 30 for a key that was already down; bit 31 for a release. */
    const lParam = 1 | (key.repeat ? 1 << 30 : 0) | (kind === 'up' ? (3 << 30) >>> 0 : 0);

    /* With Alt held, or Alt itself, the key is a system key; bit 29 says Alt is down. */
    const system = key.alt || virtual === User.VK_MENU;
    const message = system
      ? kind === 'down'
        ? User.WM_SYSKEYDOWN
        : User.WM_SYSKEYUP
      : kind === 'down'
        ? User.WM_KEYDOWN
        : User.WM_KEYUP;

    this.#post(target, message, virtual, (lParam | (key.alt ? 1 << 29 : 0)) >>> 0);
  }

  /**
   * Wakes a program waiting in `GetMessage` for a window that is due to be
   * painted: the paint is what it takes next, as Windows makes it when the
   * queue is empty.
   */
  wake() {
    const unpainted = this.desktop.unpainted;

    if (!unpainted) {
      return;
    }

    const task = this.#taskOf(unpainted);

    if (task?._messageLock) {
      const msg: any = new MSG();

      msg.hwnd = unpainted.hwnd;
      msg.message = User.WM_PAINT;
      msg.wParam = 0;
      msg.lParam = 0;
      msg.time = this.#time();
      msg.pt = { x: 0, y: 0 };
      task.push(msg);
    }
  }

  #post(target: DesktopWindow, message: number, wParam: number, lParam: number, pointer?: Pointer) {
    const task = this.#taskOf(target);

    if (!task) {
      return;
    }

    const msg: any = new MSG();

    msg.hwnd = target.hwnd;
    msg.message = message;
    msg.wParam = wParam;
    msg.lParam = lParam;
    msg.time = this.#time();
    msg.pt = { x: pointer?.x ?? 0, y: pointer?.y ?? 0 };
    task.push(msg);
  }

  #taskOf(window: DesktopWindow) {
    const handle = this.system.handles.resolve(window.hwnd);

    if (!(handle instanceof RasterWindow)) {
      return null;
    }

    return this.system.handles.resolve(handle.data.hInstance) ?? null;
  }

  #classStyle(window: DesktopWindow) {
    const handle = this.system.handles.resolve(window.hwnd);
    const windowClass = handle && this.system.handles.retrieve(handle.options.windowClass);

    return windowClass?.style ?? 0;
  }

  #time() {
    return Date.now() - (this.system._startTime ?? 0);
  }
}

/** The top-level window a window belongs to. */
function topLevel(window: DesktopWindow) {
  let at = window;

  while (at.parent) {
    at = at.parent;
  }

  return at;
}

/**
 * Which part of a window a point of the screen is on, as `DefWindowProc`
 * answers `WM_NCHITTEST`: its client area, its caption and the boxes on it,
 * its menu bar, its scroll bars, or its border.
 */
export function hitTest(desktop: Desktop, window: DesktopWindow, x: number, y: number) {
  const metric = (index: number) => desktop.environment.metric(index);
  const wx = x - window.left;
  const wy = y - window.top;
  const { left, top, right, bottom } = window.client;

  if (wx < 0 || wy < 0 || wx >= window.width || wy >= window.height) {
    return HTNOWHERE;
  }

  /* An icon is all caption: pressed, it moves; twice, it restores. */
  if (window.state === 'minimized') {
    return HTCAPTION;
  }

  if (wx >= left && wx < right && wy >= top && wy < bottom) {
    return HTCLIENT;
  }

  const style = window.style >>> 0;

  /* A sizing frame: its edges, and its corners as far as the notches. */
  if (style & WS_THICKFRAME && window.state === 'normal') {
    const frame = metric(SM_CXFRAME);
    const frameY = metric(SM_CYFRAME);
    const corner = frame + metric(SM_CXSIZE);
    const cornerY = frameY + metric(SM_CYSIZE);
    const onLeft = wx < frame;
    const onRight = wx >= window.width - frame;
    const onTop = wy < frameY;
    const onBottom = wy >= window.height - frameY;
    const nearLeft = wx < corner;
    const nearRight = wx >= window.width - corner;
    const nearTop = wy < cornerY;
    const nearBottom = wy >= window.height - cornerY;

    if ((onTop && nearLeft) || (onLeft && nearTop)) return HTTOPLEFT;
    if ((onTop && nearRight) || (onRight && nearTop)) return HTTOPRIGHT;
    if ((onBottom && nearLeft) || (onLeft && nearBottom)) return HTBOTTOMLEFT;
    if ((onBottom && nearRight) || (onRight && nearBottom)) return HTBOTTOMRIGHT;
    if (onLeft) return HTLEFT;
    if (onRight) return HTRIGHT;
    if (onTop) return HTTOP;
    if (onBottom) return HTBOTTOM;
  }

  /* The scroll bars run from a pixel outside the client area, sharing its lines. */
  if (
    style & WS_VSCROLL &&
    wx >= right &&
    wx < right + metric(SM_CXVSCROLL) &&
    wy >= top - 1 &&
    wy < bottom
  ) {
    return HTVSCROLL;
  }

  if (
    style & WS_HSCROLL &&
    wy >= bottom &&
    wy < bottom + metric(SM_CYHSCROLL) &&
    wx >= left - 1 &&
    wx < right
  ) {
    return HTHSCROLL;
  }

  if (
    window.menu &&
    wy < top &&
    wy >= top - metric(SM_CYMENU) - 1 &&
    wx >= left &&
    wx < window.width - left
  ) {
    return HTMENU;
  }

  if ((style & WS_CAPTION) === WS_CAPTION) {
    const captionBottom = top - (window.menu ? metric(SM_CYMENU) + 1 : 0);
    const captionTop = captionBottom - metric(SM_CYCAPTION);

    /* The caption spans the frame's inner edges, whatever the scroll bars take of the client area. */
    const inner = window.width - left;

    if (wy >= captionTop && wy < captionBottom && wx >= left && wx < inner) {
      const size = metric(SM_CXSIZE) + 1;

      if (style & WS_SYSMENU && wx < left + size) {
        return HTSYSMENU;
      }

      if (style & WS_MAXIMIZEBOX && wx >= inner - size) {
        return HTMAXBUTTON;
      }

      if (style & WS_MINIMIZEBOX && wx >= inner - size * (style & WS_MAXIMIZEBOX ? 2 : 1)) {
        return HTMINBUTTON;
      }

      return HTCAPTION;
    }
  }

  return HTBORDER;
}
