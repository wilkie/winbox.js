"use strict";

import { NULL } from '../consts.js';

import { HWND } from '../types.js';

import { User, MSG, MINMAXINFO, CREATESTRUCT } from '../user.js';

import { Bitmap } from '../../raster/bitmap.js';
import { Palette } from '../../raster/palette.js';
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
    //console.log("Creating window", arguments);

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

    // Set default font
    //dialog.surface.font = this.fonts.lookup

    dialog.show();
    dialog.resize(400, 300);

    parentWindow.append(dialog);

    //*
    x = User.CW_USEDEFAULT;
    y = User.CW_USEDEFAULT;
    nWidth = 500;
    nHeight = 500;
    //*/

    if (nWidth != User.CW_USEDEFAULT) {
        dialog.resize(nWidth, dialog.height);
    }

    if (nHeight != User.CW_USEDEFAULT) {
        dialog.resize(dialog.width, nHeight);
    }

    dialog.center();

    if (x != User.CW_USEDEFAULT) {
        dialog.move(x, dialog.y);
    }

    if (y != User.CW_USEDEFAULT) {
        dialog.move(dialog.x, y);
    }

    // Set default bitmap (8bpp)
    let bitmapData = new Uint8Array(dialog.innerWidth * dialog.innerHeight);
    let bitmapView = new DataView(bitmapData.buffer);
    dialog.surface.bitmap = new Bitmap(dialog.innerWidth, dialog.innerHeight, 8, Bitmap.RGBA, bitmapView, Palette.PALETTEWIN256);

    dialog.hide();

    let windowClass = this.handles.retrieve(lpszClassName);

    let hWnd = this.handles.allocate(dialog);

    let taskHandle = this.scheduler.active;
    let task = this.handles.resolve(taskHandle);

    this.windows.register(taskHandle, task, hWnd, dialog);

    // TODO: GETMINMAXINFO structure
    // TODO: WM_NCCREATE params
    // TODO: WM_NCCALCSIZE params
    // TODO: WM_CREATE params

    let mmi = new MINMAXINFO();
    let createstruct = new CREATESTRUCT();
    createstruct.lpCreateParams = lpvParam;
    createstruct.hInstance = hinst;
    createstruct.hwndParent = hwndParent;
    createstruct.hMenu = hmenu;
    createstruct.cy = nHeight;
    createstruct.cx = nWidth;
    createstruct.x = x;
    createstruct.y = y;
    createstruct.style = dwStyle;
    createstruct.lpszName = (lpszWindowName.segment << 16) | lpszWindowName.offset;
    createstruct.lpszClass = (lpszClassName.segment << 16) | lpszClassName.offset;
    createstruct.dwExStyle = 0;
    //console.log("create struct???", createstruct.cy, createstruct.cx);

    // We asynchronously halt and call the window message procedure for the
    // initialization messages:
    let ret = [
        ['callWndProc', windowClass, hWnd, User.WM_GETMINMAXINFO, 0, [mmi]],
        ['callWndProc', windowClass, hWnd, User.WM_NCCREATE, 0, 0],
        ['callWndProc', windowClass, hWnd, User.WM_NCCALCSIZE, 0, 0],
        ['callWndProc', windowClass, hWnd, User.WM_CREATE, 0, [createstruct]],
    ];

    // If we have a parent, we notify it of the WM_CREATE
    if (hwndParent) {
        // lo-word is hWnd of child
        // hi-word is identifier of child
        let notifyParam = hWnd & 0xffff;
        ret.push([
            'callWndProc', windowClass, hWnd,
            User.WM_PARENTNOTIFY, User.WM_CREATE, notifyParam
        ]);
    }

    // Push return value of CreateWindow
    ret.push([HWND, hWnd]);

    return ret;
}
