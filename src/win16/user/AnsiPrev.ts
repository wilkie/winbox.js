'use strict';

/**
 * The **AnsiPrev** function moves to the previous character in a string.
 *
 * The start of the string is passed as well as the current position, because
 * on a double-byte system there is no way to tell from the preceding byte
 * alone whether it is a character or the second half of one -- the only
 * reliable answer comes from walking forward from a known boundary.
 *
 * At the start of the string it stays put, returning *`lpchStart`*.
 *
 * **See also**:
 * {@link User.AnsiNext AnsiNext}
 *
 * @static
 * @function AnsiPrev
 * @memberof User
 *
 * @param {Types.FARPTR} lpchStart - Points to the start of the string.
 * @param {Types.FARPTR} lpchCurrentChar - Points to a character within it.
 *
 * @return {Types.FARPTR} A pointer to the previous character, or to the start
 *                        of the string if there is no previous character.
 */
export function AnsiPrev(lpchStart, lpchCurrentChar) {
  const segment = (lpchStart >> 16) & 0xffff;

  const start = lpchStart & 0xffff;
  const current = lpchCurrentChar & 0xffff;

  // TODO: a double-byte character set has to walk forward from the start
  if (current <= start) {
    return lpchStart;
  }

  return (segment << 16) | ((current - 1) & 0xffff);
}
