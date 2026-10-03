'use strict';

import { clockOf } from '../../emulator/clock.js';

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
export function GetTickCount(this: any) {
  return tickCount(clockOf(this).now());
}

/**
 * The milliseconds of a timer tick: the 8253's 1,193,180 Hz divided by
 * 65,536, as Windows counts them.
 */
const TICK = (65536 * 1000) / 1193180;

/**
 * Milliseconds as `GetTickCount` answers them: by the timer's tick, 18.2 a
 * second, not by the millisecond. `tickstep` records Windows' answers
 * stepping 55 at a time, and 54 every thirteenth or fourteenth -- whole
 * ticks of 54.9254 ms, rounded down -- nineteen different answers a second.
 * SimTower polls it some fourteen times a message and paces itself by it.
 */
export function tickCount(ms: number) {
  return Math.floor(Math.floor(ms / TICK) * TICK) >>> 0;
}
