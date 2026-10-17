'use strict';

/** @namespace Ver */

import { Module } from '../module.js';
import { BOOL, DWORD, FARPTR, INT, UINT } from '../types.js';
import {
  GetFileResource,
  GetFileResourceSize,
  GetFileVersionInfo,
  GetFileVersionInfoSize,
  VerFindFile,
  VerInstallFile,
  VerLanguageName,
  VerQueryValue,
  WEP,
} from './ver.js';

/**
 * `VER`, version information and the installing of files, as WinBox's own
 * (`ver.ts`). As `crates/winbox-win16/src/ver/`.
 *
 * It is kept as `COMMDLG` is (`commdlg/index.ts`, `own-modules.ts`): with
 * `VER.DLL` on the drive, a program that imports `VER` gets the file's
 * library, and each import of an export answered here is linked to
 * WinBox's stub, as `GetProcAddress` answers it; with none, the program
 * links to WinBox's stubs throughout, and `LoadLibrary` finds it by its
 * file's name.
 *
 * The ordinals and names are `VER.DLL`'s entry table's: 4 and 5 it has no
 * entry for, and 12 on are entries of its own far calls, not exported --
 * its `LibMain` (12), a long shift (13), its calls into Win32s (14-16),
 * joining a folder and a name (17), whether a file is in use (18), and its
 * second data segment (19, 20).
 *
 * @memberof Win16
 */
export class Ver extends Module {
  static get name(): string {
    return 'VER';
  }

  static get path() {
    return 'C:\\WINDOWS\\SYSTEM\\VER.DLL';
  }

  static get exports() {
    const PTRS7 = [FARPTR, FARPTR, FARPTR, FARPTR, FARPTR, FARPTR, FARPTR];

    return [
      // 0 // "VER - A Version stamping library"
      null,
      [WEP, 'WEP', 2, [INT], INT],
      [GetFileResourceSize, 'GetFileResourceSize', 16, [FARPTR, FARPTR, FARPTR, FARPTR], DWORD],
      [
        GetFileResource,
        'GetFileResource',
        24,
        [FARPTR, FARPTR, FARPTR, DWORD, DWORD, FARPTR],
        BOOL,
      ],
      [Ver.stub, 'unknown'],
      [Ver.stub, 'unknown'],
      [GetFileVersionInfoSize, 'GetFileVersionInfoSize', 8, [FARPTR, FARPTR], DWORD],
      [GetFileVersionInfo, 'GetFileVersionInfo', 16, [FARPTR, DWORD, DWORD, FARPTR], BOOL],
      [VerFindFile, 'VerFindFile', 30, [UINT, ...PTRS7], UINT],
      [VerInstallFile, 'VerInstallFile', 30, [UINT, ...PTRS7], DWORD],
      // 10 //
      [VerLanguageName, 'VerLanguageName', 8, [UINT, FARPTR, UINT], UINT],
      [VerQueryValue, 'VerQueryValue', 16, [FARPTR, FARPTR, FARPTR, FARPTR], BOOL],
      [Ver.stub, 'Unknown', 10],
      [Ver.stub, 'Unknown', 0],
      [Ver.stub, 'Unknown', 14],
      [Ver.stub, 'Unknown', 2],
      [Ver.stub, 'Unknown', 6],
      [Ver.stub, 'Unknown', 12],
      [Ver.stub, 'Unknown', 8],
      [Ver.stub, 'Unknown', 0],
      // 20 //
      [Ver.stub, 'Unknown', 0],
    ];
  }

  static stub() {
    console.log('Stub called!');
  }
}
