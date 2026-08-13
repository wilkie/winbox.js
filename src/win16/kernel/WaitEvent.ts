'use strict';

/**
 * The **WaitEvent** function checks for a posted event and, if one is found,
 * clears the event and returns control to the application. If no event if
 * found, the function suspends execution of the application by calling the
 * system scheduler.
 *
 * @static
 * @function WaitEvent
 * @memberof Kernel
 *
 * @param {Types.HANDLE} taskID - Identifies the task to check events for. If
 *                                this parameter is zero, the function checks
 *                                events for the current task.
 *
 * @return {Types.BOOL} Returns a nonzero value if the scheduler has scheduled
 *                      another application. Otherwise, it returns zero.
 */
export function WaitEvent(taskID) {
  // We do nothing... and just return a zero.
  return 0;
}
