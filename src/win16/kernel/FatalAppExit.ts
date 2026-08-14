'use strict';

/**
 * The **FatalAppExit** function displays a message box and terminates the
 * application when the message box is closed. If the user is running the
 * debugging version of the operating system, the message box gives the user
 * the opportunity to terminate the application or to cancel the message box
 * and return to the caller.
 *
 * **See also**:
 * {@link Kernel.FatalExit FatalExit}
 * {@link Kernel.TerminateApp TerminateApp}
 *
 * @static
 * @function FatalAppExit
 * @memberof Kernel
 *
 * @param {Types.UINT} fuAction - Reserved: must be zero.
 * @param {Types.LPCSTR} lpszMessageText - Points to a null-terminated string
 *                                         that is displayed in the message box.
 *                                         The message is displayed on a single
 *                                         line. To accommodate low-resolution
 *                                         screens, the string should contain
 *                                         no more than 35 characters.
 */
export function FatalAppExit(fuAction, lpszMessageText) {
  this.debug('FatalAppExit:', lpszMessageText);
  // TODO: spawn a message box and pause the application until it closes.
}
