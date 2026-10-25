'use strict';

import { LogicalFont } from '../../raster/logical-font.js';
import {
  GDI_ERROR,
  fileBytes,
  fontData,
  kernPairCount,
  kernPairs,
  outlineMetrics,
} from '../../raster/truetype-queries.js';
import { MulDiv } from './MulDiv.js';
import { GetTextMetrics } from './GetTextMetrics.js';
import { MM_TEXT, logicalX, logicalY, mappingOf } from './mapping.js';

/**
 * GDI's questions about a TrueType font beside drawing it:
 * `GetFontData`, `GetKerningPairs`, `GetCharABCWidths` and
 * `GetOutlineTextMetrics`. What the engine reads out of the file is
 * `raster/truetype-queries.ts`; this is GDI's part -- the device
 * context, the pixel size, the character set, the mapping.
 *
 * **Recorded** by `ttquery`: Arial, Arial Bold, Arial Bold Italic, Times
 * New Roman Italic and Bold, Courier New, Symbol and Wingdings at a few
 * sizes, into a window's device context and a memory one, and under
 * `MM_LOMETRIC`; and the System font, a strike, which none of them answer
 * for.
 */

/**
 * The ANSI character set's codes, as GDI keeps them in its data segment
 * (seg48 `067e`): a character's UTF-16 code by the character, the C1
 * block's punctuation and 2219h for B7h, and nought for 1Fh, the
 * character the TrueType faces default to.
 */
export const ANSI_CODES: number[] = (() => {
  const codes = Array.from({ length: 256 }, (_, i) => i);
  const C1: Record<number, number> = {
    0x82: 0x201a,
    0x83: 0x0192,
    0x84: 0x201e,
    0x85: 0x2026,
    0x86: 0x2020,
    0x87: 0x2021,
    0x88: 0x02c6,
    0x89: 0x2030,
    0x8a: 0x0160,
    0x8b: 0x2039,
    0x8c: 0x0152,
    0x91: 0x2018,
    0x92: 0x2019,
    0x93: 0x201c,
    0x94: 0x201d,
    0x95: 0x2022,
    0x96: 0x2013,
    0x97: 0x2014,
    0x98: 0x02dc,
    0x99: 0x2122,
    0x9a: 0x0161,
    0x9b: 0x203a,
    0x9c: 0x0153,
    0x9f: 0x0178,
    0xb7: 0x2219,
  };

  for (const [at, code] of Object.entries(C1)) {
    codes[Number(at)] = code;
  }

  codes[0x1f] = 0;

  return codes;
})();

/**
 * A UTF-16 code as an ANSI character, as GDI turns one (seg1 `56a3`): the
 * first character whose code it is, or 1Fh where none has it.
 */
export function ansiOf(code: number) {
  const at = ANSI_CODES.indexOf(code);

  return at < 0 ? 0x1f : at;
}

/** The outline face selected into a device context, with the context. */
function outlineOf(system: any, hdc: number) {
  const surface = system.handles.resolve(hdc);
  const font = surface?.font;

  if (!(font instanceof LogicalFont) || !font.outline || surface.driverDevice) {
    return { surface, font: null };
  }

  return { surface, font };
}

function write(system: any, far: number, bytes: ArrayLike<number>) {
  const core = system.machine.cpu.core;
  const segment = (far >>> 16) & 0xffff;
  const offset = far & 0xffff;

  for (let i = 0; i < bytes.length; i++) {
    core.write8(segment, (offset + i) & 0xffff, bytes[i] & 0xff);
  }
}

function read16(system: any, far: number, at: number) {
  const core = system.machine.cpu.core;

  return core.read16((far >>> 16) & 0xffff, ((far & 0xffff) + at) & 0xffff);
}

function write16(system: any, far: number, at: number, value: number) {
  system.machine.cpu.core.write16(
    (far >>> 16) & 0xffff,
    ((far & 0xffff) + at) & 0xffff,
    value & 0xffff
  );
}

/**
 * A size in the device's pixels as a size in the device context's units,
 * across (seg1 `3b3a`) or down (`3b6e`): the distance between nought and
 * the size, each turned into logical units, and the size's own sign.
 */
function logicalSize(surface: any, value: number, down: boolean) {
  const m = mappingOf(surface);
  const size = down
    ? Math.abs(logicalY(m, Math.abs(value)) - logicalY(m, 0))
    : Math.abs(logicalX(m, Math.abs(value)) - logicalX(m, 0));

  return value < 0 ? -size : size;
}

/**
 * The **GetFontData** function retrieves font metric data for a TrueType
 * font: a table of the file, or the whole file for a table of nought.
 *
 * **Read out** of `GDI.EXE` seg7 `0d98` and the engine's seg40 `0113`; see
 * `fontData`. -1 for a strike, with TrueType off, or for a handle that is
 * no device context (seg7 `07fc`). With a buffer and a size of nought it
 * reads nothing and answers nought.
 *
 * @returns {Types.DWORD} The bytes read, or the size with no buffer; -1 on failure.
 */
