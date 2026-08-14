'use strict';

import { indexFor } from '../selectors.js';

/**
 * The **GlobalFlags** function returns information about the given global
 * memory object.
 *
 * The low-order byte is the object's lock count and the high-order byte its
 * flags. Only **GMEM_DISCARDABLE** comes back among the flags: a block being
 * moveable or fixed is not reported, which the recorded answers in
 * `oracle/fixtures/memory.json` are unambiguous about -- both come back as
 * zero, and only a discardable block sets anything.
 *
 * **See also**:
 * {@link Kernel.GlobalAlloc GlobalAlloc}
 *
 * @static
 * @function GlobalFlags
 * @memberof Kernel
 *
 * @param {Types.HGLOBAL} hglb - Identifies the global memory object.
 *
 * @return {Types.UINT} The lock count in the low byte and the flags in the
 *                      high byte.
 */
export function GlobalFlags(hglb) {
  const index = indexFor(hglb);
  const flags = this.allocator.flagsOf(index);

  /* The lock count stays at zero through nested locks on fixed and moveable
   * blocks alike, which is what the handles probe recorded. Nothing has
   * measured what a discardable block counts.
   */
  return flags & 0x0100;
}
