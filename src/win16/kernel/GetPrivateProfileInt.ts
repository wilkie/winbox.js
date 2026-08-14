'use strict';

import { readProfile, toInteger } from './profiles.js';

/**
 * The **GetPrivateProfileInt** function retrieves the value of an integer key
 * from the specified initialization file.
 *
 * The conversion is not `atoi`. Windows reads digits from the start of the
 * value and stops at the first character that is not one, so `40two` is 40. It
 * reads no sign, so a value written as `-1` is not 65535 but zero. And a value
 * that does not begin with a digit at all gives zero rather than the default:
 * the default is what an entry that is *absent* returns, which is a different
 * thing from an entry that is present and unreadable.
 *
 * **See also**:
 * {@link Kernel.GetPrivateProfileString GetPrivateProfileString}
 * {@link Kernel.GetProfileInt GetProfileInt}
 *
 * @static
 * @function GetPrivateProfileInt
 * @memberof Kernel
 *
 * @param {Types.LPCSTR} lpszSection - Points to a null-terminated string that
 *                                     specifies the section containing the
 *                                     entry.
 * @param {Types.LPCSTR} lpszEntry - Points to the entry whose value is to be
 *                                   retrieved.
 * @param {Types.INT} nDefault - Specifies the default value to return if the
 *                               entry cannot be found.
 * @param {Types.LPCSTR} lpszFilename - Points to the name of the initialization
 *                                      file.
 *
 * @returns {Types.UINT} The return value is the integer value of the entry, or
 *                       *`nDefault`* if the entry is not found.
 */
export async function GetPrivateProfileInt(lpszSection, lpszEntry, nDefault, lpszFilename) {
  const profile = await readProfile(this, lpszFilename);

  /* Read without removing quotes: `"7"` is zero here, though the string form
   * of the same entry is `7`. Recorded, not guessed -- see `toInteger`.
   */
  const value = profile.get(String(lpszSection), String(lpszEntry), false);
  const ret = toInteger(value, nDefault);

  this.debug('GetPrivateProfileInt', String(lpszSection), String(lpszEntry), ret);

  return ret;
}
