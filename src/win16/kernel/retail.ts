'use strict';

/**
 * KERNEL's calls that do nothing in the retail Windows 3.1 -- the checks
 * and messages of the debugging version, and what a debugger is told --
 * each as `KRNL386.EXE` has it.
 */

/**
 * Nothing done, and AX and DX left as they were: a bare `RETF` or one
 * that pops the arguments. `EnableDos`, `DisableDos` and `EnableKernel`
 * (seg1 `9c8e`-`9c90`), `KbdRst` (`4638`), `_DEBUGOUTPUT` (`94ce`), `K329`
 * (`94c5`), `ValidateCodeSegments` (seg2 `2ab7`); and `LogError` and
 * `LogParamError`, which tell a debugger through `INT 41h` where one is
 * there and do nothing else (seg1 `94cf`, `94f2`, `9a50`-`9a75`).
 */
export function nothing(this: any) {
  return undefined;
}

/**
 * Nought in DX and AX: `LimitEmsPages` (seg1 `4632`, `XOR AX,AX; CWD`) and
 * `GetCurPID` (`4639`-`4647`). **Recorded** by `ktask`.
 */
export function nought(this: any) {
  return 0;
}

/**
 * Nought in AX: the retail `GetWinDebugInfo` and `SetWinDebugInfo` (seg1
 * `9f2a`, `9f36`, `SUB AX,AX`), which have no debugging options to give or
 * take. **Recorded** by `ktask`.
 */
export function noughtWord(this: any) {
  return 0;
}

/**
 * The word at D50h of KERNEL's data (seg1 `a70e`-`a71c`): its diagnostic
 * mode, set as Windows is started to keep a log of its start, nought
 * otherwise. **Recorded** by `ktask`: nought.
 */
export function DiagQuery(this: any) {
  return 0;
}

/**
 * The procedure KERNEL calls as a program fails, given; the one it had
 * answered (seg1 `9ecf`-`9ee8`, the double word at 304h of its data).
 * **Recorded** by `ktask`: nought first, then the procedure given.
 */
export function FatalExitHook(this: any, lpfnHook: number) {
  const before = this._fatalExitHook ?? 0;

  this._fatalExitHook = lpfnHook >>> 0;

  return before >>> 0;
}

/**
 * The free pages DPMI's function 0500h counts, where KERNEL runs with
 * paging (bit 3 of the byte at 325h of its data); FFFFFFFFh where it does
 * not (seg1 `127e`-`12ad`). **Recorded** by `ktask`: FFFFFFFFh in standard
 * mode.
 */
export function GetFreeMemInfo(this: any) {
  return 0xffffffff;
}

/**
 * A letter made small as KERNEL makes one for `Reserved5` (seg1 `8400`-
 * `8424`): A to Z, and C0h to DEh but D7h.
 */
function lower(code: number) {
  if (code >= 0x41 && code <= 0x5a) {
    return code + 0x20;
  }

  return code >= 0xc0 && code <= 0xde && code !== 0xd7 ? code + 0x20 : code;
}

/**
 * Two strings compared, letters made small (`Reserved5`, ordinal 87, seg1
 * `838e`-`83bf`): -1 where the first comes first, 1 where it comes after,
 * nought where they are alike. **Recorded** by `ktask`.
 */
export function Reserved5(this: any, lpsz1: number, lpsz2: number) {
  const core = this.machine.cpu.core;
  const first = { segment: (lpsz1 >>> 16) & 0xffff, offset: lpsz1 & 0xffff };
  const second = { segment: (lpsz2 >>> 16) & 0xffff, offset: lpsz2 & 0xffff };

  for (let at = 0; ; at++) {
    const a = core.read8(first.segment, (first.offset + at) & 0xffff) & 0xff;
    const b = core.read8(second.segment, (second.offset + at) & 0xffff) & 0xff;

    if (!a) {
      return b ? -1 : 0;
    }

    if (!b) {
      return 1;
    }

    if (lower(a) !== lower(b)) {
      return lower(a) < lower(b) ? -1 : 1;
    }
  }
}
