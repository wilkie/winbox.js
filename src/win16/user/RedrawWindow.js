"use strict";

import { TRUE, FALSE } from '../consts.js';

import { User, MSG } from '../user.js';

/**
 * The **RedrawWindow** function updates the specified rectangle or region in
 * the given window's client area.
 *
 * When the **RedrawWindow** function is used to invalidate part of the desktop
 * window, the desktop window does not receive a `WM_PAINT` message. To repaint
 * the desktop, an application should use the `RDW_ERASE` flag to generate a
 * `WM_ERASEBKGND` message.
 *
 * **See also**:
 * {@link User.GetUpdateRect GetUpdateRect}
 * {@link User.GetUpdateRgn GetUpdateRgn}
 * {@link User.InvalidateRect InvalidateRect}
 * {@link User.InvalidateRgn InvalidateRgn}
 * {@link User.UpdateWindow UpdateWindow}
 *
 * @static
 * @function RedrawWindow
 * @memberof User
 *
 * @param {Types.HWND} hwnd - Identifies the window to be redrawn. If this
 *                            parameter is `NULL`, the desktop window is
 *                            updated.
 * @param {Types.RECT} lprcUpdate - Points to a RECT structure containing the
 *                                  coordinates of the update rectangle. This
 *                                  parameter is ignored if the *`hrgnUpdate`*
 *                                  parameter contains a valid region handle.
 * @param {Types.HRGN} hrgnUpdate - Identifies the update region. If both
 *                                  *`hrgnUpdate`* and *`lprcUpdate`* parameters
 *                                  are `NULL`, the entire client area is added
 *                                  to the update region.
 * @param {Types.UINT} fuRedraw - Specifies one or more redraw flags. This
 *                                parameter can be a combination of flags:
 *
 * The following flags are used to invalidate the window:
 * * `RDW_ERASE`: Causes the window to receive a `WM_ERASEBKGND` message when
 *                the window is repainted. The `RDW_INVALIDATE` flag must also
 *                be specified; otherwise, `RDW_ERASE` has no effect.
 * * `RDW_FRAME`: Causes any part of the non-client area of the window that
 *                intersects the update region to receive a `WM_NCPAINT`
 *                message. The `RDW_INVALIDATE` flag must also be specified;
 *                otherwise, `RDW_FRAME` has no effect. The `WM_NCPAINT`
 *                message is typically not sent during the execution of the
 *                **RedrawWindow** function unless either `RDW_UPDATENOW` or
 *                `RDW_ERASENOW` is specified.
 * * `RDW_INTERNALPAINT`: Causes a `WM_PAINT` message to be posted to the window
 *                        regardless of whether the window contains an invalid
 *                        region.
 * * `RDW_INVALIDATE`: Invalidate *`lprcUpdate`* or *`hrgnUpdate`* (only one may
 *                     be non-`NULL`). If both are `NULL` the entire window is
 *                     invalidated.
 *
 * The following flags are used to validate the window:
 * * `RDW_NOERASE`: Suppresses any pending `WM_ERASEBKGND` messages.
 * * `RDW_NOFRAME`: Suppresses any pending `WM_NCPAINT` messages. This flag must
 *                  be used with `RDW_VALIDATE` and is typically used with
 *                  `RDW_NOCHILDREN`. This option should be used with care, as
 *                  it could cause parts of a window from painting properly.
 * * `RDW_NOINTERNALPAINT`: Suppresses any pending internal `WM_PAINT` messages.
 *                          This flag does not affect `WM_PAINT` messages
 *                          resulting from invalid areas.
 * * `RDW_VALIDATE`: Validates *`lprcUpdate`* or *`hrgnUpdate`* (only one may
 *                   be non-`NULL`). If both are `NULL` the entire window is
 *                   validated. This flag does not affect internal `WM_PAINT`
 *                   messages.
 *
 * The following flags control when repainting occurs. No painting is performed
 * by the **RedrawWindow** function unless one of these bits is specified.
 * * `RDW_ERASENOW`: Causes the affected windows (as specified by the
 *                   `RDW_ALLCHILDREN` and `RDW_NOCHILDREN` flags) to receive
 *                   `WM_NCPAINT` and `WM_ERASEBKGND` messages, if necessary,
 *                   before the function returns. `WM_PAINT` messages are
 *                   deferred.
 * * `RDW_UPDATENOW`: Causes the affected windows (as specified by the
 *                    `RDW_ALLCHILDREN` and `RDW_NOCHILDREN` flags) to receive
 *                    `WM_NCPAINT`, `WM_ERASEBKGND`, and `WM_PAINT` messages, if
 *                    necessary, before the function returns.
 *
 * By default, the windows affected by the **RedrawWindow** function depend on
 * whether the specified window has the `WS_CLIPCHILDREN` style. The child
 * windows of `WS_CLIPCHILDREN` windows are not affected; however,
 * non-`WS_CLIPCHILDREN` windows are recursively validated or invalidated until
 * a `WS_CLIPCHILDREN` window is encountered. The following flags control which
 * windows are affected by the **RedrawWindow** function:
 * * `RDW_ALLCHILDREN`: Includes child windows, if any, in the repainting
 *                      operation.
 * * `RDW_NOCHILDREN`: Excludes child windows, if any, from the repainting
 *                     operation.
 *
 * @return {Types.BOOL} The return value is nonzero if the function is
 *                      successful. Otherwise, it is zero.
 */
export function RedrawWindow(hwnd, lprcUpdate, hrgnUpdate, fuRedraw) {
    let dialog = this.handles.resolve(hwnd);

    if (!dialog) {
        return 0;
    }

    // Post a WM_PAINT and WM_ERASEBKGND message, as indicated
    let msg = new MSG();
    msg.hwnd = hwnd;
    msg.message = User.WM_ERASEBKGND;
    this.scheduler.task.push(msg);

    msg = new MSG();
    msg.hwnd = hwnd;
    msg.message = User.WM_PAINT;
    this.scheduler.task.push(msg);

    return TRUE;
}
