'use strict';

import { FontManager } from '../font-manager.js';
import { LogicalFont } from '../../raster/logical-font.js';
import { Surface } from '../../raster/surface.js';
import { trueTypeFacts } from './CreateScalableFontResource.js';
import { gdiDataSelector } from './gdi-data.js';
import { justifiedExtent } from './justify.js';
import { MulDiv } from './MulDiv.js';

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
  /** The transformation's matrix, `[m00, m01, m10, m11]` in pixels (`engineMatrix`). */
  matrix: number[];
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
    system._engineContext = { key: '', answer: FAILED, font: null, turn: angle, matrix: [] };
    return FAILED;
  }

  const matrix = engineMatrix(info, angle);

  /* GDI's slant leans the outline by its matrix's `m10` over `m11`, across
   * pixels for each down (`6f5b`-`6f7a`, `6fa3`-`6fce`): 13/40 at an em of
   * 40, 18/53 at 53, where the display's own synthesis leans by a third
   * rounded down, 17/53 (`Surface.leanOf`). **Recorded** by `prttslt`. */
  if (info.flags & 4 && !angle && matrix[3]) {
    (font as any).engineLean = matrix[2] / matrix[3];
  }

  system._engineContext = { key, answer: 0, font, turn: angle, matrix };
  return 0;
}

/**
 * The matrix GDI hands the scaler for a `FONTINFO` at an angle, read out of
 * `GDI.EXE` seg1 `6f22`-`6fce`: whole pixels, each the high word of a 16.16
 * entry whose fraction is nought, `[m00, m01, m10, m11]` -- across is
 * `x * m00 + y * m10`, up `x * m01 + y * m11`.
 *
 * * The em (4Ch) times the angle's cosine and sine from GDI's own table
 *   (seg33 `00fb`, `00b6`): `m00` and `m11` the cosine, `m01` the sine,
 *   `m10` its negative (`6f38`-`6f58`).
 * * GDI's slant (33h bit 2) adds 57h/100h of `m00` to `m10` and of `m01` to
 *   `m11`, each product's bits 8 to 23, a fraction dropped toward minus
 *   infinity (`6f5b`-`6f7a`): 13 at an em of 40.
 * * A stretch other than 100h (4Ah) scales `m00`, and `m01` where it is not
 *   nought, the same way (`6f7d`-`6fa0`).
 * * Resolutions that differ (6 across, 4 down) scale `m00`, and `m10` where
 *   it is not nought, by their ratio: the product, half the vertical
 *   resolution added to its low word alone -- the carry is lost -- and
 *   divided, truncating toward nought (`6fa3`-`6fce`).
 */
function engineMatrix(info: FontInfo, angle: number): number[] {
  const word = (value: number) => (value << 16) >> 16;
  const high = (product: number) => word(Math.floor(product / 256));
  const cosine = sineOf(info.em, angle, true);
  const sine = sineOf(info.em, angle, false);
  let m00 = cosine;
  let m01 = sine;
  let m10 = word(-sine);
  let m11 = cosine;

  if (info.flags & 4) {
    m10 = word(m10 + high(0x57 * m00));
    m11 = word(m11 + high(0x57 * m01));
  }

  if (info.stretch !== 0x100) {
    m00 = high(word(info.stretch) * m00);

    if (m01) {
      m01 = high(word(info.stretch) * m01);
    }
  }

  if (info.resX !== info.resY && info.resY) {
    const across = (entry: number) => {
      const product = entry * word(info.resX);
      const low = (product + Math.floor(info.resY / 2)) & 0xffff;
      const dividend = Math.floor(product / 0x10000) * 0x10000 + low;

      return word(Math.trunc(dividend / info.resY));
    };

    m00 = across(m00);

    if (m10) {
      m10 = across(m10);
    }
  }

  return [m00, m01, m10, m11];
}

/**
 * A character's glyph as the engine's context makes it (`Surface.glyphOf`,
 * at the context's angle), its advance the scaler's where the context's
 * matrix is not a plain upright scale (`engineAdvance`). What
 * `EngineGetGlyphBmp` answers and what GDI's cache of a font's glyphs is
 * filled from (`engine-text.ts`).
 */
