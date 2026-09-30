'use strict';

import { isPrinterDriver, PRINTER, printerSurface } from '../printer.js';
import { NULL } from '../consts.js';
import { SYSTEM_FONT, stockFontHandle } from './stock-fonts.js';

/**
 * A device context for a device, by its driver's name. The only device here
 * is the display: `DISPLAY` gives a context over the whole screen, as
 * `GetDC(NULL)` does, which `DeleteDC` gives back. A printer, or any other
 * driver, is not there, and the answer is `NULL`.
 *
 * `CreateIC` is the same for asking about a device without drawing on it.
 */
export function CreateDC(this: any, lpszDriver: any, _lpszDevice?: any, lpszOutput?: any) {
  /* winbox.js's own printer: a page to draw into, printed to the port given
   * (`printer.ts`). */
  if (isPrinterDriver(lpszDriver)) {
    const surface = printerSurface(this, lpszOutput ? String(lpszOutput) : PRINTER.port);
    const font = this.fonts ? stockFontHandle(this, SYSTEM_FONT) : null;

    if (font) {
      surface.font = this.handles.resolve(font);
    }

    return this.handles.allocateGDI(surface);
  }

  if (String(lpszDriver ?? '').toUpperCase() !== 'DISPLAY' || !this.screen) {
    return NULL;
  }

  /* With the System font selected, as every context starts: the Visual
   * Basic runtime measures a digit in a `DISPLAY` information context as it
   * starts, without selecting a font. */
  if (!this.screen.font) {
    const font = this.fonts ? stockFontHandle(this, SYSTEM_FONT) : null;

    if (font) {
      this.screen.font = this.handles.resolve(font);
    }
  }

  return this.handles.allocate(this.screen);
}

export function CreateIC(this: any, lpszDriver: any, lpszDevice?: any, lpszOutput?: any) {
  return CreateDC.call(this, lpszDriver, lpszDevice, lpszOutput);
}
