'use strict';

import { FatalAppExit } from './FatalAppExit.js';

/** KERNEL's text for it (data `09d5`). */
const ABNORMAL = 'Application requested abnormal termination';

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
 * **Read out** of the retail `KRNL386.EXE` (seg1 `93ce`-`93e4`):
 * `FatalAppExit(0, "Application requested abnormal termination")`, the
 * code shown nowhere. The procedure `FatalExitHook` sets is kept (the
 * double word at 304h of KERNEL's data, seg1 `9edb`-`9ee2`) and read by
 * nothing else in the retail build: it is not called.
 *
 * @param {Types.INT} nErrCode - Specifies the error value to be displayed.
 */
export async function FatalExit(this: any, nErrCode: number) {
  void nErrCode;
  await FatalAppExit.call(this, 0, ABNORMAL);
}
