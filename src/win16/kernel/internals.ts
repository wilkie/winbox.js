'use strict';

import { FatalAppExit } from './FatalAppExit.js';
import { GlobalHandle } from './GlobalHandle.js';
import { LocalInit } from './LocalInit.js';
import { segmentSelector } from '../selectors.js';
import { timeGetSystemTime } from '../mmsystem/time.js';

/**
 * KERNEL's internal calls that a program can reach and that WinBox answers
 * as `KRNL386.EXE` does: the import the loader could not bind, the chain of
 * WinOldAp's hooks, and the calls left from real mode and the debugging
 * build whose answers are only what their code leaves in AX and DX.
 * **Recorded** by `undefdl` and `kintrnl` (`kb/topics/kernel-internals.md`).
 */

/** KERNEL's text at 9BAh of its data, which `UndefDynlink` ends a program with. */
export const UNDEFINED_DYNALINK = 'Call to Undefined Dynalink';

/** The ordinal of `UndefDynlink`, where KERNEL's loader binds what it cannot find. */
export const UNDEF_DYNLINK_ORDINAL = 120;

/**
 * Where an import the loader could not find was bound: `FatalAppExit`'s
 * routine with nought and KERNEL's own text (seg1 `72d4`-`72eb`, the
 * routine at `5cdf`), the box "Application Error" and the program ended.
 * **Recorded** by `undefdl`, the box on its screen.
 */
export async function UndefDynlink(this: any) {
  await FatalAppExit.call(this, 0, UNDEFINED_DYNALINK);
}

/**
 * The profiles KERNEL holds written back (seg1 `708b`-`714f`). WinBox
 * writes a profile at each write, so none waits; then the routine only
 * loads its data segment through AX (`7092`) and AX is left KERNEL's data
 * selector, DX as it was. **Recorded** by `kintrnl`.
 */
export function WriteOutProfiles(this: any) {
  return this._moduleData?.KERNEL ?? 0;
}

/**
 * The procedure `LoadModule` calls for a task of a module flagged 08h,
 * kept at 25Dh of KERNEL's data (seg1 `8014`-`802b`): the pointer's
 * selector is left in AX (`8023`), DX as it was. **Recorded** by
 * `kintrnl`, which also found the procedure not called for a program
 * whose header has flag 08h; nothing else reads it, so WinBox keeps none.
 */
export function InitTask1(this: any, lpfn: number) {
  return (lpfn >>> 16) & 0xffff;
}

/**
 * A debugger's procedure for KERNEL's events (seg3 `081d`-`0849`): the
 * procedure's selector is left in AX (`0833`), DX as it was. WinBox tells
 * no debugger of its events, so none is kept. **Recorded** by `kintrnl`.
 */
export function RegisterPtrace(this: any, lpfn: number) {
  return (lpfn >>> 16) & 0xffff;
}

/**
 * Where `SwapRecording` pushes its own return for KERNEL's parameter error
 * (seg3 `0151`), which it pops into DX on its way out (`0162`).
 */
const SWAP_RECORDING_RETURN = 0x0167;

/**
 * The debugging build's recording of segment swaps (seg3 `014e`-`0167`):
 * the flag left in AX (`0154`) and DX the offset popped (`0162`). A flag
 * above 2 goes to KERNEL's parameter error as a warning first, which the
 * retail build carries on from (seg1 `949b`-`94c4`). **Recorded** by
 * `kintrnl`: 0, 2, 3 and 1234h each in AX, 167h in DX.
 */
export function SwapRecording(this: any, flag: number) {
  return ((SWAP_RECORDING_RETURN << 16) | (flag & 0xffff)) >>> 0;
}

/**
 * `EMSCopy` (160), left from the real-mode KERNEL's expanded memory: its
 * routine (seg1 `a940`-`a94a`) is never reached. KERNEL cuts its first code
 * segment at A940h as start-up ends (seg1 `b565`-`b573`), so the entry lies
 * one byte past the segment's limit. On a 386 a far call there is a general
 * protection fault; DOSBox checks no offset against a code segment's limit
 * and runs what lies in memory past it. That is the block the global heap
 * gave next: `MMSYSTEM.DLL`'s first code segment, loaded at start-up, whose
 * first routine is `timeGetSystemTime` (`MMSYSTEM.DLL` seg1 `0000`-`0026`,
 * `RETF 6`). **Recorded** by `emspast`, which found the block and its bytes,
 * and by `emscopy`: seven noughts give 81h, `TIMERR_STRUCT` for a size
 * under 8, DX kept, six bytes popped.
 */
export function EMSCopy(this: any, lpTime: number, uSize: number) {
  return timeGetSystemTime.call(this, lpTime, uSize);
}

/**
 * The handler for a fault at an address, from its module's `__GP` table,
 * trusted only for GDI, USER, KERNEL, PENWIN, DISPLAY and MMSYSTEM (seg1
 * `4c72`-`4d36`). No module of WinBox's has such a table, and a program's
 * own module is not trusted: nought, DX as it was. **Recorded** by
 * `kintrnl` for the probe's code, its data and nought.
 */
