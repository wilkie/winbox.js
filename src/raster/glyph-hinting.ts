'use strict';

/**
 * The TrueType hinting interpreter.
 *
 * A TrueType font carries a program per glyph, and two more that set things up:
 * `fpgm` defines functions once, `prep` runs whenever the size changes. What
 * they do is move the outline's points onto the pixel grid before anything is
 * filled -- pulling a stem onto a whole column so it comes out crisp rather
 * than smeared across two. At the sizes text is read at that decides where
 * about half the ink goes, which is the measurement in `oracle/README.md`.
 *
 * It is a stack machine with a graphics state, and the state is most of the
 * difficulty: an instruction like `MIRP` reads the projection vector, the
 * freedom vector, three reference points, two zone pointers, the round state,
 * the control value cut-in and the minimum distance, and moves one point
 * accordingly. Getting any of them wrong moves a point silently.
 *
 * Everything is in F26Dot6 -- a whole number of sixty-fourths of a pixel --
 * except the unit vectors, which are F2Dot14. The mixture is the format's, not
 * ours, and keeping the two straight is most of what the arithmetic here is
 * doing.
 *
 * An instruction that is not implemented raises `Unsupported`, and the caller
 * falls back to the unhinted outline for that glyph. That is deliberate: a
 * half-run program leaves points moved by some instructions and not others,
 * which is worse than not hinting at all, and silently wrong rather than
 * visibly so.
 */

/** Raised when a program uses something this does not implement. */
export class Unsupported extends Error {}

/** How many instructions one program may run before it is assumed stuck. */
const STEP_LIMIT = 400000;

/** A point's coordinates are sixty-fourths of a pixel. */
export const ONE = 64;

/** Unit vector components are sixteen-thousand-three-hundred-and-eighty-fourths. */
const UNIT = 16384;

/**
 * `a * b / c`, rounded the way the format's own arithmetic rounds.
 *
 * The sign is taken off first and put back at the end, so a half rounds *away
 * from zero* in both directions. `Math.round` rounds a half upwards, which
 * agrees for positive values and disagrees for every negative one: -2.5 is -3
 * here and -2 there. Every distance an interpreter measures backwards goes
 * through this, so the difference is not as rare as the phrasing makes it
 * sound.
 *
 * The scaling of the tables, by contrast, is provably unaffected: these fonts
 * have 2048 units to the em, which is a power of two, so the factor is exact
 * at every size and not one of the two thousand odd control values changes.
 * The precision that matters here is in the arithmetic, not the conversion.
 */
/**
 * Multiply a 16.16 fixed number by another -- or an integer by one -- to the
 * nearest, as the reference's `FixMul` does.
 *
 * A half goes toward positive infinity whatever the sign: the product has a
 * half added and is shifted down, and an arithmetic shift floors. It matters
 * for a negative control value at an exact half, which is what a descender is
 * under a stretch of two -- Times New Roman at twenty-one pixels asked for
 * sixteen halves a table scaled at forty-two, and its `g`, `j` and `y` came out
 * a row too deep with the half going away from zero. **Measured**: the width
 * sweep goes from 24 wrong cells and 111 wrong pixels to 21 and 35 with the
 * half going up, and the three descenders are among the ones that go.
 */
function fixMul(a: number, b: number) {
  return Math.floor((a * b + 32768) / 65536);
}

/** Divide, the result a 16.16 fixed number to the nearest, as `FixDiv`.
 * Truncating instead is refused by count: 1,984 stretched cells of 2,043 and
 * 163 wrong pixels against 2,022 and 35. */
function fixDiv(a: number, b: number) {
  const quotient = (a * 65536) / b;

  return quotient < 0 ? -Math.floor(-quotient + 0.5) : Math.floor(quotient + 0.5);
}

const ONEFIX = 65536;

/**
 * `a * b / c` to the nearest, a half going toward positive infinity.
 *
 * `mulDiv` below takes the sign out first, so its halves go away from zero.
 * The scaler's `ShortFracMul` -- what a projection is made of -- adds a half
 * and shifts, and an arithmetic shift floors, so a negative half goes *up*.
 * The two agree everywhere but on an exact negative half, and a projection of
 * whole sixty-fourths onto a 2.14 vector lands on one often enough to matter:
 * the `y` term of Arial's `X` at twenty-one pixels asked for sixteen is
 * exactly -757.5, and -757 puts the corner of its thick diagonal where a
 * readout says Windows has it, at 368, where -758 put it at 366.
 *
 * It matters, too, which way round the operands go. The reference projects a
 * point *from* its reference point and negates the result where an
 * instruction wants the other sign; projecting the reference point from the
 * point instead is the same number under the symmetric rounding and one off
 * under this one, and Arial Italic's `f` at twenty-four is the cell that says
 * so (`ALIGNRP`). **Measured**: with this rounding in the two projections
 * and the reference's operand order, the recorded corpus gains a cell in
 * `sizes`, one in `styles`, and a pixel in `widths`, and loses none. The same
 * rounding in the point move's `LongMulDiv` costs a `styles` cell, in `IP`'s
 * `MulDiv26Dot6` a `glyphs` cell, and in the freedom-projection dot product
 * changes nothing; those three keep `mulDiv`.
 */
function mulDivUp(a: number, b: number, c: number) {
  if (c === 0) {
    return 0;
  }

  if (c < 0) {
    a = -a;
    c = -c;
  }

  return Math.floor((a * b) / c + 0.5);
}

function mulDiv(a: number, b: number, c: number) {
  let sign = 1;

  if (a < 0) {
    a = -a;
    sign = -sign;
  }

  if (b < 0) {
    b = -b;
    sign = -sign;
  }

  if (c < 0) {
    c = -c;
    sign = -sign;
  }

  if (c === 0) {
    return 0;
  }

  const result = Math.floor((a * b + Math.floor(c / 2)) / c);

  return sign < 0 ? -result : result;
}

/** A division in the units the format keeps distances in. */
/**
 * Scales a font-unit measurement to pixels, rounding halves upward.
 *
 * Upward, not away from zero. The two agree on positive values and differ on
 * negative ones landing exactly on a half, which is what `(value + half) >>
 * shift` does when the shift is arithmetic: the addition biases and the shift
 * floors, so -103.5 becomes -103 rather than -104.
 *
 * That difference shows in one place and matters enormously there. Control
 * values are compared and rounded against each other by `prep` and by the glyph
 * programs, and a font that rounds a total one way and its parts another takes
 * a *branch* on whether the two agree. Times New Roman Italic's `!` at 92 pixels
 * per em is the case: `cvt[91]` is -36 units, which is -103.5 at that size, and
 * the sixty-fourth decides whether the program adjusts a control value or leaves
 * it alone. The advance comes out a pixel wide either way -- there is no partial
 * credit on a branch.
 *
 * **Measured**: 12 wrong advances against `hdmx` to 8, over 22,056.
 */
function scaleToPixels(units: number, pixels: number, unitsPerEm: number) {
  return Math.floor((units * pixels + unitsPerEm / 2) / unitsPerEm);
}

function divide(a: number, b: number) {
  if (b === 0) {
    return 0;
  }

  /* Truncating, where `mulDiv` rounds.
   *
   * `MUL` and `DIV` are not the same operation in two directions: the format
   * has `MUL` round its result to the nearest sixty-fourth and `DIV` throw the
   * remainder away. Making both round is the obvious thing to write and is
   * wrong by one sixty-fourth wherever a division lands mid-way, which is
   * rarely and consequentially -- a font that divides to get a proportion and
   * multiplies it back up carries the error into a whole pixel.
   *
   * **Measured**: see `FONTS.md`. Arial Bold's `j` at 32, 33 and 37 pixels per
   * em is the case that shows it, by way of a control value two pixels wide
   * that should have been three.
   */
  let sign = 1;
  let top = a;
  let bottom = b;

  if (top < 0) {
    top = -top;
    sign = -sign;
  }

  if (bottom < 0) {
    bottom = -bottom;
    sign = -sign;
  }

  const result = Math.floor((top * ONE) / bottom);

  return sign < 0 ? -result : result;
}

/** The points of a glyph, in both the state they arrived in and the current one. */
export class Zone {
  declare x: number[];
  declare y: number[];
  declare originalX: number[];
  declare originalY: number[];
  declare unscaledX: number[];
  declare unscaledY: number[];
  declare onCurve: boolean[];
  declare touchedX: boolean[];
  declare touchedY: boolean[];
  declare ends: number[];
  declare count: number | null;

  constructor(count = 0) {
    this.x = new Array(count).fill(0);
    this.y = new Array(count).fill(0);
    this.originalX = new Array(count).fill(0);
    this.originalY = new Array(count).fill(0);
    this.unscaledX = new Array(count).fill(0);
    this.unscaledY = new Array(count).fill(0);
    this.onCurve = new Array(count).fill(true);
    this.touchedX = new Array(count).fill(false);
    this.touchedY = new Array(count).fill(false);
    this.ends = [];

    /* How many points this zone has, which is not the same as how many the
     * arrays below have come to hold.
     *
     * A glyph program is free to name a point that does not exist, and the
     * reference interpreter does not stop it: every `CHECK_POINT` in it is
     * inside `FSCFG_DEBUG` and compiled out of anything shipped. What it does
     * instead is what C does -- it writes past the end of the element's point
     * array, into memory that is not part of the outline, and nothing ever
     * reads it back as a point. The outline drawn is the points the glyph
     * declared, and the phantom points are the four at the end of those.
     *
     * Arrays here grow instead of overflowing, which is safer in every way but
     * one: it moves the end. The advance and the pen are read as `length - 3`
     * and `length - 4`, so one write to a point past the last is enough to make
     * a glyph's own origin come out of somewhere else -- and the glyph lands in
     * a column of its own. So the count is fixed when the zone is finished and
     * the arrays are allowed to grow behind it, which is as close to writing
     * past the end as this can get.
     */
    this.count = count > 0 ? count : null;
  }

  /**
   * Fixes the point count, once every point the glyph has is in, and pads the
   * arrays out to the buffer the scaler would have allocated -- with whatever
   * the glyph before this one left in it.
   *
   * The padding is what makes a point past the end behave like memory rather
   * than like a hole. A program that names one gets a number -- nought, which
   * is what the buffer holds where no outline has been written into it -- and
   * writes what it likes back there without any of it reaching the glyph. Left
   * as holes, the same read is `undefined`, and one `undefined` in an
   * arithmetic instruction turns a real point into `NaN` and takes the whole
   * outline with it.
   *
   * And the buffer is one buffer. The scaler allocates it per size and fits
   * every glyph in it in turn, so what lies past the outline is not nought but
   * the tail of whatever was fitted before -- which makes a program that reads
   * out there depend on the glyph drawn previously. **Measured**: carrying the
   * previous glyph's tail forward rather than clearing it takes the fabricated
   * corpus from 26,029 of 26,058 cells and 118 wrong pixels to **26,055 and
   * 9**, with every recorded cell unchanged. Nothing a real font does reads out
   * there; this is what a program does when the glyph under it has been cut
   * down, and it is the only reason the order glyphs are drawn in can matter.
   */
  seal(capacity = 0, held: any = null) {
    this.count = this.x.length;

    for (let at = this.x.length; at < capacity; at++) {
      this.x.push(held?.x[at] ?? 0);
      this.y.push(held?.y[at] ?? 0);
      this.originalX.push(held?.originalX[at] ?? 0);
      this.originalY.push(held?.originalY[at] ?? 0);
      this.unscaledX.push(held?.unscaledX[at] ?? 0);
      this.unscaledY.push(held?.unscaledY[at] ?? 0);
      this.onCurve.push(held?.onCurve[at] ?? false);
      this.touchedX.push(false);
      this.touchedY.push(false);
    }
  }

  get length() {
    return this.count ?? this.x.length;
  }
}

/**
 * Runs a font's hinting programs.
 *
 * One of these is built per font and per size: `fpgm` and `prep` are run once
 * between them, and then each glyph's own program is run against the points of
 * that glyph.
 */
export class Hinter {
  declare font: any;
  declare ppem: number;
  declare scale: number;
  declare pixels: number;

  declare stack: number[];
  declare storage: number[];
  declare cvt: number[];
  declare functions: Map<number, { at: number; end: number; program: DataView }>;

  declare zones: Zone[];
  declare state: any;
  declare defaults: any;

  declare _ready: boolean;
  declare roundPhantoms: boolean;

