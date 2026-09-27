'use strict';

/** @namespace Keyboard */

import { Module } from './module.js';
import { FARPTR, UINT } from './types.js';
import { AnsiToOem, AnsiToOemBuff, OemToAnsi, OemToAnsiBuff } from './keyboard/oem.js';
import { VkKeyScan } from './keyboard/scan.js';

/**
 * The keyboard driver, `KEYBOARD.DRV`, as a module programs import from.
 *
 * The ordinals and names are the installation's own export table. Notepad
 * imports `AnsiToOem` and `OemToAnsi` from it, which translate through the
 * driver's own tables (see `keyboard/oem.ts`), and `VkKeyScan` reads its
 * layout (see `keyboard/scan.ts`). The rest are stubs -- marked
 * as stubs in a trace -- that at least take their arguments off the stack.
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

    exports[1] = [Keyboard.stub, 'Inquire', 4];
    exports[2] = [Keyboard.stub, 'Enable', 8];
    exports[3] = [Keyboard.stub, 'Disable', 0];
    exports[4] = [Keyboard.stub, 'ToAscii', 14];
    exports[5] = [AnsiToOem, 'AnsiToOem', 8, [FARPTR, FARPTR], UINT];
    exports[6] = [OemToAnsi, 'OemToAnsi', 8, [FARPTR, FARPTR], UINT];
    exports[7] = [Keyboard.stub, 'SetSpeed', 2];
    exports[8] = [Keyboard.stub, 'WEP', 2];
    exports[100] = [Keyboard.stub, 'ScreenSwitchEnable', 2];
    exports[126] = [Keyboard.stub, 'GetTableSeg', 0];
    exports[127] = [Keyboard.stub, 'NewTable', 0];
    exports[128] = [Keyboard.stub, 'OemKeyScan', 2];
    exports[129] = [VkKeyScan, 'VkKeyScan', 2, [UINT], UINT];
    exports[130] = [Keyboard.stub, 'GetKeyboardType', 2];
    exports[131] = [Keyboard.stub, 'MapVirtualKey', 4];
    exports[132] = [Keyboard.stub, 'GetKbCodePage', 0];
    exports[133] = [Keyboard.stub, 'GetKeyNameText', 10];
    exports[134] = [AnsiToOemBuff, 'AnsiToOemBuff', 10, [FARPTR, FARPTR, UINT]];
    exports[135] = [OemToAnsiBuff, 'OemToAnsiBuff', 10, [FARPTR, FARPTR, UINT]];
    exports[136] = [Keyboard.stub, 'EnableKBSysReq', 2];
    exports[137] = [Keyboard.stub, 'GetBIOSKeyProc', 0];

    return exports;
  }

  static stub() {
    console.log('Stub called!');
  }
}
