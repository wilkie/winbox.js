'use strict';

import { NULL } from '../consts.js';

/**
 * The **GetFocus** function returns the handle of the window that has the
 * input focus: the window keys go to. Known on the raster desktop; elsewhere
 * `NULL`.
 *
 * @returns {Types.HWND} The window with the focus, or `NULL`.
 */
export function GetFocus() {
  return this.rasterDesktop?.focus?.hwnd ?? NULL;
}
