'use strict';

/**
 * GDI's TrueType engine as a printer driver asks it: `EngineRealizeFont`.
 * The twin of `crates/winbox-win16/src/gdi/engine_font.rs`.
 *
 * **Read out** of `GDI.EXE` seg3 `2b2d`-`2b54`:
 *
 * * With TrueType off GDI has no TrueType table, and the answer is nought
 *   (`2b3b`).
 * * A `LOGFONT` with no face and a height of nought answers nought.
 * * Any other, with no `FONTINFO` to fill, answers 96h, the size of the
 *   `FONTINFO` GDI would realize (`2b4f`).
 * * Given a `FONTINFO`, GDI maps the font among the TrueType faces and
 *   realizes it there (seg3 `2841`, `22b3`), answering 96h.
 *
 * The PostScript driver asks with no `FONTINFO` as it enables a device,
 * and keeps room for the answer, doubled (`PSCRIPT.DRV` seg5
 * `009e`-`00b5`); nought fails the device. Not followed: a `FONTINFO`
 * given to fill, which answers nought here.
 */
export function EngineRealizeFont(
  this: any,
  lpLogFont: number,
  _lpTextXform: number,
  lpFontInfo: number
) {
  if (!this.fonts || this.fonts.trueTypeOff || !lpLogFont) {
    return 0;
  }

  const core = this.machine.cpu.core;
  const segment = (lpLogFont >>> 16) & 0xffff;
  const offset = lpLogFont & 0xffff;
  const face = core.read8(segment, (offset + 0x12) & 0xffff);
  const height = core.read16(segment, offset);

  if (!face && !height) {
    return 0;
  }

  if (!(lpFontInfo >>> 16)) {
    return 0x96;
  }

  return 0;
}
