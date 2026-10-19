'use strict';

import { Surface } from '../../raster/surface.js';

import { NULL } from '../consts.js';
import { SYSTEM_FONT, stockFontHandle } from './stock-fonts.js';

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

  /* A context starts with the System font selected, as every Windows context
   * does (see `GetDC`): Calendar and `DrawText` measure text in one without
   * selecting a font first. */
  const surface: any = Surface.memory();

  /* Not the display's: its driver is GDI's own for bitmaps (see `Escape`). */
  surface.memoryContext = true;

  /* One made compatible with a printer's context is of its driver: it
   * answers the printer's `GetDeviceCaps`, and its bitmap can be given to
   * the driver (`printer-blits.ts`). */
  const given = hdc ? this.handles.resolve(hdc) : null;

  const font = this.fonts ? stockFontHandle(this, SYSTEM_FONT) : null;

  if (font) {
    surface.font = this.handles.resolve(font);
  }

  /* Its handle GDI's, from those its objects have (`gdinum`). */
  const handle = this.handles.allocateGDI(surface);

  if (given?.driverDevice || given?.compatibleDevice) {
    surface.compatibleDevice = given.driverDevice ?? given.compatibleDevice;

    /* Its colours, brush and pen made by the driver as a printer's
     * context's are, for the memory context (seg1 `0078`, `01cd`-`0210`). */
    return import('./printer-output.js').then(async ({ startDrawing }) => {
      await startDrawing(this, surface);
      return handle;
    });
  }

  return handle;
}
