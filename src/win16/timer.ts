'use strict';

/** @namespace Timer */

import { Module } from './module.js';
import { DWORD, LPARAM, LRESULT, UINT } from './types.js';

/**
 * The timer driver, `TIMER.DRV`, kept by winbox.js itself: MMSYSTEM opens it
 * as it loads, as `timer`, and it stands in USER's list of installable
 * drivers under that name and its file's.
 *
 * On Windows it drives the hardware timer MMSYSTEM's timer services run on.
 * winbox.js's MMSYSTEM keeps its own time, so here the driver answers USER's
 * messages and drives nothing.
 *
 * @memberof Win16
 */
export class Timer extends Module {
  static get name(): string {
    return 'TIMER';
  }

  static get path() {
    return 'C:\\WINDOWS\\SYSTEM\\TIMER.DRV';
  }

  static get exports() {
    const exports: any[] = [];

    exports[1] = [() => 1, 'WEP', 2, [UINT], UINT];
    exports[2] = [DriverProc, 'DriverProc', 16, [DWORD, UINT, UINT, LPARAM, LPARAM], LRESULT];

    return exports;
  }
}

/**
 * What the timer driver answers. **Read out** of `TIMER.DRV`'s `DriverProc`:
 * `DRV_LOAD`, `DRV_OPEN` and `DRV_CLOSE` 1, `DRV_INSTALL` 2, and nought for
 * `DRV_FREE`, `DRV_CONFIGURE`, `DRV_QUERYCONFIGURE`, `DRV_REMOVE` and the
 * rest. `DRV_ENABLE` and `DRV_DISABLE` hook and unhook the hardware timer,
 * which here there is none of; what they answer was not read, and USER does
 * not look -- 1 here.
 *
 * Not followed: its own messages, 800h to 814h, which MMSYSTEM's timer
 * services send it on Windows and winbox.js's do not.
 */
export function DriverProc(
  this: any,
  _dwDriverIdentifier: number,
  _hDriver: number,
  wMessage: number,
  _lParam1: number,
  _lParam2: number
) {
  switch (wMessage) {
    case 1:
    case 2:
    case 3:
    case 4:
    case 5:
      return 1;

    case 9:
      return 2;

    default:
      return 0;
  }
}
