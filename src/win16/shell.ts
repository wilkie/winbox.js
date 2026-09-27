'use strict';

/** @namespace Shell */

import { ShellAbout } from './shell/about.js';
import {
  DoEnvironmentSubst,
  ExtractIcon,
  FindEnvironmentString,
  FindExecutable,
  ShellExecute,
} from './shell/programs.js';
import { RegisterShellHook, ShellHookProc } from './shell/shell-hook.js';
import { Module } from './module.js';

import {
  BOOL,
  DWORD,
  FARPTR,
  HWND,
  INT,
  LONG,
  LPARAM,
  LPCSTR,
  LRESULT,
  UINT,
  WPARAM,
} from './types.js';
import {
  RegCloseKey,
  RegCreateKey,
  RegDeleteKey,
  RegEnumKey,
  RegOpenKey,
  RegQueryValue,
  RegSetValue,
} from './shell/reg-api.js';

/**
 * The Windows 3.1 Shell API Library, `SHELL.DLL`.
 *
 * The ordinals and names are the installation's own export table. Only what
 * a program has been seen to need is more than a stub: Notepad imports
 * `DragAcceptFiles`, `DragQueryFile`, `DragFinish` and `ShellAbout`, and calls
 * the first while it starts; the accessories' About boxes are `ShellAbout`'s. The stubs carry the size of their arguments, so
 * that one called by mistake still returns to a stack it has not corrupted.
 *
 * @memberof Win16
 */
export class Shell extends Module {
  static get name(): string {
    return 'SHELL';
  }

  static get path() {
    return 'C:\\WINDOWS\\SYSTEM\\SHELL.DLL';
  }

  static get exports() {
    const exports: any[] = [];

    exports[1] = [RegOpenKey, 'RegOpenKey', 12, [DWORD, LPCSTR, FARPTR], LONG];
    exports[2] = [RegCreateKey, 'RegCreateKey', 12, [DWORD, LPCSTR, FARPTR], LONG];
    exports[3] = [RegCloseKey, 'RegCloseKey', 4, [DWORD], LONG];
    exports[4] = [RegDeleteKey, 'RegDeleteKey', 8, [DWORD, LPCSTR], LONG];
    exports[5] = [RegSetValue, 'RegSetValue', 20, [DWORD, LPCSTR, DWORD, LPCSTR, DWORD], LONG];
    exports[6] = [RegQueryValue, 'RegQueryValue', 16, [DWORD, LPCSTR, FARPTR, FARPTR], LONG];
    exports[7] = [RegEnumKey, 'RegEnumKey', 16, [DWORD, DWORD, FARPTR, DWORD], LONG];
    exports[8] = [Shell.stub, 'WEP', 2];
    exports[9] = [DragAcceptFiles, 'DragAcceptFiles', 4, [HWND, BOOL]];
    exports[11] = [Shell.stub, 'DragQueryFile', 10];
    exports[12] = [Shell.stub, 'DragFinish', 2];
    exports[13] = [Shell.stub, 'DragQueryPoint', 6];
    exports[20] = [ShellExecute, 'ShellExecute', 20, [HWND, LPCSTR, LPCSTR, LPCSTR, LPCSTR, INT], UINT];
    exports[21] = [FindExecutable, 'FindExecutable', 12, [LPCSTR, LPCSTR, FARPTR], UINT];
    exports[22] = [ShellAbout, 'ShellAbout', 12, [HWND, FARPTR, LPCSTR, UINT], INT];
    exports[33] = [Shell.stub, 'AboutDlgProc', 10];
    exports[34] = [ExtractIcon, 'ExtractIcon', 8, [UINT, LPCSTR, UINT], UINT];
    exports[36] = [Shell.stub, 'ExtractAssociatedIcon', 10];
    exports[37] = [DoEnvironmentSubst, 'DoEnvironmentSubst', 6, [FARPTR, UINT], DWORD];
    exports[38] = [FindEnvironmentString, 'FindEnvironmentString', 4, [FARPTR], FARPTR];
    exports[39] = [Shell.stub, 'InternalExtractIcon', 10];
    exports[101] = [Shell.stub, 'FindExeDlgProc', 10];
    exports[102] = [RegisterShellHook, 'RegisterShellHook', 4, [HWND, UINT], BOOL];
    exports[103] = [ShellHookProc, 'ShellHookProc', 8, [INT, WPARAM, LPARAM], LRESULT];

    exports[100] = [Shell.stub, 'HERETHARBETYGARS', 10];
    exports[104] = [Shell.stub, 'Unknown', 2];
    exports[105] = [Shell.stub, 'Unknown', 0];
    exports[106] = [Shell.stub, 'Unknown', 2];
    exports[108] = [Shell.stub, 'Unknown', 0];
    exports[109] = [Shell.stub, 'Unknown', 6];
    exports[110] = [Shell.stub, 'Unknown', 10];
    exports[111] = [Shell.stub, 'Unknown', 4];
    exports[112] = [Shell.stub, 'Unknown', 10];
    exports[113] = [Shell.stub, 'Unknown', 10];
    exports[114] = [Shell.stub, 'Unknown', 6];
    exports[115] = [Shell.stub, 'Unknown', 8];
    exports[116] = [Shell.stub, 'Unknown', 6];
    exports[117] = [Shell.stub, 'Unknown', 4];
    exports[118] = [Shell.stub, 'Unknown', 6];
    exports[120] = [Shell.stub, 'Unknown', 10];
    exports[122] = [Shell.stub, 'Unknown', 4];
    exports[125] = [Shell.stub, 'Unknown', 0];
    exports[126] = [Shell.stub, 'Unknown', 10];
    exports[32] = [Shell.stub, 'WCI', 10];
    exports[119] = [Shell.stub, 'Unknown', 10];
    return exports;
  }

  static stub() {
    console.log('Stub called!');
  }
}

/**
 * Whether a window takes files dropped on it: the window is marked, and File
 * Manager sends one that is `WM_DROPFILES` when files are dropped on it.
 * Nothing here drops files yet, so the mark is all there is.
 */
export function DragAcceptFiles(this: any, hwnd: number, fAccept: number) {
  const window = this.handles.resolve(hwnd);

  if (window) {
    window.acceptsFiles = !!fAccept;
  }
}
