import { BitmapFont } from '../raster/bitmap-font.js';
import { Stream } from '../stream.js';
import { LogicalFont } from '../raster/logical-font.js';
import { TrueTypeFont } from '../raster/truetype-font.js';

export class FontManager {
  declare _callback: any;
  declare _fonts: any;
  declare _outlines: any;
  declare _loading: any;
  declare _waitPromise: any;
  constructor() {
    this._fonts = {};
    this._outlines = {};
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
      return;
    }

    if (file.name.toLowerCase().endsWith('.ttf')) {
      const bytes = new Uint8Array(await file.read(0, file.size));
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

      if (!TrueTypeFont.looksLikeFont(view)) {
        return;
      }

      const font = new TrueTypeFont(bytes);
      const face = font.faceName;

      if (!face) {
        return;
      }

      /* An outline face has no strikes to collect, so it stands alone under
       * its name rather than joining a list. A family's bold and italic files
       * name themselves the same thing, and the first one loaded is the
       * regular; keeping that one is right until synthesised styles give way
       * to real ones.
       */
      /* All four files of a family name themselves the same thing, and they
       * are four different fonts. Windows does not slant the plain one to
       * answer a request for italic -- it opens the italic one, which is a
       * different design and measures differently: Arial's italic is *narrower*
       * than its regular at twenty-four pixels, which no amount of shearing
       * would produce.
       */
      const family = (this._outlines[face] = this._outlines[face] ?? {});

      family[FontManager.styleKey(font.boldFace, font.italicFace)] = font;
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

  /**
   * The cell height at and above which an outline always wins.
   *
   * Below it a strike installed at exactly the height asked for beats scaling
   * a TrueType face to that height. Sweeping every height from one to fourteen
   * gives a scattered pattern rather than a cut-off -- Arial answers with Small
   * Fonts at 3, 5, 6, 8, 10 and 11 and with itself everywhere else -- and those
   * six are exactly the strikes Small Fonts is installed in.
   *
   * Twelve is where it stops, and why it stops there is **not** known. Several
   * families carry a thirteen pixel strike, MS Sans Serif among them, which is
   * the same FF_SWISS family Arial is in and ought to be the strongest raster
   * candidate available; Arial wins that height anyway. See `FONTS.md`.
   */
  static OUTLINE_FLOOR = 12;

  /**
   * The order `WIN.INI` installs the raster faces in.
   *
   * Two faces can both have a strike at the height asked for -- MS Serif and
   * Small Fonts both have a 10 and an 11 -- and the recording says MS Serif
   * wins both, for a request for Arial and for a request for Times New Roman
   * alike. It is not the family that decides it, since those two requests are
   * FF_SWISS and FF_ROMAN and get the same answer; it is the order the fonts
   * appear in `[fonts]`, where MS Serif is listed four lines above Small Fonts.
   *
   * Kept as a list rather than read from `WIN.INI` because the loader takes
   * fonts in directory order, which is not installation order.
   */
  static INSTALLED_ORDER = [
    'MS Sans Serif',
    'Courier',
    'MS Serif',
    'Symbol',
    'Roman',
    'Script',
    'Modern',
    'Small Fonts',
  ];

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

  /** How the four files of a family are told apart. */
  static styleKey(bold, italic) {
    return `${bold ? 'bold' : 'regular'}${italic ? '-italic' : ''}`;
  }

  /**
   * The outline face of a name, after substitution, in the style asked for.
   *
   * A family that has the style installed answers with it. One that does not
   * answers with the nearest it has, and the caller makes up the difference --
   * which is what happens for the plotter and bitmap faces, and what used to
   * happen for these.
   */
  outline(name, bold = false, italic = false) {
    const face = FontManager.SUBSTITUTES[String(name).toLowerCase()] ?? name;
    const wanted = String(face).toLowerCase();

    for (const installed of Object.keys(this._outlines)) {
      if (installed.toLowerCase() !== wanted) {
        continue;
      }

      const family = this._outlines[installed];

      // Exactly what was asked for, then the nearest thing to it.
      for (const key of [
        FontManager.styleKey(bold, italic),
        FontManager.styleKey(bold, false),
        FontManager.styleKey(false, italic),
        'regular',
      ]) {
        if (family[key]) {
          return {
            name: installed,
            font: family[key],
            exact: key === FontManager.styleKey(bold, italic),
          };
        }
      }
    }

    return null;
  }

  /** The face an unrecognised name is answered with, if it is installed. */
  static FALLBACK_OUTLINE = 'Times New Roman';

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
   * The outline face that stands in for a family, when one has to.
   *
   * The same three-way split `familyFace` makes for the strikes, made again
   * over the TrueType families. Only reached by a request for a style the
   * strikes cannot supply.
   */
  static familyOutline(pitchAndFamily) {
    const family = pitchAndFamily & 0xf0;

    if (pitchAndFamily & FontManager.FIXED_PITCH || family === FontManager.FF_MODERN) {
      return 'Courier New';
    }

    if (family === FontManager.FF_ROMAN) {
      return 'Times New Roman';
    }

    return 'Arial';
  }

  /** Whether a name is installed and is itself an OEM face. */
  _isOEM(name) {
    const entries = this.lookup(name);

    return !!entries?.some((entry) => entry.header.dfCharSet === FontManager.OEM_CHARSET);
  }

  /**
   * The face with a strike at exactly this cell height, if one should win.
   *
   * Only below `OUTLINE_FLOOR`, and only against an outline: this is the rule
   * that answers a request for eight pixel Arial with Small Fonts. Ties go to
   * whichever face `WIN.INI` lists first, which is how MS Serif takes 10 and 11
   * from Small Fonts even though both carry those sizes.
   *
   * @param {number} height - The cell height asked for, in pixels.
   * @param {number} charset - The character set the request asked for.
   * @returns {Object|null} `{name, entries}`, or null if the outline should win.
   */
  _strikeAt(height, charset, fixedPitch) {
    if (height <= 0 || height >= FontManager.OUTLINE_FLOOR) {
      return null;
    }

    for (const name of FontManager.INSTALLED_ORDER) {
      const entries = this.lookup(name);

      if (!entries) {
        continue;
      }

      /* An OEM face is no use to a request that did not ask for one, the same
       * way it is not when it was named outright. Terminal has a 6 and an 8,
       * and neither of them takes those heights from Small Fonts.
       */
      const matching = entries.filter(
        (entry) =>
          entry.header.dfPixHeight === height &&
          !!(entry.header.dfPitchAndFamily & FontManager.FIXED_PITCH) !== fixedPitch &&
          (charset === FontManager.OEM_CHARSET ||
            entry.header.dfCharSet !== FontManager.OEM_CHARSET)
      );

      if (matching.length > 0) {
        return { name, entries: matching };
      }
    }

    return null;
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
    } else if (charset === FontManager.OEM_CHARSET && !this._isOEM(face)) {
      /* The OEM character set is answered by Roman unless something else OEM
       * was named, and being installed is not enough to count as something
       * else: `Courier`, `System` and `MS Sans Serif` are all installed, all
       * named explicitly, and all answered with Roman. Only a face that is
       * itself an OEM one keeps its name -- Roman, Script and Modern do.
       */
      face = 'Roman';
    } else if (!face) {
      face = FontManager.familyFace(pitchAndFamily);
    }

    /* An outline face answers before the strikes are consulted, and an
     * unrecognised name falls to Times New Roman rather than to the family
     * default -- which is the one place a name that is not installed produces
     * a *different* answer from a name that was never given.
     */
    /* A strike of the same name wins: both a bitmap Symbol and a TrueType one
     * are installed, and asking for Symbol gets the bitmap. So an outline
     * answers only where no strike carries the name at all.
     */
    const wantsBold = (request.weight ?? 0) >= 700;
    const wantsItalic = !!request.italic;

    const outline = this.lookup(face)
      ? null
      : (this.outline(face, wantsBold, wantsItalic) ??
        (face ? this.outline(FontManager.FALLBACK_OUTLINE, wantsBold, wantsItalic) : null));

    /* A symbol outline is rejected by a request that did not ask for symbols,
     * the same way an OEM strike is: WingDings asked for in ANSI comes back
     * as MS Sans Serif.
     */
    const usable =
      outline &&
      charset !== FontManager.OEM_CHARSET &&
      !(outline.font.symbolic && charset !== FontManager.SYMBOL_CHARSET);

    if (usable) {
      /* A strike installed at exactly this height beats the outline, below the
       * size at which outlines start winning outright. This is the whole of why
       * a request for eight pixel Arial comes back as Small Fonts.
       */
      const strike = this._strikeAt(request.height ?? 0, charset, outline.font.fixedPitch);

      if (strike) {
        return {
          ...FontManager.choose(strike.entries, request),
          face: strike.name,
        };
      }

      const chosen = FontManager.realiseOutline(outline.font, request);

      if (chosen) {
        return { ...chosen, outline: outline.font, face: outline.name, exactStyle: outline.exact };
      }
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

    /* A request for italic changes what gets picked, rather than being
     * synthesised onto whatever would have been picked anyway.
     *
     * `Terminal`, `WingDings` and an empty name all answer with MS Sans Serif
     * upright. Ask the same three for italic and all three answer with Arial,
     * at an overhang of zero -- a real italic file, not a slanted strike. So
     * where the mapper is falling back rather than honouring a name, having an
     * italic to offer outranks the family it would otherwise have settled on.
     *
     * Only where it is falling back: `MS Sans Serif` asked for by name in
     * italic stays MS Sans Serif and gets a synthesised slant.
     */
    const fallingBack = !request.face || !found;
    const plainCharset =
      charset === FontManager.ANSI_CHARSET || charset === FontManager.DEFAULT_CHARSET;

    if (wantsItalic && fallingBack && plainCharset) {
      const italicFamily = this.outline(FontManager.familyOutline(pitchAndFamily), wantsBold, true);

      if (italicFamily?.font?.italicFace) {
        const chosen = FontManager.realiseOutline(italicFamily.font, request);

        if (chosen) {
          return {
            ...chosen,
            outline: italicFamily.font,
            face: italicFamily.name,
            exactStyle: italicFamily.exact,
          };
        }
      }
    }

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
   * Settles an outline face at a size.
   *
   * The metrics are not a scaling of anything the font says about itself --
   * see `TrueTypeFont` -- so the size is chosen by looking through the font's
   * own table of grid-fitted extents for the largest that fits in the cell
   * asked for.
   *
   * Where two pixel sizes come out the same height the choice between them
   * changes nothing about the ascent, the descent or the height, because that
   * is what makes them tied; it moves the internal leading by one, and which
   * one Windows picks is not settled. The larger is taken here.
   */
  static realiseOutline(font, request) {
    const height = request.height ?? 0;

    /* A negative height asks for the em rather than the cell, which for an
     * outline is the pixel size directly. Zero is the mapper's default, which
     * these fonts answer at the same eighteen pixels a plotter font does.
     */
    if (height < 0) {
      const extent = font.extentAt(-height);

      return extent
        ? { entry: null, ppem: -height, ascent: extent.ascent, descent: extent.descent }
        : null;
    }

    const wanted = height || 18;
    const found = font.sizeForHeight(wanted);

    if (!found) {
      return null;
    }

    return { entry: null, ppem: found.ppem, ascent: found.ascent, descent: found.descent };
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
    /* A scalable face has one design and is drawn at whatever size is wanted,
     * so none of the business below -- nearest strike, whole-number stretch,
     * never overshoot -- applies to it. It is realised exactly.
     */
    if (entries[0] && entries[0].isVector) {
      const entry = entries[0];

      /* Zero means the mapper's default, which for a scalable face is eighteen
       * pixels rather than the twelve points a bitmap face gets. Recorded for
       * all three plotter fonts, whose designs are different heights.
       */
      let cell = height ? Math.abs(height) : 18;

      /* A negative height asks for the characters rather than the cell, and
       * the leading is a fixed fraction of the design, so the cell it implies
       * follows from it.
       */
      if (height < 0) {
        const design = entry.header.dfPixHeight;
        const em = design - entry.header.dfInternalLeading;

        cell = Math.round((-height * design) / em);
      }

      /* Widths do not scale with the height, and the reason is a rounding that
       * happens before anything else: GDI settles on a whole number for the
       * average character width, and every other width is then a proportion of
       * *that* rather than of the height.
       *
       *   average = floor(dfAvgWidth * cell * dfVertRes / (dfPixHeight * dfHorizRes))
       *
       * The design's own aspect -- three horizontal to two vertical for all
       * three plotter fonts -- is in there, but the floor around it is what
       * makes the resulting scale jump about instead of following the height:
       * across nine sizes the effective ratio runs from 0.53 to 0.66 and not
       * monotonically, which is what made this look like no rule at all.
       *
       * A request naming a width says what the average is directly, which is
       * the same quantity arrived at from the other end.
       */
      const average =
        width > 0
          ? width
          : Math.floor(
              (entry.header.dfAvgWidth * cell * entry.header.dfVertRes) /
                (entry.header.dfPixHeight * entry.header.dfHorizRes)
            );

      return {
        entry,
        scale: cell / entry.header.dfPixHeight,
        horizontal: average / entry.header.dfAvgWidth,
        cell,
      };
    }

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
