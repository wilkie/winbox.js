'use strict';

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
  const cpu = this.machine.cpu.core;

  // TODO: how does a DBCS string work

  const destSegment = (lpszString1 >> 16) & 0xffff;
  let destOffset = lpszString1 & 0xffff;

  const srcSegment = (lpszString2 >> 16) & 0xffff;
  let srcOffset = lpszString2 & 0xffff;

  console.log(
    'lstrcat',
    this.machine.memory.readCString(cpu.translateAddress(destSegment, destOffset)),
    this.machine.memory.readCString(cpu.translateAddress(srcSegment, srcOffset))
  );

  // Go through the dest memory until we hit a null terminator
  let data = null;
  let count = 0;
  do {
    data = cpu.read8(destSegment, destOffset);
    destOffset++;
    count++;
  } while (data && count <= 0xffff);

  // Return to the null-terminator in dest
  destOffset--;

  // Go through the src memory until we hit a null terminator
  // Copying every byte to the destination as we go.
  data = null;
  count = 0;
  do {
    data = cpu.read8(srcSegment, srcOffset);
    cpu.write8(destSegment, destOffset, data);
    srcOffset++;
    destOffset++;
    count++;
  } while (data && count <= 0xffff);

  return lpszString1;
}
