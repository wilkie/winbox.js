'use strict';

import { Hinter, ONE } from './glyph-hinting.js';

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
  declare _hinters: any;
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

    /* The file this came from and the installer's resource for it, when the
     * loader knows them; see `font-resource.ts`. */
    this.fileName = null;
    this.resource = null;

    this.readDirectory();
  }

  /**
   * The smallest size a face is ever drawn at.
   *
   * Asked for a one pixel cell Windows answers with two pixels of Arial rather
   * than one, so something floors it. Two is where the recording puts the
   * floor; whether it is a floor on the size or on the cell it produces the
   * probe cannot separate, because at this size they coincide.
   */
  static MIN_PPEM = 2;

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

  /**
   * How wide the font's bounding box is, in font units.
   *
   * This is what `tmMaxCharWidth` is scaled from, which is not the same thing
   * as the widest advance and is measurably wider. The box is the union of
   * every glyph's extent, so it counts ink that hangs outside the advance it
   * was given -- and an italic face, whose glyphs lean out of their cells at
   * both ends, has a box far wider than any character in it advances. Arial's
   * box is 2142 units against a widest advance of 2079; Arial Italic's is 2422
   * against the same 2079, and the difference grows with the size, which is
   * what gives it away.
   */
  get boundingWidth() {
    return this.has('head') ? this.signed('head', 40) - this.signed('head', 36) : 0;
  }

  /** The average character width the font states for itself. */
  get averageAdvance() {
    return this.has('OS/2') ? this.signed('OS/2', 2) : 0;
  }

  /** The weight class, on the same 1..1000 scale a `LOGFONT` uses. */
  get weight() {
    return this.has('OS/2') ? this.unsigned('OS/2', 4) : 400;
  }

  /** Whether this file is the bold one of its family. */
  get boldFace() {
    if (this.has('OS/2') && this._tables['OS/2'].length >= 64) {
      return (this.unsigned('OS/2', 62) & 0x20) !== 0;
    }

    return this.weight >= 700;
  }

  /** Whether this file is the italic one. */
  get italicFace() {
    if (this.has('OS/2') && this._tables['OS/2'].length >= 64) {
      return (this.unsigned('OS/2', 62) & 0x01) !== 0;
    }

    return this.has('head') ? (this.unsigned('head', 44) & 0x02) !== 0 : false;
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
   *
   * Class 12 -- the symbol fonts -- used to answer `FF_DONTCARE` here, on no
   * evidence: the only two fonts that carry it are Symbol and WingDings, and
   * neither had ever been asked for at a size that reaches an outline. Asked
   * for now, Symbol comes back `0x17`, which is `FF_ROMAN` with the pitch and
   * vector bits, so it takes the same route as anything else without a class of
   * its own. **Recorded**, at eight, ten, twelve, fifteen, twenty, twenty-four,
   * twenty-nine, thirty-seven, fifty and a hundred pixels.
   */
  get family() {
    // The installer's word first; see `font-resource.ts`.
    if (this.resource) {
      return this.resource.pitchAndFamily & 0xf0;
    }

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
   * Where in `VDMX` the group for this device's pixels starts.
   *
   * The table is not one list of sizes, it is one per aspect ratio, and which
   * of them applies is decided by the shape of the device's pixels. Arial
   * Italic carries four: 4:3, 5:3, 2:1 and a catch-all with `xRatio` zero. A
   * VGA at 96 dots per inch each way has square pixels, so none of the first
   * three apply and the catch-all is the one to read.
   *
   * Reading the first group instead of the right one is wrong in a way that
   * hides: three quarters of the sizes agree between the groups, and the ones
   * that differ look like an off-by-one in the leading rather than like a
   * lookup in the wrong table. Arial Italic at 96 pixels reports an extent of
   * 76 and 19, which appears nowhere in the first group and at 85 pixels per em
   * in the fourth. **Measured**, against every recorded size.
   *
   * @returns {number|null} The offset of the group, or null if there is none.
   */
  vdmxGroup(x = 1, y = 1) {
    if (!this.has('VDMX')) {
      return null;
    }

    const base = this._tables['VDMX'].offset;
    const ratios = this._view.getUint16(base + 4, false);

    if (ratios === 0 || !(x > 0) || !(y > 0)) {
      return null;
    }

    /* In lowest terms, which is how the table names a ratio: 4:3 is written
     * `xRatio` 4 over `yStart`..`yEnd` 3..3, and it has to be matched as 4:3
     * rather than as 8:6. */
    const divisor = (a, b) => (b ? divisor(b, a % b) : a);
    const common = divisor(x, y);

    x /= common;
    y /= common;

    for (let index = 0; index < ratios; index++) {
      const at = base + 6 + index * 4;

      const xRatio = this._view.getUint8(at + 1);
      const yStart = this._view.getUint8(at + 2);
      const yEnd = this._view.getUint8(at + 3);

      /* An `xRatio` of zero matches any ratio at all, which is what a square
       * pixel with no stretch on it ends up taking -- none of the three named
       * ones is 1:1. Otherwise the record covers `xRatio` across against
       * `yStart` to `yEnd` down.
       */
      if (xRatio === 0 || (xRatio === x && yStart <= y && y <= yEnd)) {
        return base + this._view.getUint16(base + 6 + ratios * 4 + index * 2, false);
      }
    }

    return null;
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
  extentAt(ppem, x = 1, y = 1) {
    const group = this.vdmxGroup(x, y);

    if (group === null) {
      return null;
    }

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
  sizeForHeight(height, x = 1, y = 1) {
    const group = this.vdmxGroup(x, y);

    if (group === null) {
      return null;
    }

    const records = this._view.getUint16(group, false);

    let best: any = null;

    /* Two sizes often fit the same cell, because the fitting quantises: Arial
     * comes out sixteen pixels tall at both thirteen and fourteen pixels per
     * em. Which one is taken changes nothing about the ascent, the descent or
     * the height -- that is what makes them tied -- and moves the internal
     * leading by one, so it is visible and it matters.
     *
     * Windows takes the *smallest* of a tie when the cell it fits is exactly
     * the height asked for, and the *largest* when the cell falls short.
     * **Measured**, across forty-eight ties in three families and all three
     * styles of each, with no exception.
     *
     * Stated as a rule that sounds arbitrary; stated as a loop it is the
     * obvious thing to write. Walk the sizes upward keeping the best fit so
     * far, let a later size of equal cell replace an earlier one, and stop as
     * soon as something fits exactly -- there is nothing better to find. The
     * scan that stops early keeps the first of the tie; the scan that runs to
     * the end keeps the last.
     *
     * The sizes below the table are the exception, and the loop below says why.
     */
    const consider = (ppem, ascent, descent) => {
      const cell = ascent + descent;

      if (cell > height) {
        return false;
      }

      if (!best || cell >= best.cell) {
        best = { ppem, ascent, descent, cell };
      }

      return cell === height;
    };

    /* Below the smallest size the table covers, the extent is computed rather
     * than looked up.
     *
     * `VDMX` is a cache of what the hinted outline comes out as, and Arial's
     * starts at eight pixels per em. Windows still answers for the sizes below
     * it -- asked for a one pixel cell it reports two pixels of Arial, and for
     * a nine pixel cell it reports seven -- so it is doing the work the table
     * would have saved it. Scaling the `hhea` ascender and descender and
     * rounding reproduces every one of those: 2 and 0 at two pixels per em, 3
     * and 1 at three, 6 and 1 at seven. **Measured**, against heights one to
     * fourteen for three families.
     *
     * This does not mean Windows scales them. It means that at these sizes
     * hinting moves nothing far enough to show, which is unsurprising when the
     * whole em is three pixels tall.
     */
    const smallest = this._smallestTabulated();

    let exact = false;

    /* A computed size never ends the search, however well it fits.
     *
     * The stop-on-exact rule above is a rule about the *table*, and letting a
     * size below the table trigger it gets two answers wrong. Courier New asked
     * for an eight pixel cell fits it at seven pixels per em, computed, and at
     * eight, tabulated -- and Windows answers eight. Asked for three it fits at
     * two and at three, both computed, and Windows answers three. Both are the
     * larger of the tie, where every tie inside the table takes the smaller.
     *
     * **Measured**, over all sixteen ties the recording contains: the six that
     * take the first of the tie are tabulated on both sides, and the only two
     * exceptions to that are the two above. Stated as a loop it is again the
     * obvious thing -- the fallback fills the answer in and the table settles
     * it -- and worth 15 records on `CreateFont`.
     */
    for (let ppem = TrueTypeFont.MIN_PPEM; ppem < smallest; ppem++) {
      consider(
        ppem,
        Math.round((this.ascender * ppem) / this.unitsPerEm),
        Math.round((this.descender * ppem) / this.unitsPerEm)
      );
    }

    for (let index = 0; !exact && index < records; index++) {
      const at = group + 4 + index * 6;

      exact = consider(
        this._view.getUint16(at, false),
        this._view.getInt16(at + 2, false),
        -this._view.getInt16(at + 4, false)
      );
    }

    /* Asked for a cell smaller than anything fits in, Windows overflows rather
     * than refusing: one pixel of Arial comes back two pixels tall, and keeps
     * the name Arial rather than falling to a strike. **Recorded.**
     */
    return best ?? this.smallestSize();
  }

  /** The smallest size `VDMX` tabulates, or infinity if it tabulates none. */
  _smallestTabulated() {
    const group = this.vdmxGroup();

    if (group === null) {
      return Infinity;
    }

    const records = this._view.getUint16(group, false);

    let smallest = Infinity;

    for (let index = 0; index < records; index++) {
      smallest = Math.min(smallest, this._view.getUint16(group + 4 + index * 6, false));
    }

    return smallest;
  }

  /** The smallest size the face is drawn at, for a cell nothing fits in. */
  smallestSize() {
    const ppem = TrueTypeFont.MIN_PPEM;
    const ascent = Math.round((this.ascender * ppem) / this.unitsPerEm);
    const descent = Math.round((this.descender * ppem) / this.unitsPerEm);

    return { ppem, ascent, descent, cell: ascent + descent };
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

  /**
   * A glyph's advance at a size where the font says hinting no longer moves it.
   *
   * `LTSH` is a table of one byte per glyph: the smallest pixel size at or
   * above which that glyph's advance is the scaled one, to within a couple of
   * per cent. Above the threshold Windows stops asking the interpreter and
   * scales, which is not an optimisation a caller can ignore -- it is a
   * different number. Arial's `W` at eighty-nine pixels per em hints to 89 and
   * scales to 84, and the recorded extent wants 84.
   *
   * **Recorded.** Twelve measured strings disagreed, every one of them at a
   * size `hdmx` does not tabulate, and eleven of the twelve come right on this
   * rule alone. The twelfth is Times New Roman Italic at thirty-four pixels,
   * where no table covers the glyph either way and the interpreter is simply a
   * pixel out -- section 8.
   *
   * The three sources are asked in the order Windows can answer them: the
   * tabulated value where there is one, then this, then the program. Courier
   * New carries neither table and runs the program at every size.
   *
   * Under a width the two sizes part company: the threshold is compared
   * against the *vertical* size and the advance is scaled by the horizontal
   * one. **Measured**, and it is the whole of the difference: over the
   * `charscal` sweep's 124,992 stretched advances, gating on the vertical size
   * is right on all 124,992, and gating on the horizontal one on 124,533.
   * Gating on the smaller of the two gives 124,831 and on the larger 124,694,
   * so it is the vertical size rather than either extreme.
   *
   * @param {number} glyph - The glyph index.
   * @param {number} ppem - The size in pixels per em, which the threshold is
   *                        compared against.
   * @param {number} [across] - The horizontal size to scale by, where it
   *                            differs from the size asked about.
   */
  linearAdvance(glyph, ppem, across = ppem) {
    if (!this.has('LTSH')) {
      return null;
    }

    const table = this._tables['LTSH'];
    const count = this._view.getUint16(table.offset + 2, false);

    if (glyph >= count) {
      return null;
    }

    // One means the advance was never anything but linear.
    if (ppem < this._view.getUint8(table.offset + 4 + glyph)) {
      return null;
    }

    return Math.round((this.advanceOf(glyph) * across) / this.unitsPerEm);
  }

  /**
   * A glyph's advance at a size with no program run: what the scaler answers
   * for a slant Windows synthesises.
   *
   * It is not the design advance scaled and rounded. The scaler places the
   * origin phantom at `xMin - lsb` -- the outline keeps its own coordinates
   * and the origin moves to where the bearing says it should be -- and the
   * advance phantom that far again plus the advance, scales both to 26.6 and
   * rounds each to a sixty-fourth, and the device advance is their difference
   * rounded to a pixel. When the bearing shift is nought the two agree. When it
   * is not, the origin's own rounding error moves the advance by up to half a
   * sixty-fourth, which is enough to decide a glyph whose scaled advance sits a
   * hair under the half: Symbol's `A` at sixty-three pixels per em is 45.497
   * pixels and rounds up as a number, but its origin at -0.615 pixels rounds
   * to -39 sixty-fourths and the advance to 2872, and 2911 sixty-fourths is 45.
   * `H`, the same advance with no shift, is 2912 and 46. Windows makes them 45
   * and 46.
   *
   * **Recorded.** Every letter and digit of Symbol slanted, at every cell height
   * from 8 to 110: 6,014 advances. Rounding the design advance misses 51 of
   * them, all one short, all with the fraction between .488 and .4995 of a
   * pixel. This misses none. Placing the origin at `lsb - xMin` instead
   * misses 28, and flooring the sixty-fourths instead of rounding them misses
   * 29, so both the sign and the rounding are measured rather than chosen.
   *
   * @param {number} glyph - The glyph index.
   * @param {number} ppem - The size in pixels per em.
   */
  unhintedAdvance(glyph, ppem) {
    const scale = (ppem * 64) / this.unitsPerEm;
    const shift = this.bearingShift(glyph);
    const origin = Math.round(-shift * scale);
    const advance = Math.round((this.advanceOf(glyph) - shift) * scale);
    return (advance - origin + 32) >> 6;
  }

  /**
   * A glyph's outline, fitted to the pixel grid by the font's own program.
   *
   * The program is what decides where the ink goes at text sizes -- see
   * `Hinter` -- and a program this cannot run leaves the outline as it was.
   * Falling back is safe in a way that stopping halfway would not be: a
   * partially hinted glyph has some points on the grid and some not, which
   * looks worse than an honestly unhinted one and says nothing about why.
   *
   * @param {number} glyph - The glyph index.
   * @param {number} ppem - The size to fit to.
   * @returns {Object} The contours and whether they were fitted.
   */
  hintedOutline(glyph, ppem, roundPhantoms = true, stretch = 1) {
    const contours = this.outlineOf(glyph);

    if (!contours.length || !ppem) {
      return { contours, hinted: false, scaled: false };
    }

    const range = this.glyphRange(glyph);

    if (!range) {
      return { contours, hinted: false, scaled: false };
    }

    let program = this.programOf(glyph);

    /* A composite with no instructions of its own is still made of components
     * that have theirs. Wingdings' `D` is a mirrored copy of a glyph with a
     * three-hundred byte program and no program of its own; drawn from the
     * design assembly it is a blur, drawn from the fitted components it is
     * what Windows draws. So the assembly runs for it, with nothing to execute
     * afterwards. */
    const compositeWithout = !program && this._view.getInt16(range.start, false) < 0;

    if (compositeWithout) {
      program = { composite: true, at: range.start, length: 0 };
    }

    if (!program) {
      return { contours, hinted: false, scaled: false };
    }

    try {
      const hinter = this.hinterAt(ppem, roundPhantoms, stretch);

      /* A composite is assembled in pixels rather than in design units, so it
       * is put together with the hinter's own scaling and handed over already
       * scaled. See `compositeInPixels`.
       */
      const assembly = program.composite
        ? this.compositeInPixels(
            glyph,
            ppem,
            roundPhantoms,
            (units) => hinter.toPixels(units),
            (shift) => hinter.carry(shift),
            stretch,
            (units) => hinter.toPixelsX(units)
          )
        : null;

      const fitted = hinter.hint(
        assembly ? assembly.contours : contours,
        this.advanceOf(glyph),
        this.bearingOf(glyph),
        this._view.getInt16(range.start + 2, false),
        this._view,
        program.at,
        program.length,
        assembly
      );

      /* The points come back already in pixels, so the caller must not scale
       * them again -- which is what `scaled` says. `dropout` is what the font's
       * own `SCANCTRL` asked for at this size, which the rasteriser needs and
       * only the interpreter has seen.
       */
      return {
        contours: fitted,
        hinted: true,
        scaled: true,
        advance: hinter.advanceExact,
        dropout: hinter.dropout,
      };
    } catch {
      return { contours, hinted: false, scaled: false };
    }
  }

  /**
   * A glyph's advance at a size, taken from the hinting rather than a table.
   *
   * `hdmx` holds the same numbers for the two dozen sizes it covers, and this
   * agrees with it there -- which is the only reason to trust it at the sizes
   * it does not. Windows measures a string at an uncovered size by running the
   * program, since that is what the table would have been a cache of.
   *
   * @returns {number|null} The advance in whole pixels, or null if the glyph
   *                        has no program to run.
   */
  hintedAdvance(glyph, ppem, roundPhantoms = true, stretch = 1) {
    const range = this.glyphRange(glyph);

    if (!range || !ppem) {
      return null;
    }

    const program = this.programOf(glyph);

    if (!program) {
      return null;
    }

    try {
      const hinter = this.hinterAt(ppem, roundPhantoms, stretch);

      const assembly = program.composite
        ? this.compositeInPixels(
            glyph,
            ppem,
            roundPhantoms,
            (units) => hinter.toPixels(units),
            (shift) => hinter.carry(shift),
            stretch,
            (units) => hinter.toPixelsX(units)
          )
        : null;

      hinter.hint(
        assembly ? assembly.contours : this.outlineOf(glyph),
        this.advanceOf(glyph),
        this.bearingOf(glyph),
        this._view.getInt16(range.start + 2, false),
        this._view,
        program.at,
        program.length,
        assembly
      );

      return hinter.advance ?? null;
    } catch {
      return null;
    }
  }

  /** The interpreter for a size, built once and kept. */
  hinterAt(ppem, roundPhantoms = true, stretch = 1) {
    this._hinters = this._hinters ?? new Map();

    /* The unstretched key is the number itself, which is what every other
     * lookup by size uses; a stretched hinter is its own entry. */
    const square = roundPhantoms ? ppem : `${ppem}-unrounded`;
    const key = stretch === 1 ? square : `${square}*${stretch}`;

    if (!this._hinters.has(key)) {
      this._hinters.set(key, new Hinter(this, ppem, roundPhantoms, stretch));
    }

    return this._hinters.get(key);
  }

  /** A glyph's left side bearing, in font units. */
  bearingOf(glyph) {
    if (!this.has('hhea') || !this.has('hmtx')) {
      return 0;
    }

    const count = this.unsigned('hhea', 34);
    const base = this._tables['hmtx'].offset;

    if (glyph < count) {
      return this._view.getInt16(base + glyph * 4 + 2, false);
    }

    return this._view.getInt16(base + count * 4 + (glyph - count) * 2, false);
  }

  /** The glyph a character maps to, following the symbol range if need be. */
  /**
   * What a byte means, where Windows and Latin-1 disagree.
   *
   * A character arrives as a byte and is looked up in a table of Unicode
   * codepoints, and across the Latin-1 range the byte is the codepoint. At one
   * place it is not: Windows draws the middle dot from the bullet operator
   * rather than from the middle dot.
   *
   * **Measured.** All three outline faces carry both glyphs and map them from
   * different codepoints -- U+00B7 to one, U+2219 to another. Drawing the
   * second is what Windows does at all six recorded sizes in all three faces,
   * eighteen cells, and the first gets none of them right. The two glyphs are
   * not the same shape and not in the same place: Arial's differ by two
   * hundred design units of side bearing.
   *
   * Only this one entry, because only this one has been asked. The bytes below
   * a hundred and sixty are where a codepage would have more to say, and
   * nothing has drawn them.
   */
  /**
   * Where a byte of the ANSI charset lands in a font's `cmap`.
   *
   * The block from 128 to 159 is the one that needs saying: the byte's own
   * codepoint is a C1 control there, and what Windows draws is the punctuation
   * the code page puts in its place. **Measured**, not assumed: the `charscal`
   * fixture holds `GetCharWidth` for all 224 characters at nine sizes on two
   * proportional faces, and searching every codepoint each face has a glyph for
   * against those eighteen advances leaves one candidate for seventeen of these
   * and a handful for the rest -- U+2018, U+2019 and U+201A are the same width
   * as each other, as are U+2039, U+203A and U+02C6 -- with the code page
   * naming exactly one of each handful. The eight codes with no match at all
   * (128, 129, 141 to 144, 157, 158) already agree without an entry: they reach
   * the missing glyph on both sides.
   */
  static ANSI: Record<number, number> = {
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

  glyphFor(code) {
    const cmap = this.cmap;

    /* The byte's own codepoint is still tried, for a font that has the one and
     * not the other. Which of them Windows would draw then is not known --
     * every face here has both.
     */
    const wanted = TrueTypeFont.ANSI[code];

    return (
      (wanted === undefined ? undefined : cmap.get(wanted)) ??
      cmap.get(code) ??
      cmap.get(0xf000 + code) ??
      0
    );
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
   * How many points the scaler's own point buffer holds.
   *
   * The reference allocates one buffer per glyph out of `maxp`, big enough for
   * the largest glyph in the font and its four phantoms, and the outline being
   * fitted sits at the front of it. Nothing bounds a program to the outline:
   * every `CHECK_POINT` in the interpreter is inside `FSCFG_DEBUG` and compiled
   * out of anything shipped, so an instruction naming a point the glyph does
   * not have reaches the rest of the buffer instead. See `Zone`.
   */
  get maxPoints() {
    if (!this.has('maxp') || this._tables['maxp'].length < 12) {
      return 0;
    }

    return Math.max(this.unsigned('maxp', 6), this.unsigned('maxp', 10)) + 4;
  }

  /** How many points the twilight zone holds, which the hinting programs use. */
  get maxTwilight() {
    return this.has('maxp') && this._tables['maxp'].length >= 18 ? this.unsigned('maxp', 16) : 16;
  }

  /** How many storage slots the hinting programs expect. */
  get maxStorage() {
    return this.has('maxp') && this._tables['maxp'].length >= 20 ? this.unsigned('maxp', 18) : 64;
  }

  /** Where a glyph's outline lives in `glyf`, or null if it is blank. */
  glyphRange(glyph) {
    if (!this.has('loca') || !this.has('glyf') || !this.has('head')) {
      return null;
    }

    const long = this.signed('head', 50) !== 0;
    const loca = this._tables['loca'].offset;

    const start = long
      ? this._view.getUint32(loca + glyph * 4, false)
      : this._view.getUint16(loca + glyph * 2, false) * 2;

    const end = long
      ? this._view.getUint32(loca + (glyph + 1) * 4, false)
      : this._view.getUint16(loca + (glyph + 1) * 2, false) * 2;

    // Equal offsets mean the glyph has no outline at all -- a space.
    return end > start ? { start: this._tables['glyf'].offset + start, length: end - start } : null;
  }

  /**
   * A glyph's outline, in font units.
   *
   * Contours of points, each either on the curve or a control point for the
   * quadratic that joins its neighbours. A composite glyph is assembled from
   * others -- an accented letter is a letter and an accent placed against it --
   * so those are expanded here rather than left for the rasteriser to worry
   * about.
   *
   * @param {number} glyph - The glyph index.
   * @param {number} depth - How far into a composite this already is.
   */
  outlineOf(glyph, depth = 0) {
    const range = this.glyphRange(glyph);

    if (!range || depth > 5) {
      return [];
    }

    const at = range.start;
    const contours = this._view.getInt16(at, false);

    if (contours < 0) {
      return this.compositeOutline(at + 10, range, depth);
    }

    const ends: number[] = [];

    for (let index = 0; index < contours; index++) {
      ends.push(this._view.getUint16(at + 10 + index * 2, false));
    }

    const points = contours ? ends[contours - 1] + 1 : 0;

    // The hinting program sits between the contour ends and the flags.
    let cursor = at + 10 + contours * 2;
    cursor += 2 + this._view.getUint16(cursor, false);

    const flags: number[] = [];

    while (flags.length < points) {
      const flag = this._view.getUint8(cursor++);

      flags.push(flag);

      // A repeat flag says how many more points share it.
      if (flag & 0x08) {
        let repeats = this._view.getUint8(cursor++);

        while (repeats-- > 0 && flags.length < points) {
          flags.push(flag);
        }
      }
    }

    /* The coordinates are deltas, and each axis is stored end to end rather
     * than interleaved: every x, then every y.
     */
    const read = (shortBit, sameBit) => {
      const values: number[] = [];

      let value = 0;

      for (const flag of flags) {
        if (flag & shortBit) {
          const delta = this._view.getUint8(cursor++);

          value += flag & sameBit ? delta : -delta;
        } else if (!(flag & sameBit)) {
          value += this._view.getInt16(cursor, false);
          cursor += 2;
        }

        values.push(value);
      }

      return values;
    };

    const xs = read(0x02, 0x10);
    const ys = read(0x04, 0x20);

    const shapes: any[] = [];

    let from = 0;

    for (const end of ends) {
      const contour: any[] = [];

      for (let index = from; index <= end && index < points; index++) {
        contour.push({ x: xs[index], y: ys[index], on: (flags[index] & 0x01) !== 0 });
      }

      if (contour.length) {
        shapes.push(contour);
      }

      from = end + 1;
    }

    return shapes;
  }

  /**
   * Where a glyph's program is and whether the glyph is put together.
   *
   * A simple glyph keeps its program straight after the contour ends. A
   * composite keeps it after the last of its components, and only if that
   * component says so -- which every composite that has one does in these
   * fonts, and none of them says so on any component but the last.
   *
   * @returns {Object|null} The offset and length of the program, and whether
   *                        the glyph is a composite, or null if there is none.
   */
  programOf(glyph) {
    const range = this.glyphRange(glyph);

    if (!range) {
      return null;
    }

    const count = this._view.getInt16(range.start, false);

    let cursor = range.start + 10;
    let instructed = true;

    if (count < 0) {
      let more = true;

      while (more) {
        const flags = this._view.getUint16(cursor, false);

        cursor += 4 + (flags & 0x0001 ? 4 : 2);

        if (flags & 0x0008) {
          cursor += 2;
        } else if (flags & 0x0040) {
          cursor += 4;
        } else if (flags & 0x0080) {
          cursor += 8;
        }

        more = Boolean(flags & 0x0020);
        instructed = Boolean(flags & 0x0100);
      }
    } else {
      cursor += count * 2;
    }

    const length = this._view.getUint16(cursor, false);

    if (!instructed || !length) {
      return null;
    }

    return { at: cursor + 2, length, composite: count < 0 };
  }

  /**
   * The glyph a composite takes its side bearing from.
   *
   * A component may claim the composite's metrics for itself, and one in nearly
   * every composite in these fonts does.
   *
   * @returns {number} The glyph whose metrics to use, which is the composite
   *                   itself when no component claims them.
   */
  metricsGlyph(glyph) {
    const range = this.glyphRange(glyph);

    if (!range || this._view.getInt16(range.start, false) >= 0) {
      return glyph;
    }

    let cursor = range.start + 10;

    for (;;) {
      const flags = this._view.getUint16(cursor, false);
      const index = this._view.getUint16(cursor + 2, false);

      cursor += 4 + (flags & 0x0001 ? 4 : 2);

      if (flags & 0x0008) {
        cursor += 2;
      } else if (flags & 0x0040) {
        cursor += 4;
      } else if (flags & 0x0080) {
        cursor += 8;
      }

      if (flags & 0x0200) {
        return index;
      }

      if (!(flags & 0x0020)) {
        return glyph;
      }
    }
  }

  /** How far a glyph's outline is carried across its own side bearing. */
  bearingShift(glyph) {
    const range = this.glyphRange(glyph);

    return range ? this.bearingOf(glyph) - this._view.getInt16(range.start + 2, false) : 0;
  }

  /**
   * A component's 2x2 transform, from the flags and the bytes after its
   * offset: one F2Dot14 for a uniform scale, two for x and y, four for the
   * full matrix, and the identity when there is none. Wingdings places a
   * mirrored copy of another glyph this way -- `D` is glyph 38 at a scale of
   * -1 -- and without it the copy lands off the cell.
   */
  _componentTransform(flags, at) {
    const f2 = (offset) => this._view.getInt16(at + offset, false) / 16384;

    if (flags & 0x0008) {
      const scale = f2(0);

      return [scale, 0, 0, scale];
    }

    if (flags & 0x0040) {
      return [f2(0), 0, 0, f2(2)];
    }

    if (flags & 0x0080) {
      return [f2(0), f2(2), f2(4), f2(6)];
    }

    return [1, 0, 0, 1];
  }

  /**
   * A composite's outline in pixels, assembled the way the scaler assembles it.
   *
   * A simple glyph is scaled after its program has run over design
   * coordinates. A composite is not: its components are scaled first and the
   * assembly happens in pixels, which is why the program that then runs over
   * it has no design coordinates to refer to at all.
   *
   * Each component is fitted by its **own** program before it is placed, which
   * is what the recording says: Times New Roman's `A` grave at twelve is its
   * own `A`, pixel for pixel, with one more pixel above it for the accent. An
   * assembly of unfitted components put through the composite's own short
   * program does not come to that and is not close.
   *
   * Nearly every component in these fonts asks for its offset to be rounded to
   * a whole pixel, and the rounding is of the offset alone -- not of the
   * component's points, and not of the sum -- so an accent sits a whole number
   * of pixels above the letter it belongs to whatever the size.
   *
   * A component may also claim the composite's metrics, and one in nearly every
   * composite in these fonts does. What it claims them with is its own fitted
   * advance rather than the table's number for the composite: Arial's `A` acute
   * at eleven pixels advances by eight, which is what its `A` came out with and
   * not the seven the scaled table entry gives. The font's own `hdmx` says
   * eight.
   *
   * @param {number} glyph - The composite's index.
   * @param {number} ppem - The size to fit each component at.
   * @param {boolean} roundPhantoms - Passed to each component, so that they are
   *                                  fitted the same way the composite is.
   * @param {Function} toPixels - The scaling the hinter is using, so that the
   *                              components land where its own arithmetic
   *                              would have put them.
   */
  compositeInPixels(
    glyph,
    ppem,
    roundPhantoms,
    toPixels,
    carry,
    stretch = 1,
    toPixelsX = toPixels
  ) {
    const range = this.glyphRange(glyph);
    const shapes: any[] = [];

    /* The whole pixels of a side bearing are carried outside the outline rather
     * than inside it, and that carry belongs to the glyph being drawn -- not to
     * whichever component it was read from. Each component was fitted on its
     * own and so carries its own, which for all but one of them is not the
     * composite's. The difference is made up here, so that every component is
     * placed in the same space.
     *
     * Courier New's `O` diaeresis is what says so. Its `O` claims the metrics
     * and is carried a whole pixel from about fifteen pixels per em upward; its
     * dots are carried nothing, and came out a column left of where Windows
     * draws them at exactly the sizes where that carry is a whole pixel and
     * nowhere else. Its `A` diaeresis, whose `A` is carried nothing, was right
     * all along.
     */
    const carried = carry(this.bearingShift(this.metricsGlyph(glyph)));

    let cursor = range.start + 10;
    let advance: number | null = null;

    for (;;) {
      const flags = this._view.getUint16(cursor, false);
      const index = this._view.getUint16(cursor + 2, false);

      cursor += 4;

      let dx = 0;
      let dy = 0;

      if (flags & 0x0001) {
        dx = this._view.getInt16(cursor, false);
        dy = this._view.getInt16(cursor + 2, false);
        cursor += 4;
      } else {
        dx = (this._view.getUint8(cursor) << 24) >> 24;
        dy = (this._view.getUint8(cursor + 1) << 24) >> 24;
        cursor += 2;
      }

      const [a, b, c, d] = this._componentTransform(flags, cursor);

      if (flags & 0x0008) {
        cursor += 2;
      } else if (flags & 0x0040) {
        cursor += 4;
      } else if (flags & 0x0080) {
        cursor += 8;
      }

      if (flags & 0x0002) {
        let offsetX = toPixelsX(dx);
        let offsetY = toPixels(dy);

        if (flags & 0x0004) {
          offsetX = Math.floor(offsetX / ONE + 0.5) * ONE;
          offsetY = Math.floor(offsetY / ONE + 0.5) * ONE;
        }

        offsetX += carried - carry(this.bearingShift(index));

        /* The component is fitted by its own program and *then* transformed:
         * Wingdings' five mirrored composites are 35 of 35 this way and 21 of
         * 35 with the mirror applied to the outline before its program runs. */
        const fitted = this.hintedOutline(index, ppem, roundPhantoms, stretch);

        if (flags & 0x0200) {
          advance = fitted.advance ?? null;
        }

        for (const contour of fitted.contours) {
          shapes.push(
            contour.map((point) => {
              const px = fitted.scaled ? point.x * ONE : toPixels(point.x);
              const py = fitted.scaled ? point.y * ONE : toPixels(point.y);

              return { ...point, x: a * px + c * py + offsetX, y: b * px + d * py + offsetY };
            })
          );
        }
      }

      if (!(flags & 0x0020)) {
        break;
      }
    }

    return { contours: shapes, advance };
  }

  /** Assembles a glyph that is made of other glyphs. */
  compositeOutline(at, range, depth) {
    const shapes: any[] = [];

    let cursor = at;

    for (;;) {
      if (cursor + 4 > range.start + range.length) {
        break;
      }

      const flags = this._view.getUint16(cursor, false);
      const index = this._view.getUint16(cursor + 2, false);

      cursor += 4;

      let dx = 0;
      let dy = 0;

      if (flags & 0x0001) {
        dx = this._view.getInt16(cursor, false);
        dy = this._view.getInt16(cursor + 2, false);
        cursor += 4;
      } else {
        dx = (this._view.getUint8(cursor) << 24) >> 24;
        dy = (this._view.getUint8(cursor + 1) << 24) >> 24;
        cursor += 2;
      }

      /* Scaled components exist and none of the fonts here use them; skipping
       * the right number of bytes keeps the rest of the record readable.
       */
      const [a, b, c, d] = this._componentTransform(flags, cursor);

      if (flags & 0x0008) {
        cursor += 2;
      } else if (flags & 0x0040) {
        cursor += 4;
      } else if (flags & 0x0080) {
        cursor += 8;
      }

      // Only an offset placement is honoured, which is what these fonts use.
      if (flags & 0x0002) {
        for (const contour of this.outlineOf(index, depth + 1)) {
          shapes.push(
            contour.map((point) => ({
              ...point,
              x: a * point.x + c * point.y + dx,
              y: b * point.x + d * point.y + dy,
            }))
          );
        }
      }

      if (!(flags & 0x0020)) {
        break;
      }
    }

    return shapes;
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
