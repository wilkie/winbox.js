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
      // Fill the rectangle behind it
      const font = entryOf(this._font);
      const metrics = font.measure(text);
      this.context.fillStyle = 'white';
      this.context.fillRect(x, y, metrics.width, metrics.height);
      font.draw(this.context, x, y, text);
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

    /* Black, as the bitmap path draws in black. `forecolor` starts out white
     * on a fresh surface, which paints nothing onto the white a text draw has
     * just laid down.
     */
    const colour = BitmapContext.toRGBA('black');

    let pen = x;

    for (const character of String(text)) {
      const glyph = outline.glyphFor(character.charCodeAt(0));
      const fitted = outline.hintedOutline(glyph, ppem);
      const contours = fitted.contours;

      if (contours.length) {
        const inked = fill(contours, {
          // Hinting hands back pixels; an unhinted outline is still in units.
          scale: fitted.scaled ? 1 : scale,
          originX: pen,
          originY: baseline,
          width: this.width,
          height: this.height,
        });

        for (let row = 0; row < this.height; row++) {
          for (let column = 0; column < this.width; column++) {
            if (inked[row * this.width + column]) {
              this.context.setPixel(column, row, colour);
            }
          }
        }
      }

      const device = outline.deviceAdvance(ppem, glyph);

      pen += device ?? Math.round(outline.advanceOf(glyph) * scale);
    }
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
