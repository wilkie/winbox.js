'use strict';

/**
 * The **OutputDebugString** function displays the specified character string
 * on the debugging terminal if a debugger is running.
 *
 * This function preserves all registers.
 *
 * This function does not return a value.
 *
 * **See also**:
 * {@link Kernel.DebugOutput DebugOutput}
 *
 * @static
 * @function OutputDebugString
 * @memberof Kernel
 *
 * @param {string} lpszOutputString - The string to be displayed.
 */
export function OutputDebugString(lpszOutputString) {
  console.log(lpszOutputString.toString());
}
