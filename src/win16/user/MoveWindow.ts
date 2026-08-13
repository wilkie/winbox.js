"use strict";

import { User, MSG, WINDOWPOS } from '../user.js';

import { TRUE, FALSE, NULL } from '../consts.js';

import { BOOL } from '../types.js';

export async function MoveWindow(hwnd, nLeft, nTop, nWidth, nHeight, fRepaint) {
    // Get the window itself
    const dialog = this.handles.resolve(hwnd);

    // Get the window/class for the handle
    const windowClass = this.handles.retrieve(dialog.options.windowClass);

    // Send WM_MOVE/WM_SIZE messages
    //
    // If fRepaint, send WM_PAINT
    //
    // But first, we send a WM_WINDOWPOSCHANGING
    const windowPos = new WINDOWPOS();
    windowPos.hwnd = hwnd;
    windowPos.hwndInsertAfter = NULL;
    windowPos.x = nLeft;
    windowPos.y = nTop;
    windowPos.cx = nWidth;
    windowPos.cy = nHeight;
    windowPos.flags = 0;

    await this.scheduler.callWndProc(windowClass, hwnd, User.WM_WINDOWPOSCHANGING, 0, [windowPos]);

    if (!(windowPos.flags & User.SWP_NOSIZE)) {
        dialog.resize(windowPos.cx, windowPos.cy);
    }

    if (!(windowPos.flags & User.SWP_NOMOVE)) {
        dialog.move(windowPos.x, windowPos.y);
    }

    // WM_SIZE
    const wmSizeLParam = (dialog.width & 0xffff) | ((dialog.height & 0xffff) << 16);
    await this.scheduler.callWndProc(windowClass, hwnd, User.WM_SIZE, 0, wmSizeLParam);

    // WM_MOVE
    const wmMoveLParam = (dialog.x & 0xffff) | ((dialog.y & 0xffff) << 16);
    await this.scheduler.callWndProc(windowClass, hwnd, User.WM_MOVE, 0, wmMoveLParam);

    if (fRepaint) {
        const msg = new MSG();
        msg.hwnd = hwnd;
        msg.message = User.WM_PAINT;
        this.scheduler.task.push(msg);
        //msg = new MSG();
        //msg.hwnd = hwnd;
        //msg.message = User.WM_TIMER;
        //this.scheduler.task.push(msg);
        //callStack.push([
        //    'callWndProc', windowClass, hwnd, User.WM_PAINT, 0, 0
        //]);
    }

    return TRUE;
}
