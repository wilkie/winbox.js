'use strict';

/**
 * A TrueType font, read for what it says about itself.
 *
 * Four families ship with Windows 3.1 -- Arial, Times New Roman, Courier New
 * and WingDings -- and they are a different kind of thing again from both the
 * bitmap strikes and the plotter fonts. There is one outline per character in
 * a coordinate space of the font's own choosing, and everything a program asks
 * about the font is that outline's numbers scaled to the size being drawn.
 *
 * The metrics Windows reports for these are not a scaling of anything: for
 * half the sizes recorded, no single scale factor can produce both the ascent
 * and the descent by rounding. They are grid-fitted, and for a while that
 * looked like it meant running the hinting bytecode to get them.
 *
 * It does not. The font carries the answers. `VDMX` tabulates the hinted
 * extent of the whole face at every pixel size, and `hdmx` tabulates every
 * glyph's hinted advance at a set of them -- both computed offline by whoever
 * built the font, precisely so that a system can answer `GetTextMetrics`
 * without rasterising anything. Reading them is how Windows answers, and it is
 * how this does.
 *
 * The outlines in `glyf` are still untouched. Drawing a glyph does need the
 * interpreter, or an unhinted approximation of one; measuring it does not.
 */
export class TrueTypeFont {
  declare _view: DataView;
  declare _tables: Record<string, { offset: number; length: number }>;
  declare _advances: number[] | null;
  declare _cmap: Map<number, number> | null;
  declare _name: string | null;

