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
const ONE = 64;

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
  }

  get length() {
    return this.x.length;
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
  constructor(font, ppem, roundPhantoms = true) {
    this.font = font;
    this.ppem = ppem;
    this.roundPhantoms = roundPhantoms;
    this.scale = ppem / font.unitsPerEm;

    /* The size in the units distances are kept in, so a scaling is one whole
     * multiply and divide rather than a float in the middle of it.
     */
    this.pixels = ppem * ONE;

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

  /** The control value table, in pixels rather than in font units. */
  scaledControlValues() {
    const values: number[] = [];

    if (!this.font.has('cvt ')) {
      return values;
    }

    const table = this.font._tables['cvt '];

    for (let at = 0; at + 1 < table.length; at += 2) {
      const units = this.font._view.getInt16(table.offset + at, false);

      values.push(scaleToPixels(units, this.pixels, this.font.unitsPerEm));
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
  hint(outline, advance, leftSideBearing, xMin, program, at, length) {
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
    const shift = leftSideBearing - xMin;

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
    const toward = (value: number, by: number) =>
      Math.sign(value) * Math.ceil(Math.abs(value) / by - 0.5) * by;

    const bearing = toward(shift * this.pixels, this.font.unitsPerEm) / this.font.unitsPerEm;

    const whole = toward(bearing, ONE);

    for (const contour of outline) {
      for (const point of contour) {
        zone.x.push(this.toPixels(point.x) + bearing - whole);
        zone.y.push(this.toPixels(point.y));
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
    const width =
      origin + (this.roundPhantoms ? grid(this.toPixels(advance)) : this.toPixels(advance));

    const phantom = [
      { x: origin, y: 0 },
      { x: width, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
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
      { x: 0, y: 0 },
      { x: 0, y: 0 },
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

    this.zones[1] = zone;
    this.zones[0] = new Zone(this.font.maxTwilight ?? 16);

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
    const last = zone.x.length;

    this.advance = Math.round((zone.x[last - 3] - zone.x[last - 4]) / ONE);

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

    let index = 0;

    for (const contour of outline) {
      const shape: any[] = [];

      for (let point = 0; point < contour.length; point++) {
        shape.push({
          x: (zone.x[index] + whole) / ONE,
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
    return mulDiv(x, this.state.projection.x, UNIT) + mulDiv(y, this.state.projection.y, UNIT);
  }

  /** The same, against the vector the original outline is measured with. */
  projectDual(x, y) {
    return mulDiv(x, this.state.dual.x, UNIT) + mulDiv(y, this.state.dual.y, UNIT);
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
        this.push(this.cvt[this.pop()] ?? 0);
        return at;

      case 0x44: {
        // WCVTP, in pixels
        const value = this.pop();
        const index = this.pop();

        this.cvt[index] = value;

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
        this.push(this.ppem);
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

        const vector = this.unitVector(
          zoneTwo.x[first] - zoneOne.x[second],
          zoneTwo.y[first] - zoneOne.y[second],
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
                zoneTwo.originalX[first] - zoneOne.originalX[second],
                zoneTwo.originalY[first] - zoneOne.originalY[second],
                perpendicular
              );

        return at;
      }

      case 0x0f: {
        /* ISECT: put a point where two lines cross.
         *
         * Five point numbers: the one to move, then the two ends of the line it
         * should land on, then the two ends of the line that crosses it. The
         * point goes to the intersection by Cramer's rule, and is touched in
         * both directions because it has been placed rather than shifted.
         *
         * Where the two lines are nearly parallel the intersection runs off to
         * somewhere useless, so a near-parallel pair falls back to the midpoint
         * of the two midpoints. The test compares the cross product against the
         * dot product, which stand in for the sine and cosine of the angle
         * between them, and the factor of nineteen is the reference's.
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

        const bx = zoneB.x[secondB] - zoneB.x[firstB];
        const by = zoneB.y[secondB] - zoneB.y[firstB];
        const ax = zoneA.x[secondA] - zoneA.x[firstA];
        const ay = zoneA.y[secondA] - zoneA.y[firstA];
        const dx = zoneB.x[firstB] - zoneA.x[firstA];
        const dy = zoneB.y[firstB] - zoneA.y[firstA];

        zone.touchedX[index] = true;
        zone.touchedY[index] = true;

        /* Parallel means parallel, not nearly.
         *
         * This used to take the midpoint whenever the two lines were within
         * about three degrees of each other, on an unexplained factor of
         * nineteen. The reference divides unless its denominator is exactly
         * nought -- `if (D)` -- and takes the midpoint only then, so a pair of
         * lines that nearly miss put the point a long way off and Windows lets
         * them. Being faithful about that is the point of the exercise; being
         * defensive about it is a different program.
         *
         * Nothing measurable moves either way: every fixture scores the same to
         * the pixel, which is what a near-parallel `ISECT` not arising in any of
         * them looks like.
         */
        const cross = mulDiv(ax, -by, ONE) + mulDiv(ay, bx, ONE);

        if (cross !== 0) {
          const reach = mulDiv(dx, -by, ONE) + mulDiv(dy, bx, ONE);

          zone.x[index] = zoneA.x[firstA] + mulDiv(reach, ax, cross);
          zone.y[index] = zoneA.y[firstA] + mulDiv(reach, ay, cross);
        } else {
          zone.x[index] =
            (zoneA.x[firstA] + zoneA.x[secondA] + zoneB.x[firstB] + zoneB.x[secondB]) / 4;
          zone.y[index] =
            (zoneA.y[firstA] + zoneA.y[secondA] + zoneB.y[firstB] + zoneB.y[secondB]) / 4;
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

      let distance = this.cvt[value] ?? 0;

      /* A twilight point has no outline behind it, so this does not move it --
       * it puts it there, in both the position it is at and the position it is
       * remembered as having started from. That second half matters: a later
       * instruction measuring the original distance from this point would
       * otherwise measure from the origin, because that is where an untouched
       * twilight point has always been.
       */
      if (state.zp0 === 0) {
        zone.x[index] = Math.round((distance * state.freedom.x) / UNIT);
        zone.y[index] = Math.round((distance * state.freedom.y) / UNIT);

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

        const distance = this.project(
          zoneZero.x[state.rp0] - zoneOne.x[index],
          zoneZero.y[state.rp0] - zoneOne.y[index]
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

      const zoneOne = this.zone(state.zp1);
      const zoneZero = this.zone(state.zp0);

      const distance = this.project(
        zoneZero.x[second] - zoneOne.x[first],
        zoneZero.y[second] - zoneOne.y[first]
      );

      this.movePoint(zoneOne, first, distance / 2);
      this.movePoint(zoneZero, second, -distance / 2);

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

        zone.x[index] += dx;
        zone.y[index] += dy;

        if (dx) {
          zone.touchedX[index] = true;
        }

        if (dy) {
          zone.touchedY[index] = true;
        }
      }

      state.loop = 1;

      return at;
    }

    // SHC: the same, to every point of a contour.
    if (opcode === 0x34 || opcode === 0x35) {
      const contour = this.pop();
      const { dx, dy } = this.referenceShift(opcode === 0x35);

      const zone = this.zone(state.zp2);

      const from = contour === 0 ? 0 : zone.ends[contour - 1] + 1;
      const to = zone.ends[contour] ?? zone.length - 1;

      for (let index = from; index <= to; index++) {
        zone.x[index] += dx;
        zone.y[index] += dy;
      }

      return at;
    }

    // SHZ: the same again, to a whole zone.
    if (opcode === 0x36 || opcode === 0x37) {
      this.pop();

      const { dx, dy } = this.referenceShift(opcode === 0x37);
      const zone = this.zone(state.zp2);

      for (let index = 0; index < zone.length; index++) {
        zone.x[index] += dx;
        zone.y[index] += dy;
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
      const design = (zone, index) =>
        this.projectDual(zone.unscaledX[index], zone.unscaledY[index]);

      const originalOne = design(zoneZero, state.rp1);
      const originalTwo = design(zoneOne, state.rp2);

      const currentOne = this.project(zoneZero.x[state.rp1], zoneZero.y[state.rp1]);
      const currentTwo = this.project(zoneOne.x[state.rp2], zoneOne.y[state.rp2]);

      // Design units into pixels, for a point that falls outside the two.
      const scaled = (value) => this.toPixels(value);

      while (count-- > 0) {
        const index = this.pop();
        const zone = this.zone(state.zp2);

        const original = design(zone, index);

        const current = this.project(zone.x[index], zone.y[index]);

        /* Outside the two references the point is **extrapolated**, on the
         * same line as one between them.
         *
         * This used to hold the point's distance from the nearer reference and
         * carry it along rigidly, on the strength of `cvt[2]` in Times New
         * Roman coming out a thirty-second of a pixel high when extrapolated,
         * which was enough to round a `W`'s cap height the wrong way. That
         * reading was of the ink, two roundings downstream of the decision, and
         * it was wrong about the cause.
         *
         * **Recorded**, by making the `8` report where its own waist ended up.
         * At fourteen pixels the two references are 13 design units apart and 6
         * of a pixel apart, and point 26 sits 481 design units past the first:
         * `135 + 481 * 6 / 13` is 357, which is what Windows reports to the
         * sixty-fourth. Every readable size of both waist points agrees, where
         * before none of them did, and the recorded letters go from
         * thirty-three records and fifty-eight pixels to twenty-five and
         * thirty-five.
         *
         * The degenerate case still shifts: two references at the same original
         * position give no ratio to scale by.
         */
        let wanted;

        if (originalTwo === originalOne) {
          wanted = currentOne + scaled(original - originalOne);
        } else {
          wanted =
            currentOne +
            mulDiv(original - originalOne, currentTwo - currentOne, originalTwo - originalOne);
        }

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

      this.eachDelta(this.popPairs(), band, (amount, index) => {
        const zone = this.zone(state.zp0);

        if (state.freedom.x !== 0) {
          zone.x[index] += amount;
          zone.touchedX[index] = true;
        }

        if (state.freedom.y !== 0) {
          zone.y[index] += amount;
          zone.touchedY[index] = true;
        }
      });

      return at;
    }

    if (opcode === 0x73 || opcode === 0x74 || opcode === 0x75) {
      const band = { 0x73: 0, 0x74: 16, 0x75: 32 }[opcode];

      this.eachDelta(this.popPairs(), band, (amount, index) => {
        this.cvt[index] = (this.cvt[index] ?? 0) + amount;
      });

      return at;
    }

    // MDRP: move a point a rounded distance from the reference point.
    if (opcode >= 0xc0 && opcode <= 0xdf) {
      const index = this.pop();

      const zoneOne = this.zone(state.zp1);
      const zoneZero = this.zone(state.zp0);

      const original = this.projectDual(
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

      let distance = this.cvt[value] ?? 0;

      /* A twilight point being measured to has no outline behind it either, so
       * it is placed at the control value from the reference point before
       * anything is measured -- the same rule `MIAP` follows, and for the same
       * reason: an untouched twilight point has always been at the origin, so
       * the distance from one would otherwise be whatever the reference point
       * happens to be rather than what was asked for.
       */
      if (state.zp1 === 0) {
        zoneOne.originalX[index] =
          zoneZero.originalX[state.rp0] + Math.round((distance * state.freedom.x) / UNIT);
        zoneOne.originalY[index] =
          zoneZero.originalY[state.rp0] + Math.round((distance * state.freedom.y) / UNIT);

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
    if (perpendicular) {
      const swap = dx;

      dx = -dy;
      dy = swap;
    }

    const length = Math.sqrt(dx * dx + dy * dy);

    if (!length) {
      return { x: UNIT, y: 0 };
    }

    return { x: Math.round((dx / length) * UNIT), y: Math.round((dy / length) * UNIT) };
  }

  /** How far the reference point of a shift has already moved. */
  referenceShift(useRp1) {
    const state = this.state;

    const zone = useRp1 ? this.zone(state.zp0) : this.zone(state.zp1);
    const index = useRp1 ? state.rp1 : state.rp2;

    return {
      dx: zone.x[index] - zone.originalX[index],
      dy: zone.y[index] - zone.originalY[index],
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

    const size = this.ppem - (state.deltaBase + band);

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
