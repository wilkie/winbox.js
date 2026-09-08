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
  /** The shortest strike a *fallback* from an outline face may thicken. */
  static EMBOLDEN_FLOOR = 11;

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

  /**
   * The pixel size the glyphs are drawn at horizontally.
   *
   * The same as `ppem` unless the request named an average width, which asks
   * for a font wider or narrower than its design. See `realiseOutline`.
   */
  get xPpem() {
    return this._style.xPpem ?? this.ppem;
  }

  /**
   * The horizontal size before any width was asked for.
   *
   * The vertical size where the pixel is square, and the vertical size times
   * the device's own aspect where it is not. The metrics take the average and
   * the maximum at this size and then stretch, so it has to be carried
   * separately from both the vertical size and the stretched one.
   */
  get xBase() {
    return this._style.xBase ?? this.ppem;
  }

  /** The horizontal size over the vertical: one unless a width was asked for. */
  /**
   * The horizontal size over the vertical, for hinting: one unless a width was
   * asked for. The scaler hints at a whole horizontal pixel size -- the
   * fractional one floored -- while the metrics keep the fraction: on the
   * `widths` fixture the floor is 1,482 of 1,944 stretched cells, the fraction
   * 1,117 and the rounded size 1,060.
   */
  get stretch() {
    return this.ppem ? Math.floor(this.xPpem) / this.ppem : 1;
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
   * Whether a request for bold actually thickens this face.
   *
   * Two things can stop it: the request may not have asked, or the file may be
   * bold already, as the System font is, and drawing it again a pixel across
   * would make it heavier than Windows ever draws it. Size is not one of them.
   *
   * The third thing that stops it is **where the request came from**, which is
   * not a property of the strike at all. A request for an outline face at a
   * size too small for one is answered by a strike; ask for bold there and it
   * is discarded -- `tmWeight` comes back 400, as though nothing had been asked
   * for. Ask the same strike for bold by its own name and it is emboldened.
   *
   * **Recorded**, on the same eight row cell both ways round: Arial bold at
   * eight pixels is Small Fonts and answers weight 400 with no overhang and the
   * plain widths; Small Fonts bold at eight pixels is the same strike and
   * answers weight 700, overhang 1 and every width one greater. Times New Roman
   * at eight is the same as Arial. It is the same distinction `tmItalic`
   * already made, where the byte answers for the family the request settled on
   * rather than for the strike that satisfied it; see `outlineFamily`.
   *
   * A fallback is not always discarded, though: the eleven pixel floor is real
   * and lives here. Arial bold at eleven pixels is Small Fonts' eleven row
   * strike and *is* emboldened -- weight 700, overhang 1, every width one
   * greater -- while the same request at eight and at six is not. So a request
   * that fell back is emboldened only if the strike it fell back to is at least
   * eleven rows tall, and a strike asked for by name is emboldened whatever its
   * height. **Recorded**, at six, eight and eleven pixels of Arial and at eight
   * and ten of Small Fonts and MS Serif.
   *
   * This corrects the scope of an earlier rule rather than the number in it.
   * That rule said the strike's own height decided it for everything, with the
   * same floor of eleven, and was marked **Recorded** naming a pair that pinned
   * it -- MS Serif bold at ten pixels against eleven -- which no fixture
   * contained at either size. What made it look right is that every case it was
   * written from was a fallback, where the two rules agree. They part company
   * the moment a short strike is asked for by its own name.
   */
  get emboldens() {
    if ((this._style.weight ?? 0) <= 550 || this._entry.header.dfWeight >= 700) {
      return false;
    }

    if (!this._style.outlineFamily) {
      return true;
    }

    return Math.round(this._entry.header.dfPixHeight * this.scale) >= LogicalFont.EMBOLDEN_FLOOR;
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
      const ppem = this.xPpem;

      let width = 0;

      for (const character of String(text)) {
        const glyph = font.glyphFor(character.charCodeAt(0));

        /* Under a width the advance is the hinted one at the whole horizontal
         * size, as the glyph is drawn: the program runs anisotropically and the
         * advance phantom lands where it lands. Scaling the design advance by
         * the fractional size instead rounds Times New Roman's `N` at
         * twenty-one pixels asked for twelve -- 31.5 across -- to 23, where
         * Windows says 22, which is 1479 units at 31 pixels rounded. See the
         * `hinting` fixture's stretched rows. */
        if (
          this.ppem &&
          this.xPpem !== this.ppem &&
          !(this._style?.italic && !this._style?.exactStyle)
        ) {
          width +=
            font.hintedAdvance(glyph, this.ppem, true, this.stretch) ??
            Math.round((font.advanceOf(glyph) * Math.floor(this.xPpem)) / font.unitsPerEm);

          continue;
        }

        /* Three tables and a program, asked in the order Windows can answer
         * them.
         *
         * `hdmx` tabulates the hinted advance at the sizes the font was built
         * for, and this agrees with it on every one: 3,864 of 3,864 glyphs for
         * Arial and 3,816 of 3,816 for Times New Roman. `LTSH` says where
         * hinting stops moving the advance at all, and above that the answer is
         * the scaled one rather than the hinted one -- a different number, not
         * a shortcut to the same one. Then the program. Scaling is the last
         * resort, for a glyph that has none.
         */
        /* A slant Windows synthesises is drawn from the raw outline with no
         * program run, and it is measured that way too: each advance is the
         * scaler's unhinted one -- the two phantom points scaled, rounded to
         * sixty-fourths and differenced -- not the `hdmx` or hinted one the
         * upright face would use, and not quite the design advance scaled and
         * rounded either. See `TrueTypeFont.unhintedAdvance` for the record
         * that separates the two.
         */
        width +=
          this._style?.italic && !this._style?.exactStyle
            ? font.unhintedAdvance(glyph, ppem)
            : (font.deviceAdvance(ppem, glyph) ??
              font.linearAdvance(glyph, ppem) ??
              font.hintedAdvance(glyph, ppem) ??
              Math.round((font.advanceOf(glyph) * ppem) / font.unitsPerEm));
      }

      /* A bold that had to be synthesised costs a pixel a character, which is
       * what makes the string longer as well as each letter wider. Only Symbol
       * reaches this; the other outline families have a bold file of their own.
       */
      if ((this._style.weight ?? 0) > 550 && !this._style.faceBold) {
        width += String(text).length;
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
      width += this.emboldens ? Math.max(1, Math.round(scale)) : 0;
      width += this._style.italic ? Math.floor(cell / 2) : 0;

      return { width, height: cell };
    }

    const measured = this._entry.measure(text, options);

    /* Emboldening only happens to a face that is not bold already; see
     * `GetTextMetrics` for why the System font is the case that shows it.
     */
    const bold = this.emboldens;

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
