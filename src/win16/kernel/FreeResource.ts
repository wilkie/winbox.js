'use strict';

import { GlobalFree } from './GlobalFree.js';
import { FALSE, TRUE } from '../consts.js';

/**
 * The **FreeResource** function releases a loaded resource.
 *
 * A resource's block counts its uses (`LoadResource`): a free takes one
 * away, answering the handle while any is left and nought once none is.
 * **Recorded** by `findres`: freed once of two loads, the handle, its bytes
 * still there; freed again, nought, and loaded again, the same handle. The
 * block is kept for that: its bytes are read again when it is next loaded.
 *
 * **See also**:
 * {@link Kernel.LoadResource LoadResource}
 *
 * @static
 * @function FreeResource
 * @memberof Kernel
 *
 * @param {Types.HGLOBAL} hglbResource - The loaded resource.
 *
 * @return {Types.HGLOBAL} Nought if it was freed; the handle while it is
 *                         still in use.
 */
export function FreeResource(hglbResource) {
  const found = this._loadedResources?.get(hglbResource);

  if (found?.loaded) {
    found.loaded.uses = Math.max(0, found.loaded.uses - 1);

    return found.loaded.uses > 0 ? hglbResource : 0;
  }

  // Zero means the resource was freed; anything else means it is still in use.
  return GlobalFree.call(this, hglbResource) ? TRUE : FALSE;
}
