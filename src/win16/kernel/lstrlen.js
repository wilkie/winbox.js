"use strict";

/**
 * The **lstrlen** function returns the length, in bytes, of the specified
 * string (not including the terminating null character).
 *
 * **See also**:
 * {@link Kernel.lstrcpy lstrcpy}
 *
 * @static
 * @function lstrlen
 * @memberof Kernel
 *
 * @param {Types.FARPTR} lpszString - Points to a null-terminated string. This
 *                                    string must be less than 64K in size.
 *
 * @returns {Types.INT} The return value specifies the length, in bytes, of the
 *                      string pointed to by the *`lpszString`* parameter. There
 *                      is no error return.
 */
export function lstrlen(lpszString) {
    let memory = this.machine.memory;

    // TODO: how does a DBCS string work

    let srcSegment = ((lpszString >> 16) & 0xffff) >> 3;
    let srcOffset = lpszString & 0xffff;

    // Go through the src memory until we hit a null terminator
    // Copying every byte to the destination as we go.
    let data = null;
    let count = 0;
    do {
        data = memory.read8(srcSegment, srcOffset);
        srcOffset++;
        count++;
    } while (data && count <= 0xffff);

    count--;
    return count;
}
