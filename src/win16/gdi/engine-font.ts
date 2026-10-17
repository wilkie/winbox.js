'use strict';

import { FARPTR, INT, LPARAM } from '../types.js';
import { enumerateTrueType, placement } from './EnumFontFamilies.js';
import { GetDeviceCaps } from './GetDeviceCaps.js';
import { MulDiv } from './MulDiv.js';
import { FontManager } from '../font-manager.js';

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
 *   realizes it there (seg3 `2841`, `22b3`), answering 96h; see
 *   `realizeTrueType`. It needs the device context whose font is being
 *   realized (`[064Eh]`), and answers nought without one.
 *
 * The PostScript driver asks with no `FONTINFO` as it enables a device,
 * and keeps room for the answer, doubled (`PSCRIPT.DRV` seg5
 * `009e`-`00b5`); nought fails the device.
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

  return realizeTrueType(this, lpLogFont >>> 0, _lpTextXform >>> 0, lpFontInfo >>> 0);
}

/**
 * A TrueType font realized into a `FONTINFO` a driver gave, and its
 * `TEXTXFORM` filled (`GDI.EXE` seg3 `2841`, `22b3`, `220b`, `21b6`):
 *
 * * The face mapped among the TrueType faces -- here, the face named, in
 *   the weight and slant asked for -- and settled at a size as the mapper
 *   settles one (`realiseOutline`): a negative height is the em; a positive
 *   one the cell.
 * * The header from the face's `.FOT` stub, in its font units over its em,
 *   at that size (`220b`): the points, 72 times the em over the vertical
 *   resolution; the resolutions the context's logical ones; the ascent and
 *   the cell's height as the rasterizer has them, where the text is upright
 *   and its slant not made (`2506`); the internal leading the cell less the
 *   em; the external leading, the average and widest widths scaled -- the
 *   average the width asked for where there is one; the italic flag the
 *   face's, or FFh for a slant GDI makes; underline, strike-out, weight,
 *   character set, pitch and family, and the first, last, default and
 *   break characters the stub's. The type 3, the face's name at 6Eh, and
 *   the escapement (48h), the stretch (4Ah) and the em (4Ch).
 * * The `TEXTXFORM` from it (`21b6`): the height the cell's, the width the
 *   average, the escapement and orientation the escapement, the weight,
 *   italic, underline and strike-out the header's, the rest nought.
 *
 * The answer is 96h, or nought where no face answers. Not followed: GDI's
 * penalties among faces not named, the underline and strike-out metrics at
 * 34h-3Ah, and the flags `6de2` adds.
 */
