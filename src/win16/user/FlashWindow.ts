'use strict';

import { User } from '../user.js';
import { GetActiveWindow } from './placement.js';
import { RasterWindow } from './raster-window.js';
import { SendMessage } from './SendMessage.js';

/**
 * Turns a window's caption from active to inactive or back, to draw the
 * eye, the window's activation unchanged. **Read out of `USER.EXE`** (seg6
 * `0da4`) and **recorded** by `flash`:
 *
 * * A window not minimized is sent `WM_NCACTIVATE`: turning, with its
 *   caption's state turned; not turning, with whether it is the active
 *   window. It answers what the caption was, 40h for active or nought:
 *   `DefWindowProc` keeps it as the message last had it.
 * * A minimized window's title is lit, turning when it is not already;
 *   else it is drawn again as it is, and no longer lit. It answers 1.
 *
 * Not followed: a window USER is in the middle of switching to, for which
 * it does nothing but answer.
 *
 * @param {Types.HWND} hwnd - The window.
 * @param {Types.BOOL} fInvert - Whether to turn it, or to put it back.
 *
 * @returns {Types.BOOL} The caption's state before, or 1 for a minimized window.
 */
export async function FlashWindow(this: any, hwnd: number, fInvert: number) {
  const target = this.handles.resolve(hwnd);

  if (!(target instanceof RasterWindow)) {
    return 0;
  }

  const window = target.window;

  if (window.state === 'minimized') {
    window.lit = fInvert !== 0 && !window.captionLit;

    if (window.visible) {
      target.desktop.paintFrame(window);
    }

    return 1;
  }

  const was = window.captionLit ? 0x40 : 0;
  const lit = fInvert ? !was : GetActiveWindow.call(this) === hwnd;

  await SendMessage.call(this, hwnd, User.WM_NCACTIVATE, lit ? 1 : 0, 0);

  return was;
}
