"use strict";

import { User } from '../user.js';

/**
 */
export async function InvalidateRect(hwnd, lprc, fErase) {
    // Get the window itself
    const dialog = this.handles.resolve(hwnd);

    // Get the window/class for the handle
    const windowClass = this.handles.retrieve(dialog.options.windowClass);

    dialog.data.erase = fErase != 0;

    // Send a WM_PAINT
    await this.scheduler.callWndProc(windowClass, hwnd, User.WM_PAINT, 0, 0);
}
