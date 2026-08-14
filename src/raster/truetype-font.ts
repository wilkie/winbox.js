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
 * This reads the tables that describe the font, not the ones that draw it.
 * `glyf` and `loca` -- the outlines themselves -- are untouched, because
 * rasterising them is a separate piece of work with its own oracle: Windows
 * runs the hinting bytecode before it scan-converts, which moves the outline
 * onto the pixel grid and changes the shapes substantially at text sizes.
 * Metrics are what every layout decision a program makes actually uses, and
 * they come out of the tables read here.
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

  /** Whether the outlines are slanted. */
  get italic() {
    return this.has('head') ? (this.unsigned('head', 44) & 0x02) !== 0 : false;
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
