import { BitmapFont } from '../raster/bitmap-font.js';
import { Stream } from '../stream.js';
import { LogicalFont } from '../raster/logical-font.js';

export class FontManager {
  declare _callback: any;
  declare _fonts: any;
  declare _loading: any;
  declare _waitPromise: any;
  constructor() {
    this._fonts = {};
    this._loading = 0;

    this._waitPromise = new Promise<void>((resolve, reject) => {
      if (this._loading == 0) {
        resolve();
      }
      this._callback = resolve;
    });
  }

  wait() {
    return this._waitPromise;
  }

  async load(file) {
    if (file.name.toLowerCase().endsWith('.fon')) {
      const bitmapFont = new BitmapFont(file);
      await bitmapFont.load();

      /* Every entry is kept, not just one per face. Several files carry a face
       * called Terminal at sizes that have nothing to do with each other --
       * DOSAPP.FON's smallest is six pixels tall -- so remembering only the
       * last file to mention a name means the size a caller asks for may not
       * be among the ones on offer.
       */
      bitmapFont.entries.forEach((entry) => {
        const face = entry.name;

        if (!this._fonts[face]) {
          this._fonts[face] = [];
        }

        this._fonts[face].push(entry);
      });
    } else {
      // TrueType Font
    }
  }

  /**
   * The faces a name should be looked for under.
   *
   * `WIN.INI` carries a `[FontSubstitutes]` section, and these are what a
   * stock Windows 3.1 installation puts in it. A program asking for Helv gets
   * MS Sans Serif and is not told, which is why `ANSI_VAR_FONT` measures as MS
   * Sans Serif while `GetTextFace` still answers "Helv".
   */
  /** `lfPitchAndFamily`, in the pieces the mapper reads it in. */
  static FIXED_PITCH = 0x01;
  static FF_ROMAN = 0x10;
  static FF_MODERN = 0x30;

  /** `lfCharSet` values that decide a mapping on their own. */
  static ANSI_CHARSET = 0x00;
  static DEFAULT_CHARSET = 0x01;
  static SYMBOL_CHARSET = 0x02;
  static OEM_CHARSET = 0xff;

  /** How many times over a strike may be drawn to reach a size. */
  static MAX_STRETCH = 5;

  /** The size the mapper picks when a request names none, in points. */
  static DEFAULT_POINTS = 12;

  static SUBSTITUTES = {
    helv: 'MS Sans Serif',
    'tms rmn': 'MS Serif',
    times: 'Times New Roman',
    helvetica: 'Arial',
  };

  /**
   * Every size of a face that has been loaded, after substitution.
   *
   * The name is matched without regard to case but not to spacing: `ms sans
   * serif` finds MS Sans Serif and `MSSansSerif` finds nothing, which is what
   * Windows does. A program reading a face name out of an INI file passes on
   * whatever was written there, so the case rarely matches how the font was
   * installed.
   */
  lookup(name) {
    const face = FontManager.SUBSTITUTES[String(name).toLowerCase()] ?? name;
    const wanted = String(face).toLowerCase();

    for (const installed of Object.keys(this._fonts)) {
      if (installed.toLowerCase() === wanted) {
        return this._fonts[installed];
      }
    }

    return undefined;
  }

  /**
   * What a request with no usable face name falls back to.
   *
   * With nothing named, the pitch and family are all the mapper has, and this
   * is how a program asks for "any fixed-pitch font" without caring which.
   * Recorded rather than reasoned about, in `oracle/fixtures/font.json`.
   */
  static familyFace(pitchAndFamily) {
    // The low two bits are the pitch; the high nibble is the family.
    const pitch = pitchAndFamily & 0x03;
    const family = pitchAndFamily & 0xf0;

    if (pitch === FontManager.FIXED_PITCH || family === FontManager.FF_MODERN) {
      return 'Courier';
    }

    if (family === FontManager.FF_ROMAN) {
      return 'MS Serif';
    }

    return 'MS Sans Serif';
  }

  /**
   * Finds the installed font that best answers a description of one.
   *
   * A program does not choose a font, it describes one, and GDI finds the
   * closest thing it has. Everything here was recorded from Windows doing that
   * -- see `oracle/probes/font.c` -- because almost none of it is written
   * down, and the parts that read as obvious are the parts that are not.
   *
   * The order matters. A character set that is not ANSI decides the answer on
   * its own, ahead of any name: asking for Terminal with `ANSI_CHARSET` does
   * not give you Terminal, it gives you MS Sans Serif, because Terminal is an
   * OEM font and the character set is the stronger constraint.
   *
   * @param {Object} request - The fields of a `LOGFONT` that steer matching.
   * @returns {Object|null} The entry to draw with and how much to scale it.
   */
  map(request) {
    const charset = request.charset ?? FontManager.ANSI_CHARSET;
    const pitchAndFamily = request.pitchAndFamily ?? 0;

    /* A symbol font is chosen by its character set rather than by its name.
     * The OEM set answers with the vector font `Roman`, which is not a `.FON`
     * and so is not something we have; that is a gap rather than a decision.
     */
    let face = request.face ? String(request.face) : '';

    if (charset === FontManager.SYMBOL_CHARSET) {
      face = 'Symbol';
    } else if (!face) {
      face = FontManager.familyFace(pitchAndFamily);
    }

    let entries = this.lookup(face);

    /* An OEM face is no use to a request that did not ask for one, and Windows
     * treats it as though it were not installed: asking for Terminal in the
     * ANSI character set gives MS Sans Serif. A symbol face is not rejected
     * the same way -- asking for Symbol gives Symbol -- so this is narrower
     * than "the character sets must match", which is what it looked like
     * before Symbol was probed alongside Terminal.
     */
    if (entries && charset !== FontManager.OEM_CHARSET) {
      const matching = entries.filter(
        (entry) => entry.header.dfCharSet !== FontManager.OEM_CHARSET
      );

      entries = matching.length ? matching : undefined;
    }

    /* Two separate facts, and conflating them costs a lot: whether anything was
     * found under the name, which decides whether to fall back, and whether
     * `WIN.INI` redirected the name, which decides what to call the result.
     */
    const found = !!entries && entries.length > 0;

    /* A redirected name is the one case where the request is echoed back
     * rather than the font that answered it: a program asking for Helv is told
     * Helv, though MS Sans Serif is what gets drawn. Everything else is told
     * the name of the face it actually got, including a program that spelled
     * an installed name in the wrong case -- `ms sans serif` is answered with
     * `MS Sans Serif`.
     */
    const substituted =
      FontManager.SUBSTITUTES[String(request.face ?? '').toLowerCase()] !== undefined;

    if (!found) {
      /* Windows answers an unknown name with Times New Roman, which is a
       * TrueType face and so not something we can produce. Falling back to the
       * family default keeps a program drawing rather than not, and the
       * difference is recorded as a gap rather than hidden.
       */
      entries = this.lookup(FontManager.familyFace(pitchAndFamily));
    }

    if (!entries || entries.length === 0) {
      return null;
    }

    const chosen = FontManager.choose(entries, request);

    /* The requested name survives only when it was redirected and the redirect
     * found something; anything else answers with the face that was opened.
     */
    const echo = found && substituted && request.face;

    return { ...chosen, face: echo ? String(request.face) : chosen.entry.name };
  }

