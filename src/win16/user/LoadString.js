"use strict";

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
export function LoadString(hinst, idResource, lpszBuffer, cbBuffer) {
    // Resolve the handle
    let module = this.handles.resolve(hinst);

    // Fail out if the handle is not found
    if (!module) {
        return NULL;
    }

    let cpu = this.machine.cpu.core;

    let executable = module.executable;

    // Strings are stored 16 at a time
    let stringId = idResource;
    idResource = (idResource / 16) >>> 0;
    idResource++;

    // Resource ids that are integers have the high-bit set in the executable
    idResource |= 0x8000;

    let destSegment = (lpszBuffer >> 16) & 0xffff;
    let destOffset = lpszBuffer & 0xffff;

    let ret = 0;
    executable.resources.forEach( (resourceType) => {
        if (resourceType.id == Executable.RESOURCES.StringTable) {
            resourceType.entries.forEach( (resource) => {
                if (resource.id == idResource) {
                    let origOffset = destOffset;
                    let data = new Int8Array(executable.readResource(resource));

                    // Now go through the string data for the appropriate string.
                    let offset = 0;
                    for (let i = 0; i < stringId; i++) {
                        offset += 1 + data[offset];
                    }

                    // Then, we read the string data to memory.
                    let length = data[offset];
                    offset++;
                    for (let i = offset; i < offset + length; i++) {
                        cpu.write8(destSegment, destOffset, data[i]);
                        destOffset++;
                    }

                    // Write the null-terminator as well.
                    cpu.write8(destSegment, destOffset, 0);

                    // We will return the length of the string
                    ret = length;
                }
            });
        }
    });

    // If we could not find the string, ret remains 01
    return ret;
}
