'use strict';

/** @namespace Keyboard */

import { Module } from './module.js';

/**
 * The keyboard driver, `KEYBOARD.DRV`, as a module programs import from.
 *
 * The ordinals and names are the installation's own export table. Notepad
 * imports `AnsiToOem` and `OemToAnsi` from it. Both translate through the
 * driver's tables, which are not read yet, so both are stubs -- marked as
 * stubs in a trace -- that at least take their arguments off the stack.
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
    exports[5] = [Keyboard.stub, 'AnsiToOem', 8];
    exports[6] = [Keyboard.stub, 'OemToAnsi', 8];
    exports[7] = [Keyboard.stub, 'SetSpeed', 2];
    exports[8] = [Keyboard.stub, 'WEP', 2];
    exports[100] = [Keyboard.stub, 'ScreenSwitchEnable', 2];
    exports[126] = [Keyboard.stub, 'GetTableSeg', 0];
    exports[127] = [Keyboard.stub, 'NewTable', 0];
    exports[128] = [Keyboard.stub, 'OemKeyScan', 2];
    exports[129] = [Keyboard.stub, 'VkKeyScan', 2];
    exports[130] = [Keyboard.stub, 'GetKeyboardType', 2];
    exports[131] = [Keyboard.stub, 'MapVirtualKey', 4];
    exports[132] = [Keyboard.stub, 'GetKbCodePage', 0];
    exports[133] = [Keyboard.stub, 'GetKeyNameText', 10];
    exports[134] = [Keyboard.stub, 'AnsiToOemBuff', 10];
    exports[135] = [Keyboard.stub, 'OemToAnsiBuff', 10];
    exports[136] = [Keyboard.stub, 'EnableKBSysReq', 2];
    exports[137] = [Keyboard.stub, 'GetBIOSKeyProc', 0];

    return exports;
  }

  static stub() {
    console.log('Stub called!');
  }
}
