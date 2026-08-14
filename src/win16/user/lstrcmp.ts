'use strict';

/**
 * The **lstrcmp** function compares two character strings. The comparison is
 * case-sensitive.
 *
 * The **lstrcmp** function compares two strings by checking the first
 * characters against each other, the second characters against each other, and
 * so on, until it finds an inequality or reaches the ends of the strings. The
 * function returns the difference of the values of the first unequal characters
 * it encounters. For example, **lstrcmp** determines that "abcz" is greater
 * than "abcdefg" and returns the difference of "z" and "d".
 *
 * The language driver for the language selected by the user determines which
 * string is greater (or whether the strings are the same). If no language
 * driver is selected, the system uses an internal function. With the system's
 * United States language functions, uppercase characters have lower values than
 * lowercase characters.
 *
 * With a double-byte character set (DBCS) version of the system, this function
 * can compare two DBCS strings.
 *
 * Both strings must be less than 64K in size.
 *
 * **See also**:
 * {@link Kernel.lstrcpy lstrcpy}
 * {@link User.lstrcmpi lstrcmpi}
 *
 * @static
 * @function lstrcmp
 * @memberof User
 *
 * @param {Types.LPCSTR} lpszString1 - Points to the first null-terminated
 *                                     string to be compared.
 * @param {Types.LPCSTR} lpszString2 - Points to the second null-terminated
 *                                     string to be compared.
 *
 * @returns {Types.INT} The return value is less than zero if the string
 *                      specified in `lpszString1` is less than the string
 *                      specified in `lpszString2`, is greater than zero if
 *                      `lpszString1` is greater than `lpszString2` and is zero
 *                      if the two strings are equal.
 */
export function lstrcmp(lpszString1, lpszString2) {
  // TODO: how does a DBCS string work

  /* This is not `strcmp`, and the difference is visible in the very first
   * string that mixes cases. The recorded answers say `lstrcmp("Zebra",
   * "apple")` is positive, where comparing bytes makes it negative because 'Z'
   * is 0x5A against 'a' at 0x61.
   *
   * What the US language driver does is collate on the lowercased text and
   * fall back to the byte values only to break a tie, which is why "a" is
   * greater than "A" but "_" is still less than "a". Folding the other way --
   * to uppercase -- gets that second case backwards, since '_' at 0x5F sits
   * above 'A' at 0x41 and below 'a'.
   *
   * See oracle/fixtures/strings.json, which is where these answers come from.
   */
  const left = String(lpszString1);
  const right = String(lpszString2);

  const collated = compareBytes(left.toLowerCase(), right.toLowerCase());

  return collated === 0 ? compareBytes(left, right) : collated;
}

/**
 * Compares two strings by character value, shorter sorting first.
 *
 * @returns {number} Negative, zero or positive, as `lstrcmp` reports.
 */
function compareBytes(left, right) {
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
