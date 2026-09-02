'use strict';

import { Brush } from './brush.js';
import { Pen } from './pen.js';
import { Color } from './color.js';
import { Ditherer } from './ditherer.js';
import { BitmapFont } from './bitmap-font.js';
import { BitmapContext } from './bitmap-context.js';
import { LogicalFont } from './logical-font.js';
import { fill } from './glyph-raster.js';

/**
 * This offers a drawing context.
 */
/**
 * The sized font behind whatever was selected.
 *
 * A `LogicalFont` already knows which size was asked for. A bare `BitmapFont`
 * is a whole file with the size still undecided, which happens when something
 * selects a font without going through `GetStockObject`; twelve points is a
 * guess, and the only honest thing to say about it is that it is one.
 */
function entryOf(font) {
  return font instanceof LogicalFont ? font.entry : font.fontFor(12);
}

export class Surface {
  /**
   * How far a synthesised italic leans, as a fraction of its height.
   *
   * Only one installed face ever asks for this. Arial, Times New Roman and
   * Courier New all ship an italic file, so a request for a slanted outline is
   * answered by opening it; Symbol does not, and until Symbol was probed at the
   * sizes where it answers with its outline there was nothing to measure
   * against at all. The tenth that used to be here was swept against a corpus
   * that did not contain a single synthesised outline slant.
   *
   * It is **not** the half the bitmap faces lean by, which an older comment
   * here claimed it was measured against; a strike leans by its whole overhang
   * and an outline by about a third of its height.
   *
   * Read off `symbol-slant` and `symbol-shapes`, which put known shapes in
   * place of Symbol's letters and record them upright and slanted, so that the
   * difference between the two cells is the slant and nothing else.
   *
   * **Measured on the cells that can measure it.** A shape whose widest inked
   * run is four pixels or more has an edge the scan converter finds on its own,
   * with nothing left to dropout control. Twenty-four of the slanted cells are
   * that wide, and swept over those alone the minimum is sharp and single: 0.29
   * costs sixteen pixels, three tenths costs none, 0.31 costs sixteen again.
   *
   * **Three tenths and not 0.31, which the narrow cells prefer.** With the stub
   * check off, 0.310 is the best value on wrong pixels over both instruments --
   * 84 against 96 -- and it reproduces the twenty pixel bar's ladder exactly,
   * all fourteen rows, where three tenths gets two of them a row early. It also
   * breaks eight of the wide cells, which three tenths does not. A slope that
   * fits the hairlines by fitting the unambiguous shapes worse is compensating
   * for something rather than correcting anything, so it is not taken.
   *
   * The narrower cells cannot be read this way, and reading them anyway is what
   * put 0.28 here once. A bar one pixel wide is drawn by dropout control, which
   * places its pixel a column to the left of the run rather than at the edge,
   * so a slope fitted to its leftmost inked column is fitted to the dropout
   * rule. Every wrong pixel either instrument still has is in a cell three
   * pixels across or narrower. See `FONTS.md` section 3.
   */
  static SLANT = 0.3;

  declare _backcolor: any;
  declare _bitmap: any;
  declare _brush: any;
  declare _canvas: any;
  declare _context: any;
  declare _data: any;
  declare _dirty: any;
  declare _ditherer: any;
  declare _font: any;
  declare _forecolor: any;
  declare _pen: any;
  declare _stale: any;
  declare _view: any;
  constructor(canvas) {
    this._canvas = canvas;
    this._ditherer = new Ditherer();
    this._data = {};

    // TODO: what are the default pen/brush?
    this.brush = new Brush(new Color(0xff, 0xff, 0xff, 0xff));
    this.pen = new Pen(new Color(0x00, 0x00, 0x00, 0xff));
    this.backcolor = new Color(0x00, 0x00, 0x00, 0xff);
    this.forecolor = new Color(0xff, 0xff, 0xff, 0xff);

    // We start stale
    this._stale = true;
  }

