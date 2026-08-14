'use strict';

import { handleFor, indexFor, selectorFor } from '../selectors.js';

/**
 * The **GlobalHandle** function retrieves the handle of the global memory
 * object whose selector is given.
 *
 * A handle and the selector its memory is addressed through name the same
 * descriptor and differ only in their privilege bits, so recovering one from
 * the other is arithmetic rather than a search. See
 * {@link Kernel.selectors selectors} for the relationship.
 *
 * **See also**:
 * {@link Kernel.GlobalLock GlobalLock}
 *
 * @static
 * @function GlobalHandle
 * @memberof Kernel
 *
 * @param {Types.UINT} uGlobalSel - The selector of a global memory object.
 *
 * @return {Types.DWORD} The handle in the low-order word and the selector in
 *                       the high-order word, or zero if there is no such
 *                       object.
 */
export function GlobalHandle(uGlobalSel) {
  const index = indexFor(uGlobalSel);

  if (!this.allocator.sizeOf(index) && this.allocator.flagsOf(index) === 0) {
    // Nothing was ever allocated behind this selector.
    return 0;
  }

  return ((selectorFor(uGlobalSel) << 16) | handleFor(index)) >>> 0;
}