  /**
   * @param {TrueTypeFont} font - The font whose programs these are.
   * @param {number} ppem - The size everything is being fitted to.
   * @param {boolean} roundPhantoms - Whether the advance phantom starts on the
   *                                  grid, which is what Windows does and what
   *                                  the rasteriser that filled in `hdmx` did
   *                                  not. Only the comparison against that
   *                                  table wants it off.
   */
  constructor(font, ppem, roundPhantoms = true, stretch = 1) {
    this.font = font;
    this.ppem = ppem;
    this.roundPhantoms = roundPhantoms;
    this.scale = ppem / font.unitsPerEm;

    /* A width request stretches the face: the horizontal size is the vertical
     * one times this ratio. The reference scales the control values once, at
     * one size, and multiplies every read by a 16.16 factor that depends on
     * the projection vector -- `cvtStretchX` for `x`, `cvtStretchY` for `y`,
     * the root of their weighted squares for a diagonal -- and divides every
     * write by it; `MPPEM` answers with that size times the same factor. So
     * does this; which size, see `cvtScale`. At a stretch of one nothing here
     * changes.
     */
    this.stretch = stretch;
    this.xPixels = ppem * stretch * ONE;

    /* The horizontal size as a whole number. `ppem * stretch` is that number
     * only up to floating point -- thirteen times fifteen thirteenths floors to
     * fourteen -- and `MPPEM` and the deltas want the integer. */
    this.xSize = Math.round(ppem * stretch);

    /* The size in the units distances are kept in, so a scaling is one whole
     * multiply and divide rather than a float in the middle of it.
     */
    this.pixels = ppem * ONE;

    /* The size the control values are scaled at, which is the horizontal one
     * when the face is stretched; see `cvtScale`. */
    this.cvtSize = Math.max(this.xSize, ppem);
    this.cvtPixels = this.cvtSize * ONE;

    this.stack = [];
    this.storage = new Array(Math.max(64, font.maxStorage ?? 64)).fill(0);
    this.functions = new Map();

    // The twilight zone is scratch space the programs use for construction.
    this.zones = [new Zone(font.maxTwilight ?? 16), new Zone(0)];

    this.cvt = this.scaledControlValues();
    this.state = this.freshState();
    this.defaults = { ...this.state };

    this._ready = false;
  }

  /**
   * How much a distance of a given colour is nudged before it is rounded.
   *
   * Every distance carries a colour in the low bits of the instruction that
   * measures it -- grey, black or white -- and the original rasteriser was
   * described as nudging black and white ones before rounding, to stop a
   * feature gaining or losing a pixel as it met the grid. These fonts lean on
   * it: Times New Roman measures fifty-three black distances and eight white
   * ones in the glyphs recorded, and rounds nearly all of them.
   *
   * Both are zero, and that is measured rather than inherited. Sweeping them
   * against what Windows drew peaks at nothing, sharply, and falls away
   * monotonically in both directions -- so Windows 3.1 compensated by nothing,
   * as the modern interpreter does. The colour is threaded through anyway,
   * because masking it off silently would look like an oversight rather than
   * an answer.
   */
  static BLACK = 0;
  static WHITE = 0;

  static compensation(opcode) {
    const colour = opcode & 0x03;

    if (colour === 1) {
      return Hinter.BLACK;
    }

    if (colour === 2) {
      return Hinter.WHITE;
    }

    return 0;
  }

  /**
   * Font units into pixels.
   *
   * Distinct from `mulDiv`, which is the arithmetic the interpreter does on
   * numbers that are already in pixels -- projecting onto a unit vector,
   * multiplying two 26.6 values, interpolating between two points. That one is
   * the format's own `a * b / c`; this one is a conversion, and the pseudocode
   * for the scan converter keeps its equivalent separate too. They round the
   * same way here because nothing has been measured that says otherwise, and
   * `scaleToPixels` above is a third rule again, for the control values.
   */
  /**
   * The scale a control value is read through, as a 16.16 fixed number.
   *
   * When a width request stretches the face the reference scales the control
   * values once, at one size, and multiplies every read by a factor that
   * depends on the projection vector: `cvtStretchX` along `x`, `cvtStretchY`
   * along `y`, the root of their squares weighted by the vector's components
   * along a diagonal; writes are divided by the same factor, and `MPPEM` and
   * the deltas' size are that one size times it. Which size the table is
   * scaled at is not in the pseudocode.
   *
   * **Measured**, through Arial's `prep`, which derives its x-height by
   * placing a twilight point at the unrounded control value and interpolating
   * it between the baseline and the rounded cap height. Read at the vertical
   * scale, with `y` unstretched, the x-height at sixteen points comes to 7.48
   * pixels at every width and rounds to seven; Windows draws eight at the
   * widths whose horizontal size is fifteen and twenty-six, and seven at
   * thirteen, seventeen, twenty-one and thirty-four. Scaling the table at the
   * horizontal size and reading it back along `y` through `FixDiv(13, 15)`
   * moves the unrounded x-height from 431 to 432 sixty-fourths at fifteen and
   * twenty-six and leaves it at the others, and 432 interpolated is 465 and
   * 464 -- which, sixteen added and rounded, are eight pixels. Readouts of
   * control values 2, 16, 4 and 20 along `y` agree with this to the eighth of
   * a pixel they resolve, and `MPPEM` read along `x` and `y` is the horizontal
   * size times the same factor. No recording has a face narrowed below its
   * natural width, so whether the size is the horizontal one or the larger of
   * the two is not settled.
   */
  cvtScale() {
    if (this.stretch === 1) {
      return ONEFIX;
    }

    const px = this.state.projection.x;
    const py = this.state.projection.y;

    const stretchX = fixDiv(this.xSize, this.cvtSize);
    const stretchY = fixDiv(this.ppem, this.cvtSize);

    if (py === 0) {
      return stretchX;
    }

    if (px === 0) {
      return stretchY;
    }

    // Components squared, in 2.14, then widened to 16.16 and weighted.
    const dot = (a) => Math.floor((a * a + 8192) / 16384);
    const squares =
      fixMul(dot(px) << 2, fixMul(stretchX, stretchX)) +
      fixMul(dot(py) << 2, fixMul(stretchY, stretchY));

    if (squares > ONEFIX) {
      return ONEFIX;
    }

    // A 2.30 square root, rounded to 16.16.
    return (Math.floor(Math.sqrt(squares) * 4194304) + 8192) >> 14;
  }

  /** The pixel size along the projection vector, as `MPPEM` answers it and as
   * a delta is keyed on: the control values' size through `cvtScale`. */
  sizeAlong() {
    if (this.stretch === 1) {
      return this.ppem;
    }

    return fixMul(this.cvtSize, this.cvtScale());
  }

  /** A control value as the program reads it. */
  cvtAt(index) {
    const value = this.cvt[index] ?? 0;

    return this.stretch === 1 ? value : fixMul(value, this.cvtScale());
  }

  toPixels(units: number) {
    /* A half goes upward, not away from zero.
     *
     * `mulDiv` takes the sign out and puts it back, so a half rounds outward --
     * and a coordinate is not a distance: an outline has points either side of
     * the baseline and of the origin, and rounding them outward makes which way
     * a half goes depend on which side it is, so the same shape mirrored is not
     * the same shape scaled.
     *
     * The device mapping in `glyph-raster.ts` wanted the same correction for the
     * same reason, and this is the other half of it. **Measured**: it is the
     * last of the 846 recorded glyphs, Courier New's `g` at ten pixels per em,
     * whose descender tail begins at 346 design units -- exactly 86.5
     * sixty-fourths at that size -- and whose glyph program does not run there,
     * so nothing downstream can put the half back. Rounding it toward zero or
     * downward instead costs seven or eight glyphs.
     */
    return Math.floor((units * this.pixels) / this.font.unitsPerEm + 0.5);
  }
  /** `toPixels` along `x`, at the stretched horizontal size. */
  toPixelsX(units: number) {
    /* A half goes upward, not away from zero.
     *
     * `mulDiv` takes the sign out and puts it back, so a half rounds outward --
     * and a coordinate is not a distance: an outline has points either side of
     * the baseline and of the origin, and rounding them outward makes which way
     * a half goes depend on which side it is, so the same shape mirrored is not
     * the same shape scaled.
     *
     * The device mapping in `glyph-raster.ts` wanted the same correction for the
     * same reason, and this is the other half of it. **Measured**: it is the
     * last of the 846 recorded glyphs, Courier New's `g` at ten pixels per em,
     * whose descender tail begins at 346 design units -- exactly 86.5
     * sixty-fourths at that size -- and whose glyph program does not run there,
     * so nothing downstream can put the half back. Rounding it toward zero or
     * downward instead costs seven or eight glyphs.
     */
    return Math.floor((units * this.xPixels) / this.font.unitsPerEm + 0.5);
  }

  /** The control value table, in pixels rather than in font units. */
  scaledControlValues() {
    const values: number[] = [];

    if (!this.font.has('cvt ')) {
      return values;
    }

    const table = this.font._tables['cvt '];

    for (let at = 0; at + 1 < table.length; at += 2) {
      const units = this.font._view.getInt16(table.offset + at, false);

      values.push(scaleToPixels(units, this.cvtPixels, this.font.unitsPerEm));
    }

    return values;
  }

  /** The graphics state as it stands at the start of every program. */
  freshState() {
    return {
      projection: { x: UNIT, y: 0 },
      freedom: { x: UNIT, y: 0 },
      dual: { x: UNIT, y: 0 },

      rp0: 0,
      rp1: 0,
      rp2: 0,

      zp0: 1,
      zp1: 1,
      zp2: 1,

      loop: 1,
      roundPeriod: ONE,
      roundPeriod45: 0,
      roundPhase: 0,
      roundThreshold: ONE / 2,
      rounding: true,

      minimumDistance: ONE,
      controlCutIn: (17 * ONE) / 16,
      singleWidth: 0,
      singleWidthCutIn: 0,

      autoFlip: true,
      deltaBase: 9,
      deltaShift: 3,
      instructionControl: 0,
    };
  }

  /** Rounding toward zero on a half, to a multiple. See `hint`. */
  static toward(value, by) {
    return Math.sign(value) * Math.ceil(Math.abs(value) / by - 0.5) * by;
  }

  /**
   * A side bearing in sixty-fourths, as much of it as the outline carries.
   *
   * The whole pixels of it are carried outside the outline instead -- see
   * `hint` -- and `carry` is that part. Both are wanted separately: a composite
   * is assembled out of components that were each fitted on their own, and only
   * the one whose bearing the composite took has the carry in it already.
   */
  bearingIn(shift) {
    return Hinter.toward(shift * this.xPixels, this.font.unitsPerEm) / this.font.unitsPerEm;
  }

  /** The whole pixels of a side bearing, which sit outside the outline. */
  carry(shift) {
    return Hinter.toward(this.bearingIn(shift), ONE);
  }

  /** Runs `fpgm` and `prep`, which between them set the size up. */
  prepare() {
    if (this._ready) {
      return;
    }

    this._ready = true;

    for (const tag of ['fpgm', 'prep']) {
      if (!this.font.has(tag)) {
        continue;
      }

      const table = this.font._tables[tag];

      this.state = this.freshState();
      this.stack = [];

      this.run(this.font._view, table.offset, table.offset + table.length);

      if (tag === 'fpgm') {
        continue;
      }

      // Whatever `prep` left the state as is what each glyph starts from.
      this.defaults = { ...this.state };

      /* What `prep` left for the scan converter. A glyph program may set
       * `SCANCTRL` or `SCANTYPE` for its own glyph -- Arial Bold Italic's `ø`
       * does -- and the next glyph at that size starts from these again, not
       * from what the last one chose. Kept on the hinter rather than in the
       * graphics state, they had leaked: `ø` switched dropout off for every
       * glyph after it, and `ù ú û ü` at twelve pixels were a pixel out.
       */
      this._prepScan = { control: this.scanControl, type: this.scanType };
    }
  }