  update() {
    if (this.width != 0 && this.height != 0) {
      //this.context.putImageData(this.data, 0, 0);
    }
    this.dirty = false;
  }

  get dirty() {
    return this._dirty;
  }

  set dirty(value) {
    this._dirty = value;
  }

  get data() {
    // If we are stale, pull the image data
    if (this._stale) {
      if (this.width != 0 && this.height != 0) {
        //this._data = this.context.getImageData(0, 0, this.width, this.height);
      }
      //this._view = new DataView(this._data.data.buffer);
      this._stale = false;
    }

    return this._data;
  }

  get view() {
    // Ensure that the view is created
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    this.data;

    // Return the view
    return this._view;
  }

  get width() {
    return parseInt(this._canvas.getAttribute('width'));
  }

  get height() {
    return parseInt(this._canvas.getAttribute('height'));
  }

  get canvas() {
    return this._canvas;
  }

  get context() {
    if (!this._context) {
      this._context = this.canvas.getContext('2d');
    }

    /* A canvas element that cannot produce a 2D context -- which is what jsdom
     * hands back, and what any host without a canvas implementation does. The
     * client area is our pixels either way; a browser lends us somewhere to put
     * them, and without one we keep them ourselves rather than not drawing. The
     * alternative is what used to happen: every property set on the context
     * threw on `null`, far from the thing that actually went missing.
     */
    if (!this._context) {
      this._context = new BitmapContext(this.width, this.height);
    }

    return this._context;
  }

  /**
   * A surface that draws into pixels we own rather than onto a page.
   *
   * The client area of a window is pixels -- a sixteen colour driver dithers,
   * and a dither pattern is not something the DOM can express -- so drawing
   * has to work somewhere other than a browser canvas: in a test, in a
   * comparison against what Windows drew, and eventually in whatever we
   * present to the page.
   *
   * @param {number} width - Width in pixels.
   * @param {number} height - Height in pixels.
   * @returns {Surface} A surface backed by a `BitmapContext`.
   */
  static offscreen(width, height) {
    const context = new BitmapContext(width, height);

    /* `Surface` reads its size off the canvas element's attributes, so what it
     * is given has to answer to that much of one. Nothing else about a canvas
     * is used once the context exists.
     */
    const surface = new Surface({
      getContext: () => context,
      getAttribute: (name) => (name === 'width' ? width : height),
      setAttribute: () => {},
    });

    return surface;
  }

  get brush() {
    return this._brush;
  }

  set brush(value) {
    this._brush = value;
    this.context.fillStyle = value.color.css;
  }

  get backcolor() {
    return this._backcolor;
  }

  set backcolor(value) {
    this._backcolor = value;
  }

  get pen() {
    return this._pen;
  }

  set pen(value) {
    this._pen = value;
    this.context.strokeStyle = value.color.css;
  }

  get forecolor() {
    return this._forecolor;
  }

  set forecolor(value) {
    this._forecolor = value;
  }

  get font() {
    return this._font;
  }

  set font(value) {
    this._font = value;
  }

  get bitmap() {
    return this._bitmap;
  }

  set bitmap(value) {
    this._bitmap = value;

    // This defines the canvas size
    this._canvas.setAttribute('width', value.width);
    this._canvas.setAttribute('height', value.height);

    // Tell the bitmap that it should update this surface
    value.surface = this;
  }

  drawLine(x, y, x2, y2) {
    this.context.strokeStyle = this.pen.color.css;
    this.context.beginPath();
    this.context.moveTo(x + 0.5, y + 0.5);
    this.context.lineTo(x2 + 0.5, y2 + 0.5);
    this.context.lineWidth = this.pen.width;
    // TODO: pen style
    this.context.stroke();
  }

