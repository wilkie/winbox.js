'use strict';

/** @namespace Win87EM */

import { Module } from './module.js';

/**
 * The Win16 Coprocessor/Emulator Library
 *
 * @memberof Win16
 */
export class Win87EM extends Module {
  static get name(): string {
    return 'WIN87EM';
  }

  static get path() {
    return 'C:\\WINDOWS\\SYSTEM\\WIN87EM.DLL';
  }

  static get exports() {
    return [
      // 0 // "Microsoft Windows 3.1 Coprocessor/Emulator Library 7.00.00"
      [Win87EM.stub, '__FPMATH', 0],
      [Win87EM.stub, 'WEP', 0],
      [Win87EM.stub, '__WIN87EMINFO', 6],
      [Win87EM.stub, '__WIN87EMRESTORE', 6],
      [Win87EM.stub, '__WIN87EMSAVE', 6],
    ];
  }

  static stub() {
    console.log('Stub called!');
  }
}