  /**
   * Hints one glyph's points.
   *
   * @param {Object} outline - Contours in font units.
   * @param {number} advance - The glyph's advance, in font units.
   * @param {number} leftSideBearing - Its left side bearing, in font units.
   * @param {number} xMin - The left edge of its bounding box, in font units.
   * @param {DataView} program - Its instructions.
   * @param {number} at - Where they start.
   * @param {number} length - How many bytes of them there are.
   * @returns {Array} The contours, moved onto the grid.
   */
  hint(outline, advance, leftSideBearing, xMin, program, at, length, assembly = null) {
    /* An assembled composite arrives already in pixels and brings its advance
     * with it, taken from the component that claimed the metrics.
     */
    const composite = Boolean(assembly);

    this.composite = composite;
    this.prepare();

    const zone = new Zone(0);

    /* The outline is moved so that its left edge lands on the side bearing.
     *
     * `hmtx` says where the glyph's ink begins relative to the pen, and `glyf`
     * says where it begins relative to the outline's own zero. When those two
     * disagree the outline has to be carried across the difference, and every
     * point moves with it -- so the shift is applied in font units, before the
     * scaling, and the origin phantom is left at nothing.
     *
     * **Recorded.** Three glyphs of a fabricated Times were given the same four
     * points on the baseline at 0, 256, 512 and 768 units and a program that
     * reads point one back out magnified eightfold. One ran no instruction at
     * all, so what it reports is the bare scaling. Its glyph kept the `W`'s
     * side bearing of 27 units against an `xMin` of nothing, and at every one
     * of sixteen sizes Windows reported the point 27 units to the right of
     * where the outline puts it -- 10 at nine pixels per em where 256 units
     * scale to 9, 16 at fourteen where they scale to 14. The glyph that kept
     * the `w`'s bearing of 13 units is out by half as much at every size, which
     * is the ratio the bearings are in.
     *
     * The shift cannot be left until after the program has run. Doing that
     * moves the origin phantom by the same amount as the outline, the two
     * differences cancel in the advance, and the readings come back unshifted
     * -- 9 at nine pixels per em rather than the recorded 10.
     */
    /* A composite is already assembled where it belongs: each component was
     * carried across its own bearing before it was placed, so there is nothing
     * left to carry.
     */
    const shift = composite ? 0 : leftSideBearing - xMin;

    /* And only the part of the shift that a fixed point number can hold.
     *
     * A bitmap's left edge is a whole pixel, because bitmaps are pixel
     * aligned; an outline's is a sixty-fourth, because outlines are 26.6. So
     * the shift is split between the two. The whole pixels of it come off the
     * outline here and are carried outside it, and the remainder -- which is
     * all a sixty-fourth can carry -- stays in.
     *
     * **Recorded.** The readout in a fabricated glyph multiplies the
     * coordinate it reads before reporting it, so anything inside the outline
     * is magnified and anything outside is not, and reading the same point at
     * eight, four and twofold tells the two apart. Across three fabrications,
     * three side bearings and those three magnifications, all 294 readings
     * come back at `magnify * (point - whole) + whole` and none of them at
     * `magnify * point`. The whole pixels are not magnified, so they are not
     * in the outline.
     *
     * This is why a readout stops tracking its point at a size that depends on
     * the glyph: nothing goes wrong there, the scaled bearing simply reaches
     * half a pixel and a whole pixel of it steps outside.
     *
     * The rounding is toward zero, which is not what `mulDiv` does. One
     * reading proves they differ: the `w` bearing of 13 units scales to
     * exactly 32 sixty-fourths at eighty pixels per em and to 32.9 at
     * eighty-one, and Windows carries a whole pixel out at eighty-one and none
     * at eighty. `mulDiv` rounds both to 33 and cannot tell them apart.
     * Rounding it toward zero everywhere instead is measurably wrong -- it
     * breaks the recorded interior points of Arial Italic's `M` -- so this is
     * its own rounding and not that one.
     */
    const bearing = this.bearingIn(shift);

    const whole = Hinter.toward(bearing, ONE);

    /* When the font has switched its instructions off, the bearing is carried

     * in whole pixels.

     *

     * With `INSTCTRL` inhibiting grid-fitting -- Symbol below seven pixels per

     * em, Courier New below nine -- no program runs, and the outline is placed

     * with its scaled side bearing **rounded to a pixel** rather than to the

     * sixty-fourth it is carried to everywhere else. `dot-bearing` showed it

     * first and it went unread: at every size from nine to thirty-three per em

     * the box GDI hands the scan converter moves with the bearing to the

     * sixty-fourth, and at six per em, alone, it moves in whole pixels. Six

     * per em is where Symbol's prep says `MPPEM LT 7 INSTCTRL`.

     *

     * The period at eight pixels is why it mattered. Its bearing of 145 units

     * is 0.42 of a pixel there, and carried exactly it puts the dot at

     * 2.42..3.08, whose one scanline crosses it at 2.56 and 2.94 -- both

     * rounding to 3, a run of no length, a dropout that the stub check refuses

     * because nothing continues above or below a period. Carried as nothing,

     * the dot sits at 2.00..2.66 and the same scanline crosses it at 2.14 and

     * 2.52: a run of one pixel, no rescue needed, and the pixel Windows draws.

     * Every other letter Symbol had wrong at eight pixels was the same tenth of

     * a pixel deciding a different crossing.

     *

     * **Measured**, not fitted: fifteen records of the corpus and thirty-four

     * fabricated cells, with the hinting fixture untouched at 1,442 of 1,442 --

     * and the alternatives refused first. Running the programs anyway costs

     * seven records and breaks the four letters that agreed; rounding the

     * bearing on the raw path, which an inhibited glyph never takes, changes

     * nothing here and costs eighteen cells elsewhere.

     */

    const carried = this.gridFit ? bearing : Math.round(bearing / ONE) * ONE;

    for (const contour of outline) {
      for (const point of contour) {
        /* A composite arrives already in pixels, because it was assembled in
         * pixels: its components were scaled and then put together, so there
         * is no design-unit outline of the whole to scale here.
         */
        zone.x.push((composite ? point.x : this.toPixelsX(point.x)) + carried - whole);
        zone.y.push(composite ? point.y : this.toPixels(point.y));
        zone.unscaledX.push(point.x + shift);
        zone.unscaledY.push(point.y);
        zone.onCurve.push(point.on);
        zone.touchedX.push(false);
        zone.touchedY.push(false);
      }

      zone.ends.push(zone.x.length - 1);
    }

    /* The phantom points: the glyph's origin, its advance, and two more for
     * the vertical direction. The origin is where the pen stands, which is
     * behind the outline by exactly the whole pixels that were taken out of
     * it -- so that the distance between the two phantoms, which is the
     * advance, comes out the same as if neither had moved.
     */
    const origin = -whole;

    /* The advance phantom starts on the grid.
     *
     * Windows rounds it to a whole pixel before the program runs, and the
     * program can see that it has: the `M` in Arial Italic interpolates a
     * contour point between the two phantoms, so where the advance one sits
     * moves ink. **Recorded**, by reading the phantom out of a running Windows
     * with a glyph whose program is nothing but the readout -- at every size,
     * what comes back is the scaled advance rounded to a whole number of
     * pixels.
     *
     * `hdmx` says otherwise, and `hdmx` is not Windows: it is a table computed
     * by whoever built the font, and the rasteriser that filled it in did not
     * round. Ours reproduces that table 22,051 times out of 22,056 without this
     * rounding and 21,735 with it -- and reproduces the *recorded pixels* 83
     * times out of 90 without and 85 with. The pixels are what Windows drew.
     */
    const grid = (value) => Math.floor((value + ONE / 2) / ONE) * ONE;

    /* The advance is rounded on its own, from the pen rather than from the
     * outline, which is what the origin standing at nothing already says.
     *
     * Times New Roman Italic's `j` is the glyph that showed this mattered: its
     * bearing and its `xMin` are four design units apart, a sixteenth of a
     * pixel at thirty-four pixels per em, and enough to carry an advance of
     * 9.4531 across the halfway mark and round it to ten if the two are added
     * before the rounding rather than after. Windows rounds 9.4531 to nine.
     * **Recorded**, by reading the phantom itself out of a running Windows with
     * a glyph whose whole program is the readout -- so no instruction had run
     * and the disagreement was already there.
     */
    /* A composite's advance is not scaled here. It is the advance the component
     * claiming the metrics came out with after its own program had run, which
     * is already in sixty-fourths and already rounded however this hinter
     * rounds -- and is what the font's own tables say a composite advances by.
     */
    const scaledAdvance =
      composite && assembly.advance !== null
        ? assembly.advance
        : this.roundPhantoms
          ? grid(this.toPixelsX(advance))
          : this.toPixelsX(advance);

    const width = origin + scaledAdvance;

    /* Four phantom points, and the last two are not the vertical ones.
     *
     * The spec's third and fourth phantoms carry vertical metrics; this
     * scaler predates them. Read out of GDI's element after a draw -- six
     * arrays, `maxPoints + 4` words apart -- the four slots after the outline
     * hold, in x: the origin, the origin plus the advance, the origin again,
     * and `xMin`. Times New Roman's `ß` at twenty-seven per em gives
     * `0 896 0 30`, where 30 is its `xMin` of 35 scaled; the fabricated
     * Symbol dot at six gives `-30 .. -30 48`, where 48 is a square starting
     * at 254 scaled and its bearing is somewhere else entirely, which is what
     * settles that the slot is `xMin` and not the bearing. All four are nought
     * in y.
     *
     * It matters because a program that names a point past its outline finds
     * the last glyph's slots there, and rounds what it finds. A fourth phantom
     * of nought rounds to nought; one holding a scaled `xMin` moves by up to
     * half a pixel, and that half pixel was the last wrong cell in the
     * fabricated corpus -- 26,057 of 26,058 with these at nought, all of them
     * with these read.
     */
    const phantom = [
      { x: origin, y: 0 },
      { x: width, y: 0 },
      { x: origin, y: 0 },
      { x: this.toPixelsX(xMin), y: 0 },
    ];

    /* The phantoms in design units, which is not the same list.
     *
     * `IP` takes its proportion from the design coordinates, and a program is
     * free to interpolate between the phantoms -- Arial Italic's `M` does
     * exactly that. Leaving them in pixels while every other point is in font
     * units puts a ratio of two different things in the middle of the
     * calculation.
     */
    const originUnits = 0;

    const design = [
      { x: originUnits, y: 0 },
      { x: originUnits + advance, y: 0 },
      { x: originUnits, y: 0 },
      { x: xMin, y: 0 },
    ];

    for (const [index, point] of phantom.entries()) {
      zone.x.push(point.x);
      zone.y.push(point.y);
      zone.unscaledX.push(design[index].x);
      zone.unscaledY.push(design[index].y);
      zone.onCurve.push(false);
      zone.touchedX.push(false);
      zone.touchedY.push(false);
    }

    zone.originalX = zone.x.slice();
    zone.originalY = zone.y.slice();

    /* Except the advance phantom, which remembers where the scaling left it
     * rather than where the rounding put it.
     *
     * Every other point starts where it starts and is remembered there. This
     * one is moved onto the grid before the program runs -- see `grid` above --
     * and the position it is remembered as having started from is the one
     * before that move. So a program asking how far it has travelled is told
     * the fraction of a pixel the rounding took, and a `SHP` against it carries
     * that fraction into the letter.
     *
     * **Recorded.** Courier New's bold italic `X` is the glyph that showed it:
     * its program shifts a point against the advance phantom five instructions
     * in, which does nothing at all if the phantom has not moved, and cutting
     * the program either side of that shift is where the letter starts
     * disagreeing. Thirteen of the bold and italic cells come right with this
     * and none goes wrong.
     */
    /* The advance phantom's original sits at the horizontal scale like the
     * phantom itself; at the vertical one, a stretched `MIRP` from it with an
     * empty control value measured the wrong distance and put the right side
     * of Arial's `E` three widths out instead of two. */
    zone.originalX[zone.x.length - 3] = origin + this.toPixelsX(advance);

    /* A composite has no design coordinates, so its scaled ones stand in.
     *
     * `IP`, `IUP` and `MDRP` all take a proportion or a distance from where a
     * point was designed rather than from where it was scaled to, and for a
     * glyph assembled out of other glyphs there is no such place: the assembly
     * only ever existed in pixels. The scaler says so in three separate
     * instructions, each asking whether the glyph is composite in the same
     * breath as whether a point is in the twilight zone -- which has no design
     * coordinates either, and which we already answer this same way.
     */
    if (composite) {
      zone.unscaledX = zone.originalX.slice();
      zone.unscaledY = zone.originalY.slice();
    }

    zone.seal(this.font.maxPoints, this.zones[1]);

    this.zones[1] = zone;
    this.zones[0] = new Zone(this.font.maxTwilight ?? 16);

    if (this._prepScan) {
      this.scanControl = this._prepScan.control;
      this.scanType = this._prepScan.type;
    }

    this.state = this.glyphState();
    this.stack = [];

    /* A font that asked for no grid-fitting at this size gets none.
     *
     * The scaling above still happens, and so does everything `prep` settled
     * -- the dropout rule among it -- because what is being refused is the
     * glyph's own program, not the size. The points come back where the
     * outline put them, quantised to sixty-fourths, which is what a rasteriser
     * with hinting switched off draws.
     */
    if (this.gridFit) {
      this.run(program, at, at + length);
    }

    /* What the glyph advances by, once the program has had its say.
     *
     * The two horizontal phantom points are the pen position before the glyph
     * and after it, and a program is free to move them -- that is how hinting
     * changes a glyph's width and not just its shape. The distance between
     * them afterwards is the advance, and it is exactly what `hdmx` tabulates,
     * which makes that table a check on this one.
     */
    const last = zone.length;

    this.advance = Math.round((zone.x[last - 3] - zone.x[last - 4]) / ONE);

    /* And the same in sixty-fourths, which is what a composite built on this
     * glyph inherits rather than scaling the table's number for itself.
     */
    this.advanceExact = zone.x[last - 3] - zone.x[last - 4];

    /* Back into contours, in font units scaled to pixels, and with the whole
     * pixels of the side bearing put back.
     *
     * They came out before the program ran because that is where Windows keeps
     * them -- outside the outline, in the integer the bitmap is placed at.
     * Nothing here places a bitmap, so the last thing to happen to the outline
     * is to carry it back onto the pen. A whole number of pixels is the one
     * translation that changes no sampling decision the rasteriser makes.
     */
    const hinted: any[] = [];

    /* Where the pen ended up, which is not always where it started.
     *
     * The origin phantom stands for the pen, and a program may move it -- so
     * the outline is carried back onto wherever it finished rather than onto
     * where it began. While it stays put the two are the same thing, and the
     * difference is the whole pixels of the side bearing that were taken out of
     * the outline earlier, put back.
     *
     * **Recorded.** Times New Roman's right guillemet is the glyph that moves
     * it: its last instruction before the interpolation shifts the origin a
     * whole pixel, one way at some sizes and the other way at others, and the
     * letter came out that far from where Windows draws it at every size where
     * it moved and nowhere else. Its mirror image, the left guillemet, moves
     * the advance phantom instead and was right all along.
     */
    /* A composite is carried onto where its origin phantom *started* instead.
     *
     * Its components were placed in device space as they were assembled, each
     * one carrying its own bearing and having the composite's put back -- see
     * `compositeInPixels`. So by the time the composite's own program runs, the
     * outline is already where it goes, and the origin phantom is a reference
     * the program may move rather than the position the glyph is placed at.
     *
     * **Measured, and the two halves refuse each other.** `slope-sweep` cuts
     * base letters down to four points and leaves the accented composites built
     * on them alone, so their programs -- written for the points the base used
     * to have -- name the phantoms instead, and a composite whose origin phantom
     * has been moved is exactly the case this decides. Carrying every glyph onto
     * where its origin finished puts the fabricated corpus at 25,965 of 26,058
     * cells and 2,212 wrong pixels. Carrying every glyph onto where its origin
     * started does better there -- 25,987 and 1,754 -- and **breaks eight
     * recorded cells**, the guillemets above, which is what says it is not a
     * rule about glyphs in general. Splitting it puts the corpus at **26,029 of
     * 26,058 and 118 wrong pixels** with every recorded cell still standing.
     */
    const pen = composite ? origin : zone.x[zone.length - 4];

    let index = 0;

    for (const contour of outline) {
      const shape: any[] = [];

      for (let point = 0; point < contour.length; point++) {
        shape.push({
          x: (zone.x[index] - pen) / ONE,
          y: zone.y[index] / ONE,
          on: zone.onCurve[index],
        });

        index++;
      }

      hinted.push(shape);
    }

    return hinted;
  }

