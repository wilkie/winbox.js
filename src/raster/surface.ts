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
   * Swept against what Windows draws rather than reasoned about, and the
   * answer is shallower than it looks like it should be: a tenth, about six
   * degrees, where the bitmap faces' own overhang implies something nearer a
   * half. It halves the error and does not remove it -- no slanted outline
   * comes out exactly right at any angle -- so this is a measured
   * approximation rather than the rule. See oracle/README.md.
   */
  static SLANT = 0.1;

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
      const fitted = outline.hintedOutline(glyph, ppem);
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

      /* Counted in whole rows, which is what a bitmap is made of. One of the
       * bars comes out a thousandth of a pixel short of exactly twice the cell
       * and Windows still refuses it, so the comparison is not on the fraction.
       */
      const spread = reach.length
        ? Math.ceil(Math.max(...reach.map((point: any) => point.y)) * up) -
          Math.floor(Math.min(...reach.map((point: any) => point.y)) * up)
        : 0;

      if (contours.length && spread < 2 * (font.style.ascent + font.style.descent)) {
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

    // The baseline, which is where the design's own origin sits.
    const baseline = y + Math.round(header.dfAscent * vertical);

    this.context.strokeStyle = this.pen.color.css;

    let pen = x;

    for (const character of String(text)) {
      const code = character.charCodeAt(0);

      for (const run of entry.strokesFor(code)) {
        if (run.length < 2) {
          continue;
        }

        this.context.beginPath();

        run.forEach(([px, py], index) => {
          const at = pen + Math.round(px * horizontal);
          const down = baseline - Math.round(py * vertical);

          if (index === 0) {
            this.context.moveTo(at, down);
          } else {
            this.context.lineTo(at, down);
          }
        });

        this.context.stroke();
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
