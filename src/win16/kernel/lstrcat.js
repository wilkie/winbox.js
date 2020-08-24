"use strict";

/**
 * The **lstrcat** function appends one string to another.
 *
 * Both strings must be less than 64K in size.
 *
 * **See also**:
 * {@link Kernel.lstrcpy lstrcpy}
 *
 * @static
 * @function lstrcat
 * @memberof Kernel
 *
 * @param {Types.FARPTR} lpszString1 - Points to a byte array containing a null-
 *                                     terminated string. The byte array
 *                                     containing the string must be large
 *                                     enough to contain both strings.
 * @param {Types.FARPTR} lpszString2 - Points to the null-terminated string to
 *                                     be appended to the string specified in
 *                                     the *`lpszString`* parameter.
 *
 * @returns {Types.FARPTR} The return value points to `lpszString1` if the
 *                         function is successful.
 */
export function lstrcat(lpszString1, lpszString2) {
    let memory = this.machine.memory;

    // TODO: how does a DBCS string work

    let destSegment = ((lpszString1 >> 16) & 0xffff) >> 3;
    let destOffset = lpszString1 & 0xffff;

    let srcSegment = ((lpszString2 >> 16) & 0xffff) >> 3;
    let srcOffset = lpszString2 & 0xffff;

    // Go through the dest memory until we hit a null terminator
    let data = null;
    let count = 0;
    do {
        data = memory.read8(destSegment, destOffset);
        destOffset++;
        count++;
    } while (data && count <= 0xffff)

    // Return to the null-terminator in dest
    destOffset--;

    // Go through the src memory until we hit a null terminator
    // Copying every byte to the destination as we go.
    data = null;
    count = 0;
    do {
        data = memory.read8(srcSegment, srcOffset);
        memory.write8(destSegment, destOffset, data);
        srcOffset++;
        destOffset++;
        count++;
    } while (data && count <= 0xffff)

    return lpszString1;
}
