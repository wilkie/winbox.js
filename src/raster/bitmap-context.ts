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
  declare lineTie: any;
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

  /**
   * Whether a tie rises, for a line of major span `steps` and minor span
   * `minor`, under the named driver's rule.
   *
   * `'top'` is the rule the VGA, the Super VGA and the EGA share: a tie goes
   * to the smaller y, which in the minor coordinate normalised to the
   * direction of travel never rises. `'slope'` is the Hercules driver's: the
   * slope in lowest terms decides, rising above a half and falling below it,
   * with the two end slopes turned over. See `stroke`.
   */
  static tieRises(rule, steps, minor) {
    if (rule !== 'slope') {
      return false;
    }

    let a = steps;
    let b = minor;

    while (b) {
      [a, b] = [b, a % b];
    }

    const span = steps / a;
    const rise = minor / a;

    return (2 * rise > span) !== (rise === 1 || rise === span - 1);
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
   * **Recorded**, by drawing 740 lines on each of four displays: seven rings
   * around the middle of a cell, and eight fans from its corner where a line
   * has room for a longer span. Every pixel of all 2,960 is the pixel nearest
   * the true line, on every driver, without exception. So the only thing a
   * driver decides is the tie, and the only thing this has to get right is
   * which way it goes.
   *
   * Three of the four displays -- VGA, Super VGA, EGA -- are identical record
   * for record, and their rule is one sentence: **a tie goes to the smaller
   * y**. Upward on the screen, whichever way the line runs and whichever axis
   * is the long one. Written in the minor coordinate that is what
   * `lineTie: 'top'` means below, and the sign juggling in `rises` is only
   * saying it in terms of a signed offset: on a steep line the minor
   * coordinate is x, so holding y down means moving x whichever way the two
   * directions disagree.
   *
   * An earlier reading of this had it as six of eight quadrant cases rounding
   * down and two up, with the two called odd and left alone. They are not odd;
   * they are the same rule seen through the other axis.
   *
   * The Hercules driver is the fourth, and it differs in 192 of the 740. Its
   * rule is not a direction at all but the slope, in lowest terms: for a line
   * whose span and rise reduce to `m/M`, a tie rises when `2m > M` and falls
   * when `2m < M`, and the two end slopes `1/M` and `(M-1)/M` are each the
   * other way about. That predicts all 740 records on the Hercules and all 740
   * on each of the other three, so it is measured rather than read -- though
   * why the two end slopes turn over is not known, and nothing here should be
   * taken as knowing it.
   *
   * The first version of this sweep used rings of 3, 5, 8 and 13, of which one
   * radius is even; a tie needs an even span, so seven slopes in the whole
   * corpus could tie at all, and seven is few enough to fit almost anything.
   * The even rings and the corner fans exist because of that.
   *
   * Two readings were refused along the way, and both are worth the space.
   * `CLIPCAPS` is nought on the Hercules and one on the other three, and the
   * failures were all at the sweep's longest offset, which looked like a
   * clipping difference until the cell was measured: it is thirty-two square
   * and the line starts in the middle, so nothing the probe draws comes near
   * an edge. And a run-length slice -- the shape a driver writing whole bytes
   * into a packed monochrome bitmap would use -- matches the Hercules on four
   * slopes out of seven and no better than the VGA overall, 204 records of
   * 232 for both.
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

      /* Every segment draws its pixels from the start up to but not including
       * the end -- `LineTo`'s rule, for every `LineTo` in the chain and not
       * only the last. The endpoint of one segment is the start of the next,
       * which draws it if it goes anywhere; a segment that goes nowhere draws
       * nothing, and then the shared point is never drawn at all.
       *
       * Drawing `steps + 1` for the segments before the last looked like the
       * same thing, and is the same thing whenever every segment has length.
       * The plotter faces are where it is not: Roman's `j` ends its hook with
       * one short segment and five of no length behind it, and Windows draws
       * the short segment's start and nothing more, where the extra pixel put
       * its end there too. Fifteen records of the corpus were that pixel.
       *
       * A caller that wants the final point drawn as well -- `excludeLast`
       * off -- gets it from the last segment alone.
       */
      const last = index === this._path.length - 1;
      const stop = last && !this.excludeLast ? steps + 1 : steps;

      /* A segment from a point to itself draws nothing.
       *
       * `LineTo` draws every pixel of a line but its endpoint, and a line with
       * no length has no other pixels. Drawing the one pixel anyway looked
       * harmless, because the next segment starts there and draws it -- unless
       * there is no next segment worth the name. The plotter faces' periods,
       * and the dots on their `j`s, are tiny closed loops whose every point
       * rounds to one pixel at text sizes: five coincident points, four
       * zero-length segments, and Windows draws nothing at all where this drew
       * the pixel four times over.
       */
      if (steps === 0) {
        continue;
      }

      const major = (acrossX ? dx : dy) > 0 ? 1 : -1;
      const minor = acrossX ? dy : dx;

      /* Which way this driver takes a tie, in the minor coordinate as it is
       * signed here rather than normalised to the direction of travel.
       */
      const rises = BitmapContext.tieRises(this.lineTie, steps, Math.abs(minor));
      const up = (acrossX ? rises : rises === dx * dy > 0) ? 0 : 1;

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