  /**
   * The state a glyph program starts from.
   *
   * Not simply what `prep` left behind. Some of the graphics state is about
   * the size and outlives the program that set it -- the round state, the
   * minimum distance, the control value cut-in -- and some of it is about
   * where the program had got to, and means nothing to the next one.
   *
   * The zone pointers are the ones that matter. `prep` builds its scratch
   * points in the twilight zone and quite reasonably leaves the pointers
   * there; a glyph program inheriting that moves the glyph's points in name
   * only, writing every one of them into scratch space instead. Everything
   * executes, nothing is out of place, and the outline comes out untouched --
   * which is exactly what it did.
   */
  glyphState() {
    const fresh = this.freshState();

    // What the size program settles and a glyph program inherits.
    for (const key of [
      'rounding',
      'roundPeriod',
      'roundPhase',
      'roundThreshold',
      'minimumDistance',
      'controlCutIn',
      'singleWidth',
      'singleWidthCutIn',
      'autoFlip',
      'deltaBase',
      'deltaShift',
      'instructionControl',
    ]) {
      fresh[key] = this.defaults[key];
    }

    return fresh;
  }

  /* ---- the machine ---- */

  push(value) {
    this.stack.push(value | 0);
  }

  pop() {
    if (this.stack.length === 0) {
      throw new Unsupported('stack underflow');
    }

    return this.stack.pop() as number;
  }

  zone(which) {
    return this.zones[which] ?? this.zones[1];
  }

  /** How far along the projection vector a point sits. */
  project(x, y) {
    return mulDivUp(x, this.state.projection.x, UNIT) + mulDivUp(y, this.state.projection.y, UNIT);
  }

  /** The same, against the vector the original outline is measured with. */
  /**
   * A design coordinate under the dual projection, as `IP` and `MDRP` measure
   * their proportions and distances.
   *
   * At a stretch of one the design coordinates are whole units and this is
   * `projectDual`. Under a width the design x has been multiplied by the
   * stretch and is no longer whole, and **the fraction is kept**: rounding it
   * to a unit, as the dual projection does to its sixty-fourths, was a
   * sixty-fourth's error in the proportion `IP` takes -- Times New Roman's `S`
   * at twenty-one pixels asked for five has its top terminal interpolated at
   * 939 between 1029 and 851 design units, which is 352 sixty-fourths and
   * rounds up to six pixels; with the three stretched to 581, 637 and 527 it
   * is 351, and rounds down to five. **Measured**: the width sweep goes from
   * 21 wrong cells and 35 wrong pixels to 3 and 4, and the `S` is among the
   * ones that go. Dividing the design y by the stretch instead, to whole
   * units, and leaving the x as it is, is refused at 46 cells and 94 pixels.
   * How the reference holds the stretched originals is not in the pseudocode;
   * this is the precision that reproduces the recordings.
   *
   * `IP` projects a point's design offset with this, the dual vector. The
   * reference's general case uses the current vector there; the two differ
   * only where a program interpolates along a line that has already been
   * moved off its original direction, and no recorded cell separates them.
   */
  projectDesign(x, y) {
    if (this.stretch === 1) {
      return this.projectDual(x, y);
    }

    return (x * this.state.dual.x + y * this.state.dual.y) / UNIT;
  }

  projectDual(x, y) {
    return mulDivUp(x, this.state.dual.x, UNIT) + mulDivUp(y, this.state.dual.y, UNIT);
  }

  /**
   * Moves a point by a distance along the projection vector.
   *
   * The point travels along the *freedom* vector, far enough that its
   * projection moves by what was asked. When the two vectors are at an angle
   * that means moving further than the distance itself.
   */
  movePoint(zone, index, distance) {
    const { freedom, projection } = this.state;

    /* How much of a step along the freedom vector shows up along the
     * projection vector. Where the two are the same axis this is one, and the
     * point simply moves by the distance; where they are at an angle it is
     * less, and the point has to travel further to project as far.
     */
    let along = mulDiv(projection.x, freedom.x, UNIT) + mulDiv(projection.y, freedom.y, UNIT);

    if (along === 0) {
      return;
    }

    /* A projection and a freedom vector nearly at right angles are not allowed
     * to divide.
     *
     * The move along freedom that shows as `distance` along projection is
     * `distance / cos`, and as the two vectors approach perpendicular that runs
     * away: a distance of five eighths of a pixel took Courier New's `w` eight
     * and a half. The reference refuses it -- *"Prevent divide by small
     * number"* -- by replacing a dot product under a sixteenth with a whole one
     * of the same sign, which turns an enormous move into a merely wrong one.
     *
     * It is reachable only where a font drives the vectors somewhere its own
     * `INSTCTRL` says not to go, which is why nothing in the recorded corpus
     * moves either way.
     */
    if (Math.abs(along) < UNIT / 16) {
      along = along < 0 ? -UNIT : UNIT;
    }

    if (freedom.x !== 0) {
      zone.x[index] += mulDiv(distance, freedom.x, along);
      zone.touchedX[index] = true;
    }

    if (freedom.y !== 0) {
      zone.y[index] += mulDiv(distance, freedom.y, along);
      zone.touchedY[index] = true;
    }
  }

  /** Rounds a distance according to the current round state. */
  round(value, compensation = 0) {
    if (!this.state.rounding) {
      return value;
    }

    const { roundPeriod, roundPhase, roundThreshold } = this.state;

    const negative = value < 0;

    /* The engine compensation. A distance carries a colour -- grey, black or
     * white -- and the original rasteriser nudged black and white ones before
     * rounding, to keep a stem from thickening or thinning as it met the grid.
     * Whether Windows 3.1 did, and by how much, is measured rather than
     * assumed: see oracle/README.md.
     */
    let magnitude = Math.abs(value) + compensation;

    if (magnitude < 0) {
      magnitude = 0;
    }

    magnitude += roundThreshold - roundPhase;

    /* A mask, not a division.
     *
     * `SuperRound` writes `x &= ~(period - 1)`, which is a floor to a multiple
     * only when the period is a power of two. Every named round state has one,
     * so the two agree there -- but `SROUND`'s illegal period selector gives
     * 999, and `~998` is not a floor to anything in particular. Windows lands
     * on whatever that mask leaves and the answer moves with the input, which a
     * division cannot reproduce.
     *
     * `Super45Round` does something else again: it divides by the period held
     * in 2.30, floors *that* to whole pixels, and multiplies back.
     */
    if (this.state.roundPeriod45) {
      const wide = this.state.roundPeriod45;

      // `VECTORDIV` and `VECTORMUL` round; flooring instead costs three sizes.
      magnitude = Math.round((magnitude * (1 << 30)) / wide);
      magnitude &= ~(ONE - 1);
      magnitude = Math.round((magnitude * wide) / (1 << 30));
    } else {
      magnitude &= ~(roundPeriod - 1);
    }

    magnitude += roundPhase;

    if (magnitude < 0) {
      magnitude = roundPhase;
    }

    return negative ? -magnitude : magnitude;
  }

  /**
   * Executes a program.
   *
   * @param {DataView} program - Where the instructions are.
   * @param {number} from - The first byte.
   * @param {number} to - One past the last.
   */
  run(program, from, to) {
    let at = from;
    let steps = 0;

    /* Nested conditionals and loops are handled by scanning forward for the
     * matching instruction rather than by keeping a block structure, which is
     * what the format's own flat jumps invite.
     */
    while (at < to) {
      if (++steps > STEP_LIMIT) {
        throw new Unsupported('program did not finish');
      }

      const opcode = program.getUint8(at++);

      at = this.execute(opcode, program, at, to);
    }
  }

  /**
   * Runs one instruction and says where the next one starts.
   *
   * Split out from `run` because a function call, a conditional and a loop all
   * need to execute instructions from somewhere else, and the dispatch is the
   * same wherever the bytes came from.
   */
  execute(opcode, program, at, to) {
    // The pushes carry their operands with them, so they move the cursor.
    if (opcode === 0x40) {
      const count = program.getUint8(at++);

      for (let index = 0; index < count; index++) {
        this.push(program.getUint8(at++));
      }

      return at;
    }

    if (opcode === 0x41) {
      const count = program.getUint8(at++);

      for (let index = 0; index < count; index++) {
        this.push(program.getInt16(at, false));
        at += 2;
      }

      return at;
    }

    if (opcode >= 0xb0 && opcode <= 0xb7) {
      const count = opcode - 0xb0 + 1;

      for (let index = 0; index < count; index++) {
        this.push(program.getUint8(at++));
      }

      return at;
    }

    if (opcode >= 0xb8 && opcode <= 0xbf) {
      const count = opcode - 0xb8 + 1;

      for (let index = 0; index < count; index++) {
        this.push(program.getInt16(at, false));
        at += 2;
      }

      return at;
    }

    return this.perform(opcode, program, at, to);
  }

