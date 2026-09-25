'use strict';

import { NULL } from '../consts.js';

import { RasterWindow } from './raster-window.js';

/**
 * The **GetDlgItem** function returns the handle of a dialog box's control,
 * or of any window's child, by the identifier it was made with.
 *
 * Only windows on the raster desktop keep their children; elsewhere the answer
 * is `NULL`.
 *
 * @param {Types.HWND} hwndDlg - The parent window.
 * @param {Types.INT} idDlgItem - The child's identifier.
 *
 * @returns {Types.HWND} The child's handle, or `NULL`.
 */
export function GetDlgItem(hwndDlg, idDlgItem) {
  const parent = this.handles.resolve(hwndDlg);

  if (!(parent instanceof RasterWindow)) {
    return NULL;
  }

  const child = parent.desktop.windows.find(
    (window) => window.parent === parent.window && window.controlId === (idDlgItem & 0xffff)
  );

  return child ? child.hwnd : NULL;
}
