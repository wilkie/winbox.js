'use strict';

/**
 * The **lstrcmpi** function compares two character strings without regard to
 * case.
 *
 * The comparison is the one {@link User.lstrcmp lstrcmp} makes before it
 * consults character values to break a tie: the language driver collates the
 * lowercased text, so "Zebra" is greater than "apple" and "a" is equal to "A".
 *
 * **See also**:
 * {@link User.lstrcmp lstrcmp}
 *
 * @static
 * @function lstrcmpi
 * @memberof User
 *
 * @param {Types.LPCSTR} lpszString1 - The first string.
 * @param {Types.LPCSTR} lpszString2 - The second string.
 *
 * @return {Types.INT} Less than zero if `lpszString1` is less than
 *                     `lpszString2`, greater than zero if it is greater, and
 *                     zero if the two are equal.
 */
export function lstrcmpi(lpszString1, lpszString2) {
  // TODO: how does a DBCS string work

  const left = String(lpszString1).toLowerCase();
  const right = String(lpszString2).toLowerCase();

  const max = Math.max(left.length, right.length);

  for (let i = 0; i < max; i++) {
    const a = left.charCodeAt(i) || 0;
    const b = right.charCodeAt(i) || 0;

    if (a != b) {
      return a - b;
    }
  }

  return 0;
}
