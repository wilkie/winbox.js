'use strict';

import { GlobalFree } from './GlobalFree.js';
import { FALSE, TRUE } from '../consts.js';

/**
 * The **FreeResource** function releases a loaded resource.
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
 * @return {Types.BOOL} FALSE if it was freed, which is the way round this one
 *                      is defined.
 */
export function FreeResource(hglbResource) {
  // Zero means the resource was freed; anything else means it is still in use.
  return GlobalFree.call(this, hglbResource) ? TRUE : FALSE;
}
