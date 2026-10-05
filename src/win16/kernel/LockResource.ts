'use strict';

import { GlobalLock } from './GlobalLock.js';

/**
 * The **LockResource** function gives a pointer to a loaded resource.
 *
 * A loaded resource is a global memory object, so this is
 * {@link Kernel.GlobalLock GlobalLock} under another name -- the two existed
 * separately because a resource could be discarded and reloaded, not because
 * they did anything different.
 *
 * **See also**:
 * {@link Kernel.LoadResource LoadResource}
 *
 * @static
 * @function LockResource
 * @memberof Kernel
 *
 * @param {Types.HGLOBAL} hglbResource - The loaded resource.
 *
 * @return {Types.FARPTR} A pointer to the resource.
 */
export function LockResource(hglbResource) {
  /* KERNEL's own locks the resource with `GlobalLock`, counted as a
   * program's lock is (`KRNL386.EXE` seg1 `8768`). */
  return GlobalLock.call(this, hglbResource);
}
