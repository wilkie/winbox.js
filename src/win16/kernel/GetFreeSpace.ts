'use strict';

import { freeSpace, settle } from './memory-model.js';

/**
 * Discarded objects always have a lock count of zero.
 *
 * **See also**:
 * {@link Kernel.GlobalFree GlobalFree}
 * {@link Kernel.GlobalAlloc GlobalAlloc}
 * {@link Kernel.GlobalNotify GlobalNotify}
 * {@link Kernel.GlobalReAlloc GlobalReAlloc}
 * {@link Kernel.GlobalSize GlobalSize}
 * {@link Kernel.GlobalUnlock GlobalUnlock}
 *
 * @static
 * @function GlobalLock
 * @memberof Kernel
 *
 * @param {Types.HGLOBAL} hglb - Identifies the global memory object to be
 *                               locked.
 *
 * @returns {Types.FARPTR} The return value points to the first byte of memory
 *                         in the global object, if the function is successful.
 *                         It is `NULL` if the object has been discarded or an
 *                         error occurs.
 */
export function GetFreeSpace(this: any, _fuFlags) {
  /* The oracle's machine, as KERNEL told `galimit` of it, less what has been
   * held since a program first asked. See `memory-model.ts`. */
  settle(this);

  return freeSpace(this);
}
