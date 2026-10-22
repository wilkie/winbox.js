'use strict';

import { expectedWindowsVersion, moduleFlag2000 } from '../module.js';

/**
 * The Windows version the module of a handle or instance was made for, as
 * `CreateWindow` asks it (`KRNL386.EXE` seg1 `4f02`-`4f27`): `GetExePtr`'s
 * module, its word 3Eh in AX -- the file's header's, but KERNEL's own the
 * Windows version, 3.10, which KERNEL sets on itself as it starts (seg1
 * `c285`-`c288`) -- and its flag 2000h in DX (`moduleFlag2000`). For a
 * handle of no module, nought in AX and DX as it was. **Recorded** by
 * `lbmark` and `modnum`. As the Rust engine's `get_exp_win_ver`.
 */
export function GetExpWinVer(this: any, instance: number) {
  const version = expectedWindowsVersion(this, instance);

  if (version === undefined) {
    return ((this.machine.cpu.core.dx & 0xffff) << 16) >>> 0;
  }

  return ((moduleFlag2000(this, instance) << 16) | (version & 0xffff)) >>> 0;
}
