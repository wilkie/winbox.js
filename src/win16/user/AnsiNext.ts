'use strict';

/**
 * The **AnsiNext** function moves to the next character in a string.
 *
 * On a single-byte character set this advances by one, but software is
 * expected to use it rather than incrementing a pointer so that the same code
 * works on a double-byte system, where a character may occupy two bytes.
 *
 * At the end of the string it stays put: the recorded behaviour is that
 * **AnsiNext** on a pointer to the null terminator returns that same pointer,
 * so walking a string with it stops rather than running past the end.
 *
 * **See also**:
 * {@link User.AnsiPrev AnsiPrev}
 *
 * @static
 * @function AnsiNext
 * @memberof User
 *
 * @param {Types.FARPTR} lpchCurrentChar - Points to a character in a
 *                                         null-terminated string.
 *
 * @return {Types.FARPTR} A pointer to the next character, or to the null
 *                        terminator if there is no next character.
 */
export function AnsiNext(lpchCurrentChar) {
  const cpu = this.machine.cpu.core;

  const segment = (lpchCurrentChar >> 16) & 0xffff;
  const offset = lpchCurrentChar & 0xffff;

  // TODO: a double-byte character set advances by two here
  if (!cpu.read8(segment, offset)) {
    return lpchCurrentChar;
  }

  return (segment << 16) | ((offset + 1) & 0xffff);
}
