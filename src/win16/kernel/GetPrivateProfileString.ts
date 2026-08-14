'use strict';

import { NULL } from '../consts.js';

import { lstrcpy } from './lstrcpy.js';

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
export function GetPrivateProfileString(
  lpszSection,
  lpszEntry,
  lpszDefault,
  lpszReturnBuffer,
  cbReturnBuffer,
  lpszFilename
) {
  // Open the file
  const handle = this.dos.files.open(lpszFilename);
  const file = this.dos.files.resolve(handle);
  this.debug(file);

  const ret = null;

  if (file) {
    // Read INI data from file
    // Find the section
    // Find the entry
    // Read the value
  }

  if (ret === null) {
    // Always return the default, for now.
    // TODO: lstrcpy does not have a bounds
    lstrcpy.bind(this)(lpszReturnBuffer, (lpszDefault.segment << 16) | lpszDefault.offset);
  }

  if (handle) {
    this.dos.files.close(handle);
  }
  return 0;
}
