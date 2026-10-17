'use strict';

import { isPrinterDriver, PRINTER, printerSurface } from '../printer.js';
import { NULL } from '../consts.js';
import { SYSTEM_FONT, stockFontHandle } from './stock-fonts.js';
import { createDriverDC } from './printer-driver.js';

/**
 * A device context for a device, by its driver's name. `DISPLAY` gives a
 * context over the whole screen, as `GetDC(NULL)` does, which `DeleteDC`
 * gives back: the display's driver is never run, its answers are the
 * display mode's. WinBox's own printer, `WBPRINT`, gives a page to draw
 * into (`printer.ts`). Any other driver is loaded from the drive and run as
 * GDI runs it, its `Enable` asked for its device (`printer-driver.ts`).
 *
 * `CreateIC` is the same for asking about a device without drawing on it.
 */
export function CreateDC(
  this: any,
  lpszDriver: any,
  lpszDevice?: any,
  lpszOutput?: any,
  lpInitData?: any
) {
  return createContext(this, lpszDriver, lpszDevice, lpszOutput, lpInitData, false);
}

function createContext(
  system: any,
  lpszDriver: any,
  lpszDevice: any,
  lpszOutput: any,
  lpInitData: any,
  ic: boolean
): any {
  if (
    lpszDriver &&
    !isPrinterDriver(lpszDriver) &&
    String(lpszDriver).toUpperCase() !== 'DISPLAY'
  ) {
    return createDriverDC(
      system,
      { driver: lpszDriver, device: lpszDevice, output: lpszOutput, data: lpInitData },
      ic
    );
  }

  return createKept.call(system, lpszDriver, lpszOutput);
}

/** A context of a device winbox.js keeps: the display, or its own printer. */
function createKept(this: any, lpszDriver: any, lpszOutput?: any) {
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

export function CreateIC(
  this: any,
  lpszDriver: any,
  lpszDevice?: any,
  lpszOutput?: any,
  lpInitData?: any
) {
  return createContext(this, lpszDriver, lpszDevice, lpszOutput, lpInitData, true);
}
