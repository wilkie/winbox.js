'use strict';

import { Kernel } from '../kernel.js';
import type { WindowsMode } from '../../emulator/machine.js';

/**
 * The **GetWinFlags** function retrieves the current system and memory
 * configuration.
 *
 * The configuration returned by **GetWinFlags** can be a combination of the
 * following values:
 *
 * | Flag             | Description                                            |
 * |------------------|--------------------------------------------------------|
 * |**`WF_80x87`**    | System contains an Intel math coprocessor.             |
 * |**`WF_CPU286`**   | System CPU is an 80286.                                |
 * |**`WF_CPU386`**   | System CPU is an 80386.                                |
 * |**`WF_CPU486`**   | System CPU is an i486.                                 |
 * |**`WF_ENHANCED`** | The system is running in 386-enhanced mode. The `WF_PMODE` flag is always set when `WF_ENHANCED` is. |
 * |**`WF_PAGING`**   | The system is running on a system with paged memory.   |
 * |**`WF_PMODE`**    | The system is running in protected mode. This flag is always set. |
 * |**`WF_STANDARD`** | The system is running in standard mode. The `WF_PMODE` flag is always set when `WF_STANDARD` is set. |
 * |**`WF_WIN286`**   | Same as `WF_STANDARD`.                                 |
 * |**`WF_WIN386`**   | Same as `WF_ENHANCED`.                                 |
 *
 * @static
 * @function GetWinFlags
 * @memberof Kernel
 *
 * @returns {Types.DWORD} The return value specifies the current system and
 *                        memory configuration.
 */
export function GetWinFlags(this: any) {
  return winFlags(this?.machine?.coprocessor !== false, this?.machine?.mode ?? 'standard');
}

/**
 * The flags, as `GetWinFlags` answers them and KERNEL exports them as
 * `__WINFLAGS`. **Recorded** by `winflags`: 419h in standard mode, the
 * Windows the recordings are made on -- protected mode, standard mode, a
 * 486, and a coprocessor, which DOSBox provides; and C29h in 386 enhanced
 * mode (`enhanced/winflags`, `enhanced/dpmiver`) -- protected mode,
 * enhanced mode, a 486, a coprocessor and paging. KERNEL sets
 * `WF_PMODE|WF_ENHANCED` or `WF_PMODE|WF_STANDARD` by what INT 2Fh 1600h
 * answers as it starts (`KRNL386.EXE` seg1 `aa76`-`aa90`). The
 * coprocessor's bit follows the machine's.
 */
export function winFlags(coprocessor: boolean, mode: WindowsMode = 'standard') {
  const modeFlags =
    mode === 'enhanced' ? Kernel.WF_ENHANCED | Kernel.WF_PAGING : Kernel.WF_STANDARD;

  return Kernel.WF_PMODE | modeFlags | Kernel.WF_CPU486 | (coprocessor ? Kernel.WF_80x87 : 0);
}
