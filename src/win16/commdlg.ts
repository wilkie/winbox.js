'use strict';

/** @namespace MMSystem */

import { Module } from './module.js';

/**
 * The Win16 Common Dialog library.
 *
 * @memberof Win16
 */
export class CommDlg extends Module {
  static get name(): string {
    return 'COMMDLG';
  }

  static get path() {
    return 'C:\\WINDOWS\\SYSTEM\\COMMDLG.DLL';
  }

  static get exports() {
    return [
      // 0 // "Common Windows Dialogs, Ver 3.10"
      null,
      [CommDlg.stub, 'GetOpenFilename', 4],
      [CommDlg.stub, 'GetSaveFilename', 4],
      [CommDlg.stub, 'unknown'],
      [CommDlg.stub, 'unknown'],
      [CommDlg.stub, 'ChooseColor', 4],
      [CommDlg.stub, 'FileOpenDlgProc', 10],
      [CommDlg.stub, 'FileSaveDlgProc', 10],
      [CommDlg.stub, 'ColorDlgProc', 10],
      [CommDlg.stub, 'LoadAlterBitmap', 10],
      // 10 //
      [CommDlg.stub, 'unknown'],
      [CommDlg.stub, 'FindText', 4],
      [CommDlg.stub, 'ReplaceText', 4],
      [CommDlg.stub, 'FindTextDlgProc', 10],
      [CommDlg.stub, 'ReplaceTextDlgProc', 10],
      [CommDlg.stub, 'ChooseFont', 4],
      [CommDlg.stub, 'FormatCharDlgProc', 10],
      [CommDlg.stub, 'unknown'],
      [CommDlg.stub, 'FontStyleEnumProc', 14],
      [CommDlg.stub, 'FontFamilyEnumProc', 14],
      // 20 //
      [CommDlg.stub, 'PrintDlg', 4],
      [CommDlg.stub, 'PrintDlgProc', 10],
      [CommDlg.stub, 'PrintSetupDlgProc', 10],
      [CommDlg.stub, 'EditIntegerOnly', 10],
      [CommDlg.stub, 'unknown'],
      [CommDlg.stub, 'WantArrows', 10],
      [CommDlg.stub, 'CommDlgExtendedError', 0],
      [CommDlg.stub, 'GetFileTitle', 10],
      [CommDlg.stub, 'unknown', 2],
      [CommDlg.stub, 'dwLBSubclass', 10],
      // 30 //
      [CommDlg.stub, 'dwUpArrowHack', 10],
      [CommDlg.stub, 'dwOKSubclass', 10],
      [CommDlg.stub, 'Unknown', 2],
      [CommDlg.stub, 'Unknown', 0],
      [CommDlg.stub, 'Unknown', 0],
      [CommDlg.stub, 'Unknown', 0],
      [CommDlg.stub, 'Unknown', 0],
      [CommDlg.stub, 'Unknown', 0],
      [CommDlg.stub, 'Unknown', 6],
      [CommDlg.stub, 'Unknown', 4],
      [CommDlg.stub, 'Unknown', 0],
      [CommDlg.stub, 'Unknown', 0],
      [CommDlg.stub, 'Unknown', 0],
      [CommDlg.stub, 'Unknown', 2],
      [CommDlg.stub, 'Unknown', 0],
      [CommDlg.stub, 'Unknown', 4],
      [CommDlg.stub, 'Unknown', 4],
      [CommDlg.stub, 'Unknown', 4],
      [CommDlg.stub, 'Unknown', 10],
      [CommDlg.stub, 'Unknown', 12],
      [CommDlg.stub, 'Unknown', 2],
      [CommDlg.stub, 'Unknown', 6],
      [CommDlg.stub, 'Unknown', 4],
      [CommDlg.stub, 'Unknown', 10],
    ];
  }

  static stub() {
    console.log('Stub called!');
  }
}
