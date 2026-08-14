'use strict';

import { GetPrivateProfileString } from './GetPrivateProfileString.js';
import { WINDOWS_PROFILE } from './profiles.js';

/**
 * The **GetProfileString** function retrieves a character string from the
 * `WIN.INI` initialization file.
 *
 * It is {@link Kernel.GetPrivateProfileString GetPrivateProfileString} against
 * `WIN.INI`, and that is not merely how it is implemented here -- it is what
 * the function is. `WIN.INI` is where Windows keeps what it knows about the
 * machine it is running on, so the answers matter well beyond the program that
 * asked: the `[intl]` section is how a program learns that noon is written
 * "PM", `[fonts]` is the installed typefaces, and `[FontSubstitutes]` is why
 * asking for Helv draws MS Sans Serif.
 *
 * **See also**:
 * {@link Kernel.GetPrivateProfileString GetPrivateProfileString}
 * {@link Kernel.GetProfileInt GetProfileInt}
 * {@link Kernel.WriteProfileString WriteProfileString}
 *
 * @static
 * @function GetProfileString
 * @memberof Kernel
 *
 * @param {Types.LPCSTR} lpszSection - Points to a null-terminated string that
 *                                     specifies the section containing the
 *                                     entry.
 * @param {Types.LPCSTR} lpszEntry - Points to the entry whose associated string
 *                                   is to be retrieved. If this value is
 *                                   `NULL`, all entries in the section are
 *                                   copied to the buffer.
 * @param {Types.LPCSTR} lpszDefault - Points to the default value for the given
 *                                     entry if the entry cannot be found.
 * @param {Types.LPSTR} lpszReturnBuffer - Points to the buffer that receives
 *                                         the character string.
 * @param {Types.INT} cbReturnBuffer - Specifies the size in bytes of the
 *                                     buffer.
 *
 * @returns {Types.INT} The return value specifies the number of bytes copied
 *                      to the specified buffer, not including the terminating
 *                      null character.
 */
export async function GetProfileString(
  lpszSection,
  lpszEntry,
  lpszDefault,
  lpszReturnBuffer,
  cbReturnBuffer
) {
  return await GetPrivateProfileString.bind(this)(
    lpszSection,
    lpszEntry,
    lpszDefault,
    lpszReturnBuffer,
    cbReturnBuffer,
    WINDOWS_PROFILE
  );
}
