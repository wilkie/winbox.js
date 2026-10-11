'use strict';

import { NULL } from '../consts.js';

import { RasterWindow } from './raster-window.js';

/**
 * The **SetCapture** function sends every mouse message to one window, wherever
 * the pointer is, until {@link User.ReleaseCapture ReleaseCapture}: how a
 * program follows a drag out of its window. Its coordinates stay the
 * window's client coordinates.
 *
 * @param {Types.HWND} hwnd - The window.
 *
 * @returns {Types.HWND} The window that had the capture, or `NULL`.
 */
export function SetCapture(hwnd) {
  const input = this.rasterInput;
  const window = this.handles.resolve(hwnd);

  /* Nought lets the mouse go, as `ReleaseCapture` does, answering the window
   * that had it: USER takes nought for a window here and sets it as the
   * capture (`USER.EXE` seg1 `a8d4`, `ae69`, `289e`, `28cd`). Control Panel's
   * Color lets go of a press on its sample so; the mouse stayed its dialog's,
   * and its buttons took no clicks. */
  if (input && !hwnd) {
    const had = input.capture?.hwnd ?? NULL;

    letGo(input);
    return had;
  }

  if (!input || !(window instanceof RasterWindow)) {
    return NULL;
  }

  const was = input.capture?.hwnd ?? NULL;

  input.capture = window.window;
  input.captureKind = 'set';

  return was;
}

/**
 * The **ReleaseCapture** function ends a {@link User.SetCapture SetCapture}.
 */
export function ReleaseCapture() {
  const input = this.rasterInput;

  if (input) {
    letGo(input);
  }
}

/**
 * The mouse let go: where a window had it, USER makes the mouse move where
 * it is, for the window under it to hear of (`USER.EXE` seg1 `28d0`-`28dd`,
 * `52e9`; `jrnlrec`).
 */
function letGo(input: any) {
  const had = input.capture;

  input.capture = null;

  if (had) {
    input.nudge();
  }
}

/**
 * The window that has the mouse captured, or nought: **recorded** by
 * `minis2`, nought before, the window after `SetCapture`, nought after
 * `ReleaseCapture`.
 */
export function GetCapture(this: any) {
  return this.rasterInput?.capture?.hwnd ?? 0;
}
