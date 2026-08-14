'use strict';

import { NULL } from '../consts.js';

import { Executable } from '../../executable.js';

/**
 * The **LoadString** function loads the specified string resource.
 *
 * @static
 * @function LoadString
 * @memberof User
 *
 * @param {Types.UINT} fuAllocFlags - Specifies how to allocate memory. This
 *                                    parameter can be a combination of the following
 *                                    values:
 * * LHND: Combines LMEM_MOVEABLE and LMEM_ZEROINIT
 * * LMEM_DISCARDABLE: Allocates discardable memory.
 * * LMEM_FIXED: Allocates fixed memory. The
 * * LMEM_FIXED and LMEM_MOVEABLE flags cannot be combined.
 * * LMEM_MOVEABLE: Allocates movable memory. The LMEM_FIXED and
 *   LMEM_MOVEABLE flags cannot be combined.
 * * LMEM_NOCOMPACT: Does not compact or discard memory to satisfy the
 *   allocation request.
 * * LMEM_NODISCARD: Does not discard memory to satisfy the allocation
 *   request.
 * * LMEM_ZEROINIT: Initializes memory contents to zero.
 * * LPTR: Combines LMEM_FIXED and LMEM_ZEROINIT.
 * * NONZEROLHND: Same as the LMEM_MOVEABLE flag.
 * * NONZEROLPTR: Same as the LMEM_FIXED flag.
 * @param {Types.UINT} fuAlloc - Specifies the number of bytes to be allocated.
 *
 * @return {Types.INT} The return value specifies the number of bytes copied
 *                     into the buffer, if the function is successful. It is
 *                     zero if the string resource does not exist.
 */
export async function LoadString(hinst, idResource, lpszBuffer, cbBuffer) {
  // Resolve the handle
  const module = this.handles.resolve(hinst);

  // Fail out if the handle is not found
  if (!module) {
    return NULL;
  }

  const cpu = this.machine.cpu.core;

  const executable = module.executable;

  // Strings are stored 16 at a time
  let stringId = idResource;
  idResource = (idResource / 16) >>> 0;
  idResource++;
  stringId = stringId - 16 * (idResource - 1);

  /* The executable marks an integer resource id by setting the high bit, and
   * the loader takes it off again when it parses the table -- so what is left
   * to compare against is the plain number. Setting the bit back here meant
   * the comparison could never match, and every string came back empty.
   */

  const destSegment = (lpszBuffer >> 16) & 0xffff;
  let destOffset = lpszBuffer & 0xffff;

  let ret = 0;
  for (let i = 0; i < executable.resources.length; i++) {
    const resourceType = executable.resources[i];
    if (resourceType.id == Executable.RESOURCES.StringTable) {
      for (let j = 0; j < resourceType.entries.length; j++) {
        const resource = resourceType.entries[j];
        if (resource.id == idResource) {
          const origOffset = destOffset;
          const data = new Uint8Array(await executable.readResource(resource));

          // Now go through the string data for the appropriate string.
          let offset = 0;
          for (let i = 0; i < stringId; i++) {
            offset += 1 + data[offset];
          }

          // Then, we read the string data to memory.
          const length = data[offset];
          offset++;
          for (let i = offset; i < offset + length; i++) {
            cpu.write8(destSegment, destOffset, data[i]);
            destOffset++;
          }

          // Write the null-terminator as well.
          cpu.write8(destSegment, destOffset, 0);

          console.log(
            'loading string',
            destSegment,
            destOffset - length,
            this.machine.memory.readCString(cpu.translateAddress(destSegment, destOffset - length)),
            length
          );

          // We will return the length of the string
          ret = length;
        }
      }
    }
  }

  // If we could not find the string, ret remains 0.
  return ret;
}
