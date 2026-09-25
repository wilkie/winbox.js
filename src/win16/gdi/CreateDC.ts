'use strict';

import { NULL } from '../consts.js';

/**
 * A device context for a device, by its driver's name. The only device here
 * is the display: `DISPLAY` gives a context over the whole screen, as
 * `GetDC(NULL)` does, which `DeleteDC` gives back. A printer, or any other
 * driver, is not there, and the answer is `NULL`.
 *
 * `CreateIC` is the same for asking about a device without drawing on it.
 */
export function CreateDC(this: any, lpszDriver: any) {
  if (String(lpszDriver ?? '').toUpperCase() !== 'DISPLAY' || !this.screen) {
    return NULL;
  }

  return this.handles.allocate(this.screen);
}

export function CreateIC(this: any, lpszDriver: any) {
  return CreateDC.call(this, lpszDriver);
}
