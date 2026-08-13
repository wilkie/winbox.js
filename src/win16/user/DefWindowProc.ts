"use strict";

import { NULL } from '../consts.js';

import { User, MDICREATESTRUCT } from '../user.js';

import { CreateWindow } from './CreateWindow.js';

/**
 * The **DefWindowProc** function calls the default window procedure. The
 * default window procedure provides default processing for any window messges
 * that an application does not process. This function ensures that every
 * message is processed. It should be called with the same parameters as those
 * received by the window procedure.
 *
 * **See also**:
 * {@link User.DefDlgProc DefDlgProc}
 *
 * @static
 * @function DefWindowProc
 * @memberof User
 *
 * @param {Types.HWND} hwnd - Identifies the window that received the message.
 * @param {Types.UINT} uMsg - Specifies the message.
 * @param {Types.WPARAM} wParam - Specifies 16 bits of additional
 *                                message-dependent information.
 * @param {Types.LPARAM} lParam - Specifies 32 bits of additional
 *                                message-dependent information.
 *
 * @return {Types.LRESULT} The return value is the result of the message
 *                         processing and depends on the message sent.
 */
export async function DefWindowProc(hwnd, uMsg, wParam, lParam) {
    const dialog = this.handles.resolve(hwnd);

    if (!dialog) {
        return 0;
    }

    const windowClass = this.handles.retrieve(dialog.options.windowClass);
    if (windowClass.lpszClassName.toUpperCase() === "MDICLIENT") {
        // This is an MDI client
        switch (uMsg) {
            case User.WM_MDICREATE:

                const hi = (lParam >> 16) & 0xffff;
                const lo = lParam & 0xffff;
                const struct = new MDICREATESTRUCT();
                struct.loadFromMemory(this.machine.memory, hi >> 3, lo);

                // Create the window and return the new hWnd
                return await CreateWindow.bind(this)(struct.szClass, struct.szTitle, struct.style, struct.x, struct.y, struct.cx, struct.cy, hwnd, NULL, struct.hOwner, struct.lParam);
        }
    }

    // Perform default actions
    switch(uMsg) {
        case User.WM_ERASEBKGND:
            // Paint the update region with the window class' brush
            const brush = this.handles.resolve(windowClass.hbrBackground);
            if (brush) {
                // TODO: only affect update region
                const surface = dialog.surface;
                const old = surface.brush;
                surface.brush = brush;
                surface.fillRect(0, 0, dialog.innerWidth, dialog.innerHeight);
                surface.brush = old;
            }
            return 0;
    }

    return 0;
}