  /** Everything that is not a push. */
  perform(opcode, program, at, to) {
    const state = this.state;

    switch (opcode) {
      /* -- the vectors -- */

      case 0x00: // SVTCA[0], both vectors to the y axis
      case 0x01: {
        // SVTCA[1], both to the x axis
        const vector = opcode === 0x01 ? { x: UNIT, y: 0 } : { x: 0, y: UNIT };

        state.projection = { ...vector };
        state.dual = { ...vector };
        state.freedom = { ...vector };

        return at;
      }

      case 0x02: // SPVTCA[0]
      case 0x03: {
        const vector = opcode === 0x03 ? { x: UNIT, y: 0 } : { x: 0, y: UNIT };

        state.projection = { ...vector };
        state.dual = { ...vector };

        return at;
      }

      case 0x04: // SFVTCA[0]
      case 0x05: {
        state.freedom = opcode === 0x05 ? { x: UNIT, y: 0 } : { x: 0, y: UNIT };

        return at;
      }

      case 0x0e: // SFVTPV
        state.freedom = { ...state.projection };
        return at;

      /* -- reference points and zones -- */

      case 0x10:
        state.rp0 = this.pop();
        return at;

      case 0x11:
        state.rp1 = this.pop();
        return at;

      case 0x12:
        state.rp2 = this.pop();
        return at;

      case 0x13:
        state.zp0 = this.pop();
        return at;

      case 0x14:
        state.zp1 = this.pop();
        return at;

      case 0x15:
        state.zp2 = this.pop();
        return at;

      case 0x16: {
        const which = this.pop();

        state.zp0 = which;
        state.zp1 = which;
        state.zp2 = which;

        return at;
      }

      /* -- the round state -- */

      case 0x18: // RTG
        state.rounding = true;
        state.roundPeriod = ONE;
        state.roundPeriod45 = 0;
        state.roundPhase = 0;
        state.roundThreshold = ONE / 2;
        return at;

      case 0x19: // RTHG
        state.rounding = true;
        state.roundPeriod = ONE;
        state.roundPeriod45 = 0;
        state.roundPhase = ONE / 2;
        state.roundThreshold = ONE / 2;
        return at;

      case 0x3d: // RTDG
        state.rounding = true;
        state.roundPeriod = ONE / 2;
        state.roundPeriod45 = 0;
        state.roundPhase = 0;
        state.roundThreshold = ONE / 4;
        return at;

      case 0x7d: // RDTG
        state.rounding = true;
        state.roundPeriod = ONE;
        state.roundPeriod45 = 0;
        state.roundPhase = 0;
        state.roundThreshold = 0;
        return at;

      case 0x7c: // RUTG
        state.rounding = true;
        state.roundPeriod = ONE;
        state.roundPeriod45 = 0;
        state.roundPhase = 0;
        state.roundThreshold = ONE - 1;
        return at;

      case 0x7a: // ROFF
        state.rounding = false;
        return at;

      /* -- the stack -- */

      case 0x20: {
        const value = this.pop();

        this.push(value);
        this.push(value);

        return at;
      }

      case 0x21:
        this.pop();
        return at;

      case 0x22:
        this.stack = [];
        return at;

      case 0x23: {
        const a = this.pop();
        const b = this.pop();

        this.push(a);
        this.push(b);

        return at;
      }

      case 0x24:
        this.push(this.stack.length);
        return at;

      case 0x26: {
        // MINDEX
        const index = this.pop();
        const value = this.stack.splice(this.stack.length - index, 1)[0];

        this.push(value);

        return at;
      }

      case 0x25: {
        // CINDEX
        const index = this.pop();

        this.push(this.stack[this.stack.length - index]);

        return at;
      }

      /* -- storage and control values -- */

      case 0x43:
        this.push(this.storage[this.pop()] ?? 0);
        return at;

      case 0x42: {
        const value = this.pop();
        const index = this.pop();

        this.storage[index] = value;

        return at;
      }

      case 0x45:
        this.push(this.cvtAt(this.pop()));
        return at;

      case 0x44: {
        // WCVTP, in pixels
        const value = this.pop();
        const index = this.pop();

        this.cvt[index] =
          this.stretch === 1 || value === 0 ? value : fixDiv(value, this.cvtScale());

        return at;
      }

      case 0x70: {
        // WCVTF, in font units
        const value = this.pop();
        const index = this.pop();

        this.cvt[index] = this.toPixels(value);

        return at;
      }

      /* -- arithmetic -- */

      case 0x60: {
        const b = this.pop();
        const a = this.pop();

        this.push(a + b);

        return at;
      }

      case 0x61: {
        const b = this.pop();
        const a = this.pop();

        this.push(a - b);

        return at;
      }

      case 0x62: {
        const b = this.pop();
        const a = this.pop();

        this.push(divide(a, b));

        return at;
      }

      case 0x63: {
        const b = this.pop();
        const a = this.pop();

        this.push(mulDiv(a, b, ONE));

        return at;
      }

      case 0x64:
        this.push(Math.abs(this.pop()));
        return at;

      case 0x65:
        this.push(-this.pop());
        return at;

      case 0x66:
        this.push(Math.floor(this.pop() / ONE) * ONE);
        return at;

      case 0x67:
        this.push(Math.ceil(this.pop() / ONE) * ONE);
        return at;

      case 0x8b: {
        const b = this.pop();
        const a = this.pop();

        this.push(Math.max(a, b));

        return at;
      }

      case 0x8c: {
        const b = this.pop();
        const a = this.pop();

        this.push(Math.min(a, b));

        return at;
      }

      /* -- comparison and logic -- */

      case 0x50:
      case 0x51:
      case 0x52:
      case 0x53:
      case 0x54:
      case 0x55: {
        const b = this.pop();
        const a = this.pop();

        const answer = {
          0x50: a < b,
          0x51: a <= b,
          0x52: a > b,
          0x53: a >= b,
          0x54: a === b,
          0x55: a !== b,
        }[opcode];

        this.push(answer ? 1 : 0);

        return at;
      }

      case 0x56:
        this.push(Math.abs(this.round(this.pop()) / ONE) % 2 === 1 ? 1 : 0);
        return at;

      case 0x57:
        this.push(Math.abs(this.round(this.pop()) / ONE) % 2 === 0 ? 1 : 0);
        return at;

      case 0x5a: {
        const b = this.pop();
        const a = this.pop();

        this.push(a && b ? 1 : 0);

        return at;
      }

      case 0x5b: {
        const b = this.pop();
        const a = this.pop();

        this.push(a || b ? 1 : 0);

        return at;
      }

      case 0x5c:
        this.push(this.pop() ? 0 : 1);
        return at;

      /* -- rounding -- */

      case 0x68:
      case 0x69:
      case 0x6a:
      case 0x6b:
        this.push(this.round(this.pop()));
        return at;

      case 0x6c:
      case 0x6d:
      case 0x6e:
      case 0x6f:
        // NROUND, which is the same without the rounding.
        return at;

      /* -- the size -- */

      case 0x4b:
        this.push(this.sizeAlong());
        return at;

      case 0x4c:
        /* MPS, the point size, which Windows never learns.
         *
         * The scaler keeps a point size beside the pixel size, and GDI drives
         * it by pixels and leaves the other at nought. Both `mps-raw` and
         * `mps-scaled` read nought back at every size where the program runs,
         * one of which would have carried a plain count of points and the
         * other a count in sixty-fourths, so it is the value that is nought and
         * not the unit that is wrong.
         *
         * We answered the pixels-per-em in sixty-fourths, which is neither the
         * point size nor nought, and a font asking how big it is would have
         * been told something like twenty when Windows says nothing at all.
         */
        this.push(0);
        return at;

      /* -- state values -- */

      case 0x17:
        state.loop = this.pop();
        return at;

      case 0x1a:
        state.minimumDistance = this.pop();
        return at;

      case 0x1d:
        state.controlCutIn = this.pop();
        return at;

      case 0x1e:
        state.singleWidthCutIn = this.pop();
        return at;

      case 0x1f:
        state.singleWidth = this.pop();
        return at;

      case 0x4d:
        state.autoFlip = true;
        return at;

      case 0x4e:
        state.autoFlip = false;
        return at;

      case 0x5e:
        state.deltaBase = this.pop();
        return at;

      case 0x5f:
        state.deltaShift = this.pop();
        return at;

      /* INSTCTRL: the font's own switch for turning hinting off at a size.
       *
       * The selector is a bit to change and the value carries what to change
       * it to, so it is a masked assignment rather than a store. Bit 0 says
       * "do not grid-fit at this size"; bit 1 says "ignore what `prep` did to
       * the control values". A font sets it from `prep`, where it knows the
       * size and can decide that its own instructions do more harm than good.
       *
       * Courier New does exactly that below nine pixels per em, and it is the
       * only path in any installed font that reaches this. `Hinter.gridFit`
       * is where the answer is read.
       */
      case 0x8e: {
        const selector = this.pop();
        const value = this.pop();

        state.instructionControl = (state.instructionControl & ~selector) | (value & selector);

        return at;
      }

      /* SCANCTRL and SCANTYPE: what the scan converter should do about strokes
       * too thin to cover a pixel centre. Neither moves a point, so the
       * interpreter only has to remember them for the rasteriser to read.
       *
       * `SCANCTRL`'s low byte is a size and its bit 8 says "switch dropout
       * control on at or below that size"; bits 9 and 10 do the same for
       * rotated and stretched text, which nothing here produces. `SCANTYPE`
       * chooses among the rules -- all four installed families ask for 1,
       * simple dropout control excluding stubs.
       */
      case 0x85:
        this.scanControl = this.pop();
        return at;

      case 0x8d:
        this.scanType = this.pop();
        return at;

      /* -- functions -- */

      case 0x76:
      case 0x77: {
        /* SROUND and S45ROUND: the round state spelled out in one byte rather
         * than chosen from the handful of named ones. The period is how far
         * apart the places a value can land are, the phase is where the first
         * of them sits, and the threshold is how far past one a value has to
         * get before it goes to the next.
         */
        const packed = this.pop();

        /* The period, the phase and the threshold are all whole sixty-fourths,
         * and each is rounded the way the reference rounds it.
         *
         * Two corners were ours rather than read. The fourth period selector is
         * **illegal** and the reference gives it 999, not the whole pixel we
         * guessed -- which is a real value a program can land on, and rounds a
         * point to the nearest fifteen and a half pixels. And a forty-five
         * degree period is kept in 2.30 and converted to sixty-fourths *once*,
         * so it comes out 23, 45 or 91; halving 45 in sixty-fourths gives 22.5
         * and puts every later threshold on the wrong side of a half.
         */
        const selector = packed & 0x0f;

        let period;
        let wide45 = 0;

        if (opcode === 0x76) {
          period = [ONE / 2, ONE, ONE * 2, 999][(packed >> 6) & 0x03];
        } else {
          // The square root of a half in 2.30, halved or doubled, then rounded.
          const root = Math.round(Math.SQRT1_2 * (1 << 30));

          wide45 = [Math.floor(root / 2), root, root * 2, 999][(packed >> 6) & 0x03];
          period = Math.floor((wide45 + (1 << 23)) / (1 << 24));
        }

        const phase = [
          0,
          (period + 2) >> 2,
          (period + 1) >> 1,
          (period + period + period + 2) >> 2,
        ][(packed >> 4) & 0x03];

        const threshold = selector === 0 ? period - 1 : ((selector - 4) * period + 4) >> 3;

        state.rounding = true;
        state.roundPeriod = period;
        state.roundPeriod45 = opcode === 0x77 ? wide45 : 0;
        state.roundPhase = phase;
        state.roundThreshold = threshold;

        return at;
      }

      case 0x89:
        // IDEF, which redefines an instruction. Nothing here does that.
        throw new Unsupported('IDEF');

      case 0x88: {
        // GETINFO: what the program is being run by.
        const selector = this.pop();

        let answer = 0;

        /* Bit 0 asks for the scaler's version, and nothing here rotates or
         * stretches, so the other bits stay clear.
         *
         * Three is measured, not assumed: `getinfo-version` reports the reply
         * back through the advance and Windows answers three at every size
         * where the program runs at all, against nought for the selector with
         * no bits set. A font is entitled to branch on this, so the number
         * decides which half of such a font's program ever runs.
         *
         * The version is not a bit but a number or-ed into the low end of the
         * reply, and three fills the two bits below the rotated and stretched
         * ones without reaching them.
         */
        if (selector & 0x01) {
          answer |= 3;
        }

        this.push(answer);

        return at;
      }

      case 0x8a: {
        // ROLL, which rotates the top three.
        const a = this.pop();
        const b = this.pop();
        const c = this.pop();

        this.push(b);
        this.push(a);
        this.push(c);

        return at;
      }

      case 0x0c:
        this.push(state.projection.x);
        this.push(state.projection.y);
        return at;

      case 0x0d:
        this.push(state.freedom.x);
        this.push(state.freedom.y);
        return at;

      case 0x0a: {
        const y = this.pop();
        const x = this.pop();

        state.projection = { x, y };
        state.dual = { x, y };

        return at;
      }

      case 0x0b: {
        const y = this.pop();
        const x = this.pop();

        state.freedom = { x, y };

        return at;
      }

      case 0x06:
      case 0x07:
      case 0x08:
      case 0x09:
      case 0x86:
      case 0x87: {
        /* Set a vector from the line between two points -- along it for the
         * even opcodes, at right angles for the odd ones.
         */
        const second = this.pop();
        const first = this.pop();

        const zoneOne = this.zone(state.zp1);
        const zoneTwo = this.zone(state.zp2);

        const perpendicular = (opcode & 0x01) !== 0;

        /* The deeper of the two point numbers belongs to the first zone and the
         * one on top of it to the second, which is only visible while a program
         * has the two pointing somewhere different.
         */
        const vector = this.unitVector(
          zoneOne.x[first] - zoneTwo.x[second],
          zoneOne.y[first] - zoneTwo.y[second],
          perpendicular
        );

        if (opcode === 0x08 || opcode === 0x09) {
          state.freedom = vector;

          return at;
        }

        state.projection = vector;

        /* `SDPVTL` takes its dual from where the two points *started*, not from
         * where they are now, and that is the whole of what makes it different
         * from `SPVTL`. The projection vector says which way to measure in the
         * outline as it stands; the dual says which way the line ran before any
         * of it was fitted, so that a later `MDRP` comparing against the
         * original distance compares along the original direction.
         *
         * Taking both from the current outline is the obvious reading and is
         * wrong by however far the program has already moved the two points.
         * On a line that starts off-axis and is then fitted, that is a fraction
         * of a pixel of angle -- which is nothing until it decides a rounding.
         */
        state.dual =
          opcode === 0x06 || opcode === 0x07
            ? { ...vector }
            : this.unitVector(
                zoneOne.originalX[first] - zoneTwo.originalX[second],
                zoneOne.originalY[first] - zoneTwo.originalY[second],
                perpendicular
              );

        return at;
      }

      case 0x0f: {
        /* ISECT: put a point where two lines cross.
         *
         * Five point numbers: the one to move, then the two ends of the line it
         * should land on, then the two ends of the line that crosses it. The
         * point goes to the intersection, and is touched in both directions
         * because it has been placed rather than shifted.
         *
         * Parallel means parallel, not nearly. This once took the midpoint
         * whenever the two lines were within about three degrees of each other,
         * on an unexplained factor of nineteen; the reference divides unless its
         * denominator is exactly nought and takes the midpoint only then, and
         * no fixture separates the two.
         *
         * `X` and `4` use this in all three outline faces, and without it every
         * one of them fell back to an unhinted outline.
         */
        const secondB = this.pop();
        const firstB = this.pop();
        const secondA = this.pop();
        const firstA = this.pop();
        const index = this.pop();

        const zoneA = this.zone(state.zp1);
        const zoneB = this.zone(state.zp0);
        const zone = this.zone(state.zp2);

        /* Arranged as the reference arranges it, since a chain of rounded
         * `MulDiv26Dot6`s does not land where one exact intersection rounded
         * would. Line A is the pair on top of the stack, line B the pair
         * beneath; both are divided through by the larger component of A's
         * direction so nothing overflows, and the point is B's start plus B's
         * direction scaled by the ratio that comes out.
         *
         * This used to be Cramer's rule on the exact cross products, rounded
         * once at the end -- the same line, a sixty-fourth apart. **Recorded**:
         * Arial's `X` at twenty-one pixels asked for sixteen has its left
         * crossing read out at 681 along `x`, and the chain gives 681 where the
         * exact rule gave 680; at thirteen asked for sixteen the readout is
         * (620, 358) against (619, 357); and Times New Roman's `X` at
         * twenty-one asked for five comes to 232 by the chain, 233 by the exact
         * rule, and the pixel at its crossing follows Windows only at 232.
         */
        const ax = zoneB.x[firstB];
        const ay = zoneB.y[firstB];
        const dax = zoneB.x[secondB] - ax;
        const day = zoneB.y[secondB] - ay;
        const bx = zoneA.x[firstA];
        const by = zoneA.y[firstA];
        const dbx = zoneA.x[secondA] - bx;
        const dby = zoneA.y[secondA] - by;

        zone.touchedX[index] = true;
        zone.touchedY[index] = true;

        let n: number;
        let d: number;

        if (day === 0) {
          if (dbx === 0) {
            zone.x[index] = bx;
            zone.y[index] = ay;

            return at;
          }

          n = by - ay;
          d = -dby;
        } else if (dax === 0) {
          if (dby === 0) {
            zone.x[index] = ax;
            zone.y[index] = by;

            return at;
          }

          n = bx - ax;
          d = -dbx;
        } else if (Math.abs(dax) >= Math.abs(day)) {
          n = by - ay - mulDiv(bx - ax, day, dax);
          d = mulDiv(dbx, day, dax) - dby;
        } else {
          n = mulDiv(by - ay, dax, day) - (bx - ax);
          d = dbx - mulDiv(dby, dax, day);
        }

        if (d !== 0) {
          zone.x[index] = bx + mulDiv(dbx, n, d);
          zone.y[index] = by + mulDiv(dby, n, d);
        } else {
          // Parallel: the middle of the two midpoints, in the reference's shifts.
          zone.x[index] = (bx + (dbx >> 1) + ax + (dax >> 1)) >> 1;
          zone.y[index] = (by + (dby >> 1) + ay + (day >> 1)) >> 1;
        }

        return at;
      }

      case 0x29:
        // UTP, which unsticks a point so interpolation carries it again.
        {
          const index = this.pop();
          const zone = this.zone(state.zp0);

          if (state.freedom.x !== 0) {
            zone.touchedX[index] = false;
          }

          if (state.freedom.y !== 0) {
            zone.touchedY[index] = false;
          }
        }

        return at;

      case 0x80: {
        // FLIPPT, which turns points on and off the curve.
        let count = state.loop;

        while (count-- > 0) {
          const index = this.pop();
          const zone = this.zones[1];

          zone.onCurve[index] = !zone.onCurve[index];
        }

        state.loop = 1;

        return at;
      }

      case 0x81:
      case 0x82: {
        const high = this.pop();
        const low = this.pop();

        for (let index = low; index <= high; index++) {
          this.zones[1].onCurve[index] = opcode === 0x81;
        }

        return at;
      }

      case 0x2c: {
        // FDEF
        const index = this.pop();

        const start = at;
        let cursor = at;

        // Its body runs to the matching ENDF.
        while (cursor < to) {
          const inner = program.getUint8(cursor++);

          if (inner === 0x2d) {
            break;
          }

          cursor = this.skip(inner, program, cursor);
        }

        this.functions.set(index, { at: start, end: cursor - 1, program });

        return cursor;
      }

      case 0x2d:
        // ENDF, which `run` only reaches at the end of a called function.
        return to;

      case 0x2b: {
        // CALL
        const index = this.pop();

        this.callFunction(index);

        return at;
      }

      case 0x2a: {
        // LOOPCALL
        const index = this.pop();
        let count = this.pop();

        while (count-- > 0) {
          this.callFunction(index);
        }

        return at;
      }

      /* -- conditionals -- */

      case 0x58: {
        // IF
        if (this.pop()) {
          return at;
        }

        return this.skipToElse(program, at, to);
      }

      case 0x1b: // ELSE
        return this.skipToEnd(program, at, to);

      case 0x59: // EIF
        return at;

      /* -- jumps -- */

      case 0x1c: {
        const offset = this.pop();

        return at - 1 + offset;
      }

      case 0x78:
      case 0x79: {
        const condition = this.pop();
        const offset = this.pop();

        const taken = opcode === 0x78 ? condition : !condition;

        return taken ? at - 1 + offset : at;
      }

      default:
        return this.performGeometry(opcode, program, at, to);
    }
  }

