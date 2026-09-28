'use strict';

import { FALSE, TRUE } from '../consts.js';
import { RasterWindow } from './raster-window.js';
import { positionChanged, positionChanging } from './window-state.js';

/**
 * Moving several windows at once, as `SetWindowPos` moves one: the moves
 * are kept until `EndDeferWindowPos`, which tells every window what it is
 * about to be given, in the order the moves were deferred, then places
 * them all and tells each what it was given.
 *
 * **Recorded** by `defer`, over three child windows of one parent:
 *
 * * `BeginDeferWindowPos` answers a handle, even for no windows, and each
 *   `DeferWindowPos` answers the same one, past the number asked for too.
 * * The windows are sent `WM_WINDOWPOSCHANGING`, and `WM_NCCALCSIZE`, each
 *   in turn, and then `WM_WINDOWPOSCHANGED` each in turn, which
 *   `DefWindowProc` makes `WM_MOVE` and `WM_SIZE`. A window deferred twice
 *   is told twice, and ends where the second put it. One deferred to where
 *   it already was is not sent `WM_WINDOWPOSCHANGED`.
 * * A handle that is no window's answers nought.
 * * `EndDeferWindowPos` answers `TRUE`.
 */

interface Deferred {
  hwnd: number;
  hwndInsertAfter: number;
  x: number;
  y: number;
  cx: number;
  cy: number;
  flags: number;
}

class DeferredMoves {
  moves: Deferred[] = [];
}

/**
 * Begins a set of moves.
 *
 * @param {Types.INT} _nNumWindows - How many windows it is for, which does not bound it.
 *
 * @returns {Types.HANDLE} The set's handle.
 */
export function BeginDeferWindowPos(this: any, _nNumWindows: number) {
  return this.handles.allocate(new DeferredMoves());
}

/**
 * Adds a window's move to a set: what `SetWindowPos` is given.
 *
 * @param {Types.HANDLE} hdwp - The set.
 * @param {Types.HWND} hwnd - The window.
 * @param {Types.HWND} hwndInsertAfter - The window it is to go after.
 * @param {Types.INT} x - Where it is to go.
 * @param {Types.INT} y - Where it is to go.
 * @param {Types.INT} cx - Its width.
 * @param {Types.INT} cy - Its height.
 * @param {Types.UINT} flags - As `SetWindowPos` takes them.
 *
 * @returns {Types.HANDLE} The set's handle, or nought.
 */
export function DeferWindowPos(
  this: any,
  hdwp: number,
  hwnd: number,
  hwndInsertAfter: number,
  x: number,
  y: number,
  cx: number,
  cy: number,
  flags: number
) {
  const set = this.handles.resolve(hdwp);

  if (!(set instanceof DeferredMoves) || !(this.handles.resolve(hwnd) instanceof RasterWindow)) {
    return 0;
  }

  set.moves.push({ hwnd, hwndInsertAfter, x, y, cx, cy, flags });

  return hdwp;
}

/**
 * Makes a set's moves, and lets the set go.
 *
 * @param {Types.HANDLE} hdwp - The set.
 *
 * @returns {Types.BOOL} Whether it was a set.
 */
export async function EndDeferWindowPos(this: any, hdwp: number) {
  const set = this.handles.resolve(hdwp);

  if (!(set instanceof DeferredMoves)) {
    return FALSE;
  }

  this.handles.free(hdwp);

  const begun: Awaited<ReturnType<typeof positionChanging>>[] = [];

  for (const { hwnd, hwndInsertAfter, x, y, cx, cy, flags } of set.moves) {
    const window = this.handles.resolve(hwnd);

    if (window instanceof RasterWindow) {
      begun.push(await positionChanging(this, hwnd, window, hwndInsertAfter, x, y, cx, cy, flags));
    }
  }

  await positionChanged(this, begun);

  return TRUE;
}
