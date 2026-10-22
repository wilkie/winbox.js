'use strict';

import { expectedWindowsVersion } from '../module.js';

/**
 * The Windows version the module of a handle or instance was made for, as
 * `CreateWindow` asks it (`KRNL386.EXE` seg1 `4f02`-`4f27`): `GetExePtr`'s
 * module, its word 3Eh -- the file's header's, but KERNEL's own the
 * Windows version, 3.10, which KERNEL sets on itself as it starts (seg1
 * `c285`-`c288`). Nought for a handle of no module. **Recorded** by
 * `lbmark`. The high word, the module's flag 2000h, is not answered.
 * As the Rust engine's `get_exp_win_ver`.
 */
export function GetExpWinVer(this: any, instance: number) {
  return expectedWindowsVersion(this, instance) ?? 0;
}
