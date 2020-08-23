"use strict";

import { NULL } from '../consts.js';

import { User } from '../user.js';

/**
 * The **FindWindow** function retrieves the handle of the window whose class
 * name and window name match the specified strings. This function does not
 * search child windows.
 *
 * @static
 * @function FindWindow
 * @memberof User
 *
 * @param {Types.LPCSTR} lpszClassName - Points to a null-terminated string that
 *                                       contains the window's class name. If
 *                                       this parameter is `NULL` all class
 *                                       names match.
 * @param {Types.LPCSTR} lpszWindow - Points to a null-terminated string string
 *                                    that specifies the window name (the
 *                                    window's title). If this parameter is
 *                                    `NULL`, all window names match.
 *
 * @returns {Types.HWND} The return value is the handle of the window that
 *                       has the specified class name and window name if the
 *                       function is successful. Otherwise, it is `NULL`.
 */
export function FindWindow(lpszClassName, lpszWindow) {
    let hWnd = NULL;

    // TODO: implement

    return hWnd;
}
