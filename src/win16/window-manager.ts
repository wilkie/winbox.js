'use strict';

/**
 * What the system keeps about each window beside USER's own record of it:
 * its handle and the task it belongs to.
 */
export class WindowManager {
  declare _handles: any;
  declare _scheduler: any;
  declare _startTime: any;
  constructor(scheduler, handles, startTime) {
    this._scheduler = scheduler;
    this._handles = handles;
    this._startTime = startTime;
  }

  register(taskHandle, task, hWnd, windowInstance) {
    const data = windowInstance.data;
    data.hWnd = hWnd;
    data.hInstance = taskHandle;
    windowInstance.data = data;
  }
}