function realizeTrueType(system: any, lpLogFont: number, lpTextXform: number, lpFontInfo: number) {
  const realizing = system._realizingFont;
  const caps = realizing?.surface?.device?.gdiInfo as Uint8Array | undefined;

  if (!caps) {
    return 0;
  }

  const core = system.machine.cpu.core;
  const word = (far: number, at: number) => core.read16(far >>> 16, ((far & 0xffff) + at) & 0xffff);
  const signed = (far: number, at: number) => (word(far, at) << 16) >> 16;
  const byte = (far: number, at: number) => core.read8(far >>> 16, ((far & 0xffff) + at) & 0xffff);
  const put16 = (far: number, at: number, value: number) =>
    core.write16(far >>> 16, ((far & 0xffff) + at) & 0xffff, value & 0xffff);
  const put8 = (far: number, at: number, value: number) =>
    core.write8(far >>> 16, ((far & 0xffff) + at) & 0xffff, value & 0xff);
  let face = '';

  for (let at = 0x12; at < 0x12 + 0x20; at++) {
    const code = byte(lpLogFont, at);

    if (!code) {
      break;
    }

    face += String.fromCharCode(code);
  }

  const height = signed(lpLogFont, 0);
  const width = signed(lpLogFont, 2);
  const escapement = signed(lpLogFont, 4);
  const weight = signed(lpLogFont, 8);
  const italic = byte(lpLogFont, 0x0a);
  const found = system.fonts?.outline(face, weight > 550, !!italic);
  const stub = found?.font?.resource;

  if (!found || !stub) {
    return 0;
  }

  const capsWord = (at: number) => caps[at] | (caps[at + 1] << 8);
  const logX = capsWord(0x58);
  const logY = capsWord(0x5a);
  const sized = FontManager.realiseOutline(found.font, {
    height,
    width,
    escapement,
    italic,
    weight,
    logPixelsY: logY,
    aspectX: capsWord(0x28),
    aspectY: capsWord(0x2a),
  });

  if (!sized) {
    return 0;
  }

  const ppem = sized.ppem;
  const em = stub.sizeEM;
  const scale = 0x100;
  const across = MulDiv(em, logY, (logX * scale) >> 8);
  const made = !!italic && !stub.italic;
  const angle = escapement ? ((escapement % 3600) + 3600) % 3600 : 0;
  let ascent = MulDiv(stub.ascent, ppem, em);
  let cell = ascent + MulDiv(stub.cellHeight - stub.ascent, ppem, em);

  /* The rasterizer's own ascent and cell, upright and not slanted by GDI
   * (`24dd`-`251e`). */
  if (!angle && !made) {
    ascent = sized.ascent;
    cell = sized.ascent + sized.descent;
  }

  const fi = lpFontInfo;

  put16(fi, 0, 3);
  put16(fi, 2, Math.trunc((72 * ppem) / logY));
  put16(fi, 4, logY);
  put16(fi, 6, logX);
  put16(fi, 8, ascent);
  put16(fi, 0x0a, cell - ppem);
  put16(fi, 0x0c, MulDiv(stub.externalLeading, ppem, em));
  put8(fi, 0x0e, made ? 0xff : stub.italic);
  put8(fi, 0x0f, stub.underline);
  put8(fi, 0x10, stub.strikeOut);
  put16(fi, 0x11, stub.weight);
  put8(fi, 0x13, stub.charSet);
  put16(fi, 0x14, 0);
  put16(fi, 0x16, cell);
  put8(fi, 0x18, stub.pitchAndFamily);
  put16(fi, 0x19, width || MulDiv(stub.avgWidth, ppem, across));
  put16(fi, 0x1b, MulDiv(stub.maxWidth, ppem, across));
  put8(fi, 0x1d, stub.firstChar);
  put8(fi, 0x1e, stub.lastChar);
  put8(fi, 0x1f, stub.defaultChar);
  put8(fi, 0x20, stub.breakChar);
  put16(fi, 0x27, 0x6e);
  put8(fi, 0x33, (made ? 4 : 0) | (angle ? 0x10 : 0) | 0x80);
  put16(fi, 0x48, angle);
  put16(fi, 0x4a, scale);
  put16(fi, 0x4c, ppem);

  /* The face's name, the program's own spelling where it names the face or
   * its full name (seg3 `2c36`). */
  const named =
    face.toLowerCase() === String(stub.family).toLowerCase() ||
    face.toLowerCase() === String(stub.fullName).toLowerCase();
  const name = (named ? face : String(stub.family)).slice(0, 0x1f);

  for (let at = 0; at < 0x20; at++) {
    put8(fi, 0x6e + at, at < name.length ? name.charCodeAt(at) : 0);
  }

  if (lpTextXform >>> 16) {
    const xf = lpTextXform;

    put16(xf, 0, cell);
    put16(xf, 2, word(fi, 0x19));
    put16(xf, 4, angle);
    put16(xf, 6, angle);
    put16(xf, 8, stub.weight);
    put8(xf, 0x0a, byte(fi, 0x0e));
    put8(xf, 0x0b, byte(fi, 0x0f));
    put8(xf, 0x0c, byte(fi, 0x10));
    put8(xf, 0x0d, 0);
    put8(xf, 0x0e, 0);
    put16(xf, 0x0f, 0);
    put16(xf, 0x11, 0);
  }

  return 0x96;
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
