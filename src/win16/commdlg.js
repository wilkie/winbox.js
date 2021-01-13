"use strict";

/** @namespace MMSystem */

import { Module } from './module.js';

import { BYTE, UBYTE, INT, UINT, FARPTR,
         DWORD, HLOCAL, HGLOBAL, HANDLE,
         BOOL, NEARPTR, LPCSTR, HWND } from './types.js';

/**
 * The Win16 Common Dialog library.
 *
 * @memberof Win16
 */
export class CommDlg extends Module {
    static get name() {
        return "COMMDLG";
    }

    static get path() {
        return "C:\\WINDOWS\\SYSTEM\\COMMDLG.DLL";
    }

    static get exports() {
        return [
            // 0 // "Common Windows Dialogs, Ver 3.10"
            null,
            [CommDlg.stub, "GetOpenFilename", 0],
            [CommDlg.stub, "GetSaveFilename", 0],
            [CommDlg.stub, "unknown"],
            [CommDlg.stub, "unknown"],
            [CommDlg.stub, "ChooseColor", 0],
            [CommDlg.stub, "FileOpenDlgProc", 0],
            [CommDlg.stub, "FileSaveDlgProc", 0],
            [CommDlg.stub, "ColorDlgProc", 0],
            [CommDlg.stub, "LoadAlterBitmap", 0],
            // 10 //
            [CommDlg.stub, "unknown"],
            [CommDlg.stub, "FindText", 0],
            [CommDlg.stub, "ReplaceText", 0],
            [CommDlg.stub, "FindTextDlgProc", 0],
            [CommDlg.stub, "ReplaceTextDlgProc", 0],
            [CommDlg.stub, "ChooseFont", 0],
            [CommDlg.stub, "FormatCharDlgProc", 0],
            [CommDlg.stub, "unknown"],
            [CommDlg.stub, "FontStyleEnumProc", 0],
            [CommDlg.stub, "FontFamilyEnumProc", 0],
            // 20 //
            [CommDlg.stub, "PrintDlg", 0],
            [CommDlg.stub, "PrintDlgProc", 0],
            [CommDlg.stub, "PrintSetupDlgProc", 0],
            [CommDlg.stub, "EditIntegerOnly", 0],
            [CommDlg.stub, "unknown"],
            [CommDlg.stub, "WantArrows", 0],
            [CommDlg.stub, "CommDlgExtendedError", 0],
            [CommDlg.stub, "GetFileTitle", 0],
            [CommDlg.stub, "unknown"],
            [CommDlg.stub, "dwLBSubclass", 0],
            // 30 //
            [CommDlg.stub, "dwUpArrowHack", 0],
            [CommDlg.stub, "dwOKSubclass", 0],
        ];
    }

    static stub() {
        console.log("Stub called!");
    }
}
