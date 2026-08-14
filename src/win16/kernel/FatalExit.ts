'use strict';

/**
 * The **FatalExit** function sends the current state of the operating system
 * to the debugger and prompts for instructions on how to proceed.
 *
 * An application should call this function for debugging purposes only; it
 * should not call the function in a retail version of the application. Calling
 * this function in the retail version will terminate the application.
 *
 * **See also**:
 * {@link Kernel.FatalAppExit FatalAppExit}
 *
 * @static
 * @function FatalExit
 * @memberof Kernel
 *
 * @param {Types.INT} nErrCode - Specifies the error value to be displayed.
 */
export function FatalExit(nErrCode) {
  this.debug('FatalExit:', nErrCode);

  // TODO: spawn a message box and pause the application until it closes.
  this.halt();
}
