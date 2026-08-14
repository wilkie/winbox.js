'use strict';

import { GetPrivateProfileInt } from './GetPrivateProfileInt.js';
import { WINDOWS_PROFILE } from './profiles.js';

/**
 * The **GetProfileInt** function retrieves the value of an integer key from
 * the `WIN.INI` initialization file.
 *
 * It is {@link Kernel.GetPrivateProfileInt GetPrivateProfileInt} against
 * `WIN.INI`, and reads its digits the same way.
 *
 * **See also**:
 * {@link Kernel.GetPrivateProfileInt GetPrivateProfileInt}
 * {@link Kernel.GetProfileString GetProfileString}
 *
 * @static
 * @function GetProfileInt
 * @memberof Kernel
 *
 * @param {Types.LPCSTR} lpszSection - Points to a null-terminated string that
 *                                     specifies the section containing the
 *                                     entry.
 * @param {Types.LPCSTR} lpszEntry - Points to the entry whose value is to be
 *                                   retrieved.
 * @param {Types.INT} nDefault - Specifies the default value to return if the
 *                               entry cannot be found.
 *
 * @returns {Types.UINT} The return value is the integer value of the entry, or
 *                       *`nDefault`* if the entry is not found.
 */
export async function GetProfileInt(lpszSection, lpszEntry, nDefault) {
  return await GetPrivateProfileInt.bind(this)(lpszSection, lpszEntry, nDefault, WINDOWS_PROFILE);
}
