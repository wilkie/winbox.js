'use strict';

/** @namespace SystemDriver */

import { Module } from './module.js';

/**
 * The system driver, `SYSTEM.DRV`, as a module: found by its name, `SYSTEM`,
 * as Windows' own is (`modhand`), and by its file's.
 *
 * The ordinals and names are the installation's own export table, and how
 * many bytes of arguments each takes are what each function's `retf` pops,
 * read out of the file. None is done: a stub, marked as one in a trace, that
 * takes its arguments off the stack. Its timers are KERNEL's and the
 * system's here, and a program has no business with it itself.
 *
 * @memberof Win16
 */
export class SystemDriver extends Module {
  static get name(): string {
    return 'SYSTEM';
  }

  static get path() {
    return 'C:\\WINDOWS\\SYSTEM\\SYSTEM.DRV';
  }

  static get exports() {
    const exports: any[] = [];

    exports[1] = [SystemDriver.stub, 'InquireSystem', 4];
    exports[2] = [SystemDriver.stub, 'CreateSystemTimer', 6];
    exports[3] = [SystemDriver.stub, 'KillSystemTimer', 2];
    exports[4] = [SystemDriver.stub, 'EnableSystemTimers', 0];
    exports[5] = [SystemDriver.stub, 'DisableSystemTimers', 0];
    exports[6] = [SystemDriver.stub, 'GetSystemMSecCount', 0];
    exports[7] = [SystemDriver.stub, 'Get80x87SaveSize', 0];
    exports[8] = [SystemDriver.stub, 'Save80x87State', 4];
    exports[9] = [SystemDriver.stub, 'Restore80x87State', 4];
    exports[10] = [SystemDriver.stub, 'WEP', 2];
    exports[20] = [SystemDriver.stub, 'A20_Proc', 2];

    return exports;
  }

  static stub() {
    console.log('Stub called!');
  }
}
