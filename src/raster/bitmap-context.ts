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

  /* Whether this path is handed over as a single polyline, the way a stroke
   * glyph's run is, rather than as one `LineTo` after another. See `stroke`.
   */
  declare polyline: any;

  /* Whether the driver clips a line for itself -- `CLIPCAPS`, which is
   * `CP_RECTANGLE` on the three colour drivers and nought on the Hercules. A
   * driver that does not is handed a line GDI has clipped, and GDI's walk is
   * not the driver's; see `stroke`.
   */
  declare clipCaps: any;

  /**
   * The display driver being emulated, for the handful of things a driver
   * decides rather than GDI.
   *
   * Drawing a line and smearing a bold glyph are both the driver's, and the
   * drivers do not agree -- see `stroke` here and the overhang in
   * `Surface.fillText`. A context or a surface can be told outright, which is
   * what the oracle harness does when it replays a recording made on one
   * display; everything else reads this, which the emulator sets once at boot
   * from its own display mode. One page emulates one display, so there is one
   * of these, and it lives here rather than on `Surface` because `Surface`
   * already imports this and the other way round would be a circle.
   */
  static driver: any = null;
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
    this.polyline = false;
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
   * And a tie does not depend on **where the line begins**, only on its slope.
   * Every ring and the first fan start on an even coordinate, so nothing could
   * say -- and a glyph's strokes start wherever the outline puts them, which is
   * why it was worth asking. The fans now ask the same spans from `(1,1)`,
   * `(1,0)` and `(0,1)` as well: 236 slopes across four origins, on a VGA and
   * on a Hercules, and not one of them turns on the parity of either.
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

    const clips = this.clipCaps ?? BitmapContext.driver?.clipCaps ?? 1;

    /* Whether GDI has to take the *whole* path from the driver rather than the
     * segments of it that leave the surface.
     *
     * A polyline reaches a driver as one `Output` call, so either the driver
     * takes it or GDI does; there is no third thing. But which of those happens
     * is not decided by whether the path leaves the surface. It is decided by
     * whether any point of it is **negative**.
     *
     * **Measured**, on the four ways of scoping it, against the two glyph
     * sweeps on a Hercules -- 6,046 cells at seven sizes and 1,584 at every
     * size from eight to forty:
     *
     *     scoping                          glyphs   plotter
     *     this segment only                  6042      1580
     *     any point past an edge             6038      1567
     *     the whole path, either way         6039      1569
     *     the whole path when a point is
     *       negative, else this segment      6043      1582
     *
     * A coordinate past the right-hand edge or below the bottom is a coordinate
     * the driver can be handed and told to stop at; a negative one is not, and
     * the two behave differently in exactly that way. That is a reading of the
     * numbers and not of the code.
     *
     * `Script`'s `j` is what found it. Its hook reaches a column off the left
     * of the cell, and the pixel we were short of it sat on the *stem* -- a
     * segment lying wholly inside, two segments earlier. Drawn alone as a line,
     * or as the second of a chain of two, Windows breaks that segment's tie
     * toward where it began; drawn inside the glyph it breaks it the other way.
     * Both were recorded: `segment(3,7,0,15)` and `chain(2,9,3,7,0,15)` and the
     * whole thirteen point run as `poly` all give the first answer, and the
     * glyph gives the second -- so the glyph is not drawing what `LineTo` would
     * draw, and the run's negative points are the only thing that separates it.
     *
     * That is why this is gated on `polyline` rather than applied to every
     * path. A glyph's run reaches a driver as one `Output` call and a chain of
     * `LineTo`s reaches it as one call each, and the recordings say the two do
     * not agree; `Surface.strokeText` is the only caller that sets it. Why one
     * `Output` of thirteen points and thirteen `Output`s of two behave
     * differently at all is **not read** -- only that they do, in eleven `poly`
     * records against the same points inside a letter.
     *
     * Four narrowings of this were tried against the same two sweeps and all
     * four are worse, which is what says the test is the point being negative
     * and not the run being clipped:
     *
     *     x < 0 only                                       6043  1582
     *     x < 0 or y < 0  (what this does)                 6043  1582
     *     ... or a point below the bottom                  6043  1578
     *     ... or the next point of the run is outside      6043  1578
     *     ... or the point before this segment is outside  6042  1581
     *
     * No run in the corpus has a negative y without a negative x, so the first
     * two cannot be told apart here; the second is written because a coordinate
     * a driver cannot address is the thing being described, and y is as much of
     * one as x.
     */
    const negative =
      this.polyline && this._path.some(([x, y]) => Math.floor(x) < 0 || Math.floor(y) < 0);

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
      let stop = last && !this.excludeLast ? steps + 1 : steps;

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
      const rises = BitmapContext.tieRises(
        this.lineTie ?? BitmapContext.driver?.lineTie,
        steps,
        Math.abs(minor)
      );
      let up = (acrossX ? rises : rises === dx * dy > 0) ? 0 : 1;

      /* A line that leaves the surface is not the driver's to draw.
       *
       * `CLIPCAPS` says whether a driver clips for itself. The three colour
       * drivers answer `CP_RECTANGLE` and do: **recorded**, 858 clipped lines
       * on each of them, and every one is exactly the part of the whole line
       * that falls inside -- the same pixels, nothing added and nothing moved.
       * The Hercules driver answers nought, so GDI clips for it, and what GDI
       * draws is not what that driver would have: 187 of the 858 differ.
       *
       * Two things change, and between them they are all but thirteen of it.
       *
       * **The tie stops being the driver's, and turns over.** GDI's own walk
       * takes a tie to the *larger* y where the colour drivers take it to the
       * smaller -- the same sentence with the sign reversed, and on a steep
       * line seen through the other axis exactly as theirs is. It is not the
       * slope rule this driver uses when it draws for itself. 307 ties arise in
       * the clipped lines of the sweep; 98 of them land elsewhere because of
       * this, and the other 209 are slopes where the two rules agree anyway.
       *
       * **And the pixel the line stops on is drawn, when that pixel is on the
       * edge the line is running at.** Not any edge: the major coordinate's. A
       * fan of endpoints slid along the last row says it cleanly -- from
       * `(47,5)`, every steep line to row thirty-one draws the row it stops on
       * and every shallow one does not, and the one shallow line that does is
       * the one that stops on column thirty-one. Of 522 clipped lines where the
       * two answers differ, 518 follow it.
       *
       * The minor span is asked about because two vertical lines --
       * `(16,-6)->(16,31)` and `(16,37)->(16,0)` -- stop on the edge and do not
       * draw it. A line with no minor span is the one case where GDI has no
       * second axis to clip against, which is a guess at why and not a reading;
       * what is measured is the two records.
       *
       * **The sweep is exact on all four displays**, 2,478 records each.
       *
       * A reading was fitted to nine records that used to be wrong here and
       * **refused**: that GDI re-seeds the walk where the line crosses the edge
       * and truncates from there rather than rounding. Worked by hand it gets
       * four of the nine pixel for pixel, which is persuasive at that size;
       * scored against all 858 clipped lines it gets 288 where this gets 856.
       * What those nine actually wanted is the entry rounding above.
       *
       * This is why the plotter faces failed on this display once the tie was
       * settled: a slanted `Roman` at a forty pixel cell is wider than the
       * thirty-two square the probe draws into, so its strokes begin off the
       * right-hand edge and end on the last row -- both halves of this, in four
       * of the five glyphs. The fifth, `Script`'s `j` at sixteen, is not this at
       * all: the sweep now draws every line of four pixels or fewer from the
       * middle of the cell as well as from just outside it, 160 of them, and
       * every one agrees on every display -- so the two-step slope of a half
       * that the `j`'s hook turns on is measured, and we draw it the way
       * Windows does. That cell is a pixel of the glyph's own geometry and not
       * of the line under it.
       */
      const within = (x, y) => x >= 0 && y >= 0 && x < this._width && y < this._height;

      let entry = -1;

      if (!clips && (negative || !(within(fromX, fromY) && within(toX, toY)))) {
        up = (acrossX ? true : dx * dy > 0) ? 0 : 1;

        const start = acrossX ? fromX : fromY;
        const edge = acrossX ? toX : toY;
        const limit = acrossX ? this._width : this._height;

        if (minor !== 0 && edge === (major > 0 ? limit - 1 : 0)) {
          stop = steps + 1;
        } else if (minor !== 0) {
          /* And the same again on the *minor* axis, for a line running up.
           *
           * A line can stop on the edge it is running at in the other
           * coordinate too -- a steep line whose x reaches column nought or
           * thirty-one exactly as it ends. Windows draws that stop as well, and
           * only when the line runs up the screen.
           *
           * **Measured**: 81 clipped lines of the sweep stop on their minor
           * edge, two of them running up and seventy-nine running down. Drawing
           * the stop for the two and not the seventy-nine is `lines` exact on
           * all four displays, 2,478 records each; drawing it for the
           * seventy-nine instead costs 76 of them. So the direction is doing
           * the work and is not a fit to the two.
           *
           * Why up and not down is **not read**, and it is the third time this
           * corpus has answered a question with that word -- the column block's
           * charge in `Endpoints.check` is the same shape. Nothing here should
           * be taken as knowing why.
           */
          const other = acrossX ? toY : toX;
          const span = acrossX ? this._height : this._width;
          const rising = acrossX ? minor < 0 : major < 0;

          if (rising && other === (minor > 0 ? span - 1 : 0)) {
            stop = steps + 1;
          }
        }

        /* And the step the line enters on takes its tie the other way again.
         *
         * Where the *major* coordinate starts outside, GDI has to find the
         * minor coordinate at the row or column the line comes in on, and at a
         * half it rounds **away from the start** rather than by the walk's own
         * rule. Only that one step: everything after it is the walk again.
         *
         * **Measured**: it decides eleven of the sweep's records and no others,
         * because it can only bite where the entry lands exactly on a half. The
         * eight shortest are four pixels or fewer from a point one column or row
         * outside an edge -- every one of them a slope of a half, which is what
         * puts the entry on a tie -- and `Script`'s `j` at sixteen pixels is one
         * of them with a letter round it. Rounding away at *every* entry, rather
         * than only where the major brought the line in, was tried and is worse:
         * 843 of the 858 clipped lines against 856.
         */
        if (major > 0 && start < 0) {
          entry = -start;
        } else if (major < 0 && start > limit - 1) {
          entry = start - (limit - 1);
        }
      }

      for (let step = 0; step < stop; step++) {
        const rounding = step === entry ? (minor > 0 ? 0 : 1) : up;
        const offset = Math.floor((2 * minor * step + steps - rounding) / (2 * steps));

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