  /**
   * The instructions that move points.
   *
   * Kept apart from the rest because they are where the graphics state
   * actually gets used, and because they are the ones whose absence matters:
   * everything above can be got right in isolation, and these cannot.
   */
  performGeometry(opcode, program, at, to) {
    const state = this.state;

    // MDAP, with and without rounding.
    if (opcode === 0x2e || opcode === 0x2f) {
      const index = this.pop();
      const zone = this.zone(state.zp0);

      const current = this.project(zone.x[index], zone.y[index]);
      const distance = opcode === 0x2f ? this.round(current) - current : 0;

      this.movePoint(zone, index, distance);

      state.rp0 = index;
      state.rp1 = index;

      return at;
    }

    // IUP, which carries the untouched points along with the touched ones.
    if (opcode === 0x30 || opcode === 0x31) {
      this.interpolateUntouched(opcode === 0x31);

      return at;
    }

    // MIAP, with and without rounding.
    if (opcode === 0x3e || opcode === 0x3f) {
      const value = this.pop();
      const index = this.pop();
      const zone = this.zone(state.zp0);

      let distance = this.cvtAt(value);

      /* A twilight point has no outline behind it, so this does not move it --
       * it puts it there, in both the position it is at and the position it is
       * remembered as having started from. That second half matters: a later
       * instruction measuring the original distance from this point would
       * otherwise measure from the origin, because that is where an untouched
       * twilight point has always been.
       */
      if (state.zp0 === 0) {
        zone.x[index] = Math.round((distance * state.projection.x) / UNIT);
        zone.y[index] = Math.round((distance * state.projection.y) / UNIT);

        zone.originalX[index] = zone.x[index];
        zone.originalY[index] = zone.y[index];

        /* A twilight point has no design coordinates of its own, so its scaled
         * position stands in for them. `IP` only ever divides one by another,
         * so the units cancel as long as they agree.
         */
        zone.unscaledX[index] = zone.x[index];
        zone.unscaledY[index] = zone.y[index];
      }

      const current = this.project(zone.x[index], zone.y[index]);

      if (opcode === 0x3f) {
        if (Math.abs(distance - current) > state.controlCutIn) {
          distance = current;
        }

        distance = this.round(distance);
      }

      this.movePoint(zone, index, distance - current);

      state.rp0 = index;
      state.rp1 = index;

      return at;
    }

    // GC: how far along the projection vector a point sits.
    if (opcode === 0x46 || opcode === 0x47) {
      const index = this.pop();
      const zone = this.zone(state.zp2);

      this.push(
        opcode === 0x46
          ? this.project(zone.x[index], zone.y[index])
          : this.projectDual(zone.originalX[index], zone.originalY[index])
      );

      return at;
    }

    // SCFS: put a point at a given coordinate along the projection vector.
    if (opcode === 0x48) {
      const value = this.pop();
      const index = this.pop();
      const zone = this.zone(state.zp2);

      this.movePoint(zone, index, value - this.project(zone.x[index], zone.y[index]));

      return at;
    }

    // MD: the distance between two points, as they are now or as they were.
    if (opcode === 0x49 || opcode === 0x4a) {
      const second = this.pop();
      const first = this.pop();

      const zoneOne = this.zone(state.zp1);
      const zoneTwo = this.zone(state.zp0);

      this.push(
        opcode === 0x49
          ? this.project(zoneTwo.x[first] - zoneOne.x[second], zoneTwo.y[first] - zoneOne.y[second])
          : this.projectDual(
              zoneTwo.originalX[first] - zoneOne.originalX[second],
              zoneTwo.originalY[first] - zoneOne.originalY[second]
            )
      );

      return at;
    }

    // ALIGNRP: bring points onto the reference point's own coordinate.
    if (opcode === 0x3c) {
      let count = state.loop;

      const zoneZero = this.zone(state.zp0);
      const zoneOne = this.zone(state.zp1);

      while (count-- > 0) {
        const index = this.pop();

        // The point from the reference point, negated: the reference's order.
        const distance = -this.project(
          zoneOne.x[index] - zoneZero.x[state.rp0],
          zoneOne.y[index] - zoneZero.y[state.rp0]
        );

        this.movePoint(zoneOne, index, distance);
      }

      state.loop = 1;

      return at;
    }

    // ALIGNPTS: bring two points to the same place, meeting in the middle.
    if (opcode === 0x27) {
      const second = this.pop();
      const first = this.pop();

      /* The first point off the stack is the second one named, and it lives in
       * the second zone; the one under it lives in the first. Having them the
       * other way round makes no difference while the two zones are the same,
       * which is every use of this in the recorded set, and is wrong the moment
       * a program points them somewhere different.
       */
      const zoneOne = this.zone(state.zp1);
      const zoneZero = this.zone(state.zp0);

      const distance = this.project(
        zoneOne.x[second] - zoneZero.x[first],
        zoneOne.y[second] - zoneZero.y[first]
      );

      /* Halved by a shift, so an odd gap closes unevenly rather than leaving
       * both points half a sixty-fourth off the grid: the first point takes the
       * smaller half and the second takes whatever is left of the gap.
       *
       * Which way an odd gap leans is half of a sixty-fourth, which is below
       * what the advance can report even magnified, so this is read from the
       * scaler rather than measured out of Windows.
       */
      const half = distance >> 1;

      this.movePoint(zoneZero, first, half);
      this.movePoint(zoneOne, second, half - distance);

      return at;
    }

    // SHPIX: shift points by an outright number of pixels.
    if (opcode === 0x38) {
      const amount = this.pop();

      let count = state.loop;

      while (count-- > 0) {
        const index = this.pop();
        const zone = this.zone(state.zp2);

        if (state.freedom.x !== 0) {
          zone.x[index] += Math.round((amount * state.freedom.x) / UNIT);
          zone.touchedX[index] = true;
        }

        if (state.freedom.y !== 0) {
          zone.y[index] += Math.round((amount * state.freedom.y) / UNIT);
          zone.touchedY[index] = true;
        }
      }

      state.loop = 1;

      return at;
    }

    // SHP: shift points by however far a reference point has already moved.
    if (opcode === 0x32 || opcode === 0x33) {
      const { dx, dy } = this.referenceShift(opcode === 0x33);

      let count = state.loop;

      while (count-- > 0) {
        const index = this.pop();
        const zone = this.zone(state.zp2);

        /* Touched because the point was free to move, not because it ended up
         * moving. A reference point that has not shifted leaves the amount at
         * nought, and the points it shifts are still touched by having been
         * shifted -- so `IUP` leaves them alone afterwards either way.
         */
        if (state.freedom.x !== 0) {
          zone.x[index] += dx;
          zone.touchedX[index] = true;
        }

        if (state.freedom.y !== 0) {
          zone.y[index] += dy;
          zone.touchedY[index] = true;
        }
      }

      state.loop = 1;

      return at;
    }

    // SHC: the same, to every point of a contour.
    if (opcode === 0x34 || opcode === 0x35) {
      const contour = this.pop();
      const shift = this.referenceShift(opcode === 0x35);

      const zone = this.zone(state.zp2);

      const from = contour === 0 ? 0 : zone.ends[contour - 1] + 1;
      const to = zone.ends[contour] ?? zone.length - 1;

      for (let index = from; index <= to; index++) {
        /* The point everything is being measured from does not move with the
         * rest. It has already been put where it belongs, and shifting it by
         * its own displacement would move it that far again.
         */
        if (index === shift.index && zone === shift.zone) {
          continue;
        }

        if (state.freedom.x !== 0) {
          zone.x[index] += shift.dx;
          zone.touchedX[index] = true;
        }

        if (state.freedom.y !== 0) {
          zone.y[index] += shift.dy;
          zone.touchedY[index] = true;
        }
      }

      return at;
    }

    // SHZ: the same again, to a whole zone.
    if (opcode === 0x36 || opcode === 0x37) {
      this.pop();

      const shift = this.referenceShift(opcode === 0x37);
      const zone = this.zone(state.zp2);

      const held = { x: zone.x[shift.index], y: zone.y[shift.index] };

      /* The outline and nothing after it. The phantom points sit past the last
       * contour's end and are not part of the zone as far as this is concerned,
       * so shifting a zone does not move the letter's width.
       */
      const to = zone.ends.length > 0 ? zone.ends[zone.ends.length - 1] : zone.length - 1;

      for (let index = 0; index <= to; index++) {
        if (state.freedom.x !== 0) {
          zone.x[index] += shift.dx;
        }

        if (state.freedom.y !== 0) {
          zone.y[index] += shift.dy;
        }
      }

      /* The reference point is put back rather than skipped, which comes to the
       * same thing, and unlike shifting a contour this marks nothing as
       * touched -- so `IUP` still has the whole zone to interpolate.
       */
      if (zone === shift.zone) {
        zone.x[shift.index] = held.x;
        zone.y[shift.index] = held.y;
      }

      return at;
    }

    // IP: place points proportionally between two references.
    if (opcode === 0x39) {
      let count = state.loop;

      const zoneZero = this.zone(state.zp0);
      const zoneOne = this.zone(state.zp1);

      /* The proportion is taken between the two references, and **in design
       * units rather than in the scaled originals**.
       *
       * The scaled originals have already been quantised to sixty-fourths of a
       * pixel, and interpolating a ratio out of two quantised numbers loses
       * exactly the precision the ratio needed. Design units have not been
       * quantised at all -- there are 2,048 of them to the em -- so the
       * proportion comes out right and only the result is rounded.
       */
      /* The design x stretched into the dual projection's domain, and the
       * projection left unrounded; see `MDRP` and `projectDesign`. */
      const design = (zone, index) =>
        this.projectDesign(zone.unscaledX[index] * this.stretch, zone.unscaledY[index]);

      const originalOne = design(zoneZero, state.rp1);
      const originalTwo = design(zoneOne, state.rp2);

      /* Arranged as the reference arranges it, which matters once a half can
       * round two ways. The two references' current span is one projection of
       * their difference; each point's design offset from the first reference
       * is scaled into that span by `MulDiv26Dot6`; and the move is that less
       * the projection of the point's current offset from the first reference.
       * A point outside the two is carried on the same line -- extrapolated,
       * which a readout of Times New Roman's `8` settled. The reference
       * projects the design offset with the *current* vector in this general
       * case; this keeps the dual, see the note at `projectDesign`. */
      const oldRange = originalTwo - originalOne;
      const span = this.project(
        zoneOne.x[state.rp2] - zoneZero.x[state.rp1],
        zoneOne.y[state.rp2] - zoneZero.y[state.rp1]
      );

      while (count-- > 0) {
        const index = this.pop();
        const zone = this.zone(state.zp2);

        const offset = this.projectDesign(
          (zone.unscaledX[index] - zoneZero.unscaledX[state.rp1]) * this.stretch,
          zone.unscaledY[index] - zoneZero.unscaledY[state.rp1]
        );

        const wanted = oldRange === 0 ? this.toPixels(offset) : mulDiv(span, offset, oldRange);

        const current = this.project(
          zone.x[index] - zoneZero.x[state.rp1],
          zone.y[index] - zoneZero.y[state.rp1]
        );

        this.movePoint(zone, index, wanted - current);
      }

      state.loop = 1;

      return at;
    }

    // MSIRP: move a point to a given distance from the reference point.
    if (opcode === 0x3a || opcode === 0x3b) {
      const distance = this.pop();
      const index = this.pop();

      const zoneOne = this.zone(state.zp1);
      const zoneZero = this.zone(state.zp0);

      const current = this.project(
        zoneOne.x[index] - zoneZero.x[state.rp0],
        zoneOne.y[index] - zoneZero.y[state.rp0]
      );

      this.movePoint(zoneOne, index, distance - current);

      state.rp1 = state.rp0;
      state.rp2 = index;

      if (opcode === 0x3b) {
        state.rp0 = index;
      }

      return at;
    }

    /* The delta instructions: a list of exceptions, each saying that at one
     * particular size a point or a control value wants nudging by a fraction
     * of a pixel. This is where a font's designer fixes what the rest of the
     * program gets wrong at one size and one size only.
     */
    if (opcode === 0x5d || opcode === 0x71 || opcode === 0x72) {
      const band = { 0x5d: 0, 0x71: 16, 0x72: 32 }[opcode];

      /* Along the freedom vector, by the same rule every other move obeys.
       *
       * A delta's nudge is a distance along the *projection* vector, and the
       * point travels along freedom to achieve it -- which where the two are at
       * an angle is further, and can be the other way. Adding the nudge to the
       * coordinate is only right where the two vectors are the same axis, which
       * is where every delta in the recorded corpus happens to be.
       */
      this.eachDelta(this.popPairs(), band, (amount, index) => {
        this.movePoint(this.zone(state.zp0), index, amount);
      });

      return at;
    }

    if (opcode === 0x73 || opcode === 0x74 || opcode === 0x75) {
      const band = { 0x73: 0, 0x74: 16, 0x75: 32 }[opcode];

      this.eachDelta(this.popPairs(), band, (amount, index) => {
        this.cvt[index] =
          (this.cvt[index] ?? 0) + (this.stretch === 1 ? amount : fixDiv(amount, this.cvtScale()));
      });

      return at;
    }

    // MDRP: move a point a rounded distance from the reference point.
    if (opcode >= 0xc0 && opcode <= 0xdf) {
      const index = this.pop();

      const zoneOne = this.zone(state.zp1);
      const zoneZero = this.zone(state.zp0);

      /* Measured in design units and scaled once, not measured on coordinates
       * that were scaled already.
       *
       * The two are the same number until the rounding is looked at. A
       * projection is a difference of two products, and doing it on values that
       * have each been rounded to a sixty-fourth already keeps whatever those
       * two roundings left behind; doing it in design units and scaling the
       * answer rounds once. Where the vector is nearly at right angles to the
       * line being measured the projection is a small remainder of two large
       * numbers, and the difference is the whole of it -- Courier New's `w`
       * measures a sixty-fourth this way and nought the other.
       *
       * A twilight point has no design coordinates and neither does a
       * composite, and for both of those the scaled ones stand in, which is the
       * same rule that governs `IP` and `IUP`.
       */
      const design =
        state.zp0 !== 0 && state.zp1 !== 0 && !this.composite
          ? scaleToPixels(
              /* The design vector belongs to the square domain and the dual
               * projection to the stretched one, so the design x is stretched
               * before it is projected. At a stretch of one this is the line
               * above it; under a width it is what put the top of Times New
               * Roman's N diagonal three pixels out, read off a readout of
               * that point at every width. */
              this.projectDesign(
                (zoneOne.unscaledX[index] - zoneZero.unscaledX[state.rp0]) * this.stretch,
                zoneOne.unscaledY[index] - zoneZero.unscaledY[state.rp0]
              ),
              this.pixels,
              this.font.unitsPerEm
            )
          : null;

      const original =
        design ??
        this.projectDual(
          zoneOne.originalX[index] - zoneZero.originalX[state.rp0],
          zoneOne.originalY[index] - zoneZero.originalY[state.rp0]
        );

      let distance = opcode & 0x04 ? this.round(original, Hinter.compensation(opcode)) : original;

      /* The minimum distance keeps a feature from collapsing, and it takes its
       * sign from the outline rather than from the rounded distance.
       *
       * That distinction only shows when the rounding lands on exactly zero,
       * and then it decides which side of the reference point the feature ends
       * up on. Asking whether the rounded distance is negative gets it wrong in
       * precisely that case -- zero is not negative -- so a point to the left
       * of its reference is pushed a whole pixel to the right of it, and the
       * feature is not merely the wrong size but inside out.
       *
       * It is also a clamp and not a magnitude test: a distance already past
       * the minimum in the wrong direction is brought back to the minimum on
       * the outline's side, not left where it is.
       *
       * Times New Roman's guillemet at eleven pixels per em is the case that
       * shows it. The left side bearing is hinted by a `MIRP` whose control
       * value rounds to zero; the point belongs a fifth of a pixel left of its
       * reference and this put it a pixel to the right, which moved the origin
       * two pixels and made the glyph two pixels narrow. **Measured** against
       * `hdmx`, which is what says the sign is the outline's.
       */
      if (opcode & 0x08) {
        if (original >= 0) {
          distance = Math.max(distance, state.minimumDistance);
        } else {
          distance = Math.min(distance, -state.minimumDistance);
        }
      }

      const current = this.project(
        zoneOne.x[index] - zoneZero.x[state.rp0],
        zoneOne.y[index] - zoneZero.y[state.rp0]
      );

      this.movePoint(zoneOne, index, distance - current);

      state.rp1 = state.rp0;
      state.rp2 = index;

      if (opcode & 0x10) {
        state.rp0 = index;
      }

      return at;
    }

    // MIRP: the same, but the distance comes from the control value table.
    if (opcode >= 0xe0) {
      const value = this.pop();
      const index = this.pop();

      const zoneOne = this.zone(state.zp1);
      const zoneZero = this.zone(state.zp0);

      let distance = this.cvtAt(value);

      /* A twilight point being measured to has no outline behind it either, so
       * it is placed at the control value from the reference point before
       * anything is measured -- the same rule `MIAP` follows, and for the same
       * reason: an untouched twilight point has always been at the origin, so
       * the distance from one would otherwise be whatever the reference point
       * happens to be rather than what was asked for.
       */
      if (state.zp1 === 0) {
        zoneOne.originalX[index] =
          zoneZero.originalX[state.rp0] + Math.round((distance * state.projection.x) / UNIT);
        zoneOne.originalY[index] =
          zoneZero.originalY[state.rp0] + Math.round((distance * state.projection.y) / UNIT);

        zoneOne.x[index] = zoneOne.originalX[index];
        zoneOne.y[index] = zoneOne.originalY[index];

        // The same stand-in as `MIAP` uses; see there.
        zoneOne.unscaledX[index] = zoneOne.originalX[index];
        zoneOne.unscaledY[index] = zoneOne.originalY[index];
      }

      const original = this.projectDual(
        zoneOne.originalX[index] - zoneZero.originalX[state.rp0],
        zoneOne.originalY[index] - zoneZero.originalY[state.rp0]
      );

      /* Auto flip: the control value is a size, not a direction. A stem is a
       * stem whichever side of the reference point it lies, and the table
       * states its width once; the sign has to come from the outline.
       *
       * Skipping this barely shows in the vertical direction, where nearly
       * every distance is upward and positive anyway, and wrecks the
       * horizontal one, where a glyph's points sit on both sides of the
       * reference and half the distances are negative. The letter comes out
       * narrow because half its points were fitted to the wrong side.
       */
      if (state.autoFlip && distance !== 0 && original !== 0 && distance < 0 !== original < 0) {
        distance = -distance;
      }

      /* The cut-in: where the outline's own distance is close enough to what
       * the table says, the table wins; where it is far off, the font is doing
       * something the table was not written for and the outline wins. It only
       * applies within one zone -- across two there is nothing to compare.
       */
      if (state.zp0 === state.zp1 && Math.abs(distance - original) >= state.controlCutIn) {
        distance = original;
      }

      if (opcode & 0x04) {
        distance = this.round(distance, Hinter.compensation(opcode));
      }

      /* The minimum distance keeps a feature from collapsing, and it takes its
       * sign from the outline rather than from the rounded distance.
       *
       * That distinction only shows when the rounding lands on exactly zero,
       * and then it decides which side of the reference point the feature ends
       * up on. Asking whether the rounded distance is negative gets it wrong in
       * precisely that case -- zero is not negative -- so a point to the left
       * of its reference is pushed a whole pixel to the right of it, and the
       * feature is not merely the wrong size but inside out.
       *
       * It is also a clamp and not a magnitude test: a distance already past
       * the minimum in the wrong direction is brought back to the minimum on
       * the outline's side, not left where it is.
       *
       * Times New Roman's guillemet at eleven pixels per em is the case that
       * shows it. The left side bearing is hinted by a `MIRP` whose control
       * value rounds to zero; the point belongs a fifth of a pixel left of its
       * reference and this put it a pixel to the right, which moved the origin
       * two pixels and made the glyph two pixels narrow. **Measured** against
       * `hdmx`, which is what says the sign is the outline's.
       */
      if (opcode & 0x08) {
        if (original >= 0) {
          distance = Math.max(distance, state.minimumDistance);
        } else {
          distance = Math.min(distance, -state.minimumDistance);
        }
      }

      const current = this.project(
        zoneOne.x[index] - zoneZero.x[state.rp0],
        zoneOne.y[index] - zoneZero.y[state.rp0]
      );

      this.movePoint(zoneOne, index, distance - current);

      state.rp1 = state.rp0;
      state.rp2 = index;

      if (opcode & 0x10) {
        state.rp0 = index;
      }

      return at;
    }

    throw new Unsupported(`opcode 0x${opcode.toString(16)}`);
  }