export function GetFontData(
  this: any,
  hdc: number,
  dwTable: number,
  dwOffset: number,
  lpvBuffer: number,
  cbData: number
) {
  const { font } = outlineOf(this, hdc);

  if (!font) {
    return GDI_ERROR;
  }

  const bytes = fileBytes(font.outline);
  const buffer = lpvBuffer >>> 0 !== 0;
  const { answer, from } = fontData(bytes, dwTable, dwOffset, buffer ? cbData : null);

  if (answer !== GDI_ERROR && buffer && answer) {
    write(this, lpvBuffer, bytes.subarray(from, from + answer));
  }

  return answer;
}

/**
 * The **GetKerningPairs** function retrieves the character kerning pairs
 * for the font selected in the device context.
 *
 * **Read out** of seg7 `1ccd` and `1d36`, and the engine's seg36 `1420`:
 * with no buffer, the count of the font's pairs. With one, as many as fit
 * in the count asked for, in the file's order: each glyph the code that
 * reaches it (`codesOfGlyphs`), as an ANSI character (`ansiOf`), and a pair
 * with a character the set lacks, 1Fh, left out; the amount is the font's
 * scaled to the pixel size, a half away from nought (seg36 `041f`), then
 * to the device context's units by its window and viewport extents
 * across. The answer is how many pairs were written. A strike has none.
 *
 * @returns {Types.INT} The pairs written, or the font's count with no buffer.
 */
export function GetKerningPairs(this: any, hdc: number, nPairs: number, lpkrnpair: number) {
  const { surface, font } = outlineOf(this, hdc);

  if (!font) {
    return 0;
  }

  const outline = font.outline;

  if (lpkrnpair >>> 0 === 0) {
    return kernPairCount(outline);
  }

  const ppem = font.ppem;
  const units = outline.unitsPerEm;
  const scaled = (amount: number) => {
    const magnitude = Math.floor((Math.abs(amount) * ppem + (units >> 1)) / units);

    return amount < 0 ? -magnitude : magnitude;
  };
  const wanted = Math.max(0, (nPairs << 16) >> 16);
  const pairs = kernPairs(outline).slice(0, wanted);
  const m = mappingOf(surface);
  let kept = 0;

  for (const pair of pairs) {
    const first = pair.first ? ansiOf(pair.first) : 0;
    const second = pair.first ? (pair.second ? ansiOf(pair.second) : 0) : 0;

    if (first === 0x1f || second === 0x1f) {
      continue;
    }

    let amount = scaled(pair.amount);

    if (m.mode !== MM_TEXT) {
      amount = MulDiv(amount, m.wex, m.vex);
    }

    write16(this, lpkrnpair, kept * 6, first);
    write16(this, lpkrnpair, kept * 6 + 2, second);
    write16(this, lpkrnpair, kept * 6 + 4, amount);
    kept++;
  }

  return kept;
}

/**
 * The **GetCharABCWidths** function retrieves the widths of consecutive
 * characters of the TrueType font selected: each the space before its
 * black box, the box, and the space after.
 *
 * **Read out** of seg7 `195c` and `1af8`, with the realised font's tables
 * from seg3 `2fd8`: GDI keeps, for each character of the font from the
 * second to the last, the engine's advance and the box's left edge
 * (rounded) and the space after it, as signed bytes. A is the left edge, C
 * the space after, B what is left of the advance. The font's first
 * character, 1Eh, is never asked of the engine: its entry is the advance
 * 8 and the space after 8 that the realisation writes (seg3 `3146`), so 0,
 * 0, 8. A character outside the font -- under 1Eh or past FFh -- has the
 * default character's, 1Fh's: the face's missing glyph. Under another
 * mapping mode each is turned into the device context's units across.
 *
 * A range backwards, a strike, or no device context: nought, and nothing
 * written.
 *
 * @returns {Types.BOOL} Whether the widths were written.
 */
export function GetCharABCWidths(
  this: any,
  hdc: number,
  uFirstChar: number,
  uLastChar: number,
  lpabc: number
) {
  const { surface, font } = outlineOf(this, hdc);

  if (!font || uFirstChar > uLastChar) {
    return 0;
  }

  const FIRST = 0x1e;
  const LAST = 0xff;
  const DEFAULT = 0x1f;
  const cache = new Map<number, [number, number, number]>();
  const widths = (char: number): [number, number, number] => {
    const code = char < FIRST || char > LAST ? DEFAULT : char;

    if (code === FIRST) {
      return [0, 0, 8];
    }

    let known = cache.get(code);

    if (!known) {
      const glyph = surface.glyphOutline(code);
      const advance = glyph ? glyph.advance : 0;
      const a = ((glyph ? glyph.originX : 0) << 24) >> 24;
      const c = ((advance - a - (glyph ? glyph.width : 0)) << 24) >> 24;

      known = [a, advance - a - c, c];
      cache.set(code, known);
    }

    return known;
  };
  const mapped = mappingOf(surface).mode !== MM_TEXT;

  for (let char = uFirstChar, at = 0; char <= uLastChar; char++, at += 6) {
    const [a, b, c] = widths(char);

    write16(this, lpabc, at, mapped ? logicalSize(surface, a, false) : a);
    write16(this, lpabc, at + 2, mapped ? logicalSize(surface, b, false) : b);
    write16(this, lpabc, at + 4, mapped ? logicalSize(surface, c, false) : c);
  }

  return 1;
}