  fillRect(x, y, width, height) {
    this.context.fillStyle = this.brush.color.css;
    this.context.fillRect(x, y, width, height);
    // TODO: improve performance of the ditherer and enable it
    /* TODO: a sixteen colour driver has no such colour to fill with. Windows
     * resolves that by dithering when the brush is realised, so the pattern
     * ends up in the destination bitmap and in anything that reads it back;
     * we fill flat at full precision instead. Whether to match that, and at
     * which stage to quantise, is unsettled -- see the notes on comparing
     * drawn output in oracle/README.md.
     */
    //this._ditherer.fill(this.context, x, y, width, height, this._brush.color.value);
    this._stale = true;
  }

  strokeRect(x, y, width, height) {
    this.context.strokeStyle = this.pen.color.css;
    this.context.strokeRect(x, y, width + 0.5, height + 0.5);
    this._stale = true;
  }

  fillText(x, y, text) {
    // TODO: backcolor
    if (this._font instanceof LogicalFont && this._font.outline) {
      this.outlineText(x, y, text);
      this._stale = true;
      return;
    }

    if (this._font instanceof LogicalFont && this._font.isVector) {
      this.strokeText(x, y, text);
      this._stale = true;
      return;
    }

    if (this._font instanceof LogicalFont || this._font instanceof BitmapFont) {
      /* What was asked for, which the strike does not know: a face with no
       * bold of its own is emboldened as it is drawn, and measuring it that
       * way while drawing it plainly is how a bold string came out the right
       * width with none of its characters bolder.
       */
      const style = this._font instanceof LogicalFont ? this._font.style : {};

      /* A strike too small to embolden is drawn plainly, and `emboldens` is
       * what decides -- the same answer the metrics report, so a string that is
       * measured as unbolded is drawn that way too.
       */
      const options = {
        weight:
          this._font instanceof LogicalFont && !this._font.emboldens ? 400 : (style.weight ?? 400),
        italic: !!style.italic,

        /* How many times over the strike is drawn, which the strike itself does
         * not know: it is the mapper's answer to a size the face has no strike
         * for. Measuring already used it; drawing did not, so a doubled face
         * came out a half-size letter in a full-size cell.
         */
        scale: this._font instanceof LogicalFont ? this._font.scale : 1,
        horizontal: this._font instanceof LogicalFont ? this._font.horizontal : 1,
      };

      // Fill the rectangle behind it
      const font = entryOf(this._font);
      const metrics =
        this._font instanceof LogicalFont ? this._font.measure(text) : font.measure(text, options);

      this.context.fillStyle = 'white';
      this.context.fillRect(x, y, metrics.width, metrics.height);
      font.draw(this.context, x, y, text, options);
    } else {
      // Normal text draw
      this.context.font = this._font;
      this.context.textBaseline = 'top';
      this.context.fillStyle = 'black';
      this.context.fillText(text, x, y);
    }
    this._stale = true;
  }

