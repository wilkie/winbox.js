'use strict';

import { NULL } from '../consts.js';

import { RasterWindow } from './raster-window.js';

/**
 * The **GetMenu** function retrieves the handle of the menu associated with the
 * given window.
 *
 * @static
 * @function GetMenu
 * @memberof User
 *
 * @param {Types.HWND} hwnd - Identifies the window whose menu handle is
 *                            retrieved.
 *
 * @returns {Types.HMENU} The return value is the handle of the menu if the
 *                        function is successful. It is `NULL` if the given
 *                        window has no menu. It is undefined if the window is a
 *                        child window.
 */
export function GetMenu(hwnd) {
  if (hwnd == NULL) {
    // Gets the desktop context
    return NULL;
  }

  // Get the window
  const dialog = this.handles.resolve(hwnd);

  /* On the raster desktop a window keeps the handle of its menu. */
  if (dialog instanceof RasterWindow) {
    return dialog.options.menu || NULL;
  }

  return NULL;
}
