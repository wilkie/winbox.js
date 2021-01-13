"use strict";

/**
 * The **GetTickCount** function retrieves the number of milliseconds that have
 * elapsed since the system was started.
 *
 * The internal timer will wrap around to zero if the system is run continuously
 * for approximately 49 days.
 *
 * The **GetTickCount** function is identical to the {@link User.GetCurrentTime
 * GetCurrenTime} function. Applications should use **GetTickCount**, because
 * its name matches more closely with what the function does.
 *
 * @static
 * @function GetTickCount
 * @memberof User
 *
 * @returns {Types.DWORD} The return value specifies the number of milliseconds
 *                        that have elapsed since the system was started.
 */
export function GetTickCount() {
    let ret = (new Date).getTime() - this.startTime;
    return ret;
}