  /**
   * Draws text with an outline font, by filling what its contours enclose.
   *
   * The advance between characters is the grid-fitted one the font tabulates,
   * so the letters land where the measured extent says they will even though
   * the shapes themselves are drawn unhinted. Getting those two from different
   * places sounds wrong and is not: the advance is a fact the font states, and
   * the shape is something a rasteriser works out.
   */
  outlineText(x, y, text) {
    const font = this._font;
    const outline = font.outline;
    const ppem = font.ppem;

    const scale = ppem / outline.unitsPerEm;

    // The baseline, which is where the outline's own origin sits.
    const baseline = y + font.style.ascent;

    /* And the cell, which is what a glyph is drawn into.
     *
     * A glyph gets a cell as tall as the font asks for and no taller, and ink
     * outside it is not drawn -- not clipped to the surface, clipped to the
     * cell. A hinted outline can leave the cell, since a program is free to
     * move a point anywhere, and where it does the part outside simply does not
     * appear.
     *
     * **Recorded.** `times-cell-edge` puts a bar on each row around the edge of
     * a sixteen-row cell whose baseline is row thirteen: rows thirteen, fourteen
     * and fifteen are drawn and row sixteen is not, and a bar placed above row
     * nought is not drawn either. The same font at twenty-four, where every one
     * of those rows is inside the cell, draws all six.
     */
    const cellTop = y;
    const cellBottom = y + font.style.ascent + font.style.descent;

    /* Black, as the bitmap path draws in black. `forecolor` starts out white
     * on a fresh surface, which paints nothing onto the white a text draw has
     * just laid down.
     */
    const colour = BitmapContext.toRGBA('black');

    const style = font.style ?? {};

    /* Nothing to synthesise where the family had the style as a file of its
     * own -- the glyphs are already bold, or already slanted.
     */
    const bold = (style.weight ?? 0) >= 700 && !style.exactStyle;
    const italic = !!style.italic && !style.exactStyle;

    let pen = x;

    for (const character of String(text)) {
      const glyph = outline.glyphFor(character.charCodeAt(0));
      /* A face with no italic of its own is not hinted when it is slanted.
       *
       * **Measured**, and the instrument says it plainly: `symbol-shapes` puts
       * a plain bar, an ellipse and a bar with a program that rounds its edges
       * in place of Symbol's letters. Upright all three are exact. Slanted, the
       * two without a program are wrong by about a pixel a cell and the hinted
       * one by three -- and turning hinting off for the slant brings it to
       * exactly the same pixel as the other two, which is what says the program
       * is the difference rather than the shape.
       *
       * A real letter says the same thing more legibly. Symbol's alpha at
       * twenty-four pixels has its crossbar on row 14 upright, which is where
       * Windows puts it and where a hint puts it; slanted, Windows moves it to
       * row 15, which is where the *unhinted* outline falls. Every row of that
       * letter but two then agrees.
       *
       * Shearing the outline before hinting it, which would be the other way to
       * move a hinted feature, is much worse than either: 1,795 wrong pixels
       * against 681 for not hinting and 1,030 for hinting and then shearing.
       */
      const fitted = italic
        ? { contours: outline.outlineOf(glyph), hinted: false, scaled: false }
        : outline.hintedOutline(glyph, ppem);
      const contours = fitted.contours;

      /* An outline that reaches too far out of its cell is not drawn at all.
       *
       * Not the part outside -- none of it, including the part that was inside.
       * A program is free to move a point anywhere and Courier New's `w` does,
       * once its own `INSTCTRL` is overridden: the letter reaches twenty-six
       * pixels up out of a cell eight rows tall and Windows draws nothing.
       *
       * **Recorded.** `times-tall` is five glyphs that are nothing but an
       * upright bar standing on the baseline, each taller than the last. At
       * three cell heights the bars that came back are the ones under twice the
       * cell -- one and a half, one and three fifths, one and nine tenths of it
       * -- and the ones that did not are two, two and a tenth, and two and two
       * fifths. Cutting the `w`'s program short agrees from the other side: the
       * cut where it still reaches only ten pixels is drawn, and the one
       * instruction later that takes it to twenty-six is not.
       */
      const reach = contours.flat();

      const up = fitted.scaled ? 1 : scale;

      /* How far it reaches above the baseline, counted in whole rows.
       *
       * Above only: `times-reach` hangs a bar forty rows below the baseline
       * beside a mark that is plainly inside the cell, and the mark comes back.
       * The same bar thirty rows above does not. So it is not the height of the
       * box, which is the same either way.
       *
       * Rounded to the nearest row, which is the row the top of the outline
       * lands on. Bars a row apart around the limit put it between thirty-five
       * and thirty-six rows in a cell of eighteen, and one reaching 35.55 is
       * refused where one reaching 35.00 is not.
       */
      const rows = reach.length
        ? Math.round(Math.max(...reach.map((point: any) => point.y)) * up)
        : 0;

      /* And what is really being counted is bytes, not rows.
       *
       * A row of a glyph is padded out to a multiple of thirty-two bits, so
       * every bar asked about at first -- three pixels wide, and the `w` at
       * eight -- cost four bytes a row and could not tell one from the other.
       * `times-wide` is thirty-six pixels across, which is eight bytes a row,
       * and it is refused at exactly half as many rows.
       */
      const columns = reach.length
        ? Math.round(Math.max(...reach.map((point: any) => point.x)) * up) -
          Math.round(Math.min(...reach.map((point: any) => point.x)) * up)
        : 0;

      const rowBytes = ((columns + 31) >> 5 || 1) * 4;

      const budget = 8 * (font.style.ascent + font.style.descent);

      if (contours.length && rows * rowBytes < budget) {
        /* An outline face has no bold or italic of its own here -- only the
         * plain file of each family is loaded -- so both are made as the
         * bitmap faces make them: emboldening draws the glyph again a pixel
         * across, and slanting leans it over by an amount proportional to how
         * far above the baseline each point sits.
         */
        const slanted = italic ? this.slant(contours, fitted.scaled ? 1 : scale) : contours;

        const inked = fill(slanted, {
          // Hinting hands back pixels; an unhinted outline is still in units.
          scale: fitted.scaled ? 1 : scale,
          originX: pen,
          originY: baseline,
          width: this.width,
          height: this.height,
          /* What the font's own `SCANCTRL` asked for at this size, which is
           * not always yes: Arial turns dropout control off above sixteen
           * pixels per em and this was drawing every size as though it were on.
           * An unhinted outline has no answer, so it keeps the default.
           */
          dropout: fitted.dropout ?? true,
        });

        const from = Math.max(0, cellTop);
        const to = Math.min(this.height, cellBottom);

        for (let row = from; row < to; row++) {
          for (let column = 0; column < this.width; column++) {
            if (inked[row * this.width + column]) {
              this.context.setPixel(column, row, colour);

              if (bold) {
                this.context.setPixel(column + 1, row, colour);
              }
            }
          }
        }
      }

      /* The same three sources `LogicalFont.measure` asks, in the same order,
       * so that where the pen lands and what a string measures cannot disagree.
       */
      pen +=
        outline.deviceAdvance(ppem, glyph) ??
        outline.linearAdvance(glyph, ppem) ??
        outline.hintedAdvance(glyph, ppem) ??
        Math.round(outline.advanceOf(glyph) * scale);
    }
  }

