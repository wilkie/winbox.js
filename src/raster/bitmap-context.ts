'use strict';

/**
 * A drawing context backed by our own pixels rather than by a browser canvas.
 *
 * `Surface` was written against the canvas 2D context, which is fine in a
 * browser and useless anywhere else -- so nothing could draw in a test, and
 * nothing could compare what was drawn against what Windows drew. This offers
 * the same handful of operations over a buffer we own, so `Surface` works
 * unchanged and the browser path is not touched at all.
 *
 * It is deliberately not a canvas. It implements what `Surface` and the bitmap
 * fonts actually reach for and nothing else, and it says so loudly when asked
 * for anything more, rather than quietly drawing nothing.
 *
 * The client area of a window is pixels, not DOM. That is what makes this
 * necessary rather than merely convenient: a sixteen colour driver dithers,
 * and a dither pattern is not something the DOM can express. Chrome stays DOM;
 * everything a program draws inside its window comes through here.
 */
export class BitmapContext {
  declare excludeLast: any;
  declare _width: number;
  declare _height: number;
  declare _pixels: Uint8Array;

  declare fillStyle: any;
  declare strokeStyle: any;
  declare lineWidth: number;
  declare font: any;
  declare textBaseline: any;

  declare _path: any[];

  /**
   * @param {number} width - Width of the surface in pixels.
   * @param {number} height - Height of the surface in pixels.
   * @param {Uint8Array} pixels - RGBA bytes to draw into, made if not given.
   */
  constructor(width, height, pixels?) {
    this._width = width;
    this._height = height;
    this._pixels = pixels ?? new Uint8Array(width * height * 4);

    this.fillStyle = 'rgba(0,0,0, 1)';
    this.strokeStyle = 'rgba(0,0,0, 1)';
    this.lineWidth = 1;

    this._path = [];
  }

  get width() {
    return this._width;
  }

  get height() {
    return this._height;
  }

  /** The pixels themselves, as RGBA bytes. */
  get pixels() {
    return this._pixels;
  }

  /**
   * Turns a style into the four bytes it writes.
   *
   * Only the form `Color#css` produces, which is the only form anything here
   * sets. A style this does not understand is a mistake worth hearing about
   * rather than a silent black.
   */
  static toRGBA(style) {
    /* The handful of bare names the drawing code uses. A canvas takes any CSS
     * colour; nothing here needs that, and quietly accepting a name we cannot
     * resolve would paint the wrong thing.
     */
    const named = {
      white: [0xff, 0xff, 0xff, 0xff],
      black: [0x00, 0x00, 0x00, 0xff],
      transparent: [0x00, 0x00, 0x00, 0x00],
    };

    if (named[String(style)]) {
      return named[String(style)];
    }

    const match = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/.exec(
      String(style)
    );

    if (!match) {
      throw new Error(`BitmapContext cannot interpret the colour ${JSON.stringify(style)}`);
    }

    const alpha = Number(match[4]);

    return [
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
      // Alpha arrives as a fraction from CSS and as a byte from everywhere else.
      alpha <= 1 ? Math.round(alpha * 0xff) : Math.round(alpha),
    ];
  }

  /** Writes one pixel, ignoring anything outside the surface. */
  setPixel(x, y, colour) {
    const [red, green, blue, alpha] = colour;

    if (x < 0 || y < 0 || x >= this._width || y >= this._height) {
      return;
    }

    const at = (y * this._width + x) * 4;

    this._pixels[at + 0] = red;
    this._pixels[at + 1] = green;
    this._pixels[at + 2] = blue;
    this._pixels[at + 3] = alpha;
  }

  fillRect(x, y, width, height) {
    const colour = BitmapContext.toRGBA(this.fillStyle);

    for (let row = 0; row < height; row++) {
      for (let column = 0; column < width; column++) {
        this.setPixel(Math.round(x) + column, Math.round(y) + row, colour);
      }
    }
  }

  strokeRect(x, y, width, height) {
    const colour = BitmapContext.toRGBA(this.strokeStyle);

    const left = Math.round(x);
    const top = Math.round(y);
    const right = left + Math.round(width);
    const bottom = top + Math.round(height);

    for (let column = left; column <= right; column++) {
      this.setPixel(column, top, colour);
      this.setPixel(column, bottom, colour);
    }

    for (let row = top; row <= bottom; row++) {
      this.setPixel(left, row, colour);
      this.setPixel(right, row, colour);
    }
  }

