/**
 * The **InitTask** function initializes the task by setting registers,
 * setting up the command line, and initializing the heap. This must be the
 * first function called by the startup routine for the application.
 *
 * When the function is successful, other registers contain the following
 * values:
 *
 * | Register | Value |
 * |:---------|:------|
 * | CX       | Contains the stack limit in bytes. The startup routines should check the limit to ensure there is a minimum of 100 bytes in the stack. |
 * | DI       | Contains the instance handle for the new task. The startup routine passes this address to the WinMain function. |
 * | DX       | Contains an `nCmdShow` parameter. The startup routine passes this parameter to the WinMain function for use with the CreateWindow function. |
 * | ES       | Contains the segment address of the program segment prefix (PSP) for the new task. |
 * | ES:BX    | Contains the 32-bit address of the command line (MS-DOS format). The startup routine passes this address to the WinMain function. |
 * | SI       | Contains the instance handle for the previous instance of the application, if any. The startup routine passes this address to the WinMain function. |
 *
 * The **InitTask** function also copies the top, minimum, and bottom address
 * offsets of the stack to the 16 bytes of reserved memory at the beginning of
 * the automatic data segment for the application. The reserved memory has the
 * following format:
 *
 * ```
 *            DW  0
 *    globalW oOldSP,0
 *    globalW hOldSS,5
 *    globalW pLocalHeap,0
 *    globalW pStackTop,0
 *    globalW pStackMin,0
 *    globalW pStackBot,0
 * ```
 *
 * @static
 * @function InitTask
 * @memberof Kernel
 *
 * @returns {number} This function returns 1 in the `AX` register and fills
 *                   the `CX`, `DX`, `ES`, `BX`, `SI`, and `DI` registers with
 *                   information about the new task, if the function is
 *                   successful. Otherwise, it returns zero in the `AX` register
 *                   to indicate an error.
 */
export function InitTask() {
    return this.initTask();
}