export function engineGlyph(system: any, code: number, turn: number) {
  const context: EngineContext | undefined = system._engineContext;

  if (!context?.font) {
    return null;
  }

  const glyph = Surface.glyphOf(context.font, code, turn);

  if (!glyph) {
    return null;
  }

  const advance = engineAdvance(context, code);

  return advance ? { ...glyph, advanceX: advance[0], advanceY: advance[1] } : glyph;
}

/**
 * The advance of a glyph made through a matrix that is not a plain upright
 * scale, as the scaler makes it: null for one that is, whose advance is the
 * upright chain's (`hdmx`, `LTSH`, the program; `LogicalFont.outlineAdvance`).
 *
 * **Read out** of `GDI.EXE` segment 36:
 *
 * * The scaler's glue (`0796`) asks `hdmx` and `LTSH` only of a matrix with
 *   nothing off its diagonal (`081b`-`0845`, the flag at 96h) whose two
 *   diagonal entries are the same (`0957`); `LTSH`'s linear advance needs
 *   the size at least the glyph's threshold (`103b`-`10d5`), which a
 *   negative one never is. Everything else takes the record's advance from
 *   the glyph's two phantom points (`0dc3`): their difference after the
 *   program (`1f46`-`1fdb`), each half then rounded by adding 8000h
 *   (`0e07`-`0e3d`).
 * * The outline is scaled at each row's stretch, the larger of its two
 *   entries (`3ff9`, `3f16`), and every point -- the phantoms with them --
 *   turned afterwards by the entries divided by it (`4c15`, `6ebb`;
 *   `Surface.transformOutline`).
 * * Whether the program runs is the font's: `prep` runs with `GETINFO`'s
 *   rotated flag set from the matrix (`4261`, `6641`) -- something off the
 *   diagonal, and not a turn by a right angle, whose diagonal is nought
 *   (`3e38`) -- and every installed face answers it with `INSTCTRL`, which
 *   `4bb2` reads to leave the glyph unhinted. Hinted, the origin phantom is
 *   rounded to a pixel and the advance phantom to a pixel from it (`4882`-
 *   `4926`); unhinted, both are where scaling put them.
 *
 * **Recorded** by `prttrot`, which reads the phantoms out of the scaler's
 * memory after each glyph: Wingdings' `A` at an em of 40 has its advance
 * phantom at 24.0 upright and turned by right angles, where upright the
 * record carries `hdmx`'s 23; at 45 degrees, slanted or not, unhinted at a
 * stretch of 28, 16.45; slanted upright, unhinted, 23.5.
 */
function engineAdvance(context: EngineContext, code: number): [number, number] | null {
  const [m00, m01, m10, m11] = context.matrix;
  const outline = context.font?.outline;

  if (!outline || (!m01 && !m10 && m00 === m11 && m00 > 0)) {
    return null;
  }

  const glyph = outline.glyphFor(code);
  const stretchX = Math.max(Math.abs(m00), Math.abs(m01));
  const stretchY = Math.max(Math.abs(m10), Math.abs(m11));

  if (!stretchX || !stretchY) {
    return null;
  }

  const rotated = !(m00 === 0 && m11 === 0) && (m01 !== 0 || m10 !== 0);
  const scale = engineScaler(stretchX, outline.unitsPerEm);
  const shift = outline.bearingShift(glyph);
  let origin = scale(-shift);
  let advance = scale(outline.advanceOf(glyph) - shift);
  let gridFit = false;

  /* `prep` has to have run for its `INSTCTRL` to be read; a program this
   * cannot run leaves the glyph unhinted, as `hintedOutline` does. */
  try {
    const hinter = outline.hinterAt(stretchY, true, stretchX / stretchY, rotated);

    hinter.prepare();
    gridFit = hinter.gridFit;
  } catch {
    gridFit = false;
  }

  if (gridFit) {
    const fitted = outline.hintedOutline(glyph, stretchY, true, stretchX / stretchY, rotated);
    const grid = (value: number) => Math.floor((value + 32) / 64) * 64;

    origin = grid(origin);
    advance = fitted.hinted ? origin + fitted.advance : grid(advance);
  }

  const across = fixDiv(m00, stretchX);
  const up = fixDiv(m01, stretchX);
  const whole = (value: number) => Math.floor((value * 1024 + 0x8000) / 0x10000);

  return [
    whole(fixMul(advance, across) - fixMul(origin, across)),
    whole(fixMul(advance, up) - fixMul(origin, up)),
  ];
}

