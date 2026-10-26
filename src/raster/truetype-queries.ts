'use strict';

import { type TrueTypeFont } from './truetype-font.js';

/**
 * What GDI's TrueType engine answers about a font file beside drawing it:
 * the bytes of a table (`GetFontData`), its kerning pairs
 * (`GetKerningPairs`) and the outline metrics (`GetOutlineTextMetrics`),
 * in the font's own units. GDI's side -- the character set, the pixel
 * size, the mapping -- is `gdi/outline-queries.ts`.
 *
 * **Read out** of `GDI.EXE`: the engine's entry points are a table at
 * seg47 `001e`, reached through seg36's stubs `0042` to `00ae`.
 */

/** What `GetFontData` answers when it has nothing: -1. */
export const GDI_ERROR = 0xffffffff;

/** The font file's bytes. */
export function fileBytes(font: TrueTypeFont): Uint8Array {
  const view = font._view;

  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

function u16(bytes: Uint8Array, at: number) {
  return at + 2 <= bytes.length ? (bytes[at] << 8) | bytes[at + 1] : 0;
}

function i16(bytes: Uint8Array, at: number) {
  return (u16(bytes, at) << 16) >> 16;
}

function u32(bytes: Uint8Array, at: number) {
  return at + 4 <= bytes.length
    ? ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0
    : 0;
}

/** A table's offset and length, by its tag as the four bytes of a little-endian dword. */
function tableOf(bytes: Uint8Array, tag: number): { offset: number; length: number } | null {
  const count = u16(bytes, 4);

  for (let index = 0; index < count; index++) {
    const at = 12 + index * 16;

    if (at + 16 > bytes.length) {
      break;
    }

    const name =
      (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;

    if (name === tag >>> 0) {
      return { offset: u32(bytes, at + 8), length: u32(bytes, at + 12) };
    }
  }

  return null;
}

/** A table by its name. */
function named(bytes: Uint8Array, name: string) {
  return tableOf(
    bytes,
    name.charCodeAt(0) |
      (name.charCodeAt(1) << 8) |
      (name.charCodeAt(2) << 16) |
      (name.charCodeAt(3) << 24)
  );
}

/**
 * `GetFontData`'s reading of the file. **Read out** (seg40 `0113`): with
 * no buffer the size is taken as the largest there is. A table of nought is
 * the whole file; otherwise the directory is searched for the tag, and a
 * tag it lacks is -1. What is left of the table past the offset is -1
 * where it is nothing or less, else cut to the size: that many bytes are
 * read, from the table's start plus the offset, and that is the answer.
 *
 * @returns The answer, and where in the file the bytes it read start.
 */
export function fontData(
  bytes: Uint8Array,
  table: number,
  offset: number,
  size: number | null
): { answer: number; from: number } {
  let start = 0;
  let length = bytes.length;

  if (table >>> 0 !== 0) {
    const found = tableOf(bytes, table);

    if (!found) {
      return { answer: GDI_ERROR, from: 0 };
    }

    start = found.offset;
    length = found.length;
  }

  /* Signed, as the engine compares it: what is left past the offset. */
  const left = (length - (offset >>> 0)) | 0;

  if (left <= 0) {
    return { answer: GDI_ERROR, from: 0 };
  }

  const cap = size === null ? 0xffffffff : size >>> 0;

  return { answer: Math.min(left >>> 0, cap), from: start + (offset >>> 0) };
}

/**
 * The code each glyph is reached by, as the engine builds it for the
 * kerning pairs (seg36 `15af`): every code of the Windows `cmap`, in order,
 * the glyph it reaches given that code -- so a glyph two codes reach keeps
 * the higher, the space keeping 00A0h over 0020h.
 */
export function codesOfGlyphs(font: TrueTypeFont): Map<number, number> {
  const codes = new Map<number, number>();

  for (const [code, glyph] of font.cmap) {
    if ((codes.get(glyph) ?? -1) < code) {
      codes.set(glyph, code);
    }
  }

  return codes;
}

/** One kerning pair as the engine hands it to GDI: two codes and the amount, in font units. */
export interface KernPair {
  first: number;
  second: number;
  amount: number;
}

/**
 * The font's kerning pairs (seg36 `1420`): the `kern` table's first
 * horizontal subtable of the first format -- coverage 0001h -- its pairs
 * in the file's order, each glyph turned into the code that reaches it. A
 * table of another version, or without such a subtable, has none.
 */
export function kernPairs(font: TrueTypeFont): KernPair[] {
  const bytes = fileBytes(font);
  const table = named(bytes, 'kern');

  if (!table || u16(bytes, table.offset) !== 0) {
    return [];
  }

  let left = u16(bytes, table.offset + 2);
  let at = table.offset + 4;

  while (left-- > 0) {
    if (u16(bytes, at + 4) === 0x0001) {
      const count = u16(bytes, at + 6);
      const codes = codesOfGlyphs(font);
      const pairs: KernPair[] = [];

      for (let index = 0; index < count; index++) {
        const pair = at + 14 + index * 6;

        pairs.push({
          first: codes.get(u16(bytes, pair)) ?? 0,
          second: codes.get(u16(bytes, pair + 2)) ?? 0,
          amount: i16(bytes, pair + 4),
        });
      }

      return pairs;
    }

    const length = u16(bytes, at + 2);

    if (!length) {
      break;
    }

    at += length;
  }

  return [];
}

/** How many pairs `kernPairs` has, without turning glyphs into codes. */
export function kernPairCount(font: TrueTypeFont): number {
  const bytes = fileBytes(font);
  const table = named(bytes, 'kern');

  if (!table || u16(bytes, table.offset) !== 0) {
    return 0;
  }

  let left = u16(bytes, table.offset + 2);
  let at = table.offset + 4;

  while (left-- > 0) {
    if (u16(bytes, at + 4) === 0x0001) {
      return u16(bytes, at + 6);
    }

    const length = u16(bytes, at + 2);

    if (!length) {
      break;
    }

    at += length;
  }

  return 0;
}

/**
 * The outline metrics in the font's units, as the engine makes them
 * (seg40 `0606`), before GDI scales them.
 */
export interface OutlineMetrics {
  panose: number[];
  fsSelection: number;
  fsType: number;
  slopeRise: number;
  slopeRun: number;
  italicAngle: number;
  emSquare: number;
  /** The twenty-five GDI scales, from `otmAscent` to `otmsUnderscoreSize`. */
  scaled: number[];
  /** The family (name 1), face (4), style (2) and full (3) names, as UTF-16 codes. */
  names: number[][];
}

/**
 * **Read out** of seg40 `0606`, the engine's builder, field by field:
 *
 * * From `head`: the box; the EM square, `unitsPerEm`; the cap height half
 *   of it and the x height a quarter -- the engine has no other source for
 *   them; `lowestRecPPEM`, which GDI then scales like the rest.
 *   `fsSelection` from `macStyle` -- bold 20h, italic 1, neither 40h -- and
 *   `fsType` 100h, where there is no `OS/2`.
 * * From `hhea`: the caret's rise and run, and the Macintosh ascent,
 *   descent and gap -- also the ascent, descent and gap where there is no
 *   `OS/2`.
 * * From `OS/2`: `fsType`, the sub- and superscript sizes and offsets and
 *   the strikeout's size and position, `fsSelection`, the typographic
 *   ascent, descent and gap, and the PANOSE bytes.
 * * From `post`: the italic angle in tenths of a degree -- the whole
 *   degrees, modulo 360, by ten, plus the fraction by ten, floored -- the
 *   underline's position and thickness, and a fixed pitch sets bit 0 of
 *   `fsType`.
 * * The names, from the Microsoft platform entries for the font's encoding
 *   in US English, or the Macintosh ones.
 */
export function outlineMetrics(font: TrueTypeFont, encoding: number): OutlineMetrics {
  const bytes = fileBytes(font);
  const head = named(bytes, 'head');
  const hhea = named(bytes, 'hhea');
  const os2 = named(bytes, 'OS/2');
  const post = named(bytes, 'post');
  const s = (table: { offset: number } | null, at: number) =>
    table ? i16(bytes, table.offset + at) : 0;
  const u = (table: { offset: number } | null, at: number) =>
    table ? u16(bytes, table.offset + at) : 0;

  const macStyle = u(head, 0x2c);
  const units = u(head, 0x12);
  let fsSelection = macStyle & 1 ? 0x20 : 0;

  fsSelection |= macStyle & 2 ? 1 : 0;
  fsSelection ||= 0x40;

  const metrics: OutlineMetrics = {
    panose: new Array(10).fill(0),
    fsSelection,
    fsType: 0x100,
    slopeRise: s(hhea, 0x12),
    slopeRun: s(hhea, 0x14),
    italicAngle: 0,
    emSquare: units,
    scaled: [
      s(hhea, 4),
      s(hhea, 6),
      s(hhea, 8),
      units >> 1,
      units >> 2,
      s(head, 0x24),
      s(head, 0x2a),
      s(head, 0x28),
      s(head, 0x26),
      s(hhea, 4),
      s(hhea, 6),
      s(hhea, 8),
      u(head, 0x2e),
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
    ],
    names: [[], [], [], []],
  };

  if (os2) {
    metrics.fsType = u(os2, 8);

    for (let i = 0; i < 10; i++) {
      metrics.scaled[13 + i] = s(os2, 0x0a + i * 2);
    }

    metrics.fsSelection = u(os2, 0x3e);
    metrics.scaled[0] = s(os2, 0x44);
    metrics.scaled[1] = s(os2, 0x46);
    metrics.scaled[2] = s(os2, 0x48);
    metrics.panose = Array.from(bytes.subarray(os2.offset + 0x20, os2.offset + 0x2a));
  }

  if (post) {
    if (u32(bytes, post.offset + 0x0c) !== 0) {
      metrics.fsType |= 1;
    }

    const whole = s(post, 4);
    const fraction = u(post, 6);

    metrics.italicAngle =
      (((whole % 360) * 10 + Math.floor((fraction * 10) / 0x10000)) << 16) >> 16;
    metrics.scaled[23] = s(post, 8);
    metrics.scaled[24] = s(post, 10);
  }

  metrics.names = outlineNames(bytes, encoding);

  return metrics;
}

/**
 * The four names, by the name table's entries (seg40 `0654`): the
 * Microsoft platform's for the encoding asked, in US English -- a second
 * pass asks US English again where the first lacked the family or the
 * face; the first entry of each name wins. A Macintosh entry's bytes are
 * widened to codes one for one.
 */
function outlineNames(bytes: Uint8Array, encoding: number): number[][] {
  const names: (number[] | null)[] = [null, null, null, null];
  const table = named(bytes, 'name');

  if (!table) {
    return [[], [], [], []];
  }

  const count = u16(bytes, table.offset + 2);
  const storage = table.offset + u16(bytes, table.offset + 4);
  /* Name 1 is the family, 4 the face, 2 the style, 3 the full name. */
  const slot = [0, 2, 3, 1];

  for (let index = 0; index < count; index++) {
    const at = table.offset + 6 + index * 12;

    if (u16(bytes, at) !== 3 || u16(bytes, at + 2) !== encoding || u16(bytes, at + 4) !== 0x0409) {
      continue;
    }

    const id = u16(bytes, at + 6) - 1;

    if (id < 0 || id > 3 || names[slot[id]]) {
      continue;
    }

    const length = u16(bytes, at + 8);
    const offset = storage + u16(bytes, at + 10);
    const codes: number[] = [];

    for (let byte = 0; byte + 1 < length; byte += 2) {
      codes.push(u16(bytes, offset + byte));
    }

    names[slot[id]] = codes;
  }

  return names.map((name) => name ?? []);
}
