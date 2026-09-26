'use strict';

/** @namespace ToolHelp */

import { Module } from './module.js';
import { BOOL, FARPTR, HANDLE, UINT } from './types.js';

/**
 * The tool helper library, `TOOLHELP.DLL`, as a module programs import from.
 *
 * Windows' own file walks KERNEL's private structures -- its start-up asks
 * `GlobalMasterHandle` for the global heap's arena -- which winbox.js's
 * KERNEL does not have, so it is kept here instead, as KERNEL, USER and GDI
 * are. The ordinals, names and argument sizes are the installation's own
 * file's. Object Packager imports `NotifyRegister` and `NotifyUnRegister`,
 * and Dr. Watson `InterruptRegister`, which answering nought made it say it
 * could not install itself.
 *
 * @memberof Win16
 */
export class ToolHelp extends Module {
  static get name(): string {
    return 'TOOLHELP';
  }

  static get path() {
    return 'C:\\WINDOWS\\SYSTEM\\TOOLHELP.DLL';
  }

  static get exports() {
    const exports: any[] = [];

    exports[1] = [ToolHelp.stub, 'WEP', 2];
    exports[50] = [ToolHelp.stub, 'GlobalHandleToSel', 2];
    exports[51] = [ToolHelp.stub, 'GlobalFirst', 6];
    exports[52] = [ToolHelp.stub, 'GlobalNext', 6];
    exports[53] = [ToolHelp.stub, 'GlobalInfo', 4];
    exports[54] = [ToolHelp.stub, 'GlobalEntryHandle', 6];
    exports[55] = [ToolHelp.stub, 'GlobalEntryModule', 8];
    exports[56] = [ToolHelp.stub, 'LocalInfo', 6];
    exports[57] = [ToolHelp.stub, 'LocalFirst', 6];
    exports[58] = [ToolHelp.stub, 'LocalNext', 4];
    exports[59] = [ToolHelp.stub, 'ModuleFirst', 4];
    exports[60] = [ToolHelp.stub, 'ModuleNext', 4];
    exports[61] = [ToolHelp.stub, 'ModuleFindName', 8];
    exports[62] = [ToolHelp.stub, 'ModuleFindHandle', 6];
    exports[63] = [ToolHelp.stub, 'TaskFirst', 4];
    exports[64] = [ToolHelp.stub, 'TaskNext', 4];
    exports[65] = [ToolHelp.stub, 'TaskFindHandle', 6];
    exports[66] = [ToolHelp.stub, 'StackTraceFirst', 6];
    exports[67] = [ToolHelp.stub, 'StackTraceCSIPFirst', 12];
    exports[68] = [ToolHelp.stub, 'StackTraceNext', 4];
    exports[69] = [ToolHelp.stub, 'ClassFirst', 4];
    exports[70] = [ToolHelp.stub, 'ClassNext', 4];
    exports[71] = [ToolHelp.stub, 'SystemHeapInfo', 4];
    exports[72] = [ToolHelp.stub, 'MemManInfo', 4];
    exports[73] = [NotifyRegister, 'NotifyRegister', 8, [HANDLE, FARPTR, UINT], BOOL];
    exports[74] = [NotifyUnRegister, 'NotifyUnRegister', 2, [HANDLE], BOOL];
    exports[75] = [InterruptRegister, 'InterruptRegister', 6, [HANDLE, FARPTR], BOOL];
    exports[76] = [InterruptUnRegister, 'InterruptUnRegister', 2, [HANDLE], BOOL];
    exports[77] = [ToolHelp.stub, 'TerminateApp', 4];
    exports[78] = [ToolHelp.stub, 'MemoryRead', 14];
    exports[79] = [ToolHelp.stub, 'MemoryWrite', 14];
    exports[80] = [ToolHelp.stub, 'TimerCount', 4];
    exports[81] = [ToolHelp.stub, 'TaskSetCSIP', 6];
    exports[82] = [ToolHelp.stub, 'TaskGetCSIP', 2];
    exports[83] = [ToolHelp.stub, 'TaskSwitch', 6];

    return exports;
  }

  static stub() {
    console.log('Stub called!');
  }
}

/**
 * A procedure registered to be told of what happens in the system: tasks
 * and modules starting and ending, and the like (documented). The
 * registration is kept and answered TRUE; nothing is told yet.
 */
export function NotifyRegister(this: any, hTask: number, lpfnCallback: number, wFlags: number) {
  (this._notifications ??= new Map<number, { proc: number; flags: number }>()).set(
    hTask & 0xffff,
    { proc: lpfnCallback >>> 0, flags: wFlags & 0xffff }
  );

  return 1;
}

/** A task's notification procedure taken away: whether it had one (documented). */
export function NotifyUnRegister(this: any, hTask: number) {
  return this._notifications?.delete(hTask & 0xffff) ? 1 : 0;
}

/**
 * A procedure registered to be called on a fault or an interrupt a task
 * takes (documented). The registration is kept and answered TRUE; no fault
 * is passed to it yet.
 */
export function InterruptRegister(this: any, hTask: number, lpfnIntCallback: number) {
  (this._interruptHandlers ??= new Map<number, number>()).set(hTask & 0xffff, lpfnIntCallback >>> 0);

  return 1;
}

/** A task's interrupt procedure taken away: whether it had one (documented). */
export function InterruptUnRegister(this: any, hTask: number) {
  return this._interruptHandlers?.delete(hTask & 0xffff) ? 1 : 0;
}
