"use strict";

import { NULL } from '../consts.js';

import { User } from '../user.js';

import { Window } from '../../window.js';
import { FixedWindow } from '../../windows/fixed-window.js';
import { SizableWindow } from '../../windows/sizable-window.js';

/**
 * The **InitApp** function creates the application queue and installs
 * application-support routines such as the signal procedure, version-
 * specific resource loaders, and the divide-by-zero interrupt routine.
 *
 * (Our system emulation does not need to really do anything for this)
 *
 * @static
 * @function CreateWindow
 * @memberof User
 *
 * @returns {Types.HWND} The return value is the handle of the new window if
 *                       the function is successful. Otherwise, it is NULL.
 */
export function CreateWindow(lpszClassName, lpszWindowName,
                             dwStyle, x, y, nWidth, nHeight,
                             hwndParent, hmenu, hinst, lpvParam) {
    console.log("Creating window", arguments);

    // Look up the parent (if NULL, we create a window in the desktop space)
    let parentWindow = null;
    if (hwndParent == NULL) {
        parentWindow = this._desktop;
    }
    else {
        parentWindow = this.handles.resolve(hwndParent);

        // Error if the parent window is not known
        if (!parentWindow) {
            return NULL;
        }
    }

    let windowClassType = Window;

    if (dwStyle & User.WS_THICKFRAME) {
        windowClassType = SizableWindow;
    }
    else if (dwStyle & User.WS_OVERLAPPED) {
        windowClassType = FixedWindow;
    }

    // Create a window inside the given parent
    let dialog = new windowClassType({
        caption: lpszWindowName,
        timesShown: 0,
        windowClass: lpszClassName
    });

    dialog.show();
    dialog.center();
    dialog.resize(300, 300);

    parentWindow.append(dialog);

    if (x != User.CW_USEDEFAULT) {
        console.log(x, User.CW_USEDEFAULT);
        dialog.move(x, dialog.y);
    }

    if (y != User.CW_USEDEFAULT) {
        dialog.move(dialog.x, y);
    }

    if (nWidth != User.CW_USEDEFAULT) {
        dialog.resize(nWidth, dialog.height);
    }

    if (nHeight != User.CW_USEDEFAULT) {
        dialog.resize(dialog.width, nHeight);
    }

    dialog.hide();

    let windowClass = this.handles.retrieve(lpszClassName);

    let hWnd = this.handles.allocate(dialog);

    let taskHandle = this.scheduler.active;
    let task = this.handles.resolve(taskHandle);

    this.windows.register(taskHandle, task, hWnd, dialog);
    return hWnd;
}
