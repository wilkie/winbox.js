'use strict';

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
  const cpu = this.machine.cpu.core;

  // TODO: how does a DBCS string work

  const srcSegment = (lpszString >> 16) & 0xffff;
  let srcOffset = lpszString & 0xffff;

  console.log(
    'lstrlen',
    this.machine.memory.readCString(cpu.translateAddress(srcSegment, srcOffset))
  );

  // Go through the src memory until we hit a null terminator
  let data = null;
  let count = 0;
  do {
    data = cpu.read8(srcSegment, srcOffset);
    srcOffset++;
    count++;
  } while (data && count <= 0xffff);

  count--;

  return count;
}
