'use strict';

import { NULL, TRUE, FALSE } from '../consts.js';

/**
 * The **WritePrivateProfileString** function copies a character string into the
 * specified section of the specified initialization file.
 *
 * To improve performance, the system keeps a cached version of the
 * most-recently accessed initialization file. If that filename is specified and
 * the other three parameters are `NULL`, the system flushes the cache.
 *
 * Sections in the initialization file have the following form:
 *
 *   [ section ]
 *   entry = string
 *
 * If `lpszFilename` does not contain a fully qualified path and filename for
 * the file, **WritePrivateProfileString** searches the system directory for the
 * file. If the file does not exist, this function creates the file in the
 * system directory.
 *
 * If `lpszFilename` contains a fully qualified path and filename and the file
 * does not exist, this function creates the file. The specified directory must
 * already exist.
 *
 * An application should use a private (application-specific) initialization
 * file to record information that affects only that application. This improves
 * the performance of both the application and the system itself by reducing the
 * amount of information that the system must read when it accesses the
 * initialization file. The exception to this is that device drivers should use
 * the `SYSTEM.INI` file, to reduce the number of initialization files the
 * system must open and read during the startup process.
 *
 * An application can use the
 * {@link Kernel.WriteProfileString WriteProfileString} function to add a string
 * to the `WIN.INI` file.
 *
 * **See also**:
 * {@link Kernel.GetPrivateProfileString GetPrivateProfileString}
 * {@link Kernel.WriteProfileString WriteProfileString}
 *
 * @static
 * @function WritePrivateProfileString
 * @memberof Kernel
 *
 * @param {Types.LPCSTR} lpszSection - Points to a null-terminated string that
 *                                     specifies the section to which the string
 *                                     will be copied. If the section does not
 *                                     exist, it is created. The name of the
 *                                     section is case-independent; the string
 *                                     may be any combination of uppercase and
 *                                     lowercase letters.
 * @param {Types.LPCSTR} lpszEntry - Points to a null-terminated string
 *                                   containing the entry to be associated with
 *                                   the string. If the entry does not exist in
 *                                   the specified section, it is created. If
 *                                   this parameter is `NULL`, the entire
 *                                   section, including all entries with the
 *                                   section, is deleted.
 * @param {Types.LPCSTR} lpszString - Points to a null-terminated string to be
 *                                    written to the file. If this parameter is
 *                                    `NULL`, the entry specified by the
 *                                    `lpszEntry` parameter is deleted.
 * @param {Types.LPCSTR} lpszFilename - Points to a null-terminated string that
 *                                      names the initialization file.
 *
 * @returns {Types.BOOL} The return value is nonzero if the function is
 *                       successful. Otherwise it is zero.
 */
export function WritePrivateProfileString(lpszSection, lpszEntry, lpszString, lpszFilename) {
  // Open the file
  const handle = this.dos.files.open(lpszFilename);
  const file = this.dos.files.resolve(handle);
  console.log(file);

  const ret = null;

  if (file) {
    // Read INI data from file
    // Find the section
    // Find the entry
    // Write the value
  }

  if (handle) {
    this.dos.files.close(handle);
  }

  return TRUE;
}
