'use strict';

/** @namespace Keyboard */

import { Module } from './module.js';
import { DWORD, FARPTR, INT, LONG, UINT } from './types.js';
import { AnsiToOem, AnsiToOemBuff, OemToAnsi, OemToAnsiBuff } from './keyboard/oem.js';
import { MapVirtualKey, VkKeyScan } from './keyboard/scan.js';
import {
  Disable,
  Enable,
  EnableKBSysReq,
  GetBIOSKeyProc,
  GetKeyboardType,
  GetKeyNameText,
  GetTableSeg,
  Inquire,
  NewTable,
  OemKeyScan,
  ScreenSwitchEnable,
  SetSpeed,
  ToAscii,
} from './keyboard/driver.js';

/**
 * The keyboard's OEM code page: the word the driver keeps at seg10 `06fc`,
 * before its tables, which nothing writes (read out, seg10 `083e`): 437 for
 * the US driver. DDEML takes it for a string handle's code page besides
 * CP_WINANSI (`ddemgmt`).
 */
export function GetKbCodePage() {
  return 437;
}

/**
 * The keyboard driver, `KEYBOARD.DRV`, as a module programs import from.
 *
 * The ordinals and names are the installation's own export table. Notepad
 * imports `AnsiToOem` and `OemToAnsi` from it, which translate through the
 * driver's own tables (see `keyboard/oem.ts`), and `VkKeyScan` reads its
 * layout (see `keyboard/scan.ts`); the rest of what it answers is in
 * `keyboard/driver.ts`. `Enable` and `Disable`, which USER calls to take
 * the keyboard's interrupt and give it back, are stubs: WinBox's input
 * does not come through a keyboard driver. `WEP` returns with AX as it
 * was (seg10 `0afc`).
 *
 * @memberof Win16
 */
export class Keyboard extends Module {
  static get name(): string {
    return 'KEYBOARD';
  }

  static get path() {
    return 'C:\\WINDOWS\\SYSTEM\\KEYBOARD.DRV';
  }

  static get exports() {
    const exports: any[] = [];

    exports[1] = [Inquire, 'Inquire', 4, [FARPTR], INT];
    exports[2] = [Enable, 'Enable', 8, [FARPTR, FARPTR]];
    exports[3] = [Disable, 'Disable', 0, []];
    exports[4] = [ToAscii, 'ToAscii', 14, [UINT, UINT, FARPTR, FARPTR, UINT], INT];
    exports[5] = [AnsiToOem, 'AnsiToOem', 8, [FARPTR, FARPTR], UINT];
    exports[6] = [OemToAnsi, 'OemToAnsi', 8, [FARPTR, FARPTR], UINT];
    exports[7] = [SetSpeed, 'SetSpeed', 2, [INT], INT];
    exports[8] = [() => undefined, 'WEP', 2, [INT]];
    exports[100] = [ScreenSwitchEnable, 'ScreenSwitchEnable', 2, [UINT], UINT];
    exports[126] = [GetTableSeg, 'GetTableSeg', 0, [], UINT];
    exports[127] = [NewTable, 'NewTable', 0, []];
    exports[128] = [OemKeyScan, 'OemKeyScan', 2, [UINT], DWORD];
    exports[129] = [VkKeyScan, 'VkKeyScan', 2, [UINT], UINT];
    exports[130] = [GetKeyboardType, 'GetKeyboardType', 2, [INT], INT];
    exports[131] = [MapVirtualKey, 'MapVirtualKey', 4, [UINT, UINT], UINT];
    exports[132] = [GetKbCodePage, 'GetKbCodePage', 0, [], UINT];
    exports[133] = [GetKeyNameText, 'GetKeyNameText', 10, [LONG, FARPTR, INT], INT];
    exports[134] = [AnsiToOemBuff, 'AnsiToOemBuff', 10, [FARPTR, FARPTR, UINT]];
    exports[135] = [OemToAnsiBuff, 'OemToAnsiBuff', 10, [FARPTR, FARPTR, UINT]];
    exports[136] = [EnableKBSysReq, 'EnableKBSysReq', 2, [UINT], UINT];
    exports[137] = [GetBIOSKeyProc, 'GetBIOSKeyProc', 0, [], DWORD];

    return exports;
  }

  static stub() {
    console.log('Stub called!');
  }
}
