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
    input.capture = null;
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
