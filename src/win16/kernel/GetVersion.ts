'use strict';

/**
 * The **GetVersion** function retrieves the current version numbers of the
 * emulated Windows and MS-DOS operation systems.
 *
 * The low-order word of the return value contains the emulated version of
 * Windows, if the function is successful. The high-order byte contains the
 * minor version (revision) number as a two-digit decimal number. For example,
 * Windows 3.1, the minor version number is `10`. The low-order byte contains
 * the major version number.
 *
 * The high-order word contains the emulated version of MS-DOS, if the function
 * is successful. The high-order byte contains the major version; the low-order
 * byte contains the minor version (revision) number.
 *
 * The following example uses the **GetVersion** function to display the
 * emulated Windows and MS-DOS version numbers:
 *
 * ```javascript
 * import { GetVersion } from 'win16/kernel/GetVersion.js';
 *
 * import { LOBYTE, LOWORD, HIBYTE, HIWORD } from 'win16/kernel.js';
 *
 * let version = GetVersion();
 * this.debug("Windows version: " +
 *             LOBYTE(LOWORD(version)) + "." +
 *             HIBYTE(LOWORD(version)));
 *
 * this.debug("MS-DOS version: " +
 *             HIBYTE(HIWORD(version)) + "." +
 *             LOBYTE(HIWORD(version)));
 * ```
 *
 * **Note**: The major and minor version information between the Windows and
 * MS-DOS versions are reversed.
 *
 * @static
 * @function GetVersion
 * @memberof Kernel
 *
 * @returns {Types.DWORD} The return value specifies the major and minor version
 *                        numbers of the emulated Windows and MS-DOS systems.
 */
export function GetVersion() {
  // We are emulating windows 3.1 and dos 6.22
  return 0x06160a03;
}
