'use strict';

import { FontManager } from '../font-manager.js';
import { LogicalFont } from '../../raster/logical-font.js';
import { Surface } from '../../raster/surface.js';
import { trueTypeFacts } from './CreateScalableFontResource.js';
import { gdiDataSelector } from './gdi-data.js';
import { justifiedExtent } from './justify.js';

/**
 * GDI's TrueType engine as a printer's driver puts a font it realized to
 * work: `EngineSetFontContext`, `EngineGetGlyphBmp`, `EngineGetCharWidth`
 * and `EngineExtTextOut`, and the two the engine keeps beside them,
 * `EngineMakeFontDir` and `ConvertOutlineFontFile`. The twin of
 * `crates/winbox-win16/src/gdi/engine_glyphs.rs`. See
 * `kb/topics/printer-drivers.md` and `engine-font.ts`, which realizes the
 * `FONTINFO` these are given.
 */

/** What the engine reads of a `FONTINFO` it realized (`GDI.EXE` seg3 `22b3`). */
export function fontInfoOf(system: any, far: number) {
  const core = system.machine.cpu.core;
  const byte = (at: number) => core.read8(far >>> 16, ((far & 0xffff) + at) & 0xffff);
  const word = (at: number) => core.read16(far >>> 16, ((far & 0xffff) + at) & 0xffff) & 0xffff;
  let name = '';

  for (let at = 0x6e; at < 0x6e + 0x20; at++) {
    const code = byte(at);

    if (!code) {
      break;
    }

    name += String.fromCharCode(code);
  }

  return {
    resY: word(4),
    resX: word(6),
    italic: byte(0x0e),
    weight: word(0x11),
    pixWidth: word(0x14),
    cell: word(0x16),
    average: word(0x19),
    first: byte(0x1d),
    last: byte(0x1e),
    defaultChar: byte(0x1f),
    flags: byte(0x33),
    spot: [word(0x40), word(0x42), word(0x44), word(0x46)],
    stretch: word(0x4a),
    em: word(0x4c),
    name,
  };
}

type FontInfo = ReturnType<typeof fontInfoOf>;

/**
 * The face a `FONTINFO` stands for, at its em and resolutions, slanted
 * where GDI slants it and turned by the engine's angle: what the engine's
 * transformation is made of (seg1 `6df7`-`6ff9`). Windows finds the face by
 * its slot in the TrueType table (3Ch); WinBox by its name at 6Eh, in the
 * header's weight and slant, as the realization chose it.
 */
function engineFont(system: any, info: FontInfo, turn: number) {
  const found = system.fonts?.outline(info.name, info.weight > 550, info.italic !== 0);

  if (!found) {
    return null;
  }

  const sized = FontManager.realiseOutline(found.font, {
    height: -info.em,
    width: info.stretch === 0x100 ? 0 : info.average,
    escapement: 0,
    italic: info.italic,
    weight: info.weight,
    logPixelsX: info.resX,
    logPixelsY: info.resY,
  });

  if (!sized) {
    return null;
  }

  return new LogicalFont(found.name, 0, null, {
    weight: info.weight,
    italic: info.italic ? 1 : 0,
    underline: 0,
    strikeout: 0,
    outline: found.font,
    exactStyle: found.exact,
    faceBold: found.faceBold,
    outlineFamily: true,
    ppem: sized.ppem,
    xPpem: sized.xPpem,
    xWhole: sized.xWhole,
    xBase: sized.xBase,
    horizontalRes: info.resX || 96,
    verticalRes: info.resY || 96,
    ascent: sized.ascent,
    descent: sized.descent,
    escapement: turn,
  });
}

/** The engine's context: the face and the transformation its glyphs are made with. */
interface EngineContext {
  key: string;
  answer: number;
  font: any;
  turn: number;
}

const FAILED = 0xffffffff;

/**
 * The engine's context set for a `FONTINFO` at an angle (`GDI.EXE` seg1
 * `6df7`). Nought with TrueType off. Where the face, the angle, the em,
 * the resolutions, GDI's slant, the stretch and the spot sizes are what the
 * context last had, its last answer; otherwise the face is opened where it
 * was another (-1 where it cannot be) and the transformation made: the em
 * turned by the angle, slanted by 57h/100h of itself where GDI slants
 * (`33h` bit 2), stretched, and across by the resolutions' ratio. The
 * rasterizer's answer is nought for every one recorded (`prtteng`).
 */
