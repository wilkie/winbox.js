'use strict';

/**
 * The **lstrcpyn** function copies at most a number of characters of a string
 * to a buffer, and always ends what it copies with a null character.
 *
 * As `KRNL386.EXE` does it (seg1 `831f`, ordinal 353): the source's length is
 * counted with its null character; where that is more than `cchCopy` -- as
 * compared unsigned -- `cchCopy` is taken instead. One fewer than that many
 * bytes are copied forward, a word at a time and then the odd byte, and a null
 * character written after them. So `cchCopy` of 1 writes the null character
 * alone, and the source is never read past its own null character. A count of
 * nought is one less than nought, 65535 bytes, as the code has it.
 *
 * **See also**:
 * {@link Kernel.lstrcpy lstrcpy}
 *
 * @static
 * @function lstrcpyn
 * @memberof Kernel
 *
 * @param {Types.FARPTR} lpszString1 - The buffer the string is copied to.
 * @param {Types.FARPTR} lpszString2 - The string copied.
 * @param {Types.UINT} cchCopy - The most bytes written, the null character
 *                               among them.
 *
 * @returns {Types.FARPTR} `lpszString1`.
 */
export function lstrcpyn(lpszString1, lpszString2, cchCopy) {
  const cpu = this.machine.cpu.core;

  const destSegment = (lpszString1 >> 16) & 0xffff;
  const destOffset = lpszString1 & 0xffff;
  const srcSegment = (lpszString2 >> 16) & 0xffff;
  const srcOffset = lpszString2 & 0xffff;

  // `repne scasb` from 0FFFFh, then `not cx`: the length with its nought.
  let length = 0;

  while (length < 0xffff) {
    length++;

    if (cpu.read8(srcSegment, (srcOffset + length - 1) & 0xffff) === 0) {
      break;
    }
  }

  const limit = cchCopy & 0xffff;
  const count = ((length > limit ? limit : length) - 1) & 0xffff;
  let at = 0;

  // `rep movsw`, each word read before it is written, then `rep movsb`.
  for (; at + 1 < count; at += 2) {
    const low = cpu.read8(srcSegment, (srcOffset + at) & 0xffff);
    const high = cpu.read8(srcSegment, (srcOffset + at + 1) & 0xffff);

    cpu.write8(destSegment, (destOffset + at) & 0xffff, low);
    cpu.write8(destSegment, (destOffset + at + 1) & 0xffff, high);
  }

  if (at < count) {
    cpu.write8(destSegment, (destOffset + at) & 0xffff, cpu.read8(srcSegment, (srcOffset + at) & 0xffff));
    at++;
  }

  cpu.write8(destSegment, (destOffset + at) & 0xffff, 0);

  return lpszString1;
}
