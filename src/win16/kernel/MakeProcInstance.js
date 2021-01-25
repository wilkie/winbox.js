"use strict";

import { NULL } from '../consts.js';

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
export function MakeProcInstance(lpProc, hinst) {
    // We mostly don't care
    return lpProc;
}
