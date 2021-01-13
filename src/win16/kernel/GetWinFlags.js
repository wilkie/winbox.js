"use strict";

import { NULL } from '../consts.js';

import { Kernel } from '../kernel.js';

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
export function GetWinFlags() {
    // TODO: add a coprocessor when we can
    // TODO: negotiate using the machine cpu instance
    return Kernel.WF_PMODE | Kernel.WF_WIN386 | Kernel.WF_CPU386;
}