export function setContext(system: any, far: number, angle: number): number {
  if (!system.fonts || system.fonts.trueTypeOff) {
    return 0;
  }

  const info = fontInfoOf(system, far);
  const key = [
    info.name,
    info.weight,
    info.italic,
    angle,
    info.em,
    info.resY,
    info.resX,
    info.flags & 4,
    info.stretch,
    ...info.spot,
  ].join();
  const kept: EngineContext | undefined = system._engineContext;

  if (kept?.key === key) {
    return kept.answer;
  }

  const font = engineFont(system, info, angle);

  if (!font) {
    system._engineContext = { key: '', answer: FAILED, font: null, turn: angle };
    return FAILED;
  }

  system._engineContext = { key, answer: 0, font, turn: angle };
  return 0;
}

/**
 * `EngineSetFontContext` (`GDI.EXE` seg5 `0993`, into seg1 `6de2`): the
 * engine's context set for a `FONTINFO` at an angle, as `setContext`. A
 * printer's driver sets it before it asks for glyphs (`PSCRIPT.DRV` seg4
 * `0805`); realizing a font sets it at the font's escapement (seg3 `2557`),
 * and filling its widths sets it upright (seg1 `6d5c`).
 */
export function EngineSetFontContext(this: any, lpFontInfo: number, wAngle: number) {
  return setContext(this, lpFontInfo >>> 0, wAngle & 0xffff) >>> 0;
}

/**
 * A character's glyph as the engine's context makes it: `EngineGetGlyphBmp`
 * (`GDI.EXE` seg7 `09e9`), which `GetGlyphOutline` is made of (seg7 `1059`).
 *
 * * With TrueType off, -1 and the metrics nought.
 * * The character is found at itself plus the `FONTINFO`'s offset (4Eh)
 *   where it has one, through GDI's ANSI table otherwise (`0a13`).
 * * The metrics are 24 bytes: the box's width and height, and its corner
 *   from the origin and the advance as 16.16 vectors, upward positive.
 *   `GetGlyphOutline` rounds the last four to whole pixels (`1068`).
 * * Format 0 fills the metrics and answers nought; format 1 the bitmap as
 *   well, one bit a pixel, the top row first, each row a doubleword, as
 *   much as the buffer holds, and answers its size; with no buffer the
 *   size alone. The engine's failure is -1, its metrics nought.
 *
 * Not followed: format 2, the outline as curves, which answers -1 here as
 * `GetGlyphOutline`'s does; and a font GDI draws as an outline itself
 * (`33h` bit 5, `0a55`), which no font WinBox realizes is.
 */
export function EngineGetGlyphBmp(
  this: any,
  _hdc: number,
  lpFontInfo: number,
  wChar: number,
  wFormat: number,
  lpBuffer: number,
  cbBuffer: number,
  lpMetrics: number
) {
  const core = this.machine.cpu.core;
  const metrics = lpMetrics >>> 0;
  const putMetrics = (values: number[]) => {
    values.forEach((value, index) => {
      const at = ((metrics & 0xffff) + index * 4) & 0xffff;

      core.write16(metrics >>> 16, at, value & 0xffff);
      core.write16(metrics >>> 16, (at + 2) & 0xffff, (value >>> 16) & 0xffff);
    });
  };
  const failed = () => {
    if (metrics >>> 16) {
      putMetrics([0, 0, 0, 0, 0, 0]);
    }

    return FAILED;
  };
  const context: EngineContext | undefined = this._engineContext;
  const format = wFormat & 0xffff;

  if (!this.fonts || this.fonts.trueTypeOff || !context?.font || format > 1 || !lpFontInfo) {
    return failed();
  }

  const glyph = Surface.glyphOf(context.font, wChar & 0xff, context.turn);

  if (!glyph) {
    return failed();
  }

  if (metrics >>> 16) {
    putMetrics([
      glyph.width,
      glyph.height,
      glyph.originX * 0x10000,
      glyph.originY * 0x10000,
      glyph.advanceX * 0x10000,
      glyph.advanceY * 0x10000,
    ]);
  }

  if (format === 0) {
    return 0;
  }

  const stride = ((glyph.width + 31) >> 5) * 4;
  const size = stride * glyph.height;
  const buffer = lpBuffer >>> 0;

  if (!(buffer >>> 16) || !cbBuffer) {
    return size;
  }

  for (let at = 0; at < Math.min(size, cbBuffer >>> 0); at++) {
    const row = glyph.rows[Math.floor(at / stride)];
    const first = (at % stride) * 8;
    let value = 0;

    for (let bit = 0; bit < 8; bit++) {
      value = (value << 1) | (row[first + bit] ?? 0);
    }

    core.write8(buffer >>> 16, ((buffer & 0xffff) + at) & 0xffff, value);
  }

  return size;
}

