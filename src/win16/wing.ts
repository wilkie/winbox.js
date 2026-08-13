"use strict";

/** @namespace WinG */

import { Module } from './module.js';

import { BYTE, UBYTE, INT, UINT, FARPTR,
         HDC, HBRUSH, HBITMAP, COLORREF,
         DWORD, HLOCAL, HGLOBAL, HANDLE, Struct,
         BOOL, NEARPTR, LPCSTR, HWND } from './types.js';

/**
 * The Win16 High Performance Graphics API
 *
 * @memberof Win16
 */
export class WinG extends Module {
    declare static _exports: any;
    static get name(): string {
        return "WING";
    }

    static get path() {
        return "C:\\WINDOWS\\SYSTEM\\WING.DLL";
    }

    static get exports() {
        if (!WinG._exports) {
            const ret = new Array(1011);
            ret[0] = null; // 0 // "WinG High Performance Graphics APIs"
            ret[1001] = [WinG.stub, "WinGCreateDC", 0, [], HDC];
            ret[1002] = [WinG.stub, "WinGRecommendedDIBFormat", 4, [FARPTR], BOOL];
            ret[1003] = [WinG.stub, "WinGCreateBitmap", 10, [HDC, FARPTR, FARPTR], HBITMAP];
            ret[1004] = [WinG.stub, "WinGGetDIBPointer", 6, [HBITMAP, FARPTR], FARPTR];
            ret[1005] = [WinG.stub, "WinGGetDIBColorTable", 10, [HDC, UINT, UINT, FARPTR], UINT];
            ret[1006] = [WinG.stub, "WinGSetDIBColorTable", 10, [HDC, UINT, UINT, FARPTR], UINT];
            ret[1007] = [WinG.stub, "WinGCreateHalftonePalette", 0, [], HANDLE];
            ret[1008] = [WinG.stub, "WinGCreateHalftoneBrush", 8, [HDC, COLORREF, UINT], HBRUSH];
            ret[1009] = [WinG.stub, "WinGStretchBlt", 20, [HDC, INT, INT, INT, INT, HDC, INT, INT, INT, INT], BOOL];
            ret[1010] = [WinG.stub, "WinGBitBlt", 16, [HDC, INT, INT, INT, INT, HDC, INT, INT], BOOL];
            /*
            ret[1500] = [WinG.stub, "WinGThunk16", 0];
            ret[2000] = [WinG.stub, "RegisterWinGPal", 0];
            ret[2001] = [WinG.stub, "ExceptionHandler", 0];
            */
            WinG._exports = ret;
        }

        return WinG._exports;
    }

    static stub() {
        console.log("Stub called!");
    }
}
