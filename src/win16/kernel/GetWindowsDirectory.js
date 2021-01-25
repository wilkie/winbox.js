"use strict";

import { lstrcpy } from './lstrcpy.js';

/**
 * The **GetWindowsDirectory** function retrieves the path of the system
 * directory. The system directory contains such files as system applications,
 * initization files, and help files.
 *
 * The system directory is the only directory where an application should create
 * files. If the user is running a shared version of the system, the system
 * directory is the only directory guaranteed private to the user. 
 *
 * The path this function retrieves does not end with a backslash unless the
 * system directory is the root directory. For example, if the system directory
 * is named `WINDOWS` on drive C, the path retrieved by this function is
 * `C:\WINDOWS`. If the system is installed in the root directory of drive C,
 * the path retrieved is `C:\`. 
 *
 * A similar function, {@link Kernel.GetWindowsDir GetWindowsDir}, is intended
 * for use by MS-DOS applications that set up applications. Such applications
 * should use **GetWindowsDirectory**, not **GetWindowsDir**. 
 *
 * @static
 * @function GetWindowsDirectory
 * @memberof Kernel
 *
 * @param {Types.LPSTR} lpszSysPath - Points to the buffer that will receive the
 *                                    null-terminated string containing the
 *                                    path.
 * @param {Types.UINT} cbSysPath - Specifies the maximum size, in bytes, of the
 *                                 buffer. This value should be set to at least
 *                                 `144` to allow sufficient room in the buffer
 *                                 for the path.
 *
 * @returns {Types.UINT} The return value is the length, in bytes, of the
 *                       string copied to the `lpszSysPath` parameter, not
 *                       including the terminating null character. If the return
 *                       value is greater than the number specified in the
 *                       `cbSysPath` parameter, it is the size of the buffer
 *                       required to hold the path. The return value is zero
 *                       if the function fails.
 */
export function GetWindowsDirectory(lpszSysPath, cbSysPath) {
    let destSegment = (lpszSysPath >> 16) & 0xffff;
    let destOffset = lpszSysPath & 0xffff;

    let path = "C:\\WINDOWS";

    if (cbSysPath == 0) {
        // Do nothing, I guess, and return the required buffer size.
        return path.length;
    }

    let cpu = this.machine.cpu.core;
    let count = 0;
    for (let i = 0; i < path.length && i < cbSysPath - 1; i++) {
        let data = path.charCodeAt(i);
        cpu.write8(destSegment, destOffset, data);
        destOffset++;
        count++;
    }

    // Write null-terminator
    cpu.write8(destSegment, destOffset, 0x0);
    return path.length;
}
