'use strict';

/** @namespace Shell */

import { Module } from './module.js';

import { BOOL, HWND } from './types.js';

/**
 * The Windows 3.1 Shell API Library, `SHELL.DLL`.
 *
 * The ordinals and names are the installation's own export table. Only what
 * a program has been seen to need is more than a stub: Notepad imports
 * `DragAcceptFiles`, `DragQueryFile`, `DragFinish` and `ShellAbout`, and calls
 * the first while it starts. The stubs carry the size of their arguments, so
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

    exports[1] = [Shell.stub, 'RegOpenKey', 0];
    exports[2] = [Shell.stub, 'RegCreateKey', 0];
    exports[3] = [Shell.stub, 'RegCloseKey', 0];
    exports[4] = [Shell.stub, 'RegDeleteKey', 0];
    exports[5] = [Shell.stub, 'RegSetValue', 0];
    exports[6] = [Shell.stub, 'RegQueryValue', 0];
    exports[7] = [Shell.stub, 'RegEnumKey', 0];
    exports[8] = [Shell.stub, 'WEP', 0];
    exports[9] = [DragAcceptFiles, 'DragAcceptFiles', 4, [HWND, BOOL]];
    exports[11] = [Shell.stub, 'DragQueryFile', 10];
    exports[12] = [Shell.stub, 'DragFinish', 2];
    exports[13] = [Shell.stub, 'DragQueryPoint', 6];
    exports[20] = [Shell.stub, 'ShellExecute', 0];
    exports[21] = [Shell.stub, 'FindExecutable', 0];
    exports[22] = [Shell.stub, 'ShellAbout', 12];
    exports[33] = [Shell.stub, 'AboutDlgProc', 0];
    exports[34] = [Shell.stub, 'ExtractIcon', 0];
    exports[36] = [Shell.stub, 'ExtractAssociatedIcon', 0];
    exports[37] = [Shell.stub, 'DoEnvironmentSubst', 0];
    exports[38] = [Shell.stub, 'FindEnvironmentString', 0];
    exports[39] = [Shell.stub, 'InternalExtractIcon', 0];
    exports[101] = [Shell.stub, 'FindExeDlgProc', 0];
    exports[102] = [Shell.stub, 'RegisterShellHook', 0];
    exports[103] = [Shell.stub, 'ShellHookProc', 0];

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
