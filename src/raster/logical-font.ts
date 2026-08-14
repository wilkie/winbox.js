'use strict';

import { Font } from './font.js';

/**
 * A font as a program asked for it, resolved to one it can be drawn with.
 *
 * The two are not the same thing and the difference is visible. A program asks
 * for "Helv" at eight points; `WIN.INI` says `Helv=MS Sans Serif`, so what
 * actually gets measured and drawn is MS Sans Serif -- but `GetTextFace` still
 * answers "Helv", because the name belongs to the request rather than to the
 * file that satisfied it.
 *
 * The size matters just as much. A `.FON` file holds several sizes of the same
 * face, and which one is meant is part of what was asked for: `ANSI_FIXED_FONT`
 * is Courier at ten points, thirteen pixels tall, while the same file's fifteen
 * point entry is twenty. Handing round the file and picking a size later is how
 * that gets lost.
 */
export class LogicalFont extends Font {
  declare _face: any;
  declare _points: any;
  declare _entry: any;
  declare _style: any;

  /**
   * @param {string} face - The typeface as it was asked for.
   * @param {number} points - The point size as it was asked for.
   * @param {object} entry - The `BitmapFontEntry` that satisfies it.
   * @param {object} style - What else was asked for: weight, italic,
   *                         underline, strikeout, and how far the strike has
   *                         to be stretched to reach the requested size.
   */
  constructor(face, points, entry, style: any = {}) {
    super();

    this._face = face;
    this._points = points;
    this._entry = entry;
    this._style = style;
  }

  /**
   * What was asked for beyond the face and the size.
   *
   * A bitmap face has one weight and no slant, so a request for bold or italic
   * is answered by altering the one strike there is rather than by opening a
   * different file -- which means the request has to be remembered, because
   * the file cannot remember it.
   */
  get style() {
    return this._style;
  }

  /** Whether what will be drawn is strokes rather than pixels. */
  get isVector() {
    return !!this._entry?.isVector;
  }

  /** The outline font behind this, if it is one. */
  get outline() {
    return this._style.outline ?? null;
  }

  /** The pixel size an outline face was settled at. */
  get ppem() {
    return this._style.ppem ?? 0;
  }

  /** How many times over the strike is drawn, to reach the size asked for. */
  get scale() {
    return this._style.scale ?? 1;
  }

  /** The same, sideways, which a request for a width sets on its own. */
  get horizontal() {
    return this._style.horizontal ?? this.scale;
  }

  /** The typeface as it was asked for, which is what `GetTextFace` reports. */
  get face() {
    return this._face;
  }

  get points() {
    return this._points;
  }

  /** The font that will actually be measured and drawn. */
  get entry() {
    return this._entry;
  }

  get header() {
    return this._entry.header;
  }

  /**
   * How much room the text takes, with everything the request added to it.
   *
   * The strike is measured first and then adjusted, because none of what a
   * request can ask for is in the file: stretching to a size that is not
   * installed multiplies every width, emboldening widens each character by a
   * pixel, and both emboldening and slanting leave the last character
   * overhanging the end of the string by a little more.
   */
  /**
   * How much of its design width each character keeps at this size.
   *
   * Not the height's scale, and not a fixed fraction of it: the mapper settles
   * on a whole number for the average character width first, and this is the
   * proportion that implies. See `FontManager.choose`.
   */
  get widthScale() {
    return this._style.horizontal ?? 1;
  }

  measure(text, options: any = {}) {
    if (this.outline) {
      /* Every advance is the grid-fitted one the font tabulates for this pixel
       * size. Where the table does not cover the size -- it holds a couple of
       * dozen rather than all of them -- the outline's own advance is scaled,
       * which is what it would have been hinted from.
       */
      const font = this.outline;
      const ppem = this.ppem;

      let width = 0;

      for (const character of String(text)) {
        const glyph = font.glyphFor(character.charCodeAt(0));
        const device = font.deviceAdvance(ppem, glyph);

        width += device ?? Math.round((font.advanceOf(glyph) * ppem) / font.unitsPerEm);
      }

      return { width, height: this._style.ascent + this._style.descent };
    }

    if (this.isVector) {
      const scale = this.widthScale;
      const cell = Math.round(this._entry.header.dfPixHeight * this.scale);

      let width = 0;

      for (const character of String(text)) {
        width += Math.round(this._entry.characterEntryFor(character.charCodeAt(0)).width * scale);
      }

      /* Bold costs one pixel for the whole string rather than one per
       * character, and a slant costs the overhang it leans by. See
       * `GetTextMetrics` for where both numbers come from.
       */
      /* Emboldening draws the strokes again, offset by the width scale in whole
       * pixels -- but by at least one, since an offset of nothing would not
       * embolden anything. So the ink reaches past the last character by that
       * much even at sizes where the reported overhang is zero.
       */
      const bold = (this._style.weight ?? 0) >= 700;

      width += bold ? Math.max(1, Math.round(scale)) : 0;
      width += this._style.italic ? Math.floor(cell / 2) : 0;

      return { width, height: cell };
    }

    const measured = this._entry.measure(text, options);

    /* Emboldening only happens to a face that is not bold already; see
     * `GetTextMetrics` for why the System font is the case that shows it.
     */
    const bold = (this._style.weight ?? 0) >= 700 && this._entry.header.dfWeight < 700;

    /* The same overhang the metrics report, and for the same reasons: one
     * pixel for the smear that makes a bitmap bold, and half the drawn height
     * for the lean that makes it italic. See `GetTextMetrics`.
     */
    const height = this._entry.header.dfPixHeight * this.scale;

    const overhang = (bold ? 1 : 0) + (this._style.italic ? Math.floor((height - 1) / 2) : 0);

    return {
      width: measured.width * this.horizontal + (bold ? String(text).length : 0) + overhang,
      height: measured.height * this.scale,
    };
  }

  dataFor(text, options: any = {}) {
    return this._entry.dataFor(text, options);
  }
}
