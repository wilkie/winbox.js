'use strict';

import { NULL } from '../consts.js';
import { handleFor, selectorFor } from '../selectors.js';

/**
 * The **LoadResource** function loads a resource into memory.
 *
 * The handle that comes back is an ordinary global memory handle, which is why
 * {@link Kernel.LockResource LockResource} and
 * {@link Kernel.GlobalLock GlobalLock} are the same operation on it.
 *
 * **See also**:
 * {@link Kernel.FindResource FindResource}
 * {@link Kernel.LockResource LockResource}
 *
 * @static
 * @function LoadResource
 * @memberof Kernel
 *
 * @param {Types.HINSTANCE} hinst - The module the resource came from.
 * @param {Types.HANDLE} hResInfo - The resource, from `FindResource`.
 *
 * @return {Types.HGLOBAL} The loaded resource, or NULL.
 */
export async function LoadResource(hinst, hResInfo) {
  const found = this.handles.resolve(hResInfo);

  if (!found || !found.entry) {
    return NULL;
  }

  /* One block a resource, its uses counted: loaded again, the same handle,
   * and loaded after its last use was freed, its bytes read into the same
   * handle again. **Recorded** by `findres`: a resource loaded twice is one
   * handle, and 20,000 times, without a free, never fails. A block made for
   * each load, as winbox.js once did, ran out in SimTower. */
  const loaded = found.loaded;

  if (loaded && loaded.uses > 0) {
    loaded.uses++;
    return loaded.handle;
  }

  const bytes = new Uint8Array(await found.executable.readResource(found.entry));
  let handle = loaded?.handle;

  if (handle === undefined) {
    const index = this.allocator.allocate(bytes.byteLength);

    if (index === null || index < 0) {
      return NULL;
    }

    handle = handleFor(index);
  }

  /* Resources are read into the block whole rather than a byte at a time: a
   * bitmap or a dialog template is not small, and every byte would otherwise
   * be a separate address translation.
   */
  // Through the block's own selector: `index << 3` names the wrong table.
  const address = this.machine.cpu.core.translateAddress(selectorFor(handle), 0);

  this.machine.memory.write(address, new DataView(bytes.buffer, bytes.byteOffset));

  found.loaded = { handle, uses: 1 };
  (this._loadedResources ??= new Map()).set(handle, found);

  return handle;
}