/**
 * A `FONTINFO`'s widths, filled as GDI fills them the first time they are
 * asked for (`GDI.EXE` seg1 `6d04`-`6ddf`): its `33h` bit 0 set and bit 1
 * cleared (seg3 `2f55`), the engine's context set to the font upright, and
 * each character's advance asked of it; where that fails, bit 6, and no
 * widths. The first character's width is 8 (`6dd5`); a character outside
 * the font is its default character, kept from the first as in a font
 * file; a font of fixed pitch is all its width.
 */
export function widthsOf(system: any, far: number): ((code: number) => number) | null {
  const core = system.machine.cpu.core;
  const flagsAt = ((far & 0xffff) + 0x33) & 0xffff;
  let flags = core.read8(far >>> 16, flagsAt);

  if (!(flags & 1)) {
    flags = (flags & ~3) | 1;

    if (setContext(system, far, 0) === FAILED) {
      flags |= 0x40;
    }

    core.write8(far >>> 16, flagsAt, flags);
  }

  if (flags & 0x40) {
    return null;
  }

  const info = fontInfoOf(system, far);
  const font = engineFont(system, info, 0);

  if (!font) {
    return null;
  }

  const fallback = info.first + info.defaultChar;
  const of = (code: number) => (code === info.first ? 8 : font.outlineAdvance(code));

  return (code: number) => {
    if (info.pixWidth) {
      return info.pixWidth;
    }

    return of(code < info.first || code > info.last ? fallback : code);
  };
}

/**
 * `EngineGetCharWidth` (`GDI.EXE` seg3 `2c8a`, into `2662`, the path
 * `GetCharWidth` takes for a TrueType font): each width from the first
 * character to the last, as `widthsOf` has them; 1 answered, or nought
 * for a last before the first or a font whose widths could not be filled.
 *
 * Not followed: a turned font's widths stretched where the display's
 * pixel is not square (`2738`), and the block GDI keeps of them at 54h,
 * which WinBox does not make: the widths are the engine's each time.
 */
export function EngineGetCharWidth(
  this: any,
  lpFontInfo: number,
  wFirst: number,
  wLast: number,
  lpWidths: number
) {
  const far = lpFontInfo >>> 0;
  const first = wFirst & 0xffff;
  const last = wLast & 0xffff;

  if (!(far >>> 16) || last < first) {
    return 0;
  }

  const width = widthsOf(this, far);

  if (!width) {
    return 0;
  }

  const core = this.machine.cpu.core;
  const out = lpWidths >>> 0;

  for (let code = first; code <= last; code++) {
    core.write16(out >>> 16, ((out & 0xffff) + (code - first) * 2) & 0xffff, width(code) & 0xffff);
  }

  return 1;
}

/**
 * `EngineExtTextOut` (`GDI.EXE` seg1 `669a`): GDI drawing a string of a
 * TrueType font for a printer's driver onto the driver's device, or, for a
 * negative count, measuring it (`69fe`, into `6a65`): each character's
 * width as `EngineGetCharWidth` has it, the context's character extra
 * after each, and its justification as `GetTextExtent` spreads it, across;
 * the font's cell down. An extent past 7FFFh is 7FFFh; a font whose widths
 * could not be filled answers nought across and 8000h down.
 *
 * A count of nought or more draws the string (`engine-text.ts`).
 *
 * Not followed: GDI measures with the context's own realized `FONTINFO`
 * (`6b73`), WinBox with the one given, which a driver hands on; and a
 * turned font's extent where the pixel is not square.
 */