  /**
   * Leans an outline over, for a face with no italic of its own.
   *
   * Every point moves right in proportion to how far above the baseline it
   * sits, so the baseline itself stays put and the top of the letter travels
   * furthest. The proportion is the same one the bitmap faces lean by.
   */
  slant(contours, scale) {
    return contours.map((contour) =>
      contour.map((point) => ({
        ...point,
        x: point.x + point.y * Surface.SLANT,
      }))
    );
  }

  /**
   * Draws text with a stroke font, by joining up the points it is made of.
   *
   * A plotter font is polylines rather than pixels, which is why it can be
   * drawn at any size at all. The design coordinates are scaled to the size
   * being drawn -- separately in each direction, since the design has its own
   * aspect -- and the result is joined up with the ordinary line drawing.
   *
   * Whether these are the pixels Windows chooses is not established. Matching
   * a rasteriser is a separate piece of work with its own oracle, and until
   * that exists this draws something correct in shape rather than something
   * verified in pixels.
   */
  strokeText(x, y, text) {
    const font = this._font;
    const entry = font.entry;
    const header = entry.header;

    const design = header.dfPixHeight;
    const cell = Math.round(design * font.scale);

    const vertical = cell / design;
    const horizontal = font.widthScale;

    /* A stroke design measures downward from the top of its cell, not upward
     * from the baseline: Roman's `A` has its apex at 4 and its feet at 25, in a
     * design 32 tall with an ascent of 25. So the top of the cell is the
     * origin, and the y in the data is added to it.
     */
    const top = y;

    // Black, as every other text path draws; the pen is not the text colour.
    this.context.strokeStyle = 'black';

    /* Both synthesised styles, and neither is made the way the strikes make
     * theirs.
     *
     * A strike is a picture, so its slant can only shift whole rows, and it
     * leans by its overhang -- `floor((cell - 1) / 2)` -- pairing rows from the
     * top. A stroke design is coordinates, so its slant moves the coordinates
     * and the line is drawn through them: strokes stay joined, where shifting
     * rows breaks a stroke that crosses one. It leans by `floor(cell / 2)` at
     * the top, which is the overhang the metrics report for these faces and one
     * more than a strike's.
     *
     * **Measured**: fitting a slope to how far each row of a slanted cell sits
     * from the upright one gives a half at every size from eight pixels to
     * forty, and the lean at the top row runs 4, 6, 8, 10, 12, 16, 20 for cells
     * of 8, 12, 16, 20, 24, 32 and 40. Shearing the rows instead leaves the
     * slanted cells agreeing far less often than the upright ones; shearing the
     * coordinates leaves them agreeing exactly as often, which is what says the
     * slant is now right and what is left is something else.
     *
     * The smear is the same as a strike's: the whole thing again a pixel
     * across.
     */
    const style = font.style ?? {};
    const leaning = !!style.italic;
    const smeared = font.emboldens;

    let pen = x;

    for (const character of String(text)) {
      const code = character.charCodeAt(0);

      for (const run of entry.strokesFor(code)) {
        if (run.length < 2) {
          continue;
        }

        for (let copy = 0; copy <= (smeared ? 1 : 0); copy++) {
          this.context.beginPath();
          (this.context as any).excludeLast = true;
          run.forEach(([px, py], index) => {
            /* A design coordinate below the cell is pulled back to its last
             * row rather than falling off it.
             *
             * A descender reaches the design's full height -- Modern's `g` and
             * `j` and `y` all end at 32 in a design 32 tall -- so the bottom of
             * the design is the row *after* the last one the cell has. Windows
             * draws the tail flat along that last row; letting it descend one
             * further, or clipping it away, both leave a letter Windows does
             * not draw. **Measured**: clamping takes the three faces from 314
             * of 420 to 379, and the wrong pixels from 291 to 46.
             */
            const down = top + Math.min(cell - 1, Math.round(py * vertical));
            const lean = leaning ? Math.max(0, (cell - (down - top)) >> 1) : 0;
            const at = pen + Math.round(px * horizontal) + lean + copy;

            if (index === 0) {
              this.context.moveTo(at, down);
            } else {
              this.context.lineTo(at, down);
            }
          });

          this.context.stroke();
        }
      }

      pen += Math.round(entry.characterEntryFor(code).width * horizontal);
    }
  }

