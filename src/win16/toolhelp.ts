'use strict';

/** @namespace ToolHelp */

import { Module } from './module.js';
import { GetFreeSystemResources } from './user/GetFreeSystemResources.js';
import { BOOL, DWORD, FARPTR, HANDLE, INT, LPCSTR, UINT } from './types.js';
import { ClassFirst, ClassNext } from './toolhelp/classes.js';
import {
  GlobalEntryHandle,
  GlobalEntryModule,
  GlobalFirst,
  GlobalInfo,
  GlobalNext,
} from './toolhelp/global.js';
import { LocalFirst, LocalInfo, LocalNext } from './toolhelp/local.js';
import { MemoryRead, MemoryWrite } from './toolhelp/memory.js';
import { MemManInfo, TerminateApp, TimerCount, WEP } from './toolhelp/misc.js';
import { ModuleFindHandle, ModuleFindName, ModuleFirst, ModuleNext } from './toolhelp/modules.js';
import { StackTraceCSIPFirst, StackTraceFirst, StackTraceNext } from './toolhelp/stack.js';
import { TaskFindHandle, TaskFirst, TaskGetCSIP, TaskNext } from './toolhelp/tasks.js';

/**
 * The tool helper library, `TOOLHELP.DLL`, as a module programs import from.
 *
 * Windows' own file walks KERNEL's private structures -- its start-up asks
 * `GlobalMasterHandle` for the global heap's arena and `ThHook` for the
 * heads of KERNEL's lists -- which winbox.js's KERNEL does not have, so it
 * is kept here instead, as KERNEL, USER and GDI are, answering from
 * winbox.js's own tasks, modules, heaps and classes in the shapes Windows'
 * structures give (`toolhelp/`). The ordinals, names and argument sizes are the installation's own
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

    exports[1] = [WEP, 'WEP', 2, [INT], BOOL];
    exports[50] = [GlobalHandleToSel, 'GlobalHandleToSel', 2, [HANDLE], UINT];
    exports[51] = [GlobalFirst, 'GlobalFirst', 6, [FARPTR, UINT], BOOL];
    exports[52] = [GlobalNext, 'GlobalNext', 6, [FARPTR, UINT], BOOL];
    exports[53] = [GlobalInfo, 'GlobalInfo', 4, [FARPTR], BOOL];
    exports[54] = [GlobalEntryHandle, 'GlobalEntryHandle', 6, [FARPTR, HANDLE], BOOL];
    exports[55] = [GlobalEntryModule, 'GlobalEntryModule', 8, [FARPTR, HANDLE, UINT], BOOL];
    exports[56] = [LocalInfo, 'LocalInfo', 6, [FARPTR, HANDLE], BOOL];
    exports[57] = [LocalFirst, 'LocalFirst', 6, [FARPTR, HANDLE], BOOL];
    exports[58] = [LocalNext, 'LocalNext', 4, [FARPTR], BOOL];
    exports[59] = [ModuleFirst, 'ModuleFirst', 4, [FARPTR], BOOL];
    exports[60] = [ModuleNext, 'ModuleNext', 4, [FARPTR], BOOL];
    exports[61] = [ModuleFindName, 'ModuleFindName', 8, [FARPTR, LPCSTR], HANDLE];
    exports[62] = [ModuleFindHandle, 'ModuleFindHandle', 6, [FARPTR, HANDLE], HANDLE];
    exports[63] = [TaskFirst, 'TaskFirst', 4, [FARPTR], BOOL];
    exports[64] = [TaskNext, 'TaskNext', 4, [FARPTR], BOOL];
    exports[65] = [TaskFindHandle, 'TaskFindHandle', 6, [FARPTR, HANDLE], BOOL];
    exports[66] = [StackTraceFirst, 'StackTraceFirst', 6, [FARPTR, HANDLE], BOOL];
    exports[67] = [
      StackTraceCSIPFirst,
      'StackTraceCSIPFirst',
      12,
      [FARPTR, UINT, UINT, UINT, UINT],
      BOOL,
    ];
    exports[68] = [StackTraceNext, 'StackTraceNext', 4, [FARPTR], BOOL];
    exports[69] = [ClassFirst, 'ClassFirst', 4, [FARPTR], BOOL];
    exports[70] = [ClassNext, 'ClassNext', 4, [FARPTR], BOOL];
    exports[71] = [SystemHeapInfo, 'SystemHeapInfo', 4, [FARPTR], BOOL];
    exports[72] = [MemManInfo, 'MemManInfo', 4, [FARPTR], BOOL];
    exports[73] = [NotifyRegister, 'NotifyRegister', 8, [HANDLE, FARPTR, UINT], BOOL];
    exports[74] = [NotifyUnRegister, 'NotifyUnRegister', 2, [HANDLE], BOOL];
    exports[75] = [InterruptRegister, 'InterruptRegister', 6, [HANDLE, FARPTR], BOOL];
    exports[76] = [InterruptUnRegister, 'InterruptUnRegister', 2, [HANDLE], BOOL];
    exports[77] = [TerminateApp, 'TerminateApp', 4, [HANDLE, UINT]];
    exports[78] = [MemoryRead, 'MemoryRead', 14, [UINT, DWORD, FARPTR, DWORD], DWORD];
    exports[79] = [MemoryWrite, 'MemoryWrite', 14, [UINT, DWORD, FARPTR, DWORD], DWORD];
    exports[80] = [TimerCount, 'TimerCount', 4, [FARPTR], BOOL];
    exports[81] = [ToolHelp.stub, 'TaskSetCSIP', 6];
    exports[82] = [TaskGetCSIP, 'TaskGetCSIP', 2, [HANDLE], DWORD];
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
  (this._notifications ??= new Map<number, { proc: number; flags: number }>()).set(hTask & 0xffff, {
    proc: lpfnCallback >>> 0,
    flags: wFlags & 0xffff,
  });

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
  (this._interruptHandlers ??= new Map<number, number>()).set(
    hTask & 0xffff,
    lpfnIntCallback >>> 0
  );

  return 1;
}

/** A task's interrupt procedure taken away: whether it had one (documented). */
export function InterruptUnRegister(this: any, hTask: number) {
  return this._interruptHandlers?.delete(hTask & 0xffff) ? 1 : 0;
}

