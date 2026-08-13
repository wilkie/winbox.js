'use strict';

import { TRUE, FALSE } from '../consts.js';

import { User } from '../user.js';

/**
 * The **TranslateAccelerator** function processes accelerator keys for menu
 * commands. The function translates `WM_KEYUP` and `WM_KEYDOWN` messages to
 * `WM_COMMAND` or `WM_SYSCOMMAND` messages if there is an entry for the
 * accelerator key in the application's accelerator table.
 *
 * The high-order word of the lParam parameter of the `WM_COMMAND` or
 * `WM_SYSCOMMAND` message contains the value 1, to differentiate the message
 * from messages sent by menus or controls.
 *
 * `WM_COMMAND` or `WM_SYSCOMMAND` messages are sent directly to the window,
 * rather than being posted to the application queue. The
 * **TranslateAccelerator** function does not return until the message is
 * processed.
 *
 * Accelerator keystrokes that are defined to select items from the System menu
 * are translated into `WM_SYSCOMMAND` messages; all other accelerator
 * keystrokes are translated into `WM_COMMAND` messages.
 *
 * When **TranslateAccelerator** returns a nonzero value (meaning that the
 * message is translated), the application should not process the message again
 * by using the {@link User.TranslateMessage TranslateMessage} function.
 *
 * Keystrokes in accelerator tables need not correspond to menu items.
 *
 * If the accelerator keystroke does correspond to a menu item, the application
 * is sent `WM_INITMENU` and `WM_INITMENUPOPUP` messages, just as if the user
 * were trying to display the menu. However, these messages are not sent if any
 * of the following conditions are present:
 *
 * * The window is disabled.
 * * The menu item is disabled.
 * * The accelerator keystroke does not correspond to an item on the System menu and the window is minimized.
 * * A mouse capture is in effect (for more information, see the description of the SetCapture function).
 *
 * If the window is the active window and there is no keyboard focus (generally
 * the case if the window is minimized), `WM_SYSKEYUP` and `WM_SYSKEYDOWN`
 * messages are translated instead of `WM_KEYUP` and `WM_KEYDOWN` messages.
 *
 * If an accelerator keystroke that corresponds to a menu item occurs when the
 * window that owns the menu is minimized, no `WM_COMMAND` message is sent.
 * However, if an accelerator keystroke that does not match any of the items on
 * the window's menu or the System menu occurs, a `WM_COMMAND` message is sent,
 * even if the window is minimized.
 *
 * **See also**:
 * {@link User.PeekMessage PeekMessage}
 * {@link User.GetMessage GetMessage}
 * {@link User.TranslateMessage TranslateMessage}
 *
 * @static
 * @function TranslateAccelerator
 * @memberof User
 *
 * @param {Types.HWND} hwnd - Identifies the window whose messages are to be
 *                            translated.
 * @param {Types.HACCEL} haccl - Identifies the accelerator table (loaded by
 *                               using the
 *                               {@link User.LoadAccelerators LoadAccelerators}
 *                               function).
 * @param {Types.MSG} lpmsg - Points to an MSG structure retrieved by a call to
 *                            the {@link User.GetMessage GetMessage} or
 *                            {@link User.PeekMessage PeekMessage} function.
 *                            The structure contains message information from
 *                            the application's message queue.
 *
 * @return {Types.BOOL} The return value is nonzero if the message is
 *                      translated. Otherwise, it is zero.
 */
export function TranslateAccelerator(hwnd, haccl, lpmsg) {
  if (
    lpmsg.message === User.WM_KEYDOWN ||
    lpmsg.message === User.WM_KEYUP ||
    lpmsg.message === User.WM_SYSKEYUP ||
    lpmsg.message === User.WM_SYSKEYUP
  ) {
    // TODO: Potentially issue a WM_COMMAND message
  }

  // If that is not a key event message, return FALSE.
  return FALSE;
}