export function EngineExtTextOut(
  this: any,
  hdc: number,
  lpDevice: number,
  x: number,
  y: number,
  lpClipRect: number,
  lpString: number,
  nCount: number,
  lpFontInfo: number,
  lpDrawMode: number,
  lpTextXform: number,
  lpCharWidths: number,
  lpOpaqueRect: number,
  wOptions: number
) {
  const count = ((nCount & 0xffff) << 16) >> 16;
  const far = lpFontInfo >>> 0;

  if (!(far >>> 16)) {
    return 0;
  }

  if (count >= 0) {
    return import('./engine-text.js').then(({ drawEngineText }) =>
      drawEngineText(this, {
        hdc,
        device: lpDevice >>> 0,
        x,
        y,
        clip: lpClipRect >>> 0,
        string: lpString >>> 0,
        count,
        font: far,
        drawMode: lpDrawMode >>> 0,
        xform: lpTextXform >>> 0,
        widths: lpCharWidths >>> 0,
        opaque: lpOpaqueRect >>> 0,
        options: wOptions,
      })
    );
  }

  const surface = this.handles.resolve(hdc);
  const core = this.machine.cpu.core;
  const string = lpString >>> 0;
  const width = widthsOf(this, far);

  if (!width) {
    return 0x80000000;
  }

  let text = '';
  let across = 0;

  for (let index = 0; index < -count; index++) {
    const code = core.read8(string >>> 16, ((string & 0xffff) + index) & 0xffff);

    text += String.fromCharCode(code);
    across += width(code) + (surface?.charExtra ?? 0);
  }

  across += surface ? justifiedExtent(surface, text) : 0;

  const down = fontInfoOf(this, far).cell;

  return ((Math.min(across, 0x7fff) & 0xffff) | (down << 16)) >>> 0;
}

/**
 * `EngineMakeFontDir` (`GDI.EXE` seg7 `1184`): the font directory's entry
 * of a `.TTF`, as `CreateScalableFontResource` puts it in the `.FOT` it
 * writes (seg7 `1585`), written to a buffer of the caller's; answers its
 * length, or -1 with TrueType off or where the file is not a face.
 *
 * Written in pieces, what lies between them left as it was:
 *
 * * 29h bytes as GDI keeps them (seg7 `1147`): a count of 1, an ordinal of
 *   nought, `dfVersion` 200h, `dfSize` 95h, and the copyright,
 *   `Windows! Windows! Windows!` with its nought and four bytes after.
 * * From 46h, `dfType`: 3, 80h more where the first argument is not
 *   nought, `OS/2`'s `fsSelection` in its high byte. `dfPoints` the em in
 *   font units, the resolutions 72, the ascent, the internal leading (the
 *   cell less the em) and the external leading (`hhea`'s gap, nought for
 *   less) in them. Italic, underline and strike-out FFh for `fsSelection`'s
 *   bits 0, 1 and 4. The weight, a class of 1 to 9 its hundreds (`1170`).
 *   The character set 2 for a pictorial `PANOSE` family. Nought, the cell,
 *   the pitch and family from `PANOSE` (`12af`, its serif styles at
 *   `1137`), the average width, the width of the box.
 * * The characters: from 20h less two, to FFh at most, default 1 and break
 *   2, from the first; a face whose characters start past FFh is of the
 *   symbol set, its characters counted on from 20h for as many as it has,
 *   to FFh, and 20h short of its first is its offset.
 * * `dfFace`, the offset of the names in the caller's segment; `head`'s
 *   lowest size; the offset; and the full name, the family and the style,
 *   each with its nought.
 */