/**
 * A global handle's selector: the handle with its lowest bit set, which
 * makes a moveable block's handle the selector `GlobalLock` gives, leaves a
 * fixed block's -- its own selector -- as it is, and makes nought 1
 * (`sysheap`).
 *
 * @param {Types.HANDLE} hglb - The handle.
 *
 * @returns {Types.UINT} The selector.
 */
export function GlobalHandleToSel(this: any, hglb: number) {
  return (hglb | 1) & 0xffff;
}

/**
 * How full USER's and GDI's heaps are, and their data segments. **Recorded**
 * by `sysheap`: with the structure's size in `dwSize` it answers `TRUE`,
 * the percentages `GetFreeSystemResources` gives for USER and for GDI, and
 * the two modules' data segments' selectors, each one above its module's
 * instance; with another size, `FALSE` and nothing written.
 *
 * @param {Types.FARPTR} lpSysHeap - The `SYSHEAPINFO`.
 *
 * @returns {Types.BOOL} Whether it was filled in.
 */
export function SystemHeapInfo(this: any, lpSysHeap: number) {
  const core = this.machine.cpu.core;
  const segment = (lpSysHeap >>> 16) & 0xffff;
  const offset = lpSysHeap & 0xffff;
  const at = (delta: number) => (offset + delta) & 0xffff;

  if (!lpSysHeap || core.read16(segment, offset) !== 12 || core.read16(segment, at(2)) !== 0) {
    return 0;
  }

  core.write16(segment, at(4), GetFreeSystemResources.call(this, 2));
  core.write16(segment, at(6), GetFreeSystemResources.call(this, 1));
  core.write16(segment, at(8), this._moduleData?.USER ?? 0);
  core.write16(segment, at(10), this._moduleData?.GDI ?? 0);

  return 1;
}
