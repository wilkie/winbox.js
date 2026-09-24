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
  declare boldOverhang: any;


  /* **And the shear is very probably not this at all.**
   *
   * Comparing every slanted cell of the four slant instruments against its own
   * upright cell says 338 of 384 are the upright cell with each row shifted by
   * whole columns -- and the shift steps every three rows, which is a lean of
   * one third applied to the *bitmap*, a row at a time, exactly as the `.FON`
   * faces are leaned at one half in `bitmap-font.ts`. At the two sizes where
   * Symbol resolves to its own strike instead of its outline the same recording
   * steps every two rows, which is that other rule showing up beside it.
   *
   * It accounts for what shearing the outline cannot. At twelve pixels Windows
   * inks a column whose sample point the sheared bar never covers at any slope,
   * and which no dropout can place; the slanted cell inks exactly the rows the
   * upright one does, every time; and a slope fitted to the ink gives ranges
   * that do not intersect. All three follow from there being no slope at all,
   * only a table of whole-column shifts.
   *
   * **It was implemented, and it is not right either.** Drawing the glyph
   * upright and shifting the rows of the result by `floor((baseline + c - row)
   * / 3)`, swept over every origin `c` from -4 to 3, is worse than shearing the
   * outline at every one of them: 1,665 wrong pixels on the four instruments'
   * 384 slanted cells at its best, against about 460 for what is here.
   *
   * The reason is in `corner-phase`, whose bars differ only in side bearing and
   * height. Fitting the shift table per glyph, `symbol-slant` -- where every
   * glyph is the same bar -- gives one table per size and nothing else
   * (`K` = 2, 3, 6, 11, 13 at 8, 10, 12, 15 and 20 pixels, with the strike sizes
   * 13 and 16 fitting none of it, as they should). But no single table fits all
   * twelve of `corner-phase`'s bars at any size, and those differ in *where they
   * sit across the pixel*. A shear that shifts whole rows cannot care about
   * that. So the ink is consistent with a row shift for any one glyph without
   * being a row shift.
   *
   * What survives is everything the shift table explained -- the row set being
   * identical to the upright's, ink in pixels whose sample points are never
   * covered, slopes that do not intersect -- and none of it is explained by a
   * shear of this outline either.
   *
   * **And that is now proved rather than inferred.** `slant-baked` writes this
   * shear into the outline -- the same parallelogram `slant` builds, to the font
   * unit, at the same device coordinates -- and asks for it upright. Windows
   * draws it exactly as we do, 88 cells and no wrong pixels. Then the same shape
   * arrived at by asking Windows to lean the rectangle comes back different.
   *
   * `slant-angle` then bakes that bar at twelve leans from a fifth to nine
   * twentieths, tan 20 degrees among them, and all 88 of those cells are exact
   * too -- so the recording is a readout of what Windows draws for a hairline at
   * any lean. **None of the twelve matches the synthesised cell at twelve or at
   * fifteen pixels**, and no one lean matches at every size. The twelve pixel
   * cell says why in a line: its top row is two pixels wide and the bar is 0.703
   * px across, and no parallelogram that narrow covers two sample points on any
   * row at any angle. Windows' synthesised glyph is wider than the bar it came
   * from, and a shear does not widen anything.
   *
   * So this constant is the best straight line through something that is not a
   * straight line. See `FONTS.md` section 3.
   */

  declare _backcolor: any;

  /* `OPAQUE`, which is what a fresh device context starts at. `TRANSPARENT` is
   * one; see `SetBkMode`. */
  backMode: number = 2;

  /* `TA_LEFT | TA_TOP`, which is what a fresh device context starts at and the
   * one combination that cannot show the others. See `SetTextAlign`. */
  textAlign: number = 0;

  /* The colour outline text is drawn in, where something has said: `null`
   * draws black, which is what every probe before `rotstyle` asked for.
   * `SetTextColor` does not reach this yet -- it sets `forecolor`, which a
   * fresh surface starts white for reasons of its own. */
  textColor: any = null;

  /* The gap added after every character, which starts at none -- the one value
   * that cannot show itself. See `SetTextCharacterExtra`. */
  charExtra: number = 0;
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

  /** Set while `extText` draws the characters of a run one at a time. */
  declare _runOnly: any;
  declare _view: any;
  constructor(canvas) {
    this._canvas = canvas;
    this._ditherer = new Ditherer();
    this._data = {};

    // TODO: what are the default pen/brush?
    this.brush = new Brush(new Color(0xff, 0xff, 0xff, 0xff));
    this.pen = new Pen(new Color(0x00, 0x00, 0x00, 0xff));
    /* White, which is what a fresh device context's background colour is.
     *
     * It was black here, and harmless while the text drawing painted its cell
     * white whatever the colour said. Honouring the colour makes the default
     * visible, and Windows' default is white -- every probe that draws text
     * without touching `SetBkColor` comes back on a white ground.
     */
    this.backcolor = new Color(0xff, 0xff, 0xff, 0xff);
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

  /**
   * The underline and the strikeout, which GDI draws and the glyph does not.
   *
   * Both run from the pen to the end of the string's advance and are filled
   * solid, and both take their place and their thickness from the **font**
   * where the font has an answer:
   *
   *     underline   `post`'s position, negated, below the baseline
   *                 `post`'s thickness
   *     strikeout   `OS/2`'s position above the baseline
   *                 `OS/2`'s size
   *
   * scaled at the size and rounded, with a thickness of at least one row. The
   * three outline families say very different things -- Arial -217 and 150,
   * Courier New -477 and 84 -- and every row of `rules` follows them.
   *
   * A strike has no such tables, and its underline sits **one row below the
   * baseline** whatever the size, with a thickness that follows the cell.
   *
   * **Recorded.** `oracle/probes/rules.c` draws four kinds of face at seven
   * sizes with each rule on and off; before this nothing had ever drawn either,
   * and the corpus carried them only through what `GetTextMetrics` reports.
   */
  /**
   * The cell behind the text, painted before the text is.
   *
   * In the background colour, and only where the background mode says to paint
   * it at all. This painted it **white** whatever `SetBkColor` had been told,
   * and painted it whatever the mode, and both were invisible until something
   * asked: every probe before `textbk` left the colour white and the mode
   * `OPAQUE`, and a white rectangle on a white cell is indistinguishable from
   * no rectangle at all. See `FONTS.md` 8o.
   */
  /**
   * The ascent of whatever is selected, which the style holds for an outline
   * face and the strike's own file for a raster one.
   *
   * A stretched strike has it scaled the way `GetTextMetrics` scales it: the
   * design value carried to the cell being drawn and rounded on its own.
   */
  ascentOf() {
    const font: any = this._font;
    const style = (font && font.style) ?? {};

    if (font.outline) {
      return style.ascent ?? 0;
    }

    const header = entryOf(font).header;
    const scale = font.scale ?? 1;

    return scale === 1
      ? header.dfAscent
      : Math.round((header.dfAscent * Math.round(header.dfPixHeight * scale)) / header.dfPixHeight);
  }

  /** The internal leading of a strike, scaled the way its ascent is. */
  internalOf() {
    const font: any = this._font;

    if (font.outline) {
      return 0;
    }

    const header = entryOf(font).header;
    const scale = font.scale ?? 1;

    return scale === 1
      ? header.dfInternalLeading
      : Math.round(
          (header.dfInternalLeading * Math.round(header.dfPixHeight * scale)) / header.dfPixHeight
        );
  }

  /**
   * Where the point handed to `TextOut` puts the text.
   *
   * `SetTextAlign` names it: left, centre or right across, and top, bottom or
   * baseline down. **Measured** by `textalin`, which draws in the middle of the
   * cell so that a shift has somewhere to go -- right moves the text left by
   * the whole advance, centre by half of it truncated, bottom moves it up by
   * the cell and baseline by the ascent.
   */
  /**
   * A polygon filled the way GDI fills one for a display driver that takes
   * only scanlines. 8u.
   *
   * **Read out of `GDI.EXE`.** A VGA reports `POLYGONALCAPS` 8, scanlines
   * alone, so `Polygon` never reaches the driver: at `seg24:06e3` GDI finds the
   * driver cannot take it, brackets its own conversion with `Output` begin and
   * end, and converts at `0bcb`. Every edge that is not horizontal runs from
   * its upper point down to, but not including, its lower one; `030e` sets it
   * up as a Bresenham with its major axis the longer of the two, an error term
   * `2 * minor - major + bias`, and a bias of one except for an edge whose
   * major axis is `y` and which steps left, which gets nothing. Each row, the
   * active edges' `x` are sorted and handed to the driver in pairs, each pair
   * half-open; then each edge steps -- one pixel at most for a `y`-major edge,
   * while its error is positive, and for an `x`-major one at least one pixel
   * and on while the error stays at or below nought.
   *
   * **Recorded** by `polyfill`, 117 quadrilaterals under both fill modes -- a
   * rectangle turned every five degrees, bands two and three pixels thick, and
   * the corners of every turned ground `rotstyle` drew: **234 of 234** exact.
   *
   * What is not here: the winding rule, and what `094f` does with two edges
   * meeting at a vertex, neither of which a convex quadrilateral can ask.
   */
  fillPolygon(points, color) {
    const edges: any[] = [];

    for (let index = 0; index < points.length; index++) {
      const a = points[index];
      const b = points[(index + 1) % points.length];

      if (a[1] === b[1]) {
        continue;
      }

      const [upper, lower] = a[1] < b[1] ? [a, b] : [b, a];
      const dx = lower[0] - upper[0];
      const dy = lower[1] - upper[1];
      const yMajor = Math.abs(dx) <= dy;
      const major = yMajor ? dy : Math.abs(dx);
      const minor = yMajor ? Math.abs(dx) : dy;
      const bias = yMajor ? (dx >= 0 ? 1 : 0) : 1;

      edges.push({
        x: upper[0],
        top: upper[1],
        bottom: lower[1],
        step: Math.sign(dx),
        yMajor,
        error: 2 * minor - major + bias,
        up: 2 * minor,
        down: 2 * minor - 2 * major,
      });
    }

    if (!edges.length) {
      return;
    }

    const rgba = [color.red, color.green, color.blue, 0xff];
    const top = Math.min(...edges.map((edge) => edge.top));
    const bottom = Math.max(...edges.map((edge) => edge.bottom));

    for (let y = top; y < bottom; y++) {
      const xs = edges.filter((edge) => y >= edge.top && y < edge.bottom).map((edge) => edge.x);

      xs.sort((one, other) => one - other);

      for (let index = 0; index + 1 < xs.length; index += 2) {
        for (let x = xs[index]; x < xs[index + 1]; x++) {
          if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
            this.context.setPixel(x, y, rgba);
          }
        }
      }

      for (const edge of edges) {
        if (y < edge.top || y >= edge.bottom || edge.step === 0) {
          continue;
        }

        if (edge.yMajor) {
          if (edge.error > 0) {
            edge.x += edge.step;
            edge.error += edge.down;
          } else {
            edge.error += edge.up;
          }
        } else {
          edge.error += edge.down;
          edge.x += edge.step;

          while (edge.error <= 0) {
            edge.x += edge.step;
            edge.error += edge.up;
          }
        }
      }
    }

    this._stale = true;
  }

  /** The escapement's sine and cosine as the placement takes them. */
  turnedTrig() {
    const radians = ((this._font as any).escapement * Math.PI) / 1800;
    const fixed = (value) => Math.round(value * 65536) / 65536;

    return { sine: fixed(Math.sin(radians)), cosine: fixed(Math.cos(radians)) };
  }

  /** Whether text drawn now is turned: an outline face with an escapement. */
  get turnedText() {
    return this._font instanceof LogicalFont && !!this._font.outline && !!this._font.escapement;
  }

  /**
   * The alignment of turned text, in the text's own frame. 8u.
   *
   * `across` is how far along the baseline the reference point moves the
   * string back -- its width for `TA_RIGHT`, half of it for `TA_CENTER` -- and
   * `down` is how far the baseline sits below the reference point: the ascent
   * for `TA_TOP`, nothing for `TA_BASELINE`, and minus the descent for
   * `TA_BOTTOM`. **Recorded** by `rotstyle`: Windows turns the alignment with
   * the text, so `TA_CENTER` at a right angle slides the string down its own
   * baseline, not across the page.
   */
  turnedAlign(text, runWidth = null) {
    const font: any = this._font;
    const width = runWidth ?? font.measure(text).width;
    const across = this.textAlign & 6;
    const down = this.textAlign & 24;

    return {
      across: across === 2 ? -width : across === 6 ? -Math.floor(width / 2) : 0,
      down: down === 8 ? -font.style.descent : down === 24 ? 0 : font.style.ascent,
      bottom: down === 8,
    };
  }

  aligned(x, y, text, runWidth = null) {
    if (this.turnedText) {
      return [x, y];
    }

    if (!this.textAlign) {
      return [x, y];
    }

    const metrics = { ...this._font.measure(text), width: runWidth ?? this._font.measure(text).width };
    const across = this.textAlign & 6;
    const down = this.textAlign & 24;

    if (across === 2) {
      x -= metrics.width;
    } else if (across === 6) {
      x -= Math.floor(metrics.width / 2);
    }

    if (down === 8) {
      y -= metrics.height;
    } else if (down === 24) {
      y -= this.ascentOf();
    }

    return [x, y];
  }

  /**
   * The cell behind the text, painted before the text is.
   *
   * It runs from the pen for the string's advance -- except where a glyph
   * reaches past it, and then it reaches with the glyph. `groundbx` draws four
   * faces at every cell from eight to forty-eight in the background's own
   * colour, so that the glyph adds nothing and what comes back is the rectangle
   * alone: nineteen of the outline cells are wider than the advance, and Courier
   * New above a cell of thirty-six starts a column to the **left** of the pen,
   * where its serifs do.
   *
   * The box is the one the buffer gate already counts -- the fitted outline's
   * extremes carried to pixels and rounded to the nearest column, which is what
   * `columns` is measured as in `outlineText` -- united with the advance. A
   * strike never needs it: MS Sans Serif and the System font are the advance at
   * every one of their cells, and their glyphs never leave it.
   *
   * **Measured**, and **not finished**: the union takes `groundbx` to 565 of
   * its 656 and `textbk` to 63 of 64, and the 91 that are left are nearly all a
   * single column short on the right, of an outline face, and most of them of
   * `l` -- a bar whose advance is wider than its ink, so the box does not reach
   * and the advance decides. Arial's `l` agrees at cells of 10, 11, 12 and 14
   * and is a column short at 13 and at every cell from 15 to 21, which is not a
   * threshold in the size.
   *
   * Refused, by count, each measured through the whole pipeline: the outline's
   * extremes floored and ceiled rather than rounded, 536 of 656 against 565;
   * the design advance carried across the size and rounded **up**, alone or
   * united with the rest, which takes `textbk` from 63 to 61.
   */
  groundBox(text, dx = null, inkOnly = false) {
    const font: any = this._font;
    const outline = font.outline;

    const metrics = font.measure(text);
    const characters = [...String(text)];

    /* A synthesised bold's widths each carry a pixel, and GDI's opaque
     * rectangle is those widths summed (`GDI.EXE` seg1 `63b9`, the widths from
     * `6874`). On a device with `TC_EA_DOUBLE` it is `6b73`'s pixel; on one
     * without, it is the character extra GDI's own bold raises while it draws
     * (seg16 `0070`) -- one pixel either way. Turned text on a device with it
     * has both, which `ground` adds. **Recorded** by `smeargnd`. */
    const boldPixel = outline && this.synthesisesBold() ? 1 : 0;

    const advanceOf = (character) =>
      (font.outlineAdvance ? font.outlineAdvance(character.charCodeAt(0)) : metrics.width) + boldPixel;

    /* A strike is the advance, and with an array it is the pens the array
     * makes plus the **last glyph's own advance** -- which is where the two
     * kinds of face part company, because an outline face takes the array's own
     * sum. **Measured** by `groundrn`: MS Sans Serif at a cell of sixteen with
     * twenty and twenty is painted over twenty-nine and Arial over forty.
     */
    if (!outline) {
      if (!dx || characters.length === 0) {
        return { left: 0, right: metrics.width, height: metrics.height };
      }

      let width = 0;

      for (let index = 0; index < characters.length - 1; index++) {
        width += dx[index] + this.charExtra;
      }

      width += font.measure(characters[characters.length - 1]).width;

      return { left: 0, right: width, height: metrics.height };
    }

    const scale = font.ppem / outline.unitsPerEm;
    const stretch = font instanceof LogicalFont ? font.stretch : 1;

    let left = 0;
    let right = 0;
    let pen = 0;
    let first: any = null;

    for (let index = 0; index < characters.length; index++) {
      const character = characters[index];
      const glyph = outline.cmap.get(character.charCodeAt(0)) ?? 0;

      let fitted: any = null;

      try {
        fitted = outline.hintedOutline(glyph, font.ppem, true, stretch);
      } catch {
        fitted = null;
      }

      const reach = fitted && fitted.contours ? fitted.contours.flat() : [];

      if (reach.length) {
        const up = fitted.scaled ? 1 : scale;

        if (first === null) {
          first = {
            bearing: Math.round(Math.min(...reach.map((p: any) => p.x)) * up),
            advance: advanceOf(character),
          };

          left = Math.min(0, first.bearing);
        }

        right = Math.max(right, pen + Math.round(Math.max(...reach.map((p: any) => p.x)) * up));
      }

      pen += dx ? dx[index] + this.charExtra : advanceOf(character);
    }

    /* The greatest of three: the **first** glyph's box -- its left edge plus its
     * own advance -- the furthest any glyph's ink reaches, and, where there is
     * more than one glyph, the run's own advance from the pen.
     *
     * **Measured** by `groundrn`, which sweeps four faces, ten cells and five
     * runs with the text painted in the background's own colour so that the
     * rectangle is all that comes back: all 90 of the outline records, left
     * edge and right.
     *
     * Only the first glyph's box, which is what the single character sweep of
     * 8o could not see. Arial's `l` at a cell of forty-eight advances ten and
     * bears three, and alone it is painted over thirteen; two of them are
     * painted over twenty, not twenty-three. The bearing enters once.
     *
     * And the run's advance enters only where there **is** a run. One glyph is
     * its own box and nothing else: Courier New's `W` at a cell of forty-four
     * advances twenty-five and bears minus one, and is painted over twenty-four
     * -- where two characters of the same face at a cell of twenty-four take
     * the whole of their advance and not the shifted one.
     */
    /* A run with no ink anywhere -- a space -- has no box to take, and it is
     * its advance. */
    if (inkOnly) {
      /* `ETO_OPAQUE` paints the glyphs' own boxes and not the run's rectangle:
       * Arial's `AB` at a cell of sixteen is painted over seventeen columns
       * under the flag and eighteen without it, and Courier New's at twenty
       * over nineteen against twenty. A strike is its advance either way,
       * because a strike's bitmap fills its own cell.
       */
      return { left, right, height: metrics.height };
    }

    right = Math.max(
      right,
      first === null || characters.length > 1 ? pen : 0,
      first ? first.bearing + first.advance : 0
    );

    return { left, right, height: metrics.height };
  }

  /**
   * How a distance in a turned font's own terms reaches the device where the
   * pixel is not square: one down the text is carried across by the
   * resolutions' ratio, and one along it down by the other, each ratio 256
   * times the quotient rounded and applied as a truncated multiply --
   * `GDI.EXE` seg1 `625b` makes them and seg8 `02c1` and `01f0` use them. On a
   * square pixel both are the identity.
   */
  aspectCarries() {
    const style = (this._font as any)?.style ?? {};
    const H = style.horizontalRes ?? 96;
    const V = style.verticalRes ?? 96;
    const across = Math.floor((256 * H + Math.floor(V / 2)) / V);
    const down = Math.floor((256 * V + Math.floor(H / 2)) / H);

    return {
      toAcross: (value) => (H === V ? value : Math.floor((value * across) / 256)),
      toDown: (value) => (H === V ? value : Math.floor((value * down) / 256)),
    };
  }

  /** Whether the selected outline face is being made bold by smearing. */
  synthesisesBold() {
    const style = (this._font as any)?.style ?? {};
    return !!(this._font as any)?.outline && (style.weight ?? 0) > 550 && !style.faceBold;
  }

  /** Whether the display driver has `TC_EA_DOUBLE`: the colour drivers do and
   * a Hercules does not, which is the same line `boldOverhang` draws. */
  devicePaintsBold() {
    return (this.boldOverhang ?? BitmapContext.driver?.boldOverhang) !== 'always';
  }

  /** Whether GDI draws a synthesised bold itself rather than leaving it to the
   * driver: when the driver cannot, or when the text is turned, since GDI
   * keeps every effect of turned text for a device that cannot turn text
   * (`GDI.EXE` seg1 `35b2`). */
  gdiDrawsBold() {
    return this.synthesisesBold() && (this.turnedText || !this.devicePaintsBold());
  }

  ground(x, y, text, runWidth = null) {
    if (this.backMode === 1 || this._runOnly) {
      return;
    }

    /* Where GDI draws the bold itself -- turned text, or any bold on a device
     * without `TC_EA_DOUBLE` -- an opaque ground is painted twice
     * (`GDI.EXE` seg16 `0030`). First GDI calls itself with the string swapped
     * for a single space (`ds:041e` in seg48) at the pen, opaque, and then
     * draws the string twice: at x + 1 keeping the opaque ground, and at x
     * transparent (`020a`, `0294`). So the ground is a space's ground at x and
     * the run's at x + 1. Turned on a device with `TC_EA_DOUBLE`, each
     * character also carries both the widths' pixel and the character extra
     * GDI raises for the duration (`0070`).
     *
     * **Recorded** by `smeargnd`: an opaque ground white on black behind plain
     * and smeared "AB", upright and turned, on a VGA and a Hercules.
     */
    if (this.gdiDrawsBold()) {
      this.groundOf(x, y, ' ', null);
      this.groundOf(x + 1, y, text, runWidth);
      return;
    }

    this.groundOf(x, y, text, runWidth);
  }

  groundOf(x, y, text, runWidth) {
    const box = this.groundBox(text);

    if (this.gdiDrawsBold() && this.turnedText && this.devicePaintsBold()) {
      box.right += [...String(text)].length;
    }

    /* Turned, the ground is `Polygon` with no pen: the ground rectangle turned,
     * its corners whole pixels -- the reference point, and that carried along
     * the baseline by the ground's width and down by the cell, each carry
     * rounded on its own. **Recorded** by `rotstyle` and `polyfill`: all
     * twelve turned grounds are pixel for pixel GDI's `Polygon` on exactly
     * those corners, and so is this. 8u.
     */
    if (this.turnedText) {
      const away = (value) => Math.sign(value) * Math.round(Math.abs(value));
      const { sine, cosine } = this.turnedTrig();
      const reference = this.turnedAlign(text, runWidth);
      const left = reference.across + box.left;
      const width = (runWidth ?? box.right - box.left);
      const down = reference.down - (this._font as any).style.ascent;
      const { toAcross, toDown } = this.aspectCarries();
      const originX = x + away(left * cosine) + away(toAcross(down) * sine);
      const originY = y - away(toDown(left) * sine) + away(down * cosine);
      const alongX = originX + away(width * cosine);
      const alongY = originY - away(toDown(width) * sine);

      this.fillPolygon(
        [
          [originX, originY],
          [alongX, alongY],
          [alongX + away(toAcross(box.height) * sine), alongY + away(box.height * cosine)],
          [originX + away(toAcross(box.height) * sine), originY + away(box.height * cosine)],
        ],
        this.backcolor
      );
      return;
    }

    this.context.fillStyle = this.backcolor.css;
    this.context.fillRect(x + box.left, y, box.right - box.left, box.height);
  }

  rules(x, y, text, runWidth = null) {
    const font: any = this._font;
    const style = (font && font.style) ?? {};

    if ((!style.underline && !style.strikeout) || (this._runOnly && runWidth === null)) {
      return;
    }

    const outline = font.outline;
    const ppem = font.ppem;
    const width = runWidth ?? font.measure(text).width;

    /* A strike keeps its ascent in the file rather than on the style, and a
     * stretched one has it scaled the way `GetTextMetrics` scales it -- the
     * design value carried to the cell being drawn and rounded on its own. */
    const header = outline ? null : entryOf(font).header;
    const cell = header ? Math.round(header.dfPixHeight * (font.scale ?? 1)) : 0;
    const ascent = this.ascentOf();

    const baseline = y + ascent;

    const across = (units) => Math.round((units * ppem) / outline.unitsPerEm);
    const thick = (rows) => Math.max(1, rows);

    this.context.fillStyle = 'black';

    /* A strike's rules are a twelfth of the cell thick, at least a row.
     *
     * **Measured** by `strikout` over every strike the installation has at
     * eighteen sizes -- 136 readings, 32 distinct realisations -- where the
     * thickness steps at cells of 24, 36 and 48. A sixteenth of the cell
     * rounded fits every one of them up to a cell of 45 and not the cell of 48,
     * which is the only one the earlier sweep never reached.
     */
    const strikeRows = thick(Math.floor(cell / 12));

    /* Turned, a rule is a line along the turned baseline, and each row of its
     * thickness is one. 8u.
     *
     * **Recorded** by `rotstyle`. At every angle Windows draws both ends: an
     * eighteen pixel run's underline is nineteen pixels long at a right angle
     * and at a half turn, fourteen diagonal pixels at half a right angle, and
     * seventeen at thirty degrees. The ends are the pen carried down to the
     * rule by *one* rounded vector -- the ascent and the rule's own offset
     * together, fourteen at Arial's cell of sixteen -- and then along the
     * baseline by the run's width, rounded again. Between them it is the
     * display driver's own line, ties and all.
     *
     * Only a rule one row thick has been recorded turned, and only at the
     * default alignment. A thicker one is drawn as that many lines a row apart
     * down the text, and another alignment carries the rule from the same
     * reference point as the glyphs; neither has been asked.
     */
    if (outline && this.turnedText) {
      const radians = (font.escapement * Math.PI) / 1800;
      const fixed = (value) => Math.round(value * 65536) / 65536;
      const away = (value) => Math.sign(value) * Math.round(Math.abs(value));
      const sine = fixed(Math.sin(radians));
      const cosine = fixed(Math.cos(radians));
      const reference = this.turnedAlign(text, runWidth);
      const startX = x + away(reference.across * cosine);
      const startY = y - away(reference.across * sine);
      const shift = reference.down - font.style.ascent;

      const ends = (down) => {
        const fromX = startX + away((shift + down) * sine);
        const fromY = startY + away((shift + down) * cosine);

        return [fromX, fromY, fromX + away(width * cosine), fromY - away(width * sine)];
      };

      const band = (down, rows) => {
        const first = ends(down);

        if (rows <= 1) {
          this.context.strokeStyle = this.textColor ? this.textColor.css : 'black';
          this.context.beginPath();
          this.context.excludeLast = false;
          this.context.moveTo(first[0], first[1]);
          this.context.lineTo(first[2], first[3]);
          this.context.stroke();
          return;
        }

        /* Thicker, it is `Polygon` drawn with a pen a pixel wide: the far
         * edge is the near one carried down by the thickness less one, the
         * inside is GDI's own fill, and the outline is the driver's lines. A
         * band one row thick is the same polygon collapsed onto its line.
         *
         * **Recorded** by `rotstyle`: carrying the far edge from the pen
         * rather than from the near edge puts Arial's two-row underline at
         * thirty degrees a pixel short on every row, and filling between two
         * lines without GDI's fill leaves a gap at half a right angle. */
        const [ax, ay, bx, by] = first;
        const shiftX = away((rows - 1) * sine);
        const shiftY = away((rows - 1) * cosine);
        const corners = [
          [ax, ay],
          [bx, by],
          [bx + shiftX, by + shiftY],
          [ax + shiftX, ay + shiftY],
        ];

        this.fillPolygon(corners, this.textColor ?? new Color(0, 0, 0));
        this.context.strokeStyle = this.textColor ? this.textColor.css : 'black';
        this.context.excludeLast = false;

        for (let index = 0; index < corners.length; index++) {
          const [fromX, fromY] = corners[index];
          const [toX, toY] = corners[(index + 1) % corners.length];

          this.context.beginPath();
          this.context.moveTo(fromX, fromY);
          this.context.lineTo(toX, toY);
          this.context.stroke();
        }
      };

      if (style.underline) {
        band(font.style.ascent + across(-outline.underlinePosition), thick(across(outline.underlineThickness)));
      }

      if (style.strikeout) {
        band(font.style.ascent - across(outline.strikeoutPosition), thick(across(outline.strikeoutSize)));
      }

      return;
    }

    if (style.underline) {
      const top = outline ? baseline + across(-outline.underlinePosition) : baseline + 1;
      const rows = outline ? thick(across(outline.underlineThickness)) : strikeRows;

      this.context.fillRect(x, top, width, rows);
    }

    if (style.strikeout) {
      /* A strike has no `OS/2` to ask, and the rule is a third of the way up
       * from the baseline to the top of the internal leading:
       *
       *     centre = (2 * ascent + internal leading) / 3, floored
       *
       * and the band is that row and the thickness grown **upward first** --
       * a thickness of two puts the centre at the bottom, three puts it in the
       * middle, four puts it second from the bottom. So the top is the centre
       * less half the thickness, floored.
       *
       * **Measured** by `strikout` on all 136 readings, with no exception:
       * Courier at a cell of 16 has no internal leading and rules at row 8,
       * MS Sans Serif at a cell of 20 has four rows of it and rules at 12, and
       * the two ascents are 13 and 16. A stretched strike is not the unstretched
       * one doubled -- MS Sans Serif at a cell of 40 rules at rows 23 to 25
       * where twice the cell-20 answer would be 24 and 25 -- it is this
       * arithmetic done again at the stretched numbers.
       */
      const top = outline
        ? baseline - across(outline.strikeoutPosition)
        : Math.floor((2 * ascent + this.internalOf()) / 3) - (strikeRows >> 1);

      const rows = outline ? thick(across(outline.strikeoutSize)) : strikeRows;

      this.context.fillRect(x, top, width, rows);
    }
  }

  /**
   * `ExtTextOut`'s rectangle, painted in the background colour.
   *
   * It is painted whatever the background mode says -- `TRANSPARENT` does not
   * stop it, which is the one thing the flag settles that the mode cannot. Its
   * right and bottom edges are **outside** it, the way a `RECT` always is.
   *
   * **Recorded** by `extout`: a rectangle of (4, 2) to (40, 22) comes back as
   * rows 2 to 21 and columns 4 to 39, under both modes.
   */
  paintGround(rect) {
    this.context.fillStyle = this.backcolor.css;
    this.context.fillRect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
    this._stale = true;
  }

  /**
   * Draws with everything outside a rectangle put back as it was.
   *
   * `ETO_CLIPPED` clips the whole drawing -- the ground the mode paints as well
   * as the glyphs -- and not just the ink. **Recorded**: the same request with
   * and without the flag differs only in that everything outside the rectangle
   * is gone, ground included.
   */
  withClip(box, draw) {
    if (!box) {
      draw();
      return;
    }

    /* A rectangle whose edges are the wrong way round is **normalised**, not
     * refused: (20, 6) to (10, 14) clips exactly as (10, 6) to (20, 14) does,
     * and so does (10, 14) to (20, 6). One whose edges are equal clips
     * everything away, which falls out of the comparison below.
     *
     * **Recorded** by `clipedge`, which walks each edge across the text a
     * column at a time and asks the degenerate rectangles on purpose.
     */
    const rect = {
      left: Math.min(box.left, box.right),
      right: Math.max(box.left, box.right),
      top: Math.min(box.top, box.bottom),
      bottom: Math.max(box.top, box.bottom),
    };

    const before = this.context.getImageData(0, 0, this.width, this.height);

    draw();

    const after = this.context.getImageData(0, 0, this.width, this.height);

    for (let row = 0; row < this.height; row++) {
      for (let column = 0; column < this.width; column++) {
        if (
          column >= rect.left &&
          column < rect.right &&
          row >= rect.top &&
          row < rect.bottom
        ) {
          continue;
        }

        const at = (row * this.width + column) * 4;

        for (let byte = 0; byte < 4; byte++) {
          after.data[at + byte] = before.data[at + byte];
        }
      }
    }

    this.context.putImageData(after, 0, 0);
    this._stale = true;
  }

  /**
   * One run of text with the pen moved by an array of advances.
   *
   * `ExtTextOut`'s last argument is one distance per character, and each is
   * what the pen moves by after that character rather than what the character
   * advances -- so the last of them is never used. The ground behind the run
   * and any rule under it run from the pen to the last character's own
   * advance past its own pen, which is to say the array decides where the
   * characters are and the font decides how far the run reaches.
   *
   * `SetTextCharacterExtra` is **added to** each of them rather than replaced
   * by them: three pixels of extra against an array of twenty puts the second
   * character twenty-three across.
   *
   * **Recorded** by `extout`, on a strike, an outline face and a fixed-pitch
   * outline face.
   */
  extText(x, y, text, dx, inkOnly = false) {
    const characters = [...String(text)];

    if ((!dx && !inkOnly) || characters.length === 0) {
      this.fillText(x, y, text);
      return;
    }

    const box = this.groundBox(text, dx, inkOnly);

    /* Turned, the run is one walk along the turned baseline, the array's
     * distances in place of the advances. */
    if (this.turnedText) {
      const advances = characters.map((character, index) =>
        dx ? dx[index] : this._font.measure(character).width
      );

      this.ground(x, y, text, box.right - box.left);
      this.outlineText(x, y, text, { advances, runWidth: box.right - box.left });
      this.rules(x, y, text, box.right - box.left);
      this._stale = true;
      return;
    }

    [x, y] = this.aligned(x, y, text, box.right - box.left);

    if (this.backMode !== 1) {
      this.context.fillStyle = this.backcolor.css;
      this.context.fillRect(x + box.left, y, box.right - box.left, box.height);
    }

    this._runOnly = true;

    let pen = x;

    for (let index = 0; index < characters.length; index++) {
      this.fillText(pen, y, characters[index]);
      pen += dx
        ? dx[index] + this.charExtra
        : this._font.measure(characters[index]).width + this.charExtra;
    }

    this._runOnly = false;

    this.rules(x, y, text, box.right - box.left);

    this._stale = true;
  }

  fillText(x, y, text) {
    // TODO: backcolor
    [x, y] = this.aligned(x, y, text);

    if (this._font instanceof LogicalFont && this._font.outline) {
      this.ground(x, y, text);
      this.outlineText(x, y, text);
      this.rules(x, y, text);
      this._stale = true;
      return;
    }

    if (this._font instanceof LogicalFont && this._font.isVector) {
      this.ground(x, y, text);
      this.strokeText(x, y, text);
      this.rules(x, y, text);
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

        /* The gap after every character; see `SetTextCharacterExtra`. */
        extra: this.charExtra,
      };

      // Fill the rectangle behind it
      const font = entryOf(this._font);

      this.ground(x, y, text);

      font.draw(this.context, x, y, text, options);
      this.rules(x, y, text);
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
  outlineText(x, y, text, run: any = {}) {
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
    const colour = this.textColor
      ? [this.textColor.red, this.textColor.green, this.textColor.blue, 0xff]
      : BitmapContext.toRGBA('black');

    const style = font.style ?? {};

    /* Nothing to synthesise where the family had the style as a file of its
     * own -- the glyphs are already bold, or already slanted.
     */
    /* Bold is synthesised above 550, not at 700.
     *
     * Swept every ten from 500 to 700 on Arial, Times New Roman, MS Sans Serif
     * and Symbol -- two faces with a bold file, a strike family, and an outline
     * face with no bold file -- the cell first changes at 560 on all four, so
     * 550 is drawn plainly and 560 is emboldened. What is emboldened is the
     * file the mapper chose, which is the regular one until 700; so at 600 the
     * regular outline is smeared, and at 700 the bold file is drawn as it is.
     * The weight sweep in the `styles` fixture is 720 of 720 with this rule and
     * 648 with the threshold at 700.
     */
    const bold = (style.weight ?? 0) > 550 && !style.faceBold;
    const italic = !!style.italic && !style.exactStyle;

    /* The angle the baseline runs at, 8u.
     *
     * Reduced to a turn already, and a whole turn reduces to nothing -- which
     * is measured rather than assumed. Every record `rotate` and `rotangle`
     * hold at a whole number of turns, 3600 and 7200 and 10800 and the two
     * negatives, is **pixel for pixel** what the upright machinery draws at
     * the turned size: same hinting, same advances, same placement. So a turn
     * changes the size the font is realised at and, at an angle of nothing,
     * changes nothing else.
     */
    const turn = (this._font instanceof LogicalFont ? this._font.escapement : 0) || 0;
    const radians = (turn * Math.PI) / 1800;

    /* The outline goes through a matrix whose entries are **whole pixels**:
     * the size times the cosine and the size times the sine, each rounded.
     * Not normalised afterwards, so an oblique glyph is scaled as well as
     * turned -- at half a right angle and twenty-six per em the entries are
     * eighteen and eighteen, and the em comes out 25.46 pixels across.
     *
     * **Measured** on `rot-square`, one plain square with no program, whose
     * box at an angle is the transform itself: 70 of its 91 oblique squares
     * exact with the entries rounded, 15 with the exact rotation, 21 with
     * the rounded pair normalised back to a unit. And it is what makes a small
     * angle draw exactly what nought draws: at fifteen per em the sine entry
     * of a tenth of a degree rounds to nothing, the matrix is the identity,
     * and Windows's Times at an escapement of one is ink for ink its whole
     * turn. Arial at twenty-nine per em changes at one degree and not at a
     * half, which is where twenty-nine times the sine crosses a half. The
     * steps in `rotsq`'s fine sweep, where the ink holds still across 43.0 to
     * 44.6 degrees and moves at 44.7 and 45.4, are the same thing: the matrix
     * is constant between them.
     */
    /* Each entry is the size times a sixteen-dot-sixteen cosine or sine,
     * rounded with a half going away from nought -- the same convention the
     * pen's carries use below. A double's sine of thirty degrees is a hair
     * under a half, and at thirty-three per em that decided `rotpen`'s ten
     * last squares the wrong way; see `Surface.turnEntries`. */
    const [entryCos, entrySin] = turn ? Surface.turnEntries(ppem, radians) : [ppem, 0];
    const cosine = entryCos / ppem;
    const sine = entrySin / ppem;

    /* Screen `y` runs down and the angle runs counter-clockwise, so a right
     * angle sends the text up the cell. **Recorded**: Arial at a cell of
     * sixteen drawn from the middle of a sixty-four square cell inks rows 15
     * to 31 at 900, columns 15 to 31 at 1800, and rows 32 to 48 at 2700.
     */
    const turned = (px, py) =>
      turn === 0 ? [px, py] : [px * cosine - py * sine, px * sine + py * cosine];

    /* Whether the scaler calls the glyph rotated, which is what `GETINFO`
     * answers a font's `prep` with. The scaler's own flag is for a transform
     * that is not a multiple of a right angle, and it is the *rounded* matrix
     * that is asked: a tenth of a degree at fifteen per em is the identity and
     * is not rotated. See `Hinter`'s `GETINFO` and FONTS.md 8u.
     */
    /* Whether the device's pixel is square, which a turn has to know.
     *
     * GDI builds a turned glyph's matrix in whole pixels -- the size times the
     * angle's cosine and sine, as on a square pixel -- and then, where the
     * font's `dfHorizRes` and `dfVertRes` differ, multiplies the two entries
     * that land across the page by their ratio: `(entry * H + V / 2) / V`,
     * the division truncating toward nought (`GDI.EXE` seg1 `6fa3`-`6fce`). So
     * the turn is done in physical space and stretched across afterwards, and
     * the rounding is not symmetric: at ninety degrees Arial's fourteen per em
     * is -18 across on a Hercules and at two hundred and seventy it is 19.
     *
     * **Recorded** by `rotherc`: every one of its 216 turned glyphs and pairs
     * on a Hercules is the right shape with this, against 16 at thirty degrees
     * and none at the right angles for the size rounded away from nought, and
     * fewer again for it truncated, rounded up, or left fractional.
     */
    const horizontalRes = (this._font as any)?.style?.horizontalRes ?? 96;
    const verticalRes = (this._font as any)?.style?.verticalRes ?? 96;
    const aspect = turn && outline ? horizontalRes / verticalRes : 1;
    const rotated = sine !== 0 && cosine !== 0;
    const turnMatrix = (() => {
      /* Only where the two differ: `6fa3` compares them first, and on a square
       * pixel the multiply would move a negative entry by the half it adds. */
      const across = (entry) =>
        horizontalRes === verticalRes
          ? entry
          : Math.trunc((entry * horizontalRes + Math.floor(verticalRes / 2)) / verticalRes);
      return [across(entryCos), entrySin, across(-entrySin), entryCos];
    })();

    /* Where the glyphs go is worked out along the exact angle, not the rounded
     * one, and in sixteen-dot-sixteen: the pen is carried to the baseline by
     * the ascent, and each glyph from there by the advances so far, and each
     * of those two carries is rounded to a whole pixel with a half going away
     * from nought.
     *
     * **Measured.** Along the rounded matrix instead, the letters are 474
     * wrong pixels against 234; from the unrounded baseline origin, `rotpen`'s
     * pairs are 131 of 272 and its triples 84; with every advance rounded as
     * it is taken, the triples are 141. The last seven of `rotpen`'s
     * disagreements about the walk were all at thirty, a hundred and twenty,
     * a hundred and fifty and three hundred and thirty degrees -- where a
     * sine or a cosine is exactly a half, and an odd advance lands on half a
     * pixel. A double's sine of thirty degrees is a hair under a half and
     * decides those ties by accident; a sixteen-dot-sixteen one is a half, and
     * rounding it away from nought is what Windows does. With that every one
     * of `rotpen`'s 816 records that disagrees does so in its first square
     * alone: 236 of 272 for one square, two and three alike.
     */
    const fixed = (value) => Math.round(value * 65536) / 65536;
    const away = (value) => Math.sign(value) * Math.round(Math.abs(value));
    const pathSine = fixed(Math.sin(radians));
    const pathCosine = turn ? fixed(Math.cos(radians)) : 1;

    /* Where the reference point is, in the text's own frame: `across` along
     * the baseline, from the alignment, and `down` from the reference point to
     * the baseline -- the ascent for `TA_TOP`, nothing for `TA_BASELINE`, the
     * descent back up for `TA_BOTTOM`. Upright these are what `aligned` moves
     * the pen by; turned, they turn with the text. See `Surface.turnedAlign`.
     */
    const reference = turn ? this.turnedAlign(text, run.runWidth) : { across: 0, down: font.style.ascent };
    const cell = font.style.ascent + font.style.descent;

    /* Each carry is rounded on its own -- the alignment's along the baseline
     * apart from the one down to it -- and `TA_BOTTOM`'s is two: down to the
     * baseline by the ascent as usual, and back up by the whole cell.
     *
     * **Recorded** by `rotstyle`. Rounding the alignment's carry together with
     * the ascent's loses `TA_CENTER` at half a right angle on every face, and
     * `TA_BOTTOM` carried as one vector of minus the descent is wrong at thirty
     * degrees, where three times the sine is minus one and a half: two carries,
     * seven less eight, make it minus one, which is where Windows puts it.
     */
    /* On a pixel that is not square a distance down the text is carried
     * across by the resolutions' ratio first, and one along it is carried down
     * by the other: `GDI.EXE` seg8 `02c1` and `01f0`, each ratio 256 times
     * the quotient rounded and applied as a truncated multiply. */
    const { toAcross, toDown } = this.aspectCarries();

    const downX = reference.bottom
      ? away(toAcross(font.style.ascent) * pathSine) - away(toAcross(cell) * pathSine)
      : away(toAcross(reference.down) * pathSine);
    const downY = reference.bottom
      ? away(font.style.ascent * pathCosine) - away(cell * pathCosine)
      : away(reference.down * pathCosine);

    const baseX = x + away(reference.across * pathCosine) + downX;
    const baseY = y - away(toDown(reference.across) * pathSine) + downY;

    let pen = x;
    let index = 0;
    const count = [...String(text)].length;

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
      const stretch = this._font instanceof LogicalFont ? this._font.stretch : 1;

      /* The horizontal size the lean is a third of, which is the *fractional*
       * one and not the whole one everything else here is measured at. See
       * `Surface.leanOf`.
       */
      const acrossPixels = this._font instanceof LogicalFont ? this._font.xPpem : ppem;

      /* A slant is drawn from the raw outline with no program run, and the
       * scale applied to it afterwards is the vertical one. Where the pixel is
       * not square that is only right down the page, so the design `x` is
       * carried across the stretch first -- the same thing `projectDesign`
       * does for a coordinate the program measures from. On a square pixel the
       * stretch is one and nothing moves.
       */
      /* An outline that reaches here in design units -- a slant, or a glyph
       * with no program to run -- is scaled afterwards by the vertical size,
       * and that is only right down the page. So its design `x` is carried
       * across the stretch first, the same thing `projectDesign` does for a
       * coordinate the program measures from. A glyph the program fitted comes
       * back in pixels and has the stretch in it already.
       */
      /* The stretch is folded into the sixty-fourth the raster rounds to, not
       * applied to the design coordinate and left to a second multiplication.
       *
       * `stretch` is `xWhole / ppem` and everything downstream multiplies by
       * `ppem / unitsPerEm` and rounds to a sixty-fourth, so the `ppem` cancels
       * and the true value is `x * xWhole * 64 / unitsPerEm` -- an integer over
       * a power of two, exact in a double. Multiplying by the two ratios one
       * after the other is not: `230 * (8/12) * (12/2048) * 64` is exactly 57.5
       * and comes out of the arithmetic as 57.49999999999999, which rounds the
       * wrong way and puts the point a sixty-fourth to the left.
       *
       * So the grid rounding happens here, on the exact product, and the value
       * is handed on already sitting on it -- which is idempotent, because
       * `slant` and `sixtyFourth` round to that same grid and find it already
       * there. Nothing about the model changes; only the arithmetic.
       *
       * **Measured**: it is the last two cells of the recorded glyph corpus,
       * `Symbol`'s slanted `m` and `y` at fifteen on both displays whose pixel
       * is not square, and it touches nothing on a square pixel, where the
       * stretch is one and this does not run at all.
       */
      const grid = (ppem * 64) / outline.unitsPerEm;
      const sideways = this._font instanceof LogicalFont ? this._font.xWhole : ppem;

      const across = (contours) =>
        stretch === 1
          ? contours
          : contours.map((contour) =>
              contour.map((point) => ({
                ...point,
                x: Math.round((point.x * sideways * 64) / outline.unitsPerEm) / grid,
              }))
            );

      /* A rotated glyph is not fitted, and it is the font that says so.
       *
       * Every installed family's `prep` asks `GETINFO` whether the glyph is
       * rotated, and told yes, all four switch grid-fitting off, set dropout
       * control on at every size and leave `SCANTYPE` unset. So a rotated
       * hinter runs `prep` and nothing after it -- the path Courier New's own
       * `INSTCTRL` already takes at eight per em -- and this passes it the
       * flag and lets the font decide. 8u.
       *
       * An earlier reading said a turned glyph *is* fitted, on the evidence
       * that an escapement of one draws what a whole turn draws. It does, and
       * for another reason: at fifteen per em that tenth of a degree rounds to
       * the identity matrix, which the scaler does not call rotated. Deciding
       * it from the angle rather than the matrix is what was wrong.
       */
      const raw = italic
        ? { contours: outline.outlineOf(glyph), hinted: false, scaled: false }
        : aspect !== 1 && !rotated
          ? /* A turn by right angles is still fitted, and the scaler fits it at
             * each row's own stretch -- the larger entry of the row -- which on
             * a pixel that is not square is not the upright stretch: at ninety
             * degrees the glyph's `x` is the size and its `y` the size across. */
            outline.hintedOutline(
              glyph,
              Math.max(Math.abs(turnMatrix[2]), Math.abs(turnMatrix[3])),
              true,
              Math.max(Math.abs(turnMatrix[0]), Math.abs(turnMatrix[1])) /
                Math.max(Math.abs(turnMatrix[2]), Math.abs(turnMatrix[3])),
              rotated
            )
          : outline.hintedOutline(glyph, ppem, true, stretch, rotated);

      /* A rotated glyph is carried through the scaler's own transform, from
       * the design outline, and arrives in pixels already turned. See
       * `Surface.turnOutline`. */
      /* A made-up slant turned goes through the same transform, with the
       * shear in the matrix rather than applied to the outline afterwards; see
       * `Surface.slantedTurn`. */
      const fitted = turn && italic
        ? {
            ...raw,
            hinted: true,
            scaled: true,
            turnedAlready: true,
            contours: Surface.transformOutline(
              outline.outlineOf(glyph),
              Surface.slantedTurn(entryCos, entrySin),
              outline.unitsPerEm
            ),
          }
        : rotated
        ? {
            ...raw,
            hinted: true,
            scaled: true,
            turnedAlready: true,
            contours: Surface.transformOutline(outline.outlineOf(glyph), turnMatrix, outline.unitsPerEm),
          }
        : raw.scaled
          ? raw
          : { ...raw, contours: across(raw.contours) };
      const contours = fitted.contours;

      /* A slanted glyph is carried across its side bearing in whole pixels.
       *
       * A hinted outline arrives already carried across the gap between its
       * stored left edge and its side bearing -- the phantom points see to it.
       * The raw outline the slant is drawn from has not been carried at all,
       * and Symbol is a face where that matters: every glyph in it is stored
       * from zero, with the bearing held apart, from twenty units for the
       * capitals to two hundred and forty for the digit one.
       *
       * **Read, not fitted.** `dot-bearing` holds one square still and walks
       * its bearing through eleven values either side of its edge; upright, the
       * box GDI hands the scan converter moves with the bearing to the
       * sixty-fourth, and slanted it moves by the bearing **rounded to a whole
       * pixel**, at every one of nine sizes. And the fifteen boxes the real
       * face still disagreed on were exactly the glyphs whose bearing rounds to
       * a pixel or more at that size, short by exactly that many columns.
       *
       * Rounded as a 26.6 quantity is rounded to a pixel, which is what puts
       * the period's 145 units at seven per em -- 31.7 sixty-fourths -- across
       * the half and into the next column, where Windows draws it.
       */
      /* The bearing in sixty-fourths, with a half going *down*.
       *
       * Two ties decide the direction and they pull opposite ways: alpha at
       * twelve per em has a bearing of exactly 31.5 sixty-fourths and Windows
       * carries it as nothing, while the period at seven per em has 31.72 and
       * is carried a whole pixel. Rounding the half up gives alpha 32, then a
       * half pixel, then one; truncating gives the period 31 and no pixel.
       * Only a half rounded down fits both. It is the one tie in the corpus,
       * and it is written down as that.
       */
      /* At the *horizontal* size, because a bearing is a distance across the
       * page. The two are the same number wherever the pixel is square, which
       * is where this was read; on an EGA Arial at sixteen pixels runs at
       * thirteen up and seventeen across, and carrying its slanted glyphs by
       * thirteen leaves every one of them a column to the left of where Windows
       * draws it.
       */
      const shift = Math.ceil(
        (outline.bearingShift(glyph) * ppem * stretch * 64) / outline.unitsPerEm - 0.5
      );

      /* An upright glyph that has no program of its own comes back from
       * `hintedOutline` exactly as stored, and so has not been carried across
       * its bearing either. A hinted outline already has, through its phantom
       * points, so only the raw case needs it here.
       *
       * **And below seven pixels per em the carry is a whole pixel.** GDI moves
       * the box with the bearing to the sixty-fourth at seven per em and above,
       * and by the bearing rounded to a pixel below that.
       *
       * The two readings are almost the same thing, which is why this took so
       * long to see. At eight per em they part company by two font units of
       * bearing and at twelve by less; only at six and seven are they far
       * enough apart for a sweep to land between them. `dot-fine` is
       * `dot-bearing`'s square with the bearing stepped four units at a time
       * across that gap, and the two sizes answer opposite ways:
       *
       *     ppem 6:  the box steps at a shift of 172 -- sixty-fourths say 259,
       *              whole pixels say 171
       *     ppem 7:  the box steps at a shift of 188 -- sixty-fourths say 186,
       *              whole pixels say 147
       *
       * **Recorded.** Against every upright box the stack probe has read off a
       * rewritten glyph -- 704 of them, ten dot instruments and eighteen cell
       * heights -- carrying in sixty-fourths throughout misses nine, all at six
       * per em; carrying in whole pixels throughout misses far more; and the
       * split at seven misses **none**. Putting the boundary at eight instead
       * costs sixteen and at nine seventeen, so the seven is measured and not
       * chosen.
       */
      const carried = italic
        ? Math.round(shift / 64)
        : fitted.hinted
          ? 0
          : ppem < 7
            ? Math.ceil((outline.bearingShift(glyph) * ppem) / outline.unitsPerEm - 0.5)
            : shift / 64;

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
      const raised = reach.length
        ? Math.round(Math.max(...reach.map((point: any) => point.y)) * up)
        : 0;

      /* And it is counted in sixty-fourths of a row, in sixteen signed bits,
       * so a glyph reaching more than five hundred and twelve rows above the
       * baseline wraps to a negative height and is always drawn.
       *
       * **Recorded**, and it is why the sweep stops being monotone. In
       * `buffer-times-buffer-sweep` the blocks are ordered by height, and up to
       * a cell of 138 Windows draws exactly the short ones -- and then the two
       * tallest blocks of the ten come back, first `r` at 142 and then `M` as
       * well at 170, while every block between them stays blank. Both cross at
       * the same place: `r` reaches 506 rows at 138 and 519 at 142, `M` 502 at
       * 166 and 513 at 170. Five hundred and twelve rows is 32,768
       * sixty-fourths, which is where a signed sixteen-bit number turns over.
       *
       * Written as the wrap rather than as a size test, so that it is the
       * arithmetic that is being reproduced and not its consequence.
       */
      const rows = (((raised + 512) % 1024) + 1024) % 1024 - 512;

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

      /* And what it is compared against is one cell of the *face*, a long wider
       * than the face is.
       *
       * The cell is the ascent plus the descent by `tmMaxCharWidth` -- the
       * font's own bounding box carried across the horizontal size, which is
       * the width GDI has on hand for a face it has selected -- padded to whole
       * longs and then given one more. So a glyph has to fit a bitmap of the
       * widest cell the face can produce, with a long to spare on each row.
       *
       * Two earlier readings of the same ceiling collapse onto this one and
       * could not be told from it. `times-reach` and `times-wide` measure it at
       * a cell sixteen rows tall where the face is fifteen pixels across, so
       * `tmMaxCharWidth` pads to four bytes: a long more is eight, twice the
       * cell is eight, and eight bytes a row of the cell is eight. All three
       * say 128 bytes, a glyph reaching thirty-four rows at four bytes is
       * refused and one thirty-six pixels wide is refused at half as many rows,
       * and nothing in that instrument moves them apart.
       *
       * `buffer` is what moves them apart. Ten characters carry an identical
       * marker by the baseline and a block standing above the ascender, where
       * the cell clips it away so it can only be counted; the ten block heights
       * are assigned in an order uncorrelated with the ten advances, and the
       * sweep runs from a cell of thirty to one of a hundred and ninety.
       *
       *     the character's own cell, twice    refuted: Windows refuses none of
       *                                        the ten when they share a block
       *                                        it says are too big
       *     the face's cell, twice             too generous by about a half at
       *                                        every size above a cell of
       *                                        thirty-four
       *     the face's cell and a long         exact
       *
       * The threshold in bytes a cell row, read off the sweep: 8 at a cell of
       * 30, 12 from 34 to 66, 16 from 70 to 98, 20 from 102 to 134, 24 at 138 --
       * and `tmMaxCharWidth` pads to 4, 8, 12, 16 and 20 across those same
       * bands. A long more, every time. It is the box and not the widest
       * advance: at a cell of thirty-four the box is thirty-three pixels and the
       * advance thirty, which pad to eight bytes and four, and the recording
       * says twelve.
       *
       * **Measured.** `buffer` is 409 of its 410 records with this and 284 with
       * the character's own cell; all seven `bands` recordings stay 288 of 288,
       * the fabricated corpus disagrees about nothing, `glyphs` is 6,046 of
       * 6,046 on each of four displays, `lines` 2,478 and `plotter` 1,584.
       */
      const maxWidth = Math.round((outline.boundingWidth * acrossPixels) / outline.unitsPerEm);
      const cellBytes = ((maxWidth + 63) >> 5 || 1) * 4;
      const budget = cellBytes * (font.style.ascent + font.style.descent);

      if (contours.length && rows * rowBytes < budget) {
        /* An outline face has no bold or italic of its own here -- only the
         * plain file of each family is loaded -- so both are made as the
         * bitmap faces make them: emboldening draws the glyph again a pixel
         * across, and slanting leans it over by an amount proportional to how
         * far above the baseline each point sits.
         */
        const slanted = italic && !fitted.turnedAlready
          ? this.slant(contours, fitted.scaled ? 1 : scale, ppem, acrossPixels)
          : contours;

        /* A turned glyph is carried to pixels and then rotated about its own
         * origin, and the scan converter is handed the result with nothing
         * left to scale. 8u.
         */
        const placed = turn && !fitted.turnedAlready
          ? slanted.map((contour) =>
              contour.map((point) => {
                const [px, py] = turned(point.x * up, point.y * up);

                return { ...point, x: px, y: py };
              })
            )
          : slanted;

        /* Where that origin is: the baseline's, carried along the exact angle
         * by the advances so far and rounded -- see `baseX`. At a right angle
         * Arial's baseline origin is its ascent to the *right* of the pen
         * rather than below it, and the carries are whole numbers already.
         */
        const along = pen - x + carried;

        const inked = fill(placed, {
          // Hinting hands back pixels; an unhinted outline is still in units.
          scale: turn ? 1 : fitted.scaled ? 1 : scale,
          originX: turn ? baseX + away(along * pathCosine) : pen + carried,
          originY: turn ? baseY - away(toDown(along) * pathSine) : baseline,
          width: this.width,
          height: this.height,
          /* What the font's own `SCANCTRL` asked for at this size, which is
           * not always yes: Arial turns dropout control off above sixteen
           * pixels per em and this was drawing every size as though it were on.
           * An unhinted outline has no answer, so it keeps the default.
           */
          dropout: fitted.dropout ?? true,

          /* The scan converter needs the size as well as the scale: above
           * forty-eight pixels per em it stops rescuing a dropout in a glyph
           * whose box has not collapsed -- and only on a square pixel, which is
           * what `across` is here to say. See `fillWalked`. */
          ppem,
          across: acrossPixels,
          /* A glyph Windows is slanting for us keeps every row it had upright.
           *
           * **Measured**, and it is an invariant rather than a tendency: across
           * the four slant instruments the synthesised cell inks exactly the
           * rows its own upright cell inks, 88 times out of 88. The same shape
           * written into the outline and asked for upright does not -- it loses
           * its tip row in 18 of the 88, which is stub control refusing to
           * rescue a run with nothing above or below it, and Windows and this
           * agree on every one of those.
           *
           * So the check that costs a bare stroke its ends is not applied to a
           * glyph being slanted. At twelve pixels the bar inks rows 3 to 10
           * upright and, baked into the outline, rows 4 to 10; slanted, Windows
           * inks 3 to 10 again. See `FONTS.md` section 3.
           */
          /* And a stroke's end is spared the stub test wherever the font's own
           * `SCANTYPE` is not the rule that excludes stubs. Every installed
           * family asks for that rule, and only by a branch of `prep` a rotated
           * glyph never takes: told the glyph is rotated, all four leave
           * `SCANTYPE` at nought, simple dropout control *with* stubs, and the
           * square's rescued corners are that. 8u. */
          stubs: !italic && (fitted.scanType ?? 1) === 1,
          /* And the box is built from the sheared corners of the glyph's
           * bounding box rather than from the outline's own extent; see
           * `leanOf` and the note in `glyph-raster`. */
          lean: italic && !fitted.turnedAlready ? Surface.leanOf(ppem, acrossPixels) : 0,
        });

        const box = (inked as any).box ?? { left: 0, right: this.width };

        /* The cell GDI lays the glyph out in: the box's left edge plus the
         * device advance. Read out of GDI's memory beside the box, it is
         * `boxLeft + advance` in all sixty-six plain cells of the real face,
         * and one wider for bold. The bold overhang has to fit inside it.
         */
        /* The advance is the one the face lays the character out with, which
         * on a pixel that is not square is measured across and not down.
         * `LogicalFont.outlineAdvance` is that rule -- `LTSH` gated on the
         * vertical size and scaled by the horizontal one, then the program run
         * anisotropically -- and reaching for the vertical advance here made
         * the cell too narrow on an EGA, which clipped the bold overhang. On a
         * square pixel the two are the same number. */
        const cell = box.left + font.outlineAdvance(character.charCodeAt(0));

        /* The glyph the string ends on, whose overhang is the only one with a
         * rule to it; see below. */
        const lastGlyph = index === count - 1;

        /* Whether this driver draws the emboldening overhang where the colour
         * drivers drop it; see the condition below.
         */
        const spills = (this.boldOverhang ?? BitmapContext.driver?.boldOverhang) === 'always';

        /* The cell clips an upright glyph and cannot clip a turned one: the
         * cell turns with the text, and every angle in the recording draws ink
         * well above and below the rows an upright cell would allow.
         */
        const from = turn ? 0 : Math.max(0, cellTop);
        const to = turn ? this.height : Math.min(this.height, cellBottom);

        for (let row = from; row < to; row++) {
          for (let column = 0; column < this.width; column++) {
            if (inked[row * this.width + column]) {
              this.context.setPixel(column, row, colour);

              /* Emboldening draws the glyph again a column across, and the
               * overhang has two things to fit inside.
               *
               * It is done here rather than inside the scan converter because
               * the stack probe says it is not the scan converter's business:
               * the box GDI hands it for a bold glyph is byte for byte the box
               * it hands it for a plain one, at every size and bearing, so the
               * smear is not bounded by the box -- in 102 of 132 cells read
               * against their boxes the bold ink reaches the column just past
               * the box's last.
               *
               * What bounds it is the **cell** and a **byte**. Beside the box in
               * GDI's memory sits the width it lays the glyph out in, and in
               * all sixty-six plain cells of the real face it is
               * `boxLeft + advance`, one wider for bold. The overhang column is
               * drawn when it lies inside that cell and does not begin a new
               * byte of the destination row -- a smear ORed in a byte at a time
               * lands where the glyph already wrote and is dropped where it
               * would need one byte more. The four bold cells at ten pixels and
               * mu at twenty-four were the ones the cell caught: their boxes
               * end a column past `boxLeft + advance`, so the overhang had
               * nowhere to go. Together the two conditions account for every
               * one of the 132 with no exception left, and the corpus with
               * them.
               *
               * An earlier attempt measured the cell from the *pen* rather than
               * the box's left and cost twenty-eight records; the two differ by
               * whatever the hinted outline reaches left of its origin.
               */
              /* And a Hercules draws it wherever the smear reaches.
               *
               * The condition above is the colour drivers', measured on a VGA.
               * A Hercules keeps none of it: every bold cell of the corpus that
               * the two 96x72 displays disagree about is one of these, ten of
               * them, and in every one the Hercules has exactly one more pixel
               * at the right-hand end of a row. **Recorded**, and the two
               * weaker readings refused with it -- dropping only the byte test
               * closes seven of the ten and dropping only the cell test closes
               * three, against ten for drawing it always.
               */
              /* Both of those conditions are the **last** glyph's, and only
               * when the ground is opaque -- which every bold glyph above was
               * drawn with, one to a string.
               *
               * **Recorded** by `smearrun` and `smearmod`, strings of one to
               * three and four glyphs in four faces at every byte phase of the
               * pen, 1,280 records. Every glyph but the last draws its whole
               * overhang, into the next one's cell, in both modes and at every
               * phase: 0 of those columns is dropped. The last glyph keeps the
               * cell and the byte when the ground is opaque -- each of the 47
               * columns it loses there is one of the two -- and when it is
               * transparent it loses the column past its box at every phase,
               * in all 640 transparent records; its overhang inside the box is
               * drawn.
               *
               * **Read out of `VGA.DRV`'s 386 `StrBlt`** (seg2), which is what
               * draws these. Its bold compositor (`17c2`) ORs every glyph into
               * the string buffer at its phase and the next, not cut to its width,
               * so every overhang reaches the buffer; what reaches the page is
               * masked to where the layout ends. GDI hands TrueType text over
               * with a width array, and the loop that walks one (`0424`) lays
               * each glyph but the last at its array width -- widening the
               * glyph into its byte's spare bits first -- and the last at its
               * own bitmap's width, never reading the bold flag. So the string
               * ends at the last glyph's box, and the overhang past it is
               * masked off: the transparent rule. With `ETO_OPAQUE` and a
               * rectangle covering the rows, `0744` carries the end on to the
               * next byte boundary but not past the rectangle, whose right is
               * the bold cell: the opaque rule, byte and cell both. GDI's side
               * is `GDI.EXE` seg1 `6223`: the array is a character's width
               * plus a pixel when the device has `TC_EA_DOUBLE` (`6b73`), and
               * in `OPAQUE` mode the rectangle is those widths summed. A
               * Hercules has no `TC_EA_DOUBLE`, so its smear is left to GDI's
               * simulation (seg16 `0030`: the string drawn twice, at x + 1 and
               * at x), which nothing cuts at the end.
               *
               * The stack-probe cell is kept because it is that rectangle, and
               * the transparent one is refused at 312 of 640 as a clip at the
               * pen plus the plain advances and at 320 as one at the ground's
               * right.
               *
               * Turned, none of it: the overhang is a column to the right on
               * the device and not along the text, and it is always drawn.
               * GDI will not leave turned text's double weight to a device
               * that cannot turn text (seg1 `35b2`), so it is GDI's
               * simulation, seg16 `0030`: the whole string drawn at x + 1 and
               * again at x, transparent -- two whole draws, which nothing
               * cuts. All
               * 320 of `smearmod`'s turned records in both modes, and
               * `rotstyle`'s fifteen; a smear along the text, with the same
               * advance, is refused at 0 of either.
               */
              const cellRule = column + 1 < box.right || (box.right <= cell && box.right % 8 !== 0);
              const overhangRule = !lastGlyph ? true : this.backMode === 2 ? cellRule : column + 1 < box.right;
              if (bold && (turn || spills || overhangRule)) {
                this.context.setPixel(column + 1, row, colour);
              }
            }
          }
        }
      }

      /* `LogicalFont.measure`'s own rule, so that where the pen lands and what
       * a string measures cannot disagree.
       *
       * It used to be the same *sources* in the same order rather than the same
       * function, and that is not the same thing. `outlineAdvance` asks them at
       * the whole **horizontal** size -- `hdmx`, `LTSH`, the program, and for a
       * synthesised slant the scaler's unhinted advance -- and this asked them
       * at the vertical one. A square pixel cannot tell the two apart, and
       * every reading of them had been taken on one.
       *
       * **Recorded.** `hinting` now sweeps Symbol upright as well as slanted,
       * which says what the advance is rather than leaving it to be read out of
       * ink: 14,928 records on each of two displays, all of them exact, and
       * Symbol's `z` at a twenty-two pixel cell on an EGA advances by thirteen.
       * The pen stepped by eleven. The glyph corpus draws pairs precisely
       * because a single character never steps and nothing else could see it;
       * on an EGA 24 of its 29 pairs were in the wrong column, and with the one
       * rule they are in the right one.
       */
      /* And the gap `SetTextCharacterExtra` asks for after every character. */
      /* And the pixel a synthesised bold costs each character, which
       * `LogicalFont.measure` charges and the pen had not: Arial asked for at
       * a weight of 600 is its regular file smeared, and Windows draws the `B`
       * of "AB" a column further on. **Recorded** by `rotstyle`, upright as
       * well as turned; nothing before it drew two smeared outline characters
       * in a row.
       *
       * Turned it is **two**. `rotstyle`'s "AB" puts the `B` two pixels further
       * along than the plain one at all four angles, and `smearmod`'s three-
       * glyph strings say it is two a glyph and not one a glyph and one more:
       * all 320 of its turned records at two, 70 at one. **Read out** of
       * `GDI.EXE`: GDI's bold simulation (seg16 `0030`, which turned text gets;
       * see the smear) adds one to the character extra while it draws, and
       * the widths it hands on still carry the `TC_EA_DOUBLE` pixel (seg1
       * `6b73`). */
      /* The same advance a turned glyph steps by as an upright one. The
       * design advance scaled and left fractional, which is what an unfitted
       * glyph would carry, is refused: the letters are 768 wrong pixels with
       * it and `rotangle` 32 of its 40 oblique boxes. Rounded, it is this. */
      pen += run.advances
        ? run.advances[index] + this.charExtra
        : font.outlineAdvance(character.charCodeAt(0)) + this.charExtra + (bold ? (turn && this.devicePaintsBold() ? 2 : 1) : 0);
      index++;
    }
  }

  /**
   * The whole-pixel matrix GDI hands the scaler for turned text: the size
   * times the cosine and the size times the sine, in sixteen-dot-sixteen, each
   * rounded to a whole pixel with a half going away from nought. 8u.
   *
   * **Measured.** Rounded, not normalised: 70 of `rot-square`'s 91 oblique
   * squares against 15 for the exact rotation, and the ink holding still
   * across 43.0 to 44.6 degrees is the matrix not changing. The sixteen-dot-
   * sixteen and the away-from-nought are the last ten of `rotpen`'s: at
   * thirty-three per em and thirty degrees the sine entry is exactly 16.5.
   */
  /**
   * A made-up slant turned: the turn's whole-pixel matrix with a third of its
   * first row, floored, added to its second. 8u.
   *
   * Upright that is the lean section 3 measured, `floor(ppem / 3)` pixels per
   * em. Turned, the third is taken of the matrix's own entries and floored as
   * a signed number, which at a half turn -- where the entry is minus the
   * size -- leans a pixel further than the upright lean turned would.
   *
   * **Recorded** by `rotstyle`, Symbol slanted at two sizes and five angles:
   * ten of ten. Shearing by the upright lean and then turning, each entry
   * rounded, is nine; composing the upright lean with the turn's rounded
   * entries is eight, and loses both half turns.
   */
  static slantedTurn(entryCos, entrySin) {
    return [entryCos, entrySin, -entrySin + Math.floor(entryCos / 3), entryCos + Math.floor(entrySin / 3)];
  }

  static turnEntries(ppem, radians) {
    const fixed = (value) => Math.round(value * 65536) / 65536;
    const away = (value) => Math.sign(value) * Math.round(Math.abs(value));

    return [away(ppem * fixed(Math.cos(radians))), away(ppem * fixed(Math.sin(radians)))];
  }

  /**
   * A rotated outline carried to the device the way the scaler carries it.
   *
   * **Read out of `GDI.EXE`**, segment 36 -- the TrueType glue, which is not
   * among the scaler sources on disk:
   *
   * - `3ff9` sets a transformation up. It takes each row of the matrix to a
   *   *stretch* through `3f16`, and `3f16` is not a length: it is the larger
   *   of the row's two entries in magnitude. So an outline turned by
   *   half a right angle at twenty-six per em, whose entries are eighteen and
   *   eighteen, is scaled at **eighteen** per em, and the rest of the em is the
   *   matrix's to supply.
   * - The outline is scaled at that stretch into sixty-fourths by whichever
   *   method `3f55` picks for the ratio of the stretch times sixty-four to the
   *   em. At an em of 2048 it always reduces to a power of two, which is the
   *   multiply-and-shift at `3e5e`: a half goes up. Otherwise `3e80` divides,
   *   and a half goes away from nought.
   * - `6ebb` then turns every point. Each matrix entry is divided by its row's
   *   stretch with `FixDiv` at `0x270` -- magnitudes, half the divisor added,
   *   the sign put back -- and each point is `FixMul(x, m00) + FixMul(y, m10)`
   *   across and `FixMul(x, m01) + FixMul(y, m11)` up, with `FixMul` at
   *   `0x200` adding `0x8000` before it shifts. Two products, each rounded,
   *   then added.
   *
   * **Measured.** `rot-square` and `rotpen`, 363 single squares at every five
   * and every ten degrees, a tenth of a degree at a time across half a right
   * angle, and four sizes: **363 of 363** exact. Every simpler model of the
   * same numbers stopped near 306, and the same arithmetic run with the ppem as
   * the stretch instead of the larger entry is 309.
   *
   * The bearing is not carried here: every installed face and every
   * instrument keeps a glyph's left side bearing equal to its `xMin`, so the
   * phantom points would move nothing.
   */
  static turnOutline(contours, entryCos, entrySin, unitsPerEm) {
    return Surface.transformOutline(contours, [entryCos, entrySin, -entrySin, entryCos], unitsPerEm);
  }

  /**
   * An outline carried through any matrix of whole-pixel entries, as the
   * scaler carries it: each row scaled at its own stretch -- the larger of its
   * two entries -- and turned by the entries divided by it. `matrix` is
   * `[m00, m01, m10, m11]`, where across is `x * m00 + y * m10` and up is
   * `x * m01 + y * m11`, per em. See `turnOutline` for what was read and where.
   */
  static transformOutline(contours, matrix, unitsPerEm) {
    const [e00, e01, e10, e11] = matrix;
    const stretchX = Math.max(Math.abs(e00), Math.abs(e01));
    const stretchY = Math.max(Math.abs(e10), Math.abs(e11));

    /* The scale into sixty-fourths, reduced the way `3f55` reduces it. */
    const scaler = (stretch) => {
      let multiplier = stretch * 64;
      let divisor = unitsPerEm;

      while (multiplier % 2 === 0 && divisor % 2 === 0) {
        multiplier /= 2;
        divisor /= 2;
      }

      const shifted = (divisor & (divisor - 1)) === 0;

      return (value) =>
        shifted || value >= 0
          ? Math.floor((value * multiplier + Math.floor(divisor / 2)) / divisor)
          : -Math.floor((-value * multiplier + Math.floor(divisor / 2)) / divisor);
    };
    const scaleX = scaler(stretchX);
    const scaleY = scaler(stretchY);

    const fixDiv = (numerator, denominator) =>
      Math.sign(numerator) *
      Math.sign(denominator) *
      Math.floor((Math.abs(numerator) * 65536 + Math.floor(Math.abs(denominator) / 2)) / Math.abs(denominator));
    const fixMul = (value, factor) => Math.floor((value * factor + 32768) / 65536);

    const m00 = fixDiv(e00, stretchX);
    const m01 = fixDiv(e01, stretchX);
    const m10 = fixDiv(e10, stretchY);
    const m11 = fixDiv(e11, stretchY);

    /* And on a diagonal the whole outline is nudged a sixty-fourth across.
     *
     * **Read out of `GDI.EXE`.** `3dc1`, called as the transformation is set
     * up, compares each row's two entries and sets a flag where they are equal
     * or opposite -- which for a turn is exactly half a right angle and its
     * odd multiples. Before the glyph goes to the scan converter, `202d` tests
     * it and `2357` adds one to every point's `x`. The letters at 45, 135, 225
     * and 315 degrees were every one of `rotate`'s draws still wrong without
     * it.
     */
    const diagonal = Math.abs(e00) === Math.abs(e01) || Math.abs(e10) === Math.abs(e11);
    const nudge = diagonal ? 1 : 0;

    return contours.map((contour) =>
      contour.map((point) => {
        const x = scaleX(point.x);
        const y = scaleY(point.y);

        return {
          ...point,
          x: (fixMul(x, m00) + fixMul(y, m10) + nudge) / 64,
          y: (fixMul(x, m01) + fixMul(y, m11)) / 64,
        };
      })
    );
  }

  /**
   * Leans an outline over, for a face with no italic of its own.
   *
   * Every point moves right in proportion to how far above the baseline it
   * sits, so the baseline itself stays put and the top of the letter travels
   * furthest. The proportion is the same one the bitmap faces lean by.
   */
  slant(contours, scale, ppem, across = ppem) {
    const lean = Surface.leanOf(ppem, across);

    /* Each point is sheared in sixty-fourths, with the two roundings apart.
     *
     * The scaled coordinate is rounded to a sixty-fourth, the shear of the
     * scaled height is rounded to a sixty-fourth, and the two are added --
     * which is the arithmetic the box was read to use, applied to the outline
     * as well. Shearing in font units and letting the raster round the sum once
     * is the same thing to within a sixty-fourth, and a sixty-fourth is exactly
     * what a crossing sitting on a half decides by.
     *
     * **Measured.** Seven records of the corpus, twenty-four fabricated cells,
     * and every slant instrument exact: `slant-angle`, `slant-baked` and
     * `slant-width` go to 288 of 288 with no wrong pixels, joining
     * `symbol-slant` and `symbol-shapes`. Rounding the shear term down instead
     * costs four records.
     *
     * And swept again once a display with a pixel that is not square had an
     * instrument of its own, where the halves land differently: a half upward
     * is 32,394 fabricated cells of 32,394 and 2,654 of the 2,668 that are not
     * square, against 31,973 and 2,650 for flooring, 31,959 and 2,650 for
     * ceiling, 32,383 and 2,654 for away from zero, and 32,347 and 2,652 for
     * toward it. Upward is best on both counts and alone in being exact on the
     * first.
     */
    const k = scale * 64;

    return contours.map((contour) =>
      contour.map((point) => {
        const x64 = Math.round(point.x * k);
        const y64 = Math.round(point.y * k);

        return { ...point, x: (x64 + Math.round(lean * y64)) / k };
      })
    );
  }

  /**
   * How far a synthesised italic leans at this size.
   *
   * A whole number of pixels of lean over one em of rise. The whole number is
   * `floor(ppem / 3)` -- nominally a third; in practice a third truncated onto
   * the pixel grid, so the slope is `4/12` at twelve per em, `5/16` at sixteen,
   * `6/20` at twenty, never a third exactly except where three divides the size
   * -- and then that whole number is **carried across the device's own aspect
   * and rounded again**, because it is a count of pixels down the page and the
   * lean is across it.
   *
   * The second rounding is invisible on a square pixel, where the aspect is one
   * and the number comes back as itself, and every reading of this had been
   * taken on one.
   *
   * **Measured**, by sweeping the numerator against `symbol-slant` recorded on
   * an EGA -- one upright bar in place of every Symbol letter, so the slanted
   * cell is the shear and nothing else -- and asking which whole number makes
   * every cell of a size exact. Nineteen sizes answer with exactly one, and the
   * rule gives all nineteen:
   *
   *     ppem  across   wants   floor(ppem/3) x aspect
   *        6   8.000       3    2 x 4/3 =  2.67
   *        7   9.333       3    2 x 4/3 =  2.67
   *        9  12.000       4    3 x 4/3 =  4
   *       11  14.667       4    3 x 4/3 =  4
   *       12  16.000       5    4 x 4/3 =  5.33
   *       14  18.667       5    4 x 4/3 =  5.33
   *       16  21.333       7    5 x 4/3 =  6.67
   *       20  26.667       8    6 x 4/3 =  8
   *       23  30.667       9    7 x 4/3 =  9.33
   *       24  32.000      11    8 x 4/3 = 10.67
   *       27  36.000      12    9 x 4/3 = 12
   *       31  41.333      13   10 x 4/3 = 13.33
   *
   * No product in the sweep lands on an exact half, so which way a half goes is
   * **not** measured and nothing here should be read as saying it is.
   *
   * The horizontal size is the *fractional* one, `xPpem`, and not the whole
   * `xWhole` that the advance and the hint program are measured at. Taking the
   * whole one instead is 322 of 352 cells against 340, and truncating the
   * product rather than rounding it is 306. Four further readings were refused
   * on the same sweep: `floor(across/3)/ppem` (306), `round(across/3)/ppem`
   * (290), `ceil(across/3)/ppem` (260) and the unrounded `across/3/ppem` (258).
   * The six readings scored against this instrument before were all scored
   * while its *upright* half was also failing, which is why none of them could
   * be right and why the number they agreed on meant nothing.
   *
   * **Read out of GDI's memory, not fitted.** `oracle/probes/stack.c` recovers
   * the box the scan converter is set up from; 948 of them were recorded across
   * eight instruments and sixteen sizes. Holding the size and letting the ink's
   * height vary, the displacement the slant applies to the box is a shear with
   * **no constant term at all** at every size -- and the slope it wants is a
   * whole number over the size at every size, uniquely: 3/9, 3/11, 4/12, 4/14,
   * 5/16, 6/18, 6/20, 7/23, 8/26, 11/33. Ten sizes, ten integers, and every one
   * of them `floor(ppem / 3)`.
   *
   * That is why the constant this replaced could never be right. Three tenths
   * was the best single number over a corpus whose sizes wanted 0.273, 0.286,
   * 0.3, 0.3125 and 0.333 -- a good average and wrong everywhere. With the rule
   * in its place `symbol-slant` and `symbol-shapes`, the two instruments built
   * to measure exactly this, go from 252 and 248 of 288 cells to **288 of 288
   * with no wrong pixels at all**.
   *
   * The three tenths was not carelessness, and the way it was arrived at is
   * worth keeping. It was swept over the cells that can measure a slope -- the
   * twenty-four whose widest inked run is four pixels or more, where the scan
   * converter finds the edge itself and dropout control decides nothing -- and
   * over those the minimum was sharp and single: 0.29 cost sixteen pixels,
   * three tenths cost none, 0.31 cost sixteen again. A sharp minimum in the
   * wrong family of curves. Every one of those twenty-four cells is at a size
   * whose true slope is near three tenths, and the sweep had no way to ask for
   * a slope that changed with the size.
   *
   * Only one installed face ever asks for this. Arial, Times New Roman and
   * Courier New all ship an italic file, so a request for a slanted outline is
   * answered by opening it; Symbol does not. And it is **not** the half the
   * bitmap faces lean by -- a strike leans by its whole overhang and from the
   * bottom of the cell, which is a different mechanism with a different number.
   * See `BitmapFont.SLANT` and `FONTS.md` section 3.
   */
  static leanOf(ppem, across = ppem) {
    return Math.round((Math.floor(ppem / 3) * across) / ppem) / ppem;
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

          /* One run is one polyline, which is not the same as a chain of
           * `LineTo` calls through the same points -- see `BitmapContext.stroke`
           * and the `poly` records of the `lines` fixture. */
          (this.context as any).polyline = true;
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
