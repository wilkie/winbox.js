'use strict';

import { GetDlgItem } from './GetDlgItem.js';
import { SendMessage } from './SendMessage.js';

/**
 * The **SendDlgItemMessage** function sends a message to a dialog box's
 * control, found by its identifier as {@link User.GetDlgItem GetDlgItem}
 * finds it, and returns what the control's window procedure returns.
 *
 * @param {Types.HWND} hwndDlg - The parent window.
 * @param {Types.INT} idDlgItem - The control's identifier.
 * @param {Types.UINT} uMsg - The message.
 * @param {Types.WPARAM} wParam - Its first parameter.
 * @param {Types.LPARAM} lParam - Its second.
 *
 * @returns {Types.LRESULT} What the control answered, or 0 for no control.
 */
export async function SendDlgItemMessage(hwndDlg, idDlgItem, uMsg, wParam, lParam) {
  const hwnd = GetDlgItem.call(this, hwndDlg, idDlgItem);

  if (!hwnd) {
    return 0;
  }

  return SendMessage.call(this, hwnd, uMsg, wParam, lParam);
}