  /**
   * @param {ArrayBuffer|Uint8Array} data - The whole font file.
   */
  constructor(data) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);

    this._view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this._tables = {};
    this._advances = null;
    this._cmap = null;
    this._name = null;

    this.readDirectory();
  }

  /** Whether the bytes look like a TrueType font at all. */
  static looksLikeFont(view: DataView) {
    if (view.byteLength < 12) {
      return false;
    }

    const version = view.getUint32(0, false);

    // 0x00010000 is a TrueType outline font; 'true' is the Macintosh spelling.
    return version === 0x00010000 || version === 0x74727565;
  }

  /**
   * Reads the table directory at the front of the file.
   *
   * Every table is found through here rather than by walking the file, which
   * is what lets the tables be in any order and lets us ignore the ones we do
   * not need.
   */
  readDirectory() {
    const count = this._view.getUint16(4, false);

    for (let index = 0; index < count; index++) {
      const at = 12 + index * 16;

      if (at + 16 > this._view.byteLength) {
        break;
      }

      let tag = '';

      for (let byte = 0; byte < 4; byte++) {
        tag += String.fromCharCode(this._view.getUint8(at + byte));
      }

      this._tables[tag] = {
        offset: this._view.getUint32(at + 8, false),
        length: this._view.getUint32(at + 12, false),
      };
    }
  }

  /** Whether a table is present and inside the file. */
  has(tag) {
    const table = this._tables[tag];

    return !!table && table.offset + 4 <= this._view.byteLength;
  }

  /** A signed 16-bit field of a table. */
  signed(tag, offset) {
    return this._view.getInt16(this._tables[tag].offset + offset, false);
  }

  /** An unsigned 16-bit field of a table. */
  unsigned(tag, offset) {
    return this._view.getUint16(this._tables[tag].offset + offset, false);
  }

  /**
   * The coordinate space the outlines are drawn in.
   *
   * Every other measurement in the font is in these units, so this is the
   * denominator of every scaling done with them.
   */
  get unitsPerEm() {
    return this.has('head') ? this.unsigned('head', 18) : 2048;
  }

  /** How far above the baseline the font says its characters reach. */
  get ascender() {
    /* `OS/2` carries a Windows-specific pair that is what GDI uses, and `hhea`
     * carries the typographic one, which is not always the same number. The
     * Windows pair is the one to prefer where it exists.
     */
    if (this.has('OS/2') && this._tables['OS/2'].length >= 78) {
      return this.unsigned('OS/2', 74);
    }

    return this.has('hhea') ? this.signed('hhea', 4) : 0;
  }

  /** How far below it they reach, as a positive number. */
  get descender() {
    if (this.has('OS/2') && this._tables['OS/2'].length >= 78) {
      return this.unsigned('OS/2', 76);
    }

    return this.has('hhea') ? -this.signed('hhea', 6) : 0;
  }

  /** The gap the font asks for between one line and the next. */
  get lineGap() {
    return this.has('hhea') ? this.signed('hhea', 8) : 0;
  }

  /** The typographic ascender, which excludes what sits above the capitals. */
  get typoAscender() {
    return this.has('OS/2') && this._tables['OS/2'].length >= 74
      ? this.signed('OS/2', 68)
      : this.ascender;
  }

  /** The widest advance in the font. */
  get maxAdvance() {
    return this.has('hhea') ? this.unsigned('hhea', 10) : 0;
  }

  /** The average character width the font states for itself. */
  get averageAdvance() {
    return this.has('OS/2') ? this.signed('OS/2', 2) : 0;
  }

  /** The weight class, on the same 1..1000 scale a `LOGFONT` uses. */
  get weight() {
    return this.has('OS/2') ? this.unsigned('OS/2', 4) : 400;
  }

  /**
   * Whether the font holds symbols rather than letters.
   *
   * A symbol font maps its characters into a private range instead of at the
   * codepoints they are written with, so it has no glyph for `A` at `A`. That
   * is the test, and it matters because such a font is no use to a request
   * that asked for the ANSI character set -- Windows answers a request for
   * WingDings in ANSI with MS Sans Serif, exactly as it does for Terminal.
   */
  get symbolic() {
    const cmap = this.cmap;

    return !cmap.has(0x41) && cmap.has(0xf041);
  }

  /**
   * Whether this is the plain face of its family.
   *
   * The four files of a family all call themselves the same thing -- Arial,
   * Arial Bold, Arial Italic and Arial Bold Italic are all `Arial` in the name
   * table -- so a request for Arial has to be answered with the right one of
   * them, and it is not whichever the directory happened to list first.
   */
  get regular() {
    if (this.has('OS/2') && this._tables['OS/2'].length >= 64) {
      const selection = this.unsigned('OS/2', 62);

      // Bit 6 says so outright; failing that, not bold and not italic.
      return (selection & 0x40) !== 0 || (selection & 0x21) === 0;
    }

    return this.weight < 700;
  }

  /**
   * The widest advance at a pixel size, grid-fitted.
   *
   * `hdmx` states this per size alongside the per-glyph widths, and it is not
   * the scaled `hhea` maximum: hinting can push a glyph a pixel wider than the
   * outline it came from.
   */
  deviceMaxAdvance(ppem) {
    if (!this.has('hdmx')) {
      return null;
    }

    const base = this._tables['hdmx'].offset;
    const count = this._view.getInt16(base + 2, false);
    const stride = this._view.getInt32(base + 4, false);

    for (let index = 0; index < count; index++) {
      const record = base + 8 + index * stride;

      if (this._view.getUint8(record) === ppem) {
        return this._view.getUint8(record + 1);
      }
    }

    return null;
  }

  /**
   * The family the font puts itself in, as the low nibble of a `LOGFONT`'s
   * pitch and family byte.
   *
   * `OS/2` states a class, and Windows turns it into one of the handful of
   * families a program can ask for: Arial calls itself class 8, which is the
   * sans serifs, and comes back as `FF_SWISS`; Times New Roman is class 1 and
   * comes back as `FF_ROMAN`.
   */
  get family() {
    if (!this.has('OS/2')) {
      return 0x00;
    }

    const klass = this.signed('OS/2', 30) >> 8;

    if (klass === 8) {
      return 0x20; // FF_SWISS
    }

    if (klass === 10) {
      return 0x40; // FF_SCRIPT
    }

    if (klass === 12) {
      return 0x00; // FF_DONTCARE, which is what a symbol font gets
    }

    if (this.fixedPitch) {
      return 0x30; // FF_MODERN
    }

    return 0x10; // FF_ROMAN
  }

  /** Whether every character advances by the same amount. */
  get fixedPitch() {
    return this.has('post')
      ? this._view.getUint32(this._tables['post'].offset + 12, false) !== 0
      : false;
  }

  /**
   * The family name, which is what `GetTextFace` answers.
   *
   * Taken from the Windows platform entry where there is one, because that is
   * the one Windows itself reads; its strings are UTF-16, so the low byte of
   * each pair is the character for everything these fonts are named.
   */
  get faceName() {
    if (this._name !== null) {
      return this._name;
    }

    this._name = '';

    if (!this.has('name')) {
      return this._name;
    }

    const base = this._tables['name'].offset;
    const count = this._view.getUint16(base + 2, false);
    const storage = base + this._view.getUint16(base + 4, false);

    let best = '';

    for (let index = 0; index < count; index++) {
      const at = base + 6 + index * 12;

      const platform = this._view.getUint16(at, false);
      const nameId = this._view.getUint16(at + 6, false);
      const length = this._view.getUint16(at + 8, false);
      const offset = this._view.getUint16(at + 10, false);

      // Name 1 is the family, which is the name a program asks for.
      if (nameId !== 1) {
        continue;
      }

      let text = '';

      if (platform === 3) {
        for (let byte = 1; byte < length; byte += 2) {
          text += String.fromCharCode(this._view.getUint8(storage + offset + byte));
        }
      } else if (platform === 1) {
        for (let byte = 0; byte < length; byte++) {
          text += String.fromCharCode(this._view.getUint8(storage + offset + byte));
        }
      }

      if (text && (platform === 3 || !best)) {
        best = text;
      }
    }

    this._name = best;

    return this._name;
  }

  /**
   * The grid-fitted extent of the face at a pixel size.
   *
   * `VDMX` is a table of what the outlines actually came out as once they had
   * been hinted onto the grid, one entry per pixel size, computed when the
   * font was built. It is why the reported ascent and descent are not a
   * scaling of the font's own ascender and descender, and why they can move
   * independently of one another from one size to the next.
   *
   * The groups are indexed by aspect ratio. Every ratio in the fonts shipped
   * with 3.1 carries the same numbers, and a square-pixel display would take
   * the 1:1 group in any case, so the first is read.
   *
   * @param {number} ppem - The size in pixels per em.
   * @returns {Object|null} The extent above and below the line, or null if the
   *                        table does not cover this size.
   */
  extentAt(ppem) {
    if (!this.has('VDMX')) {
      return null;
    }

    const base = this._tables['VDMX'].offset;
    const ratios = this._view.getUint16(base + 4, false);

    if (ratios === 0) {
      return null;
    }

    const group = base + this._view.getUint16(base + 6 + ratios * 4, false);

    const records = this._view.getUint16(group, false);
    const first = this._view.getUint8(group + 2);
    const last = this._view.getUint8(group + 3);

    if (ppem < first || ppem > last) {
      return null;
    }

    for (let index = 0; index < records; index++) {
      const at = group + 4 + index * 6;

      if (this._view.getUint16(at, false) === ppem) {
        return {
          ascent: this._view.getInt16(at + 2, false),
          descent: -this._view.getInt16(at + 4, false),
        };
      }
    }

    return null;
  }

  /**
   * The largest pixel size whose grid-fitted extent fits in a cell.
   *
   * A program asks for a cell height and the font has only the sizes it was
   * hinted at, so the answer is the tallest that does not overflow. Where two
   * sizes come out the same height -- which happens, because grid-fitting
   * quantises -- the smaller is the one Windows picks, and the difference
   * shows up in the internal leading rather than anywhere else.
   *
   * @param {number} height - The cell height asked for, in pixels.
   */
  sizeForHeight(height) {
    if (!this.has('VDMX')) {
      return null;
    }

    const base = this._tables['VDMX'].offset;
    const ratios = this._view.getUint16(base + 4, false);

    if (ratios === 0) {
      return null;
    }

    const group = base + this._view.getUint16(base + 6 + ratios * 4, false);
    const records = this._view.getUint16(group, false);

    let best: any = null;

    for (let index = 0; index < records; index++) {
      const at = group + 4 + index * 6;

      const ppem = this._view.getUint16(at, false);
      const ascent = this._view.getInt16(at + 2, false);
      const descent = -this._view.getInt16(at + 4, false);

      const cell = ascent + descent;

      if (cell > height) {
        continue;
      }

      if (!best || cell > best.cell || (cell === best.cell && ppem < best.ppem)) {
        best = { ppem, ascent, descent, cell };
      }
    }

    return best;
  }

  /**
   * A glyph's grid-fitted advance at a pixel size, in whole pixels.
   *
   * `hdmx` is the same idea as `VDMX` applied to widths: what each glyph's
   * advance came out as once hinted, at the handful of sizes the font was
   * built for. A size that is not in the table has no answer here, and a
   * fixed-pitch font may carry no table at all because every advance is the
   * same one scaled.
   *
   * @param {number} ppem - The size in pixels per em.
   * @param {number} glyph - The glyph index.
   */
  deviceAdvance(ppem, glyph) {
    if (!this.has('hdmx')) {
      return null;
    }

    const base = this._tables['hdmx'].offset;
    const count = this._view.getInt16(base + 2, false);
    const stride = this._view.getInt32(base + 4, false);

    for (let index = 0; index < count; index++) {
      const record = base + 8 + index * stride;

      if (this._view.getUint8(record) !== ppem) {
        continue;
      }

      const at = record + 2 + glyph;

      return at < base + this._tables['hdmx'].length ? this._view.getUint8(at) : null;
    }

    return null;
  }

  /** The glyph a character maps to, following the symbol range if need be. */
  glyphFor(code) {
    const cmap = this.cmap;

    return cmap.get(code) ?? cmap.get(0xf000 + code) ?? 0;
  }

  /**
   * The advance widths, in font units, indexed by glyph.
   *
   * The table stores one per glyph up to a point and then stops; every glyph
   * after that keeps the last advance, which is how a font with a long run of
   * equal-width glyphs stays small.
   */
  get advances() {
    if (this._advances) {
      return this._advances;
    }

    this._advances = [];

    if (!this.has('hhea') || !this.has('hmtx')) {
      return this._advances;
    }

    const count = this.unsigned('hhea', 34);
    const base = this._tables['hmtx'].offset;

    for (let index = 0; index < count; index++) {
      this._advances.push(this._view.getUint16(base + index * 4, false));
    }

    return this._advances;
  }

  /** The advance of one glyph, in font units. */
  advanceOf(glyph) {
    const advances = this.advances;

    if (advances.length === 0) {
      return 0;
    }

    return advances[Math.min(glyph, advances.length - 1)];
  }

  /**
   * The character to glyph mapping.
   *
   * Only the two subtable formats these fonts actually use are read: format 4,
   * which is the segmented mapping every Windows font has, and format 0, the
   * single byte table a symbol font may carry.
   */
  get cmap() {
    if (this._cmap) {
      return this._cmap;
    }

    this._cmap = new Map();

    if (!this.has('cmap')) {
      return this._cmap;
    }

    const base = this._tables['cmap'].offset;
    const count = this._view.getUint16(base + 2, false);

    let chosen = -1;

    for (let index = 0; index < count; index++) {
      const at = base + 4 + index * 8;

      const platform = this._view.getUint16(at, false);
      const offset = this._view.getUint32(at + 4, false);

      // The Windows table wins; anything else will do if there is no Windows one.
      if (platform === 3 || chosen < 0) {
        chosen = base + offset;
      }
    }

    if (chosen < 0) {
      return this._cmap;
    }

    const format = this._view.getUint16(chosen, false);

    if (format === 4) {
      const segments = this._view.getUint16(chosen + 6, false) / 2;

      const ends = chosen + 14;
      const starts = ends + segments * 2 + 2;
      const deltas = starts + segments * 2;
      const ranges = deltas + segments * 2;

      for (let segment = 0; segment < segments; segment++) {
        const end = this._view.getUint16(ends + segment * 2, false);
        const start = this._view.getUint16(starts + segment * 2, false);
        const delta = this._view.getInt16(deltas + segment * 2, false);
        const range = this._view.getUint16(ranges + segment * 2, false);

        for (let code = start; code <= end && code !== 0xffff; code++) {
          let glyph = 0;

          if (range === 0) {
            glyph = (code + delta) & 0xffff;
          } else {
            const at = ranges + segment * 2 + range + (code - start) * 2;

            if (at + 2 > this._view.byteLength) {
              continue;
            }

            glyph = this._view.getUint16(at, false);

            if (glyph !== 0) {
              glyph = (glyph + delta) & 0xffff;
            }
          }

          if (glyph) {
            this._cmap.set(code, glyph);
          }
        }
      }
    } else if (format === 0) {
      for (let code = 0; code < 256; code++) {
        const glyph = this._view.getUint8(chosen + 6 + code);

        if (glyph) {
          this._cmap.set(code, glyph);
        }
      }
    }

    return this._cmap;
  }

  /**
   * The advance of one character, in font units.
   *
   * A symbol font maps its characters into a private range rather than at the
   * codepoints they are written with, so a character that is not in the table
   * is looked for there before it is given up on.
   */
  advanceFor(code) {
    const cmap = this.cmap;

    const glyph = cmap.get(code) ?? cmap.get(0xf000 + code) ?? 0;

    return this.advanceOf(glyph);
  }
}