export function HasGPHandler(this: any, _address: number) {
  return 0;
}

/**
 * A record added to the chain of WinOldAp's hooks, or taken from it
 * (seg2 `0689`-`06f0`), in standard mode, which WinBox reports. A flag
 * whose low byte is not nought puts the record at the head, its first
 * four bytes the old head: 1. Nought takes it out, its link put where it
 * was linked from: 1, or nought where it is not in the chain. DX is kept.
 * The procedures are never called: WinBox runs no DOS session.
 * **Recorded** by `kintrnl`.
 */
export function RegisterWinOldApHook(this: any, lpRecord: number, flag: number) {
  const core = this._machine.cpu.core;
  const record = lpRecord >>> 0;
  const head = (this._winOldApHooks ?? 0) >>> 0;
  const link = (at: number) =>
    (core.read16(at >>> 16, at & 0xffff) | (core.read16(at >>> 16, (at + 2) & 0xffff) << 16)) >>> 0;
  const setLink = (at: number, value: number) => {
    core.write16(at >>> 16, at & 0xffff, value & 0xffff);
    core.write16(at >>> 16, (at + 2) & 0xffff, (value >>> 16) & 0xffff);
  };

  if (flag & 0xff) {
    setLink(record, head);
    this._winOldApHooks = record;
    return 1;
  }

  if (head === record) {
    this._winOldApHooks = link(record);
    return 1;
  }

  for (let at = head; at; at = link(at)) {
    if (link(at) === record) {
      setLink(at, link(record));
      return 1;
    }
  }

  return 0;
}

/** The head of the chain `RegisterWinOldApHook` keeps, the far pointer at 336h of KERNEL's data (seg2 `06f3`-`0705`). */
export function GetWinOldApHooks(this: any) {
  return (this._winOldApHooks ?? 0) >>> 0;
}

/**
 * The end of the session (`KRNL386.EXE` seg1 `9d6f`-`9e09`): every
 * library's exit procedure, the drivers off, the profiles written, DOS
 * given back with `DisableKernel`, and DOS's exit with the code, or a
 * restart for 43h. It never returns. WinBox's end of the session, as its
 * `ExitWindows` ends it. Not measured: under DOSBox it would end the
 * recording.
 */
export function ExitKernel(this: any, _wExitCode: number) {
  this.scheduler.task?.end();
}

/**
 * A code segment's prologues patched (`KRNL386.EXE` seg1 `7bac`-`7ca5`):
 * AX the handle given, DX its block's selector, or nought where it names
 * no block (seg1 `0ede`). WinBox's loader patches every code segment's
 * prologues as it loads the module, as KERNEL's loader calls this for
 * each one it loads (`patchPrologues`, seg1 `7af3`), and patching again
 * changes nothing: a prologue made `nop`s, `mov ax,ds` or `mov ax,DGROUP`
 * is not one the routine patches. **Recorded** by `kgaps`: the probe's
 * code segment, its data segment, a block of its own -- AX the handle, DX
 * the selector -- and nought, AX and DX nought; the probe's exported
 * prologue three `nop`s before and after.
 */
export function PatchCodeHandle(this: any, hSeg: number) {
  const handle = hSeg & 0xffff;
  const selector = handle ? (GlobalHandle.call(this, handle) >>> 16) & 0xffff : 0;

  return ((selector << 16) | handle) >>> 0;
}

/**
 * What `SI` holds as `InitLib` returns: left from KERNEL's own use
 * (`KRNL386.EXE` seg2 `27b0`, `mov si,842Ah`).
 */
const INIT_LIB_SI = 0x842a;

/**
 * A library's start-up in registers (`KRNL386.EXE` seg2 `2797`-`27b3`): CX
 * the size of its local heap, DS its data. With CX nought, AX nought;
 * otherwise `LocalInit(0, 0, CX)`, the heap the last CX bytes of DS, its
 * answer in AX, and CX kept unless it left CX nought. ES is KERNEL's data,
 * SI 842Ah, DS as it came; nothing popped. **Recorded** by `kgaps`.
 */
export function InitLib(this: any) {
  const core = this.machine.cpu.core;
  const cx = core.cx & 0xffff;
  const ds = core.ds & 0xffff;

  core.ax = 0;

  if (cx) {
    core.ax = LocalInit.call(this, 0, 0, cx) & 0xffff;
  }

  core.cx = cx;
  core.ds = ds;
  core.es = this._moduleData?.KERNEL ?? 0;
  core.si = INIT_LIB_SI;
}

/**
 * The word at 271h of KERNEL's data, which `WinOldApCall(0)` answers in DI:
 * set as KERNEL starts from the DOS it runs on (seg1 `b9cd`-`b9f5`, the
 * routine at `ba10`). **Recorded** by `kgaps` on DOSBox's DOS, as WinBox's
 * is: 10h.
 */
