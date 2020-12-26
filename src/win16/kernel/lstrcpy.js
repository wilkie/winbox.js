"use strict";

/**
 * The **lstrcpy** function copies a string to a buffer.
 *
 * This function can be used to copy a double-byte character set (DBCS) string.
 *
 * Both strings must be less than 64K in size.
 *
 * **See also**:
 * {@link Kernel.lstrcat lstrcat}
 * {@link Kernel.lstrcpyn lstrcpyn}
 * {@link Kernel.lstrlen lstrlen}
 *
 * @static
 * @function lstrcpy
 * @memberof Kernel
 *
 * @param {Types.FARPTR} lpszString1 - Points to a buffer that will receive the
 *                                     contents of the string pointed to by the
 *                                     `*lpszString2*` parameter. The buffer
 *                                     must be large enough to contain the
 *                                     string, including the terminating null
 *                                     character.
 * @param {Types.FARPTR} lpszString2 - Points to the null-terminated string to
 *                                     be copied.
 *
 * @returns {Types.FARPTR} The return value is a pointer to `lpszString1` if the
 *                         function is successful. Otherwise, it is `NULL`.
 */
export function lstrcpy(lpszString1, lpszString2) {
    let cpu = this.machine.cpu.core;

    // TODO: how does a DBCS string work

    let destSegment = (lpszString1 >> 16) & 0xffff;
    let destOffset = lpszString1 & 0xffff;

    let srcSegment = (lpszString2 >> 16) & 0xffff;
    let srcOffset = lpszString2 & 0xffff;

    // Go through the src memory until we hit a null terminator
    // Copying every byte to the destination as we go.
    let data = null;
    let count = 0;
    do {
        data = cpu.read8(srcSegment, srcOffset);
        cpu.write8(destSegment, destOffset, data);
        srcOffset++;
        destOffset++;
        count++;
    } while (data && count <= 0xffff)

    return lpszString1;
}