export async function EngineMakeFontDir(
  this: any,
  hidden: number,
  lpFontDir: number,
  lpszPath: any
) {
  if (!this.fonts || this.fonts.trueTypeOff || !lpszPath) {
    return FAILED;
  }

  let facts: ReturnType<typeof trueTypeFacts>;

  try {
    const handle = await this.dos.files.open(String(lpszPath));
    const file = this.dos.files.resolve(handle);

    if (!file) {
      return FAILED;
    }

    const ttf = new Uint8Array(await file.read(0, file.size));

    this.dos.files.close(handle);
    facts = trueTypeFacts(ttf);
  } catch {
    return FAILED;
  }

  const out = lpFontDir >>> 0;
  const core = this.machine.cpu.core;
  const put8 = (at: number, value: number) =>
    core.write8(out >>> 16, ((out & 0xffff) + at) & 0xffff, value & 0xff);
  const put16 = (at: number, value: number) => {
    put8(at, value);
    put8(at + 1, value >> 8);
  };
  const putText = (at: number, text: string) => {
    for (let index = 0; index < text.length; index++) {
      put8(at + index, text.charCodeAt(index));
    }

    put8(at + text.length, 0);
    return at + text.length + 1;
  };

  /* The entry's head as GDI keeps it (seg7 `1147`). */
  put16(0, 1);
  put16(2, 0);
  put16(4, 0x200);
  put16(6, 0x95);
  put16(8, 0);
  putText(0x0a, COPYRIGHT);
  AFTER_COPYRIGHT.forEach((value, index) => put8(0x25 + index, value));

  const { panose, selection } = facts;
  const monospaced = panose[3] === PANOSE_MONOSPACED;
  const familyBits =
    panose[0] === PANOSE_SCRIPT
      ? FF_SCRIPT
      : panose[0] === PANOSE_DECORATIVE
        ? FF_DECORATIVE
        : monospaced
          ? FF_MODERN
          : panose[1] >= 11
            ? FF_SWISS
            : panose[1] >= 2
              ? FF_ROMAN
              : FF_DONTCARE;
  const cell = facts.ascender - facts.descender;
  let first = facts.firstChar;
  let last = facts.lastChar;
  let offset = 0;
  let charSet = panose[0] === PANOSE_PICTORIAL ? SYMBOL_CHARSET : ANSI_CHARSET;

  if (last > 0xff && first > 0xff) {
    charSet = SYMBOL_CHARSET;
    last = Math.min(last - first, 0xdf) + 0x20;
    offset = first - 0x20;
    first = 0x20;
  } else {
    last = Math.min(last, 0xff);
    first = Math.max(first, 0x20);
  }

  put8(0x46, 3 | (hidden & 0xffff ? 0x80 : 0));
  put8(0x47, selection);
  put16(0x48, facts.unitsPerEm);
  put16(0x4a, 72);
  put16(0x4c, 72);
  put16(0x4e, facts.ascender);
  put16(0x50, cell - facts.unitsPerEm);
  put16(0x52, Math.max(0, facts.lineGap));
  put8(0x54, selection & 1 ? 0xff : 0);
  put8(0x55, selection & 2 ? 0xff : 0);
  put8(0x56, selection & 0x10 ? 0xff : 0);
  put16(0x57, facts.weight <= 9 ? facts.weight * 100 : facts.weight);
  put8(0x59, charSet);
  put16(0x5a, 0);
  put16(0x5c, cell);
  put8(0x5e, (familyBits + (monospaced ? 0 : 1)) | 6);
  put16(0x5f, facts.averageWidth);
  put16(0x61, facts.xMax - facts.xMin);
  put8(0x63, first - 2);
  put8(0x64, last);
  put8(0x65, 1);
  put8(0x66, 2);
  put16(0x6d, ((out & 0xffff) + NAMES) & 0xffff);
  put16(0x71, facts.lowestRecPPEM);
  put16(0x73, offset);

  return putText(putText(putText(NAMES, facts.face), facts.family), facts.style);
}

/**
 * `ConvertOutlineFontFile` (`GDI.EXE` seg7 `0d8a`): an entry that does
 * nothing, answering with what its prologue left in AX -- GDI's own data
 * segment.
 */
export function ConvertOutlineFontFile(this: any) {
  return gdiDataSelector(this);
}

/** The copyright GDI writes in every entry, and the four bytes it keeps after its nought (seg7 `1151`, `116c`). */
const COPYRIGHT = 'Windows! Windows! Windows!';
const AFTER_COPYRIGHT = [0x10, 0x03, 0x01, 0x01];

/** Where the names start in an entry (seg7 `13a6`). */
const NAMES = 0x76;

const PANOSE_SCRIPT = 3;
const PANOSE_DECORATIVE = 4;
const PANOSE_PICTORIAL = 5;
const PANOSE_MONOSPACED = 9;
const FF_DONTCARE = 0x00;
const FF_ROMAN = 0x10;
const FF_SWISS = 0x20;
const FF_MODERN = 0x30;
const FF_SCRIPT = 0x40;
const FF_DECORATIVE = 0x50;
const ANSI_CHARSET = 0;
const SYMBOL_CHARSET = 2;