const WINOLDAP_DOS_WORD = 0x10;

/**
 * Standard mode's WinOldAp asking KERNEL (`KRNL386.EXE` seg3 `07e6`-`081a`).
 * Not nought: KERNEL's cached module files closed for its own prefix
 * (seg1 `534c`), which leaves DX that prefix; BX is SP as the routine
 * found it after pushing DS (`07ea`). Nought: AX, BX, CX and DX the words
 * at 251h-257h of KERNEL's data, which nothing writes, and DI the word at
 * 271h. WinBox keeps no module file open. **Recorded** by `kgaps`.
 */
export function WinOldApCall(this: any, wFlag: number) {
  const core = this.machine.cpu.core;

  if (wFlag & 0xffff) {
    core.bx = (core.sp - 2) & 0xffff;
    core.dx = kernelPdb(this);
    return;
  }

  core.ax = 0;
  core.bx = 0;
  core.cx = 0;
  core.dx = 0;
  core.di = WINOLDAP_DOS_WORD;
}

/**
 * KERNEL's own prefix, the word at 220h of its data: in Windows each
 * task's prefix's parent (word 16h), as `kgaps` found it. WinBox keeps no
 * prefix of KERNEL's, and a task's prefix has no parent: the running
 * task's word 16h, nought (`kgaps:kernelpdb`, a known gap).
 */
export function kernelPdb(system: any) {
  const task = system.scheduler?.task;
  const pdb = task?.programSegment ? segmentSelector(task.programSegment) : 0;

  return pdb ? system.machine.cpu.core.read16(pdb, 0x16) & 0xffff : 0;
}

/**
 * A procedure for KERNEL's events, exchanged with the one kept at 310h of
 * its data (`KRNL386.EXE` seg3 `084c`-`0885`): the old one in DX:AX, BX the
 * new one's offset and selector or'd together (`0862`-`0864`). WinBox
 * tells no debugger of its events, so the procedure is kept and never
 * called, as `RegisterPtrace`'s is not. **Recorded** by `kgaps`: nought
 * first, then the procedure given.
 */
export function ToolHelpHook(this: any, lpfnNotify: number) {
  const old = (this._toolHelpHook ?? 0) >>> 0;
  const given = lpfnNotify >>> 0;

  this._toolHelpHook = given;
  this.machine.cpu.core.bx = (given | (given >>> 16)) & 0xffff;

  return old;
}

/**
 * The address KERNEL makes its DOS calls through, exchanged
 * (`KRNL386.EXE` seg1 `9eaf`-`9ecc`): the far pointer at 3Ch of its code
 * segment, the `INT 21h` vector it found before it put in its own, through
 * which it makes its DOS calls and passes on a program's. WinBox's KERNEL
 * has nothing beneath it and makes its DOS calls itself: nought until a
 * procedure is given, which is kept and answered back, and never called.
 * **Recorded** by `kgaps`: the procedure given back; the first answer,
 * neither nought nor KERNEL's own code, is a known gap
 * (`kgaps:dosprocold`).
 */
export function GetSetKernelDosProc(this: any, lpfnNewProc: number) {
  const old = this._kernelDosProc ?? 0;

  this._kernelDosProc = lpfnNewProc >>> 0;

  return old >>> 0;
}

/** A warning's bit in `K327`'s code (seg1 `94af`). */
const PARAMETER_WARNING = 0x8000;

/**
 * The end of a parameter check in USER, GDI or KERNEL (`KRNL386.EXE` seg1
 * `949b`-`94c4`), reached by a far jump with BX the code, CX:AX the value
 * and a far return into the check on the stack, above it the offset of the
 * API's `RETF` and its caller's BP. `LogParamError` tells no one in the
 * retail build. A warning, bit 15, returns to the check, every register
 * kept. Otherwise the frame is unwound: BX the offset popped, BP the
 * caller's with its low bit cleared, and the return made to that offset in
 * the check's segment with AX, CX, DX and ES nought. **Recorded** by
 * `kgaps`.
 */
export function K327(this: any) {
  const core = this.machine.cpu.core;

  if (core.bx & PARAMETER_WARNING) {
    return;
  }

  const ss = core.ss & 0xffff;
  const sp = core.sp & 0xffff;
  const cs = core.read16(ss, (sp + 2) & 0xffff);
  const offset = core.read16(ss, (sp + 4) & 0xffff);
  const bp = core.read16(ss, (sp + 6) & 0xffff);
  const top = (sp + 4) & 0xffff;

  core.write16(ss, top, offset);
  core.write16(ss, (top + 2) & 0xffff, cs);
  core.sp = top;
  core.bp = bp & ~1 & 0xffff;
  core.bx = offset;
  core.ax = 0;
  core.cx = 0;
  core.dx = 0;
  core.es = 0;
}
