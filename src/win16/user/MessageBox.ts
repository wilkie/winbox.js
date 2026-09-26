'use strict';

import { messageBox } from './message-box.js';

/**
 * A message box: USER's own dialog on the raster desktop. See
 * `message-box.ts`. With no raster desktop there is no box to show, and it
 * answers nought, as it does when it cannot make one.
 *
 * @param {Types.HWND} hwndParent - The owner, or nought.
 * @param {Types.LPCSTR} lpszText - The text.
 * @param {Types.LPCSTR} lpszTitle - The caption, or nought for USER's own.
 * @param {Types.UINT} fuStyle - The buttons, icon, default button and modality.
 *
 * @returns {Types.INT} The button pressed, or nought.
 */
export async function MessageBox(hwndParent, lpszText, lpszTitle, fuStyle) {
  if (!this.rasterDesktop) {
    return 0;
  }

  return messageBox(this, hwndParent & 0xffff, lpszText, lpszTitle, fuStyle);
}
