'use strict';

import { heldIn } from './cursor-pos.js';
import { clockOf } from '../../emulator/clock.js';
import { queueOf } from './queue.js';
import { noteAsyncKey } from './enumerate.js';

import { MSG, User } from '../user.js';

import { type Desktop, type DesktopWindow } from './desktop.js';
import { RasterWindow } from './raster-window.js';
import { type MouseInput } from './mouse-scan.js';

/**
 * The mouse and keyboard, on the raster desktop: what the page hands in --
 * a pointer at a pixel of the screen, a key -- put in the queue of the
 * program whose window it is, as input.
 *
 * Nothing here calls into a program. A key is put in as the message it is.
 * The mouse is put in as the mouse made it, a point of the screen and what
 * it did, and hit-tested as a look takes it: `WM_NCHITTEST`,
 * `WM_PARENTNOTIFY`, `WM_MOUSEACTIVATE` and `WM_SETCURSOR` sent from the
 * program's own look, as USER's system queue sends them
 * (`mouse-scan.ts`). Which keys are system keys is measured by `altchild`,
 * which puts its keys in through `KEYBD_EVENT`; the rest of the input queue
 * is not.
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
export const HTERROR = 0xfffe;

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

  /**
   * How it was captured (`USER.EXE` seg1 `28cd`, the kind at `10e`):
   * `set`, by `SetCapture`, its messages in the client area; `loop` and
   * `menu`, by USER's own loops, which move and size windows and run menus,
   * in their client form at the point on the screen, a menu's presses
   * twice a double click whatever the class (seg1 `2df1`, `2d7c`).
   */
  captureKind: 'set' | 'loop' | 'menu' = 'set';

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

  /** How many keys were pressed while Alt was down, since its press (USER's `32d`). */
  #keysWithAlt = 0;

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
      this.#toDesktop(x, y);
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

  /**
   * A move over no window, the desktop window's: taken, it makes the cursor
   * the arrow (`set-cursor.ts`; `curerr`).
   */
  #toDesktop(x: number, y: number) {
    const desktop = this.system.desktopWindow;
    const task = desktop && queueOf(this.system, desktop);

    /* Input, as the mouse's own moves are, not a message posted: it comes
     * after what was posted and after the quit (`quitin`), and several made
     * before the queue is looked at are kept as one (`nudges`). */
    if (task) {
      this.#input(task, desktop, User.WM_MOUSEMOVE, 0, ((y & 0xffff) << 16) | (x & 0xffff));
    }
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
      if (kind === 'move') {
        this.#toDesktop(pointer.x, pointer.y);
      }

      return;
    }

    /* A caption pressed, as the frame lies: what follows it, until the
     * buttons are let go, goes to that window's task (above). */
    if (kind === 'down') {
      this.captionPress =
        !this.capture &&
        !disabled(target) &&
        hitTest(desktop, target, pointer.x, pointer.y) === HTCAPTION
          ? target
          : null;
    } else if (!pointer.buttons) {
      this.captionPress = null;
    }

    /* Put in as the mouse made it, to be hit-tested as it is taken: the
     * window it lands on, the part of it, the form the message takes, and a
     * press's activation are the look's to find (`mouse-scan.ts`). Here it
     * only finds the queue: the task of the window under it now. */
    let message = User.WM_MOUSEMOVE;

    if (kind !== 'move') {
      const base = [
        [User.WM_LBUTTONDOWN, User.WM_LBUTTONUP],
        [User.WM_MBUTTONDOWN, User.WM_MBUTTONUP],
        [User.WM_RBUTTONDOWN, User.WM_RBUTTONUP],
      ][pointer.button] ?? [User.WM_LBUTTONDOWN, User.WM_LBUTTONUP];

      message = base[kind === 'up' ? 1 : 0];
    }

    const keys =
      (pointer.buttons & 1 ? User.MK_LBUTTON : 0) |
      (pointer.buttons & 2 ? User.MK_RBUTTON : 0) |
      (pointer.buttons & 4 ? User.MK_MBUTTON : 0) |
      (pointer.shift ? User.MK_SHIFT : 0) |
      (pointer.control ? User.MK_CONTROL : 0);
    const mouse: MouseInput = {
      x: pointer.x,
      y: pointer.y,
      kind: message,
      double: pointer.double && kind === 'down',
      keys,
    };

    this.#post(
      target,
      message,
      keys,
      ((pointer.y & 0xffff) << 16) | (pointer.x & 0xffff),
      pointer,
      mouse
    );
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

    /* What it types, for `TranslateMessage`; the keys that type a control
     * character the page names rather than gives: the keyboard driver's
     * `ToAscii` makes them 8, 9, 13 and 27. */
    const control = { Backspace: 0x08, Tab: 0x09, Enter: 0x0d, NumpadEnter: 0x0d, Escape: 0x1b }[
      key.code as string
    ];
    const typed = control ?? (key.key.length === 1 ? key.key.charCodeAt(0) & 0xff : undefined);

    this.virtualKey(kind, virtual, { alt: !!key.alt, repeat: key.repeat, typed });
  }

  /**
   * A virtual key pressed or released, as the keyboard driver hands it to
   * USER's `KEYBD_EVENT`: the page's keys, and a program's own through that
   * entry (`keybd-event.ts`). `alt` is whether Alt is down with it -- bit 29
   * of `lParam` -- and `typed` the character it types, if any.
   *
   * **Read out** of `USER.EXE`: `KEYBD_EVENT` (seg1 `4b59`, then `4c1d`-
   * `4c4e`) makes a key a system key, `WM_SYSKEYDOWN` or `WM_SYSKEYUP`,
   * when Alt is down and Control is not. Alt's own press is one; its
   * release is one only if no other key was pressed while it was down
   * (the count at `32d`), else a plain `WM_KEYUP`; Control is never one.
   * The system queue makes F10 one as the key is taken from it, Alt or not
   * (seg1 `3188`).
   *
   * **Recorded** by `altchild`, whose keys go in through `KEYBD_EVENT`:
   * Alt's press with bit 29, its release alone as `WM_SYSKEYUP` without
   * it, and F10 alone as `WM_SYSKEYDOWN` and `WM_SYSKEYUP`.
   */
  virtualKey(
    kind: 'down' | 'up',
    virtual: number,
    { alt, repeat, typed }: { alt: boolean; repeat: boolean; typed?: number }
  ) {
    const target = this.desktop.focus ?? this.desktop.active;

    if (!this.modal && (!target || disabled(target))) {
      return;
    }

    noteAsyncKey(this.system, virtual, kind === 'down');

    /* Alt's own press has Alt down, and its release has it up, whatever
     * the host says of it (`altchild`). */
    if (virtual === User.VK_MENU) {
      alt = kind === 'down';
    }

    const control = ((this.system._asyncKeys?.[User.VK_CONTROL] ?? 0) & 0x80) !== 0;
    let system = false;

    if (virtual === User.VK_MENU) {
      if (kind === 'down') {
        this.#keysWithAlt = 0;
      }

      system = !control && (kind === 'down' || this.#keysWithAlt === 0);
    } else if (virtual !== User.VK_CONTROL && alt) {
      if (kind === 'down') {
        this.#keysWithAlt++;
      }

      system = !control;
    }

    if (virtual === User.VK_F10) {
      system = true;
    }

    const message = system
      ? kind === 'down'
        ? User.WM_SYSKEYDOWN
        : User.WM_SYSKEYUP
      : kind === 'down'
        ? User.WM_KEYDOWN
        : User.WM_KEYUP;

    if (this.modal) {
      this.modal(message, virtual, this.cursor.x, this.cursor.y);
      return;
    }

    if (kind === 'down' && typed !== undefined) {
      this.typed.set(virtual, typed);
    }

    /* The repeat count, and bit 30 for a key that was already down; bit 31
     * for a release; bit 29 while Alt is down. */
    const lParam =
      1 | (repeat ? 1 << 30 : 0) | (kind === 'up' ? (3 << 30) >>> 0 : 0) | (alt ? 1 << 29 : 0);

    this.#post(target!, message, virtual, lParam >>> 0);
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

  #post(
    target: DesktopWindow,
    message: number,
    wParam: number,
    lParam: number,
    pointer?: Pointer,
    mouse?: MouseInput
  ) {
    const task = this.#taskOf(target);

    if (!task) {
      return;
    }

    this.#input(task, target.hwnd, message, wParam, lParam, pointer, mouse);
  }

  /** A message put in a task's queue as input, the mouse's or the keyboard's. */
  #input(
    task: any,
    hwnd: number,
    message: number,
    wParam: number,
    lParam: number,
    pointer?: Pointer,
    mouse?: MouseInput
  ) {
    const msg: any = new MSG();

    if (mouse) {
      msg.mouse = mouse;
    }

    msg.hwnd = hwnd;
    msg.message = message;
    msg.wParam = wParam;
    msg.lParam = lParam;
    msg.time = this.#time();
    msg.pt = { x: pointer?.x ?? this.cursor.x, y: pointer?.y ?? this.cursor.y };

    /* A move not yet taken, with nothing after it, is replaced by the next,
     * which goes to the window under the mouse then: shown under the cursor
     * just after it moved there, a window is the only one to hear of it
     * (`setcur`). */
    const move = message === User.WM_MOUSEMOVE;
    const last = this.#lastMove;

    if (move && last) {
      const at = last.task._input?.indexOf(last.msg) ?? -1;

      if (at >= 0) {
        last.task._input.splice(at, 1);
      }
    }

    task.push(msg, true);
    this.#lastMove = move ? { task, msg } : null;
  }

  /** The last input posted, when it was a move. */
  #lastMove: { task: any; msg: any } | null = null;

  #taskOf(window: DesktopWindow) {
    const handle = this.system.handles.resolve(window.hwnd);

    if (!(handle instanceof RasterWindow)) {
      return null;
    }

    return this.system.handles.resolve(handle.data.hInstance) ?? null;
  }

  #time() {
    return clockOf(this.system).now();
  }
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

  /* An icon is all caption: pressed, it moves; twice, it restores. So is its
   * title, whose procedure answers `WM_NCHITTEST` with `HTCAPTION` (`USER.EXE`
   * seg1 `6dbd`) and hands the press to the icon (`iconTitleProc` in
   * `raster-desktop.ts`). */
  if (window.state === 'minimized' || window.titleOf) {
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
