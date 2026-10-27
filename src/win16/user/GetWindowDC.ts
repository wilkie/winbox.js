'use strict';

import { NULL } from '../consts.js';

import { lendsTo, takeEntry } from './dc-entries.js';
import { withFont } from './GetDC.js';

/**
 * A device context for the whole of a window, its frame, caption and menu bar
 * as well as its client area, with its origin at the window's corner. A
 * program draws its own frame with one. `ReleaseDC` gives it back.
 *
 * One of USER's entries (`dc-entries.ts`), as `GetDCEx` with `DCX_WINDOW`
 * and `DCX_USESTYLE` (`USER.EXE` seg1 `8457`-`8473`); `NULL` is the desktop
 * window, the whole screen (`visrgn`).
 *
 * @param {number} hwnd - The window.
 * @returns {number} The device context, or `NULL`.
 */
export function GetWindowDC(this: any, hwnd: number) {
  if (hwnd != NULL && !lendsTo(this, hwnd)) {
    return NULL;
  }

  const hdc = takeEntry(this, hwnd || this.desktopWindow, 0, 0x00010001);

  if (hdc) {
    withFont(this, this.handles.resolve(hdc));
  }

  return hdc;
}
