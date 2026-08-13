"use strict";

/**
 * The **LocalLock** function retrieves a pointer to the given local memory
 * object. **LocalLock** increments (increases by one) the lock count of
 * movable objects and locks the memory.
 *
 * Each time an application calls **LocalLock** for an object, it must
 * eventually call {@link Kernel.LocalUnlock LocalUnlock} for the object.
 *
 * This function will return `NULL` if an application attempts to lock a memory
 * object with a size of 0 bytes.
 *
 * The {@link Kernel.LocalUnlock LocalUnlock} function decrements (decreases by
 * one) the lock count for the object if **LocalLock** incremented the count.
 * Other functions can also affect the lock count of a memory object.
 *
 * Locked memory will not be moved or discarded unless the memory object is
 * reallocated by the {@link Kernel.LocalReAlloc LocalReAlloc} function. The
 * object remains locked in memory until its lock count is decreased to zero.
 *
 * Discarded objects always have a lock count of zero.
 *
 * **See also**:
 * {@link Kernel.LocalReAlloc LocalReAlloc}
 * {@link Kernel.LocalUnlock LocalUnlock}
 * {@link Kernel.LocalFlags LocalFlags}
 *
 * @static
 * @function LocalLock
 * @memberof Kernel
 *
 * @param {Types.HLOCAL} hloc - Identifies the local memory object to be locked.
 *
 * @returns {Types.NEARPTR} The return value points to the first byte of memory
 *                          in the local object, if the function is successful.
 *                          It is `NULL` if the object has been discarded or an
 *                          error occurs.
 */
export function LocalLock(hloc) {
    console.log("LocalLock:", hloc);
}
