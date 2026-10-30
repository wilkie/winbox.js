'use strict';

import { FatalAppExit } from './FatalAppExit.js';

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