  /**
   * Returns the dimensions of the given string using the current font.
   *
   * @param {String} text - The text to measure.
   */
  measureText(text) {
    if (this._font instanceof LogicalFont || this._font instanceof BitmapFont) {
      /* Through the logical font rather than past it to its strike. What was
       * asked for is not in the file -- a size that is not installed, a weight
       * the face does not have -- so the strike alone measures the wrong
       * thing, and going straight to it is how that gets lost.
       */
      return this._font instanceof LogicalFont
        ? this._font.measure(text)
        : entryOf(this._font).measure(text);
    } else {
      // Normal text draw
      this.context.font = this._font;

      this.context.textBaseline = 'top';
      const measured = this.context.measureText(text);
      const textWidth = measured.actualBoundingBoxRight + measured.actualBoundingBoxLeft;
      const textHeight = measured.actualBoundingBoxDescent - measured.actualBoundingBoxAscent;

      return {
        width: textWidth,
        height: textHeight,
      };
    }
  }

  /**
   * Pulls out a data view for the given dimensions.
   */
  lock(x, y, width, height) {
    const data = this.context.getImageData(x, y, width, height);
    const view = new DataView(data.data.buffer);
    (view as any)._x = x;
    (view as any)._y = y;
    (view as any)._data = data;
    return view;
  }

  /**
   * Paints the updated pixel region back to the surface's device context.
   */
  unlock(view) {
    this.context.putImageData(view._data, view._x, view._y);
  }
}
