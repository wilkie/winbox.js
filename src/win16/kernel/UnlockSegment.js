"use strict";

/**
 * The **UnlockSegment** function unlocks the specified discardable memory
 * segment. The function decrements (decreases by one) the segment's lock count.
 * The segment is completely unlocked and subject to discarding when the lock
 * count reaches zero.
 *
 * An application should not rely on the return value to determine the number
 * of times it must subsequently call **UnlockSegment** for the segment.
 *
 * Other functions also can affect the lock count of a memory object. For a list
 * of these functions, see the description of the
 * {@link Kernel.GlobalFlags GlobalFlags} function.
 *
 * Each time an application calls {@link Kernel.LockSegment LockSegment} for a
 * segment, it must eventually call **UnlockSegment** for the segment.
 *
 * **See also**:
 * {@link Kernel.GlobalFlags GlobalFlags}
 * {@link Kernel.UnlockData UnlockData}
 * {@link Kernel.LockSegment LockSegment}
 *
 * @static
 * @function UnlockSegment
 * @memberof Kernel
 *
 * @param {Types.UINT} uSegment - Specifies the segment address of the segment
 *                                to be unlocked. If this parameter is -1, the
 *                                **UnlockSegment** function unlocks the current
 *                                data segment.
 *
 * @returns {Types.HGLOBAL} The return value is the lock count for the segment,
 *                          if the function is successful. This function returns
 *                          its result in the `CX` register. When the `CX`
 *                          register contains zero, the segment is completely
 *                          unlocked.
 *
 *                          The normal return value should be ignored because
 *                          the return value can be checked only in the machine
 *                          code.
 */
export function UnlockSegment(uSegment) {
    if (uSegment == 0xffff) {
        // We are referring to the task's current data segment
        uSegment = -1;
    }

    // Return the lock count
    this.machine.cpu.core.cx = 0;

    console.log("UnlockSegment:", uSegment);
}
