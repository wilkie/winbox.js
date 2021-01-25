"use strict";

import { TRUE, FALSE } from '../consts.js';

import { Gdi } from '../gdi.js';

/**
 * The **GetRasterizerCaps** function returns flags indicating whether TrueType
 * fonts are installed on the system.
 *
 * The **GetRasterizerCaps** function enables applications and printer drivers
 * to determine whether TrueType is installed.
 *
 * If the `TT_AVAILABLE` flag is set in the `wFlags` member of the
 * `RASTERIZER_STATUS` structure, at least one TrueType font is installed. If
 * the `TT_ENABLED` flag is set, TrueType is enabled for the system.
 *
 * **See also**:
 * {@link Gdi.GetOutlineTextMetrics GetOutlineTextMetrics}
 *
 * @static
 * @function GetRasterizerCaps
 * @memberof Gdi
 *
 * @param {Gdi.RASTERIZER_STATUS} lpraststat - Points to a `RASTERIZER_STATUS`
 *                                             structure that receives
 *                                             information about the rasterizer.
 * @param {Types.INT} cb - Specifies the number of bytes that will be copied
 *                         into the structure pointed to by the `lpraststat`
 *                         parameter.
 *
 * @return {Types.BOOL} The return value is nonzero if the function is
 *                      successful. Otherwise, it is zero.
 */
export function GetRasterizerCaps(lpraststat, cb) {
    lpraststat.nSize = lpraststat.structSize;
    lpraststat.wFlags = Gdi.TT_AVAILABLE | Gdi.TT_ENABLED;
    lpraststat.nLanguageID = 1; // TODO: language id
    return TRUE;
}