  /** A unit vector along -- or across -- a line, in F2Dot14. */
  unitVector(dx, dy, perpendicular) {
    const length = Math.sqrt(dx * dx + dy * dy);

    if (!length) {
      return { x: UNIT, y: 0 };
    }

    /* Made a unit vector first and turned afterwards, which is the order the
     * scaler does it in -- it normalises the line and the instruction that
     * wanted a right angle rotates the result. Turning first and normalising
     * after is the same vector and not always the same rounding, since a
     * component landing on an exact half goes one way as a positive and the
     * other as a negative.
     */
    const x = Math.round((dx / length) * UNIT);
    const y = Math.round((dy / length) * UNIT);

    return perpendicular ? { x: -y, y: x } : { x, y };
  }

  /** How far the reference point of a shift has already moved. */
  referenceShift(useRp1) {
    const state = this.state;

    const zone = useRp1 ? this.zone(state.zp0) : this.zone(state.zp1);
    const index = useRp1 ? state.rp1 : state.rp2;

    /* How far the reference point has moved *along the projection vector*, and
     * then that distance laid back out along the freedom vector.
     *
     * Not the displacement itself. The two are the same thing while the point
     * moved along an axis that both vectors lie on, which is every upright
     * face's stem work, and they part company as soon as the vectors are at an
     * angle to each other -- which is what a slanted face does all day.
     *
     * It is the same arithmetic `movePoint` does with a distance: the component
     * along the projection is what is being carried, and the freedom vector
     * says which way the carrying goes.
     */
    const carried = this.project(
      zone.x[index] - zone.originalX[index],
      zone.y[index] - zone.originalY[index]
    );

    const { freedom, projection } = this.state;

    let along = mulDiv(projection.x, freedom.x, UNIT) + mulDiv(projection.y, freedom.y, UNIT);

    if (Math.abs(along) < UNIT / 16) {
      along = along < 0 ? -UNIT : UNIT;
    }

    return {
      dx: freedom.x === 0 ? 0 : mulDiv(carried, freedom.x, along),
      dy: freedom.y === 0 ? 0 : mulDiv(carried, freedom.y, along),
      zone,
      index,
    };
  }

