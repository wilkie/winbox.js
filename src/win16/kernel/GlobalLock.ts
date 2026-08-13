'use strict';

import { NULL } from '../consts.js';

/**
 * The **GlobalLock** function returns a pointer to the given global memory
 * object. **GlobalLock** increments (increases by one) the lock count of
 * movable objects and locks the memory. Locked memory will not be moved or
 * discarded unless the memory object is reallocated by the
 * {@link Kernel.GlobalReAlloc GlobalReAlloc} function. The object remains
 * locked in memory until its lock count is decreased to zero.
 *
 * Each time an application calls the **GlobalLock** function for an object,
 * it must eventually call the {@link Kernel.GlobalUnlock GlobalUnlock}
 * function for the object.
 *
 * This function will return `NULL` if an application attempts to lock a memory
 * object with a zero-byte size.
 *
 * If **GlobalLock** incremented the lock count for the object,
 * {@link Kernel.GlobalUnlock GlobalUnlock} decrements the lock count for the
 * object. Other functions can also affect the lock count of a memory object.
 * For a list of these functions, see the description of the **GetGlobalFlags**
 * function.
 *
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
export function GlobalLock(hglb) {
  // Resolve global memory pointer
  const selector = hglb;
  console.log('locked block at', selector, (selector << 16).toString(16));
  return selector << 16;
}