/**
 * The **GetOutlineTextMetrics** function retrieves metric information for
 * the TrueType font selected.
 *
 * **Read out** of seg7 `16ed`, with the engine's seg40 `0606`
 * (`outlineMetrics`):
 *
 * * The structure is its size, the `TEXTMETRIC` as `GetTextMetrics` makes
 *   it, a filler byte, then the engine's: the PANOSE bytes, `fsSelection`,
 *   `fsType`, the caret's slope, the italic angle and the EM square as they
 *   are, then twenty-five sizes scaled to the pixel size -- `(v * ppem +
 *   units / 2) / units`, the division truncating -- then the four names'
 *   offsets from the structure's start, then the names, each code's low
 *   byte, nul-terminated.
 * * With no buffer the answer is the size, the structure's 114 bytes and
 *   the names'; `otmSize` is that rounded up to even. With one, as much as
 *   fits is copied and the answer is 1.
 * * Under another mapping mode, the ascent to the Macintosh gap and the
 *   sub- and superscripts to the underline are turned into the device
 *   context's units -- down, but for the box's left and right -- as far as
 *   the buffer reaches.
 * * The filler is a byte of GDI's stack the `TEXTMETRIC` was made on,
 *   whatever was there (`ttquery` records AAh, 0Ah and nought); nought
 *   here.
 *
 * A strike, or no device context: nought.
 *
 * @returns {Types.WORD} The size with no buffer, 1 having copied, nought on failure.
 */
export async function GetOutlineTextMetrics(this: any, hdc: number, cbData: number, lpotm: number) {
  const { surface, font } = outlineOf(this, hdc);

  if (!font) {
    return 0;
  }

  const outline = font.outline;
  const metrics = outlineMetrics(outline, outline.symbolic ? 0 : 1);
  const names = metrics.names.map((codes) => [...codes.map((code) => code & 0xff), 0]);
  const size = 114 + names.reduce((total, name) => total + name.length, 0);

  if ((lpotm >>> 0) >>> 16 === 0) {
    return size;
  }

  const tm: any = {};

  await GetTextMetrics.call(this, hdc, tm);

  const bytes: number[] = [];
  const word = (value: number) => bytes.push(value & 0xff, (value >> 8) & 0xff);
  const ppem = font.ppem;
  const units = metrics.emSquare;
  const half = units >> 1;

  word((size + 1) & ~1);

  for (const value of [
    tm.tmHeight,
    tm.tmAscent,
    tm.tmDescent,
    tm.tmInternalLeading,
    tm.tmExternalLeading,
    tm.tmAveCharWidth,
    tm.tmMaxCharWidth,
    tm.tmWeight,
  ]) {
    word(value);
  }

  bytes.push(
    tm.tmItalic,
    tm.tmUnderlined,
    tm.tmStruckOut,
    tm.tmFirstChar,
    tm.tmLastChar,
    tm.tmDefaultChar,
    tm.tmBreakChar,
    tm.tmPitchAndFamily,
    tm.tmCharSet
  );
  word(tm.tmOverhang);
  word(tm.tmDigitizedAspectX);
  word(tm.tmDigitizedAspectY);
  bytes.push(0);
  bytes.push(...metrics.panose);

  for (const value of [
    metrics.fsSelection,
    metrics.fsType,
    metrics.slopeRise,
    metrics.slopeRun,
    metrics.italicAngle,
    metrics.emSquare,
  ]) {
    word(value);
  }

  for (const value of metrics.scaled) {
    word(units ? Math.trunc((value * ppem + half) / units) : 0);
  }

  let at = 114;

  for (const name of names) {
    word(at);
    at += name.length;
  }

  for (const name of names) {
    bytes.push(...name);
  }

  const count = Math.min(cbData & 0xffff, bytes.length);

  write(this, lpotm, bytes.slice(0, count));

  if (mappingOf(surface).mode !== MM_TEXT) {
    /* Bit set, down: the box's left and right are across. */
    const groups: [number, number][] = [
      [0x38, 0xf5f],
      [0x52, 0xfff],
    ];
    let left = (cbData & 0xffff) - 0x38;

    for (const [start, mask] of groups) {
      for (let i = 0; i < 12; i++) {
        left -= 2;

        if (left < 0) {
          return 1;
        }

        const offset = start + i * 2;
        const value = (read16(this, lpotm, offset) << 16) >> 16;

        write16(this, lpotm, offset, logicalSize(surface, value, ((mask >> i) & 1) === 1));
      }

      left -= 2;

      if (left < 0) {
        return 1;
      }
    }
  }

  return 1;
}
