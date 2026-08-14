'use strict';

import { Brush } from './brush.js';
import { Pen } from './pen.js';
import { Color } from './color.js';
import { Ditherer } from './ditherer.js';
import { BitmapFont } from './bitmap-font.js';
import { BitmapContext } from './bitmap-context.js';
import { LogicalFont } from './logical-font.js';

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
   * Returns the dimensions of the given string using the current font.
   *
   * @param {String} text - The text to measure.
   */
  measureText(text) {
    if (this._font instanceof LogicalFont || this._font instanceof BitmapFont) {
      return entryOf(this._font).measure(text);
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