  /**
   * Picks which strike of a face answers a height, and how much to stretch it.
   *
   * A positive height asks for a cell that tall, including the leading above
   * the characters; a negative one asks for the characters themselves to be
   * that tall, which is a smaller number for the same font; and zero asks for
   * the mapper's own default, which is twelve points.
   *
   * Beyond the largest strike installed, Windows stretches one rather than
   * refusing: a hundred pixel MS Sans Serif is the twenty pixel strike at five
   * times size, exact in every metric. It picks the strike and the factor that
   * land on the requested height, which is why the answer is 100 and not 111.
   */
  static choose(entries, request) {
    const height = request.height ?? 0;
    const width = request.width ?? 0;

    /* Whether the target is a cell or the characters within it. The internal
     * leading is the difference, and it varies from strike to strike, so the
     * comparison has to be made per strike rather than once.
     */
    const wantsCell = height > 0;

    /* No height named means the mapper's own default, which is twelve points.
     * That is a size rather than a cell, so it is compared the way a negative
     * height is -- against the characters rather than against the cell around
     * them -- and lands on the same strike Windows picks.
     */
    const target = height ? Math.abs(height) : Math.round((FontManager.DEFAULT_POINTS * 96) / 72);

    /* The largest size that does not overshoot, rather than the nearest one.
     *
     * These are not the same rule and the difference is visible: Courier is
     * installed at cells of 13, 16 and 20, and asked for 24 Windows answers 20
     * -- not the 26 it could have made by doubling the 13, which is closer.
     * Overshooting is what it will not do. Asked for 29 it does double the 13,
     * because 26 fits under 29 and is larger than 20.
     */
    let best: any = null;
    let smallest: any = null;

    for (const entry of entries) {
      const cell = entry.header.dfPixHeight;
      const em = cell - entry.header.dfInternalLeading;

      const measured = wantsCell ? cell : em;

      /* Only whole multiples, and not many of them: a bitmap stretched by a
       * fraction is not what a bitmap driver does, and nothing recorded is
       * stretched more than five times. The limit is what makes MS Serif
       * answer a hundred pixel request with ninety-five -- its nineteen pixel
       * strike five times over -- rather than with the exact hundred its ten
       * pixel strike would give at ten times, which is the answer every other
       * rule here would have chosen.
       */
      for (let scale = 1; scale <= FontManager.MAX_STRETCH; scale++) {
        const size = measured * scale;

        if (
          !smallest ||
          size < smallest.size ||
          (size === smallest.size && scale < smallest.scale)
        ) {
          smallest = { entry, scale, size };
        }

        if (
          size <= target &&
          (!best || size > best.size || (size === best.size && scale < best.scale))
        ) {
          best = { entry, scale, size };
        }

        if (size > target) {
          break;
        }
      }
    }

    /* Nothing fits under a request smaller than anything installed, and the
     * answer is the smallest there is rather than nothing: asking for a single
     * pixel of MS Sans Serif gives its eight point strike.
     */
    best = best ?? smallest;

    /* An average width asked for as well as a height stretches the chosen
     * strike sideways, to the nearest whole multiple of its own average.
     */
    let horizontal = best.scale;

    if (width > 0) {
      const average = best.entry.header.dfAvgWidth;

      horizontal = Math.max(1, Math.round(width / (average || 1)));
    }

    return { entry: best.entry, scale: best.scale, horizontal };
  }

  /**
   * Resolves a request for a face at a size to something drawable.
   *
   * The nearest size wins when the exact one is not there, which is what
   * Windows does with a bitmap face it cannot match precisely.
   *
   * @param {string} face - The typeface asked for.
   * @param {number} points - The point size asked for.
   * @returns {LogicalFont} The font, or null if the face is not installed.
   */
  realize(face, points) {
    const entries = this.lookup(face);

    if (!entries || entries.length === 0) {
      return null;
    }

    let best = entries[0];

    for (const entry of entries) {
      if (Math.abs(entry.size - points) < Math.abs(best.size - points)) {
        best = entry;
      }
    }

    return new LogicalFont(face, points, best);
  }
}