/**
 * Design units into sixty-fourths at a stretch, as `3f55` reduces the ratio
 * of the stretch times 64 to the em: a power of two multiplies and shifts,
 * a half going up (`3e5e`); otherwise it divides, a half away from nought
 * (`3e80`). As `Surface.transformOutline`.
 */
function engineScaler(stretch: number, unitsPerEm: number) {
  let multiplier = stretch * 64;
  let divisor = unitsPerEm;

  while (multiplier % 2 === 0 && divisor % 2 === 0) {
    multiplier /= 2;
    divisor /= 2;
  }

  const shifted = (divisor & (divisor - 1)) === 0;

  return (value: number) =>
    shifted || value >= 0
      ? Math.floor((value * multiplier + Math.floor(divisor / 2)) / divisor)
      : -Math.floor((-value * multiplier + Math.floor(divisor / 2)) / divisor);
}

/** `FixDiv` of two whole numbers (seg36 `0270`): magnitudes, half the divisor added, the sign put back. */
function fixDiv(numerator: number, denominator: number) {
  return (
    Math.sign(numerator) *
    Math.sign(denominator) *
    Math.floor(
      (Math.abs(numerator) * 65536 + Math.floor(Math.abs(denominator) / 2)) / Math.abs(denominator)
    )
  );
}

/** `FixMul` (seg36 `0200`): the product, 8000h added, shifted. */
function fixMul(value: number, factor: number) {
  return Math.floor((value * factor + 32768) / 65536);
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

  const glyph = engineGlyph(this, wChar & 0xff, context.turn);

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

/** `v` times the sine, or the cosine, of an angle in tenths of a degree, from GDI's table (seg33 `00b6`, `00fb`, `013f`). */
export function sineOf(value: number, angle: number, cosine: boolean) {
  let a = angle;

  if (a < 0) {
    a = 3600 - (-a % 3600);
  } else {
    a %= 3600;
  }

  let negative = false;
  let tenths: number;

  if (cosine) {
    if (a <= 900) {
      tenths = 900 - a;
    } else if (a <= 1800) {
      negative = true;
      tenths = a - 900;
    } else if (a < 2700) {
      negative = true;
      tenths = 2700 - a;
    } else {
      tenths = a - 2700;
    }
  } else if (a <= 900) {
    tenths = a;
  } else if (a <= 1800) {
    tenths = 1800 - a;
  } else if (a <= 2700) {
    negative = true;
    tenths = a - 1800;
  } else {
    negative = true;
    tenths = 3600 - a;
  }

  const degree = Math.trunc(tenths / 10);
  const part = tenths % 10;
  const low = SINES[degree];
  const high = SINES[degree + 1] ?? low;
  const sine = low + MulDiv(part, high - low, 10);
  const product = MulDiv(value, sine, 10000);

  return negative ? -product : product;
}

/** The sine of each whole degree to 90, times 10000 (seg33 `0000`). */
const SINES = [
  0, 175, 349, 523, 698, 872, 1045, 1219, 1392, 1564, 1736, 1908, 2079, 2250, 2419, 2588, 2756,
  2924, 3090, 3256, 3420, 3584, 3746, 3907, 4067, 4226, 4384, 4540, 4695, 4848, 5000, 5150, 5299,
  5446, 5592, 5736, 5878, 6018, 6157, 6293, 6428, 6561, 6691, 6820, 6947, 7071, 7193, 7314, 7431,
  7547, 7660, 7771, 7880, 7986, 8090, 8192, 8290, 8387, 8480, 8572, 8660, 8746, 8829, 8910, 8988,
  9063, 9135, 9205, 9272, 9336, 9397, 9455, 9511, 9563, 9613, 9659, 9703, 9744, 9781, 9816, 9848,
  9877, 9903, 9925, 9945, 9962, 9976, 9986, 9994, 9998, 10000,
];
