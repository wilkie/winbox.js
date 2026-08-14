'use strict';

/**
 * The **EndDialog** function hides a modal dialog box and causes the
 * {@link User.DialogBox DialogBox} function to return.
 *
 * The **EndDialog** function is required to complete processing of a modal
 * dialog box created by the {@link User.DialogBox DialogBox} function. An
 * application calls **EndDialog** from within the dialog box procedure.
 *
 * A dialog box procedure can call **EndDialog** at any time, even during the
 * processing of the `WM_INITDIALOG` message. If the function is called while
 * `WM_INITDIALOG` is being processed, the dialog box is hidden before it is
 * shown and before the input focus is set.
 *
 * **EndDialog** does not destroy the dialog box immediately. Instead, it sets a
 * flag that directs the system to destroy the dialog box when the
 * {@link User.DialogBox DialogBox} function returns.
 *
 * **See also**:
 * {@link User.DialogBox DialogBox}
 *
 * @static
 * @function EndDialog
 * @memberof User
 *
 * @param {Types.HWND} hwndDlg - Identifies the dialog box to be destroyed.
 * @param {Types.INT} nResult - Specifies the value that is returned to the
 *                              caller of {@link User.DialogBox DialogBox}.
 */
export function EndDialog(hwndDlg, nResult) {
  // Resolve the dialog
  const dialog = this.handles.resolve(hwndDlg);

  this.debug('ok hello', hwndDlg, dialog);

  // Bail if the dialog is invalid
  if (!dialog) {
    return;
  }

  // Bail if the dialog has no resolve callback
  if (!dialog.data.resolve) {
    return;
  }

  // Resolve the dialog (and resume execution from DialogBox)
  dialog.data.resolve(nResult);
}
