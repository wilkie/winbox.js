'use strict';

import { FALSE, TRUE } from '../consts.js';

import { MenuData } from './menu-data.js';
import { trackMenu } from './menu-loop.js';
import { RasterWindow } from './raster-window.js';

/**
 * The **TrackPopupMenu** function shows a pop-up menu with its top left at a
 * point of the screen, runs it until it closes, and sends the command chosen
 * to the window given, as `WM_COMMAND`. Only `TPM_LEFTALIGN` is placed as
 * asked; the other alignments are not done yet.
 *
 * @param {Types.HMENU} hmenu - The menu.
 * @param {Types.UINT} fuFlags - Where it goes from the point, and which buttons choose.
 * @param {Types.INT} x - The point, on the screen.
 * @param {Types.INT} y - The point, on the screen.
 * @param {Types.INT} nReserved - Nothing.
 * @param {Types.HWND} hwnd - The window the command is sent to.
 * @param {Types.LPRECT} lprc - Where a press does not close it; not used.
 *
 * @returns {Types.BOOL} Whether the menu was shown.
 */
export async function TrackPopupMenu(hmenu, fuFlags, x, y, nReserved, hwnd, _lprc) {
  const menu = this.handles.resolve(hmenu);
  const window = this.handles.resolve(hwnd);

  if (!(menu instanceof MenuData) || !(window instanceof RasterWindow)) {
    return FALSE;
  }

  await trackMenu(this, hwnd, { kind: 'popup', menu, x: (x << 16) >> 16, y: (y << 16) >> 16 });

  return TRUE;
}
