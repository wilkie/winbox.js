'use strict';

import { Surface } from '../../raster/surface.js';

import { NULL } from '../consts.js';

/**
 * Makes a memory device context: pixels winbox.js owns, with no canvas, and the
 * one-by-one monochrome bitmap every new memory device context starts with
 * until the program selects its own. Drawing goes straight into whatever
 * bitmap is selected; see `DeviceBitmap`.
 *
 * @param {Types.HDC} hdc - The device context to be compatible with, or null
 *                          for the screen.
 *
 * @returns {Types.HDC} The new device context, or null.
 */
export function CreateCompatibleDC(hdc) {
  if (hdc != NULL && !this.handles.resolve(hdc)) {
    return NULL;
  }

  return this.handles.allocate(Surface.memory());
}
