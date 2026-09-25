'use strict';

import { copyOut, copyOutList, readProfile, writtenValue } from './profiles.js';

/**
 * The **GetPrivateProfileString** function retrieves a character string from
 * the specified section in the specified initalization file.
 *
 * The function searches the file for an entry that matches the name specified
 * by the `lpszEntry` parameter under the section heading specified by the
 * `lpszSection` parameter. If the entry is found, its corresponding string is
 * copied to the buffer. If the entry does not exist, the default character
 * string specified by the `lpszDefault` parameter is copied. A string entry in
 * the initialization file must have the following form:
 *
 *   [ section ]
 *   entry = string
 *
 * If `lpszEntry` is `NULL`, the **GetPrivateProfileString** function copies all
 * entries in the specified section to the supplied buffer. Each string will be
 * null-terminated, with the final string ending with two zero-termination
 * characters. If the supplied destination buffer is too small to hold all the
 * strings, the last string will be truncated and followed with two
 * zero-termination characters.
 *
 * If the string associated with `lpszEntry` is enclosed in single or double
 * quotation marks, the marks are discarded when **GetPrivateProfileString**
 * returns the string.
 *
 * **GetPrivateProfileString** is not case-dependent, so the strings in
 * `lpszSection` and `lpszEntry` may contain a combination of uppercase and
 * lowercase letters.
 *
 * An application can use the {@link Kernel.GetProfileString GetProfileString}
 * function to retrieve a string from the `WIN.INI` file.
 *
 * The `lpszDefault` parameter must point to a valid string, even if the string
 * is empty (its first character is zero).
 *
 * **See also**:
 * {@link Kernel.GetProfileString GetProfileString}
 * {@link Kernel.WritePrivateProfileString WritePrivateProfileString}
 *
 * @static
 * @function GetPrivateProfileString
 * @memberof Kernel
 *
 * @param {Types.LPCSTR} lpszSection - Points to a null-terminated string that
 *                                     specifies the section containing the
 *                                     entry.
 * @param {Types.LPCSTR} lpszEntry - Points to a null-terminated string
 *                                   containing the entry whose associated
 *                                   string is to be retrieved. If this value
 *                                   is `NULL`, all entries in the section
 *                                   specified by the `lpszSection` parameter
 *                                   are copied to the buffer specified by the
 *                                   `lpszReturnBuffer` parameter.
 * @param {Types.LPCSTR} lpszDefault - Points to a null-terminated string that
 *                                     specifies the default value for the given
 *                                     entry if the entry cannot be found in the
 *                                     initialization file. This parameter must
 *                                     never be `NULL`.
 * @param {Types.LPSTR} lpszReturnBuffer - Points to the buffer that receives
 *                                         the character string.
 * @param {Types.INT} cbReturnBuffer - Specifies the size in bytes of the buffer
 *                                     pointed to by the `lpszReturnBuffer`
 *                                     parameter.
 * @param {Types.LPCSTR} lpszFilename - Points to a null-terminated string that
 *                                      names the initialization file. If this
 *                                      parameter does not contain a full path,
 *                                      the system searches for the file in a
 *                                      system directory.
 *
 * @returns {Types.INT} The return value specifies the number of bytes copied
 *                      to the specified buffer, not including the terminating
 *                      null character.
 */
export async function GetPrivateProfileString(
  lpszSection,
  lpszEntry,
  lpszDefault,
  lpszReturnBuffer,
  cbReturnBuffer,
  lpszFilename
) {
  const profile = await readProfile(this, lpszFilename);

  /* No entry named means the program wants the section's contents rather than
   * one value out of it -- how `[fonts]` and `[ports]` get enumerated.
   */
  if (lpszEntry === null) {
    const names = profile.entries(String(lpszSection));

    this.debug('GetPrivateProfileString', String(lpszSection), names);

    return copyOutList(this, lpszReturnBuffer, names, cbReturnBuffer);
  }

  /* A value this program wrote since the file was last flushed comes back as
   * it was written, not as the file would parse; see `writtenValue`.
   */
  const found =
    writtenValue(this, String(lpszFilename), String(lpszSection), String(lpszEntry)) ??
    profile.get(String(lpszSection), String(lpszEntry));

  /* The default is copied verbatim when the entry is missing, and a null
   * default is documented as not allowed -- but a program that passes one
   * should get an empty string rather than the word "null".
   */
  const value = found === null ? (lpszDefault === null ? '' : String(lpszDefault)) : found;

  this.debug('GetPrivateProfileString', String(lpszSection), String(lpszEntry), value);

  return copyOut(this, lpszReturnBuffer, value, cbReturnBuffer);
}
