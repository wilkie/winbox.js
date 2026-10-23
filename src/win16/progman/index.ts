'use strict';

/** @namespace Progman */

import { Module } from '../module.js';
import { HINSTANCE, HWND, INT, LPARAM, LRESULT, FARPTR, UINT, WPARAM } from '../types.js';
import { FRAMEWNDPROC, WINMAIN } from './main.js';

/**
 * `PROGMAN`, WinBox's own Program Manager: a task with no file, started only
 * where a program starts `PROGMAN.EXE` -- `WinExec` or `LoadModule` -- and
 * no such file is found; an installation's own `PROGMAN.EXE` is
 * Microsoft's, and runs. Never in an ordinary run, a probe's or the
 * corpus's. As `crates/winbox-win16/src/progman/`. The design:
 * `kb/topics/program-manager-dde.md`, "In winbox.js".
 *
 * It is two halves, as a program and the library it calls are: the program,
 * a module made in memory (`image.ts`), whose start-up the processor runs
 * and whose data segment is its instance, made a task by the loader, the
 * linker and `InitTask` as any program is; and WinBox's code, kept as this
 * module, whose stubs the program calls: `WinMain` and the frame's window
 * procedure, `PROGMAN.EXE`'s read out (`main.ts`).
 *
 * @memberof Win16
 */
export class Progman extends Module {
  static get name(): string {
    return 'PROGMAN';
  }

  static get path() {
    return 'C:\\WINDOWS\\PROGMAN.EXE';
  }

  static get exports() {
    return [
      null,
      [WINMAIN, 'WINMAIN', 10, [HINSTANCE, HINSTANCE, FARPTR, UINT], INT],
      [FRAMEWNDPROC, 'FRAMEWNDPROC', 10, [HWND, UINT, WPARAM, LPARAM], LRESULT],
    ];
  }

  static stub() {
    console.log('Stub called!');
  }
}
