'use strict';

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
export function GetRasterizerCaps(this: any, lpraststat, cb) {
  /* **Read out** of `GDI.EXE` (seg7 `0d36`): for a size above nought, six
   * bytes -- `TT_AVAILABLE` where the TrueType table has a font, `TT_ENABLED`
   * where `TTEnable` is on, and GDI's language, 409h -- AX left the language;
   * with TrueType off there is no table and no language, and the flags and the
   * answer are nought. A size of nought or less answers nought and writes
   * nothing. **Recorded** by `fontboot`. As the Rust engine's. */
  if (cb <= 0) {
    return 0;
  }

  const off = !!this.fonts?.trueTypeOff;
  const language = off ? 0 : 0x409;

  lpraststat.nSize = lpraststat.structSize;
  lpraststat.wFlags = off
    ? 0
    : ((this.fonts?.trueTypeDirectory?.length ?? 0) > 0 ? Gdi.TT_AVAILABLE : 0) | Gdi.TT_ENABLED;
  lpraststat.nLanguageID = language;

  return language;
}
