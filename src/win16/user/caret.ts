'use strict';

import { rasterOp } from '../../raster/raster-op.js';

import { GetSystemMetrics } from './GetSystemMetrics.js';
import { killTimer, setTimer } from './queue.js';

/**
 * The caret: one for the whole system, owned by a window, shown by inverting
 * a rectangle of that window's client area and blinking on a timer.
 *
 * **Recorded** by `editctl`, on four displays: the caret inverts what is
 * under it -- black text turns white -- and blinks every 530 milliseconds
 * until `SetCaretBlinkTime` says otherwise. A caret starts hidden, and each
 * `HideCaret` must be undone by a `ShowCaret` before it shows again.
 *
 * The blink is a system timer: `WM_SYSTIMER`, 118h, which a program's loop
 * takes and dispatches like any message and which calls the caret's own
 * procedure. On the replay's virtual clock, where every timer is due at once,
 * it does not run, so a loop that empties the queue still ends.
 *
 * Not yet measured: a caret made from a bitmap, or grey (`hbm` 1), which are
 * drawn solid here, and the caret of a window that is not the focus.
 */

export const WM_SYSTIMER = 0x0118;

/** The system timer's identifier, which no program's timer is given. */
const BLINK_TIMER = 0xffff;

interface Caret {
  hwnd: number;
  width: number;
  height: number;
  x: number;
  y: number;
  /** How many `HideCaret`s have not been undone; it starts hidden. */
  hidden: number;
  /** Whether it is drawn now, in its blink. */
  on: boolean;
}

function caretOf(system: any): Caret | null {
  return system._caret ?? null;
}

function blinkTime(system: any) {
  return system._caretBlink ?? 530;
}

/** Inverts the caret's rectangle in its window, drawing it or taking it away. */
function invert(system: any, caret: Caret) {
  const window = system.handles.resolve(caret.hwnd);
  const surface = window?.surface;

  if (!surface) {
    return;
  }

  rasterOp(system.display, surface, caret.x, caret.y, caret.width, caret.height, 0x550009, null, 0, 0);
}

function draw(system: any, caret: Caret, on: boolean) {
  if (caret.on !== on) {
    invert(system, caret);
    caret.on = on;
  }
}

function startBlink(system: any, caret: Caret) {
  if (system.virtualClock) {
    return;
  }

  setTimer(system, caret.hwnd, BLINK_TIMER, blinkTime(system), () => {
    const current = caretOf(system);

    if (current && current.hidden === 0) {
      draw(system, current, !current.on);
    }

    return 0;
  });

  system._timers.get(`${caret.hwnd}:${BLINK_TIMER}`).message = WM_SYSTIMER;
}

/**
 * Makes a caret for a window, taking the place of any caret before it. A
 * width or height of nought is the width or height of a window's border.
 */
export function CreateCaret(hwnd, hbm, nWidth, nHeight) {
  DestroyCaret.call(this);

  const caret: Caret = {
    hwnd,
    /* SM_CXBORDER and SM_CYBORDER. */
    width: nWidth || GetSystemMetrics.call(this, 5),
    height: nHeight || GetSystemMetrics.call(this, 6),
    x: 0,
    y: 0,
    hidden: 1,
    on: false,
  };

  void hbm;
  this._caret = caret;
  startBlink(this, caret);
}

/** Takes the caret away. */
export function DestroyCaret() {
  const caret = caretOf(this);

  if (!caret) {
    return 0;
  }

  draw(this, caret, false);
  killTimer(this, caret.hwnd, BLINK_TIMER);
  this._caret = null;

  return 1;
}

/** Moves the caret, in its window's client coordinates; a caret that shows is drawn again there. */
export function SetCaretPos(x, y) {
  const caret = caretOf(this);

  if (!caret) {
    return;
  }

  const was = caret.on;

  draw(this, caret, false);
  caret.x = (x << 16) >> 16;
  caret.y = (y << 16) >> 16;
  draw(this, caret, was);
}

/** Where the caret is, into a `POINT`. */
export function GetCaretPos(lpPoint) {
  const caret = caretOf(this);

  if (lpPoint) {
    lpPoint.x = caret?.x ?? 0;
    lpPoint.y = caret?.y ?? 0;
  }
}

/** Hides the caret, if it is the window's (or with `NULL`, whoever's): once more to be undone. */
export function HideCaret(hwnd) {
  const caret = caretOf(this);

  if (!caret || (hwnd && hwnd !== caret.hwnd)) {
    return;
  }

  caret.hidden++;
  draw(this, caret, false);
}

/** Undoes a `HideCaret`; the last one shows it at once and starts its blink again. */
export function ShowCaret(hwnd) {
  const caret = caretOf(this);

  if (!caret || (hwnd && hwnd !== caret.hwnd) || caret.hidden === 0) {
    return;
  }

  caret.hidden--;

  if (caret.hidden === 0) {
    draw(this, caret, true);
    startBlink(this, caret);
  }
}

export function SetCaretBlinkTime(uMSeconds) {
  this._caretBlink = uMSeconds;

  const caret = caretOf(this);

  if (caret) {
    startBlink(this, caret);
  }
}

export function GetCaretBlinkTime() {
  return blinkTime(this);
}

/** Hides the caret while a window of it is painted; see `BeginPaint`. */
export function hideCaretFor(system: any, hwnd: number) {
  const caret = caretOf(system);

  if (caret && caret.hwnd === hwnd) {
    HideCaret.call(system, hwnd);
    return true;
  }

  return false;
}
