'use strict';

import { heldIn } from './cursor-pos.js';
import { clockOf } from '../../emulator/clock.js';
import { PostMessage } from './PostMessage.js';
import { noteAsyncKey } from './enumerate.js';

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

  /**
   * Where the cursor is on the screen: what a message carries as its point
   * when it is not the mouse's own -- a key, a timer, one posted.
   */
  cursor = { x: 0, y: 0 };

  /** The window whose caption the buttons were pressed on, until let go. */
  captionPress: DesktopWindow | null = null;

  /** The last press put in through `Mouse_Event`, for its double clicks. */
  lastPress: { button: number; x: number; y: number; time: number } | null = null;

  /**
   * What takes the mouse and the keyboard instead of the windows, while a box
   * of USER's own that lets no program run is up (`sys-error-box.ts`): each
   * message as it would be posted, with the point on the screen.
   */
  modal: ((message: number, wParam: number, x: number, y: number) => void) | null = null;

  /** The character each virtual key typed last, for `TranslateMessage`. */
  readonly typed = new Map<number, number>();

  constructor(system: any) {
    this.system = system;

    /* Where the mouse driver's reset leaves it: the middle of the screen. */
    const screen = system.rasterDesktop?.screen;

    if (screen) {
      this.cursor = { x: screen.width >> 1, y: screen.height >> 1 };
    }
  }

  /**
   * A mouse move USER makes of its own accord, where the cursor is: after a
   * window is shown or moves, and after `SetCursorPos`. **Recorded** by
   * `mousemv`: the window under the cursor is sent `WM_MOUSEMOVE` at that
   * point, whether or not the window that changed is the one under it, and
   * with no window there the desktop is. A program that waits in
   * `GetMessage` before it first draws -- SkiFree -- is woken by it.
   */
  nudge() {
    if (this.modal) {
      return;
    }

    const { x, y } = this.cursor;

    if (!this.capture && !this.desktop.windowAt(x, y)) {
      const desktop = this.system.desktopWindow;

      if (desktop) {
        PostMessage.call(
          this.system,
          desktop,
          User.WM_MOUSEMOVE,
          0,
          ((y & 0xffff) << 16) | (x & 0xffff)
        );
      }

      return;
    }

    this.pointer('move', {
      x,
      y,
      button: 0,
      buttons: this.buttons,
      double: false,
      shift: false,
      control: false,
    });
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
    /* Held where `ClipCursor` keeps it, as `SetCursorPos` is. */
    pointer = { ...pointer, ...heldIn(this.system, pointer) };

    /* The buttons as they are now, for `GetAsyncKeyState`: left, right and
     * middle, `VK_LBUTTON`, `VK_RBUTTON` and `VK_MBUTTON`. */
    for (const [bit, vk] of [
      [1, 0x01],
      [2, 0x02],
      [4, 0x04],
    ]) {
      if ((pointer.buttons & bit) !== (this.buttons & bit)) {
        noteAsyncKey(this.system, vk, (pointer.buttons & bit) !== 0);
      }
    }

    this.cursor = { x: pointer.x, y: pointer.y };

    if (this.modal) {
      const left = pointer.button === 0;
      const message =
        kind === 'move'
          ? User.WM_MOUSEMOVE
          : !left
            ? 0
            : kind === 'down'
              ? User.WM_LBUTTONDOWN
              : User.WM_LBUTTONUP;

      this.buttons = pointer.buttons;

      if (message) {
        this.modal(message, pointer.buttons, pointer.x, pointer.y);
      }

      return;
    }
    const desktop = this.desktop;

    /* A caption pressed goes to `DefWindowProc`'s move loop, which takes the
     * mouse until it is let go: what comes before that loop starts is its
     * too. Windows keeps the mouse in one queue for the system and gives it
     * out as it is taken; here each event is posted as it happens, so a move
     * made before the loop has begun would go to what lies under it. */
    const pressed =
      !this.capture && this.buttons !== 0 && kind !== 'down' ? this.captionPress : null;
    const target = this.capture ?? pressed ?? desktop.windowAt(pointer.x, pointer.y);

    this.buttons = pointer.buttons;

    if (!target) {
      return;
    }

    /* A disabled window, or one inside one, takes no input: a press there does
     * nothing, as when a dialog box has disabled its owner. */
    if (!this.capture && disabled(target)) {
      return;
    }

    const hit = this.capture ? HTCLIENT : hitTest(desktop, target, pointer.x, pointer.y);

    if (kind === 'down') {
      this.captionPress = hit === HTCAPTION && !this.capture ? target : null;
    } else if (!pointer.buttons) {
      this.captionPress = null;
    }

    if (kind === 'down') {
      const top = topLevel(target);

      /* Activated by the press: the messages go before it, and move the
       * focus; a control pressed takes it for itself. See `activation.ts`.
       * A caption pressed is not: `DefWindowProc` activates its window as it
       * takes the press, after `WM_NCLBUTTONDOWN` (`iconclk`). */
      if (!top.active && hit !== HTCAPTION) {
        desktop.show(top);

        if (desktop.pendingActivation) {
          desktop.pendingActivation.click = true;
        }

        this.wake();
      } else if (top.active && !this.capture) {
        desktop.focus = target.control ? target : (desktop.focus ?? top);
      }
    }

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

    if (!this.modal && (!target || disabled(target))) {
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

    noteAsyncKey(this.system, virtual, kind === 'down');

    if (this.modal) {
      const alt = key.alt || virtual === User.VK_MENU;

      this.modal(
        alt
          ? kind === 'down'
            ? User.WM_SYSKEYDOWN
            : User.WM_SYSKEYUP
          : kind === 'down'
            ? User.WM_KEYDOWN
            : User.WM_KEYUP,
        virtual,
        this.cursor.x,
        this.cursor.y
      );
      return;
    }

    if (kind === 'down' && key.key.length === 1) {
      this.typed.set(virtual, key.key.charCodeAt(0) & 0xff);
    }

    /* The keys that type a control character, which the page names rather
     * than gives: the keyboard driver's `ToAscii` makes them 8, 9, 13 and
     * 27. */
    const control = { Backspace: 0x08, Tab: 0x09, Enter: 0x0d, NumpadEnter: 0x0d, Escape: 0x1b }[
      key.code as string
    ];

    if (kind === 'down' && control !== undefined) {
      this.typed.set(virtual, control);
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
  wake(except: number | null = null) {
    const woken = new Set<any>();

    /* Each task with a window due: it looks again, and paints it. */
    this.desktop.unpaintedWhere((window: DesktopWindow) => {
      const task = this.#taskOf(window);

      if (task && !woken.has(task) && this.system.scheduler?.windowTask(window.hwnd) !== except) {
        woken.add(task);
        task.signal?.();
      }

      return false;
    });
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
    msg.pt = { x: pointer?.x ?? this.cursor.x, y: pointer?.y ?? this.cursor.y };
    task.push(msg, true);
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
    return clockOf(this.system).now();
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

/** Whether a window, or any window it is inside, has `WS_DISABLED`. */
function disabled(window: DesktopWindow) {
  for (let at: DesktopWindow | null = window; at; at = at.parent) {
    if (at.style & User.WS_DISABLED) {
      return true;
    }
  }

  return false;
}