  /**
   * Takes a delta instruction's exceptions off the stack, deepest first.
   *
   * Each exception is two words: the packed argument underneath and the point
   * or control value it applies to on top. They come off in the order they
   * were pushed rather than the order they are read, because the reading is a
   * search over the whole list and the search cares where each one sits.
   */
  popPairs() {
    const pairs = [];

    for (let count = this.pop(); count > 0; count--) {
      const index = this.pop();
      const argument = this.pop();

      pairs.unshift([argument, index]);
    }

    return pairs;
  }

  /**
   * Applies the exceptions in a delta list that are meant for this size.
   *
   * The argument packs the size and the nudge into one byte: the high nibble
   * says which size, counted from the delta base, and the low nibble says how
   * far to move in steps of a fraction the delta shift sets.
   *
   * This is not a scan of the list. Windows looks the size up, halving its way
   * down the list as if it were sorted, and then reads forward only until it
   * meets a size past the one it wants. A list that is not sorted by size can
   * therefore hide exceptions that are plainly in it -- and does: the same
   * sixteen exceptions applied in `delta-ascending` and skipped entirely in
   * `delta-descending`, which is a difference no scan could produce. So the
   * search is not an optimisation to see through, it is the behaviour.
   *
   * The halving keeps its step even so that it always lands on an argument and
   * never on the point beside it, and stops while the step is still two, which
   * leaves the last pair or two to the reading forward.
   */
  eachDelta(pairs, band, move) {
    const state = this.state;

    /* The size a delta is keyed on is the one along the projection vector,
     * as `MPPEM` answers it -- the reference's delta engine says "same as
     * itrp_MPPEM ()" and scales the same way. Under a width request that is
     * the horizontal size for an `x` delta, and Windows's round letters gain
     * a row at exactly the widths where it lands on an exception. */
    const size = this.sizeAlong() - (state.deltaBase + band);

    // Outside the sixteen sizes this band covers, nothing in the list can be
    // meant for us and the list is never looked at.
    if (size < 0 || size >= 16) {
      return;
    }

    const wanted = size << 4;

    /* Counted in stack words, the way Windows counts, so that the evenness the
     * halving depends on is the evenness of the code it came from.
     */
    const high = pairs.length << 1;

    let aim = 0;
    let step = (high >> 1) & ~1;

    while (step > 2) {
      const at = (aim + step) >> 1;

      if (at < pairs.length && (pairs[at][0] & ~0x0f) < wanted) {
        aim += step;
      }

      step = (step >> 1) & ~1;
    }

    for (let word = aim; word < high; word += 2) {
      const [argument, index] = pairs[word >> 1];
      const at = argument & ~0x0f;

      if (at > wanted) {
        // Past the size we want. In a sorted list nothing further can match.
        break;
      }

      if (at < wanted) {
        continue;
      }

      let steps = (argument & 0x0f) - 8;

      // There is no zero step: the range skips it, so the upper half shifts
      // down.
      if (steps >= 0) {
        steps += 1;
      }

      /* A shift, not a division. The two agree while the shift is small enough
       * for the step to come out whole, which is every shift a font sets; past
       * that a shift floors and so rounds a negative step away from a positive
       * one of the same size.
       */
      move((steps * ONE) >> state.deltaShift, index);
    }
  }

  /**
   * Whether glyph programs run at this size at all.
   *
   * A font can say no, from `prep`, through `INSTCTRL`. Courier New says no
   * below nine pixels per em -- at eight its stems are a third of a pixel wide
   * and its serifs a sixth, and grid-fitting them means rounding every one of
   * them up to a whole pixel and drawing a letter made entirely of features
   * that are three times too heavy. The font would rather be blurred than
   * shouted, and says so.
   *
   * It is the only path in any installed font that reaches `INSTCTRL`, and no
   * other measurement we have could have found it: Arial and Times are
   * answered by a strike below twelve pixels, so eight pixels per em is a size
   * only Courier New is ever asked to draw.
   */
  get gridFit() {
    return !(this.defaults?.instructionControl & 1);
  }

  /**
   * Whether the scan converter should rescue dropouts at this size.
   *
   * Read after the programs have run, since `prep` sets it and a glyph program
   * may set it again. Only the size condition is implemented: the other two ask
   * about rotated and stretched text, and this draws neither.
   */
  get dropout() {
    const control = this.scanControl ?? 0;

    // Bit 11 turns it off above the size, and outranks bit 8 turning it on.
    if (control & 0x800 && this.ppem > (control & 0xff)) {
      return false;
    }

    return !!(control & 0x100) && this.ppem <= (control & 0xff);
  }

  /** Runs a defined function. */
  callFunction(index) {
    const body = this.functions.get(index);

    if (!body) {
      throw new Unsupported(`function ${index}`);
    }

    this.run(body.program, body.at, body.end);
  }

  /** How many bytes an instruction occupies, for scanning past it. */
  skip(opcode, program, at) {
    if (opcode === 0x40 || opcode === 0x41) {
      const count = program.getUint8(at++);

      return at + count * (opcode === 0x41 ? 2 : 1);
    }

    if (opcode >= 0xb0 && opcode <= 0xb7) {
      return at + (opcode - 0xb0) + 1;
    }

    if (opcode >= 0xb8 && opcode <= 0xbf) {
      return at + (opcode - 0xb8 + 1) * 2;
    }

    return at;
  }

  /** Finds the ELSE or EIF that belongs to an IF that was not taken. */
  skipToElse(program, at, to) {
    let depth = 0;
    let cursor = at;

    while (cursor < to) {
      const opcode = program.getUint8(cursor++);

      if (opcode === 0x58) {
        depth++;
      } else if (opcode === 0x59) {
        if (depth === 0) {
          return cursor;
        }

        depth--;
      } else if (opcode === 0x1b && depth === 0) {
        return cursor;
      }

      cursor = this.skip(opcode, program, cursor);
    }

    return to;
  }

  /** Finds the EIF that closes the block an ELSE opened. */
  skipToEnd(program, at, to) {
    let depth = 0;
    let cursor = at;

    while (cursor < to) {
      const opcode = program.getUint8(cursor++);

      if (opcode === 0x58) {
        depth++;
      } else if (opcode === 0x59) {
        if (depth === 0) {
          return cursor;
        }

        depth--;
      }

      cursor = this.skip(opcode, program, cursor);
    }

    return to;
  }

  /**
   * Carries the untouched points along with the touched ones.
   *
   * A program moves a handful of points -- the edges of stems, mostly -- and
   * `IUP` moves everything between them proportionally, so that a curve
   * between two moved points keeps its shape instead of being left behind.
   */
  interpolateUntouched(horizontal) {
    const zone = this.zones[1];

    const current = horizontal ? zone.x : zone.y;
    const original = horizontal ? zone.originalX : zone.originalY;
    const design = horizontal ? zone.unscaledX : zone.unscaledY;
    const touched = horizontal ? zone.touchedX : zone.touchedY;

    let from = 0;

    for (const end of zone.ends) {
      const anchors: number[] = [];

      for (let index = from; index <= end; index++) {
        if (touched[index]) {
          anchors.push(index);
        }
      }

      if (anchors.length === 0) {
        from = end + 1;
        continue;
      }

      /* One anchor moves the whole contour with it: there is nothing to
       * interpolate between, so everything keeps its shape and shifts.
       */
      if (anchors.length === 1) {
        const shift = current[anchors[0]] - original[anchors[0]];

        for (let index = from; index <= end; index++) {
          if (!touched[index]) {
            current[index] = original[index] + shift;
          }
        }

        from = end + 1;
        continue;
      }

      for (let slot = 0; slot < anchors.length; slot++) {
        const left = anchors[slot];
        const right = anchors[(slot + 1) % anchors.length];

        // The run between two anchors, wrapping round the end of the contour.
        let index = left === end ? from : left + 1;

        while (index !== right) {
          /* Only the untouched ones. A point the program moved deliberately
           * must not be dragged back by the points either side of it, which
           * is what interpolating over it would do -- and would undo most of
           * the fitting the program just did.
           */
          if (!touched[index]) {
            this.interpolateOne(index, left, right, current, original, design);
          }

          index = index === end ? from : index + 1;
        }
      }

      from = end + 1;
    }
  }

  /**
   * Places one untouched point between two touched ones.
   *
   * Two frames at once, which is the part that is not guessable. The reference
   * takes its ratio from the glyph's **design** coordinates -- `oox`, the
   * original originals -- and everything else from the **scaled** ones: which
   * anchor is the low one, whether this point lies between them, and what a
   * point outside them is shifted by. A composite glyph is the exception and
   * uses the scaled coordinates for the ratio as well, which does not arise
   * here since composites are not hinted.
   *
   * A point outside the anchors keeps its scaled position and moves by however
   * far the nearer anchor moved. It is not extrapolated -- that is `IP`'s rule,
   * not this one, and the two instructions genuinely differ.
   *
   * The division rounds by adding half the divisor and truncating, which is the
   * reference's `lTemp += lOrigCorr; lTemp /= lOrigDelta` on a signed integer.
   */
  interpolateOne(index, left, right, current, scaled, design) {
    // Which anchor is the lower is decided in design units, and the scaled
    // bounds follow that choice rather than being sorted again.
    const ascending = design[left] < design[right];
    const low = ascending ? left : right;
    const high = ascending ? right : left;

    const designLow = design[low];
    const designSpan = design[high] - design[low];

    const movedLow = current[low] - scaled[low];

    if (designSpan === 0) {
      current[index] += movedLow;

      return;
    }

    const value = scaled[index];

    if (value > scaled[low] && value < scaled[high]) {
      const span = current[high] - current[low];
      const half = designSpan >> 1;

      current[index] =
        current[low] + Math.trunc(((design[index] - designLow) * span + half) / designSpan);

      return;
    }

    current[index] = value + (value >= scaled[high] ? current[high] - scaled[high] : movedLow);
  }
}
