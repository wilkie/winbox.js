'use strict';

import { ansiConvert, ansiConvertBuffer, ansiUpperByte } from './ansi.js';

/**
 * The **AnsiUpper** function converts a character string to uppercase.
 *
 * The conversion is by the language driver rather than by arithmetic on the
 * character values, so the accented letters convert and the symbols scattered
 * among them do not. See {@link User.ansi ansi} for what was measured.
 *
 * If the high-order word of *`lpsz`* is zero, the low-order byte is taken as a
 * single character to convert, and the converted character is returned rather
 * than written anywhere.
 *
 * **See also**:
 * {@link User.AnsiLower AnsiLower}
 *
 * @static
 * @function AnsiUpper
 * @memberof User
 *
 * @param {Types.FARPTR} lpsz - Points to a null-terminated string, or contains
 *                              a single character in its low-order byte.
 *
 * @return {Types.FARPTR} The converted string, or the converted character.
 */
export function AnsiUpper(lpsz) {
  return ansiConvert(this.machine.cpu.core, lpsz, ansiUpperByte);
}

/**
 * Uppercases `cbLen` bytes of a buffer in place, NULs and all, answering
 * the count. See `ansiConvertBuffer`.
 *
 * @param {Types.FARPTR} lpsz - The buffer.
 * @param {Types.UINT} cbLen - How many bytes.
 *
 * @returns {Types.UINT} The count.
 */
export function AnsiUpperBuff(lpsz, cbLen) {
  return ansiConvertBuffer(this.machine.cpu.core, lpsz, cbLen, ansiUpperByte);
}