  beginPath() {
    this._path = [];

    /* GDI's `LineTo` does not draw the pixel it stops on, and neither does
     * `Polyline`. Everything here that draws a path wants that, but only the
     * stroke fonts have anything recorded to say so, so it is asked for rather
     * than assumed. See `Surface.strokeText`.
     */
    this.excludeLast = false;
  }

  moveTo(x, y) {
    this._path = [[x, y]];
  }

  lineTo(x, y) {
    this._path.push([x, y]);
  }

  /**
   * Draws the path as one-pixel lines.
   *
   * Not Bresenham's error term but the value it approximates, worked out per
   * step in integers: the minor coordinate at step `k` of `n` is `minor * k /
   * n`, rounded. Which is the same line until it lands exactly between two
   * pixels, and GDI has a rule for that which an error term does not express.
   *
   * **Recorded**, by drawing 248 lines from the middle of a cell to every
   * point on four rings around it and reading the ink back. Every tie -- every
   * line whose span is even -- rounds the minor coordinate *down*, except on a
   * steep line whose x and y run in opposite directions, where it rounds up.
   * Six of the eight quadrant-and-orientation cases say down and two say up,
   * and each is settled by about thirty lines, so this is a reading rather
   * than a fit.
   *
   * The exception is odd and is left as it is measured. It is the difference
   * between `(16,16)-(17,24)`, which holds x at 16 through the halfway row,
   * and `(16,16)-(17,8)`, which does not.
   *
   * A line also does not draw the pixel it stops on -- GDI's rule for `LineTo`
   * and `Polyline` -- which callers ask for with `excludeLast`.
   */
  stroke() {
    const colour = BitmapContext.toRGBA(this.strokeStyle);

    for (let index = 1; index < this._path.length; index++) {
      const [fromX, fromY] = this._path[index - 1].map(Math.floor);
      const [toX, toY] = this._path[index].map(Math.floor);

      const dx = toX - fromX;
      const dy = toY - fromY;

      const acrossX = Math.abs(dx) >= Math.abs(dy);
      const steps = acrossX ? Math.abs(dx) : Math.abs(dy);

      const last = index === this._path.length - 1;
      const stop = last && this.excludeLast ? steps : steps + 1;

      if (steps === 0) {
        if (stop > 0) {
          this.setPixel(fromX, fromY, colour);
        }

        continue;
      }

      const major = (acrossX ? dx : dy) > 0 ? 1 : -1;
      const minor = acrossX ? dy : dx;

      /* Up on a tie only where the line is steep and its two axes disagree in
       * direction; down everywhere else.
       */
      const up = !acrossX && dx * dy < 0 ? 0 : 1;

      for (let step = 0; step < stop; step++) {
        const offset = Math.floor((2 * minor * step + steps - up) / (2 * steps));

        const x = acrossX ? fromX + major * step : fromX + offset;
        const y = acrossX ? fromY + offset : fromY + major * step;

        this.setPixel(x, y, colour);
      }
    }
  }

  /**
   * Hands out a region of pixels, in the shape the canvas hands them out.
   *
   * The bitmap fonts draw by taking a region, writing glyph pixels into it and
   * handing it back, so this is the whole of what they need.
   */
  getImageData(x, y, width, height) {
    const data = new Uint8ClampedArray(width * height * 4);

    for (let row = 0; row < height; row++) {
      for (let column = 0; column < width; column++) {
        const from = ((Math.round(y) + row) * this._width + Math.round(x) + column) * 4;
        const to = (row * width + column) * 4;

        if (from >= 0 && from + 4 <= this._pixels.length) {
          data.set(this._pixels.subarray(from, from + 4), to);
        }
      }
    }

    return { data, width, height };
  }

  putImageData(image, x, y) {
    for (let row = 0; row < image.height; row++) {
      for (let column = 0; column < image.width; column++) {
        const from = (row * image.width + column) * 4;

        this.setPixel(Math.round(x) + column, Math.round(y) + row, [
          image.data[from + 0],
          image.data[from + 1],
          image.data[from + 2],
          image.data[from + 3],
        ]);
      }
    }
  }

  /**
   * Text through the browser's own font machinery, which does not exist here.
   *
   * A bitmap font never reaches this: it draws its own glyphs through
   * `getImageData`. Anything that does reach it is asking for a typeface we
   * have no way to rasterise, and should hear about it.
   */
  measureText() {
    throw new Error('BitmapContext has no font engine; select a bitmap font');
  }

  fillText() {
    throw new Error('BitmapContext has no font engine; select a bitmap font');
  }
}
