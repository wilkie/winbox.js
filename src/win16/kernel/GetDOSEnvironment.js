"use strict";

/**
 * The **GetDOSEnvironment** function returns a far pointer to the environment
 * string of the current (running) task.
 *
 * Unlike an application, a dynamic-link library (DLL) does not have a copy of
 * the environment string. As a result, the library must call this function to
 * retrieve the environment string.
 *
 * @static
 * @function GetDOSEnvironment
 * @memberof Kernel
 *
 * @returns {Types.FARPTR} The return value is a far pointer to the current
 *                         environment string.
 */
export function GetDOSEnvironment() {
    let taskHandle = this.scheduler.active;
    let task = this.handles.resolve(taskHandle);

    return (((task.environmentSegment << 3) | 0x3) << 16);
}
