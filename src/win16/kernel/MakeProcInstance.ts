'use strict';

import { GlobalAlloc } from './GlobalAlloc.js';
import { globalPointer } from './GlobalLock.js';
import { segmentSelector } from '../selectors.js';

/**
 * A procedure given its instance's data segment: a thunk that loads it into
 * AX and jumps to the procedure, `mov ax, <data segment>` then `jmp far`,
 * eight bytes. A program's exported function takes its data segment from AX
 * -- KERNEL patches its prologue to three `nop`s (see `library.ts`) -- so a
 * procedure a program hands to Windows to call goes through one of these.
 * For a library, whose functions load their own data segment, the procedure
 * is answered as it is (`KRNL386.EXE` seg3 `0294`, bit 15 of the module's
 * flags). A program linked with a single data segment, as Media Player is,
 * has its thunk as any program does (seg3 `033d`): KERNEL counts it as
 * having multiple data (`library.ts`). Recorded by `solodata`.
 *
 * @param {Types.FARPROC} lpProc - The procedure.
 * @param {Types.HINSTANCE} hinst - The instance whose data it is to find.
 *
 * @returns {Types.FARPROC} The thunk, or the procedure itself.
 */
export function MakeProcInstance(this: any, lpProc: number, hinst: number) {
  const task = this.handles.resolve(hinst & 0xffff);
  const loader = task?.loader;

  if (!loader?.ds || !task?.executable || task.executable.neHeader.flags & 0x8000) {
    return lpProc;
  }

  const ds = segmentSelector(loader.translate(loader.ds));

  return thunk(this, lpProc >>> 0, ds);
}

/** Eight bytes of code in a block kept for thunks: `mov ax, ds` then `jmp far proc`. */
function thunk(system: any, proc: number, ds: number) {
  const state = (system._thunks ??= { far: 0, used: THUNKS });

  if (state.used >= THUNKS) {
    state.far = globalPointer.call(system, GlobalAlloc.call(system, 0x42, THUNKS * 8)) >>> 0;
    state.used = 0;
  }

  const core = system.machine.cpu.core;
  const segment = state.far >>> 16;
  const offset = (state.far & 0xffff) + state.used * 8;
  const bytes = [
    0xb8,
    ds & 0xff,
    ds >> 8,
    0xea,
    proc & 0xff,
    (proc >> 8) & 0xff,
    (proc >> 16) & 0xff,
    proc >>> 24,
  ];

  bytes.forEach((byte, at) => core.write8(segment, offset + at, byte));
  state.used++;

  return ((segment << 16) | offset) >>> 0;
}

const THUNKS = 512;
