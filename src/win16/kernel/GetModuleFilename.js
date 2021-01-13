"use strict";

import { lstrcpy } from './lstrcpy.js';

/**
 * The **GetModuleFilename** function returns a far pointer to the environment
 * string of the current (running) task.
 *
 * Unlike an application, a dynamic-link library (DLL) does not have a copy of
 * the environment string. As a result, the library must call this function to
 * retrieve the environment string.
 *
 * @static
 * @function GetModuleFilename
 * @memberof Kernel
 *
 * @returns {Types.FARPTR} The return value is a far pointer to the current
 *                         environment string.
 */
export function GetModuleFilename(hinst, lpszFilename, cbFileName) {
    let taskHandle = this.scheduler.active;
    let task = this.handles.resolve(taskHandle);
    let executable = task.executable;
    let filename = executable.path;

    let cpu = this.machine.cpu.core;

    let destSegment = (lpszFilename >> 16) & 0xffff;
    let destOffset = lpszFilename & 0xffff;

    if (cbFileName == 0) {
        // Do nothing, I guess
        return 0;
    }

    let count = 0;
    for (let i = 0; i < filename.length && i < cbFileName - 1; i++) {
        let data = filename.charCodeAt(i);
        cpu.write8(destSegment, destOffset, data);
        destOffset++;
        count++;
    }

    // Write null-terminator
    cpu.write8(destSegment, destOffset, 0x0);
    console.log(filename, count);

    return count;
}
