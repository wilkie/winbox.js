"use strict";

import { NULL } from '../consts.js';

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
    console.log("Creating window", lpszClassName, lpszWindowName);

    // Look up the parent (if NULL, we create a window in the desktop space)
    let parentWindow = null;
    if (hwndParent == NULL) {
        parentWindow = this._desktop;
    }
    else {
        // TODO: lookup window by handle
    }

    // Create a window inside the given parent
    let dialog = new SizableWindow({
        caption: lpszWindowName
    });

    dialog.resize(300, 300);
    dialog.center();

    parentWindow.append(dialog);

    // Return a error for now :)
    return NULL;
}
