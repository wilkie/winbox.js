'use strict';

import { FARPTR, INT, LPARAM } from '../types.js';
import { enumerateTrueType, placement } from './EnumFontFamilies.js';
import { GetDeviceCaps } from './GetDeviceCaps.js';

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

/**
 * GDI's TrueType fonts for a printer driver's own walk of its fonts:
 * `EngineEnumerateFont` (`GDI.EXE` seg5 `093c`, into `0697`). Each font of
 * the TrueType directory, as `EnumFonts` gives it, at the resolution of
 * the context GDI is walking the fonts of, or 300 dots an inch with none,
 * typed `TRUETYPE_FONTTYPE` and `DEVICE_FONTTYPE`, to the driver's
 * procedure with its data. With TrueType off, nothing, and 1 answered. The
 * last answer; 1 for none.
 */
export async function EngineEnumerateFont(
  this: any,
  lpszFace: any,
  lpFontFunc: number,
  dwData: number
) {
  if (!this.fonts || this.fonts.trueTypeOff) {
    return 1;
  }

  const walking = this._fontEnumeration;
  const logX = walking ? GetDeviceCaps.call(this, walking.hdc, LOGPIXELSX) : 300;
  const logY = walking ? GetDeviceCaps.call(this, walking.hdc, LOGPIXELSY) : 300;
  const name = lpszFace ? String(lpszFace) : null;
  const answer = await enumerateTrueType(
    this,
    logX,
    logY,
    name,
    async (elf, ntm, type) => {
      const result = await this.scheduler.callProc(
        lpFontFunc >>> 0,
        [
          /* Where GDI's walk of its TrueType fonts puts them (seg5 `07f5`). */
          [[elf, ...(placement(TRUETYPE_FONTTYPE)?.lf ?? [])], FARPTR],
          [[ntm, ...(placement(TRUETYPE_FONTTYPE)?.tm ?? [])], FARPTR],
          [type, INT],
          [dwData >>> 0, LPARAM],
        ],
        this.scheduler.stackRegisters()
      );

      return ((result & 0xffff) << 16) >> 16;
    },
    DEVICE_FONTTYPE
  );

  return answer ?? 1;
}

const DEVICE_FONTTYPE = 2;
const TRUETYPE_FONTTYPE = 4;
const LOGPIXELSX = 88;
const LOGPIXELSY = 90;
