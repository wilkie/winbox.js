'use strict';

import { WINDOWS_PROFILE } from './profiles.js';
import { WritePrivateProfileString } from './WritePrivateProfileString.js';

/**
 * The **WriteProfileString** function copies a string into the `WIN.INI`
 * initialization file.
 *
 * It is {@link Kernel.WritePrivateProfileString WritePrivateProfileString}
 * against `WIN.INI`.
 *
 * **See also**:
 * {@link Kernel.WritePrivateProfileString WritePrivateProfileString}
 * {@link Kernel.GetProfileString GetProfileString}
 *
 * @static
 * @function WriteProfileString
 * @memberof Kernel
 *
 * @param {Types.LPCSTR} lpszSection - Points to a null-terminated string that
 *                                     specifies the section to write in.
 * @param {Types.LPCSTR} lpszEntry - Points to the entry to write. If this is
 *                                   `NULL`, the entire section is deleted.
 * @param {Types.LPCSTR} lpszString - Points to the string to write. If this is
 *                                    `NULL`, the entry is deleted.
 *
 * @returns {Types.BOOL} The return value is nonzero if the function is
 *                       successful.
 */
export async function WriteProfileString(lpszSection, lpszEntry, lpszString) {
  return await WritePrivateProfileString.bind(this)(
    lpszSection,
    lpszEntry,
    lpszString,
    WINDOWS_PROFILE
  );
}
