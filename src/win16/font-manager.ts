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
  static MAX_STRETCH = 8;

  /** And the most it is drawn sideways, which is not the same number. */
  static MAX_WIDTH_STRETCH = 5;

  /**
   * The quality at which a stretched strike is refused rather than scored.
   *
   * Read out of `GDI.EXE` and then asked for: the mapper's penalty routine
   * tests `lfQuality` against this before it adds a single term, and answers
   * the largest penalty there is where it matches, which takes the candidate
   * out of the running altogether.
   *
   * **Recorded**, and it is exactly the stretched candidates that go: at proof
   * quality every one of six faces answers with a height it has a strike
   * installed at and never with a multiple of one. Fixedsys, whose only strike
   * is fifteen rows, answers fifteen for every request from eight to fifty
   * where the default quality answers 30 and 45. Courier answers 13, 16 or 20
   * and never 26, 32, 40 or 48.
   *
   * It is also the cleanest confirmation there is that the stretched sizes are
   * *candidates* rather than something worked out after a strike has been
   * chosen -- they can be refused one at a time, so they must be scored one at
   * a time.
   */
  static PROOF_QUALITY = 2;

  /* The mapper's penalty weights, from GDI's own table at `0x39c`, each
   * multiplied by 1024 as the table is built.
   */
  static STRETCH_PENALTY = 20 * 1024;
  static HEIGHT_PENALTY = 150 * 1024;
  static TALLER_PENALTY = 600 * 1024;
  static ASPECT_PENALTY = 30 * 1024;
  static RATIO_PENALTY = 4 * 1024;

  /* What a candidate pays for not being the face that was asked for, from the
   * same table: the mapper adds `AddAtom` on the candidate's name and charges
   * this when it matches neither the name requested nor its alias. It dwarfs
   * every other term, which is why a request that names a face gets that face
   * -- until the height term outgrows it. See `map`.
   */
  static FACE_PENALTY = 10000 * 1024;

  /** A square device pixel, as the mapper counts aspect: hundredths. */
  static SQUARE = 100;

  /** `MulDiv`, which rounds to nearest, as GDI's does at `seg1:41b0`. */
  static muldiv(a, b, c) {
    return Math.floor((a * b + (c >> 1)) / c);
  }

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
            faceBold:
              key === FontManager.styleKey(true, italic) ||
              key === FontManager.styleKey(true, false),
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
  _strikeAt(height, charset, fixedPitch, only = null, ownName = false) {
    if (height <= 0 || (!ownName && height >= FontManager.OUTLINE_FLOOR)) {
      return null;
    }

    /* A symbol face is answered by its own strikes or by none.
     *
     * Symbol asked for at eight pixels does not become Small Fonts the way
     * Arial does: it stays Symbol and comes back seven pixels tall, drawn from
     * the outline. An ANSI strike is no answer to a request for symbols, which
     * is the same reason an OEM strike is no answer to a request for ANSI.
     */
    for (const name of only ? [only] : FontManager.INSTALLED_ORDER) {
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
      /* The set outranks the name, but a name that is itself a symbol face
       * keeps it: asked for Wingdings in the symbol set, Windows answers with
       * Wingdings at every height recorded, and with Symbol for a name that is
       * not a symbol face. */
      const named = this.outline(face);

      face = named && named.font.symbolic ? named.name : 'Symbol';
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
    /* An outline of the name asked for answers, even when strikes carry the
     * same name.
     *
     * Symbol is the only face installed both ways, and it used to be read as
     * the strike winning outright. It does not: it wins at thirteen and at
     * sixteen pixels, which are the two sizes `SYMBOLE.FON` has strikes at
     * below the size where outlines take over, and nowhere else. Asked for
     * eight it answers seven, for twelve twelve, for twenty twenty -- none of
     * them a size that file holds -- and `tmPitchAndFamily` says TrueType at
     * every one of them. So this is the ordinary rule about strikes and
     * outlines and not an exception to it, and what had made it look like one
     * was that the only size ever asked for was sixteen, where the two answer
     * alike in every field.
     *
     * A name with strikes and no outline still finds no outline here, and must
     * not fall back to Times New Roman: Courier is not Courier New.
     */
    /* The bold file is chosen above 600, and bold is synthesised above 550.
     *
     * Two thresholds, read off a sweep of every ten of weight from 500 to 700
     * at sixteen pixels. On Arial and Times New Roman, which have a bold file,
     * 500 to 550 draw the regular file plainly, 560 to 600 draw the regular
     * file emboldened, and 610 upward draw the bold file. On MS Sans Serif and
     * Symbol, which have none, 560 upward is the synthesised bold. So the file
     * switches at 600 and the smear at 550, and a request between them gets
     * the regular outline smeared rather than the bold one drawn.
     */
    const wantsBold = (request.weight ?? 0) > 600;
    const wantsItalic = !!request.italic;

    const named = this.outline(face, wantsBold, wantsItalic);

    const outline =
      named ??
      (this.lookup(face)
        ? null
        : face
          ? this.outline(FontManager.FALLBACK_OUTLINE, wantsBold, wantsItalic)
          : null);

    /* A symbol outline is rejected by a request that did not ask for symbols,
     * the same way an OEM strike is: WingDings asked for in ANSI comes back
     * as MS Sans Serif.
     */
    const usable =
      outline &&
      charset !== FontManager.OEM_CHARSET &&
      !(
        outline.font.symbolic &&
        charset !== FontManager.SYMBOL_CHARSET &&
        !this.lookup(outline.name)
      );

    if (usable) {
      /* A strike installed at exactly this height beats the outline, below the
       * size at which outlines start winning outright. This is the whole of why
       * a request for eight pixel Arial comes back as Small Fonts.
       */
      /* The size at which outlines take over is about falling back to some
       * *other* face's strike. A strike of the face's own name is not a
       * fallback and is not subject to it: Symbol at sixteen pixels answers
       * with the sixteen row strike out of `SYMBOLE.FON`, where Arial at
       * sixteen answers with its outline because the only sixteen row strikes
       * belong to other faces.
       */
      const own = this.lookup(outline.name) ? outline.name : null;

      const strike = this._strikeAt(
        request.height ?? 0,
        charset,
        outline.font.fixedPitch,
        outline.font.symbolic ? (own ?? outline.name) : own,
        Boolean(own)
      );

      if (strike) {
        /* Which family the mapper had settled on before the size sent it to a
         * strike, because `tmItalic` still answers for that one.
         *
         * Ask for eight pixel Arial in italic and what gets drawn is Small
         * Fonts with a synthesised slant -- and the byte comes back 255, the
         * TrueType answer. Ask for Small Fonts itself at the same size and the
         * same slant is synthesised onto the same strike, and it comes back 1.
         * The strike cannot tell them apart; only the request can. **Recorded**,
         * both ways round.
         */
        return {
          ...FontManager.choose(strike.entries, request),
          face: strike.name,

          /* Only when the strike belongs to some *other* family. Symbol's own
           * strike is not a fallback from anywhere, so a slant synthesised onto
           * it reports `tmItalic` as 1 the way any strike's does, not the 255
           * an outline family answers with.
           */
          outlineFamily: !own,
        };
      }

      const chosen = FontManager.realiseOutline(outline.font, request);

      if (chosen) {
        return {
          ...chosen,
          outline: outline.font,
          face: outline.name,
          exactStyle: outline.exact,
          faceBold: outline.faceBold,
        };
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
    /* A family of strikes loses to some other face's outline once its best
     * strike costs more than the wrong name does.
     *
     * The mapper scores every installed face against the request and keeps the
     * cheapest. A strike of the name asked for pays nothing for its name and
     * 150 a pixel for being the wrong height; an outline of another name pays
     * 10,000 flat and nothing for height, because it can be realised at any.
     * So Fixedsys at a hundred pixels, asked for at proof quality where a strike
     * may not be stretched, is a fifteen row strike eighty-five pixels short --
     * 12,750 in height -- and Arial answers, with a hundred pixel cell and
     * Arial's own widths. Asked for at default quality the same strike is drawn
     * six times over for under two thousand and keeps winning. The corpus
     * brackets the threshold from both sides: four bitmap families at a hundred
     * pixels answer with Arial at proof quality and their own strikes at
     * default, and MS Serif and MS Sans Serif, whose tallest strikes are only
     * sixty-five and sixty-three short, keep theirs at both.
     *
     * Every outline that is not the face pays the same 10,000, and the loop
     * replaces its best only on a strictly lower score, so the tie goes to the
     * first outline in the font directory. Windows builds that directory in
     * `WIN.INI` `[fonts]` order, which the installer wrote alphabetically, and
     * the drive image is loaded in the same order; Arial is first either way.
     * A symbol outline is out for a request that did not ask for symbols, the
     * same way it is everywhere else here.
     */
    if (found && chosen.cost > FontManager.FACE_PENALTY) {
      const symbols = charset === FontManager.SYMBOL_CHARSET;
      for (const installed of Object.keys(this._outlines)) {
        const other = this.outline(installed, wantsBold, wantsItalic);
        if (!other || Boolean(other.font.symbolic) !== symbols) {
          continue;
        }
        const realised = FontManager.realiseOutline(other.font, request);
        if (realised) {
          return {
            ...realised,
            outline: other.font,
            face: other.name,
            exactStyle: other.exact,
            faceBold: other.faceBold,
          };
        }
        break;
      }
    }

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

    /* A width asked for as well as a height gives the glyphs a pixel size of
     * their own in the horizontal direction.
     *
     * `lfWidth` is a request for the average character to come out that wide,
     * and Windows answers it by scaling the outline horizontally to a second
     * pixel size rather than by stretching what the height chose. This once
     * read that size as `floor(lfWidth * unitsPerEm / xAvgCharWidth)`, from
     * the six requests the `font` fixture makes; the `widths` sweep refused it
     * for the rule below, which has the same six right.
     */
    const width = request.width ?? 0;

    /* A width stretches the face: the horizontal size is the vertical one
     * times `lfWidth` over the average character width the face has *at that
     * vertical size*, and it is not rounded to whole pixels. Read off the
     * `widths` fixture: the average width comes back as `lfWidth` itself, 60 of
     * 60; the maximum width is the `head` box at that fractional size, 58 of
     * 60; and Arial asked for its own average, six at sixteen pixels, draws
     * exactly as it does unstretched, which an integer size one pixel off
     * would not. Ratio and size as the scaler's transform has them.
     */
    const stretched = (ppem) => {
      if (!(width > 0) || !font.averageAdvance) {
        return ppem;
      }

      const average = Math.round((font.averageAdvance * ppem) / font.unitsPerEm);

      if (!(average > 0)) {
        return ppem;
      }

      /* The ratio is a 16.16 fixed number, rounded to the nearest, and the
       * size is the vertical one times it -- not the one division
       * `ppem * width / average` would be. The two differ only where the ratio
       * is not representable and the product is whole. Arial at twenty-one
       * pixels asked for twelve has an average of nine: twelve ninths is four
       * thirds, which rounds down to 87381 sixty-fourths of a thousand and
       * twenty-fourths (16.16), and times twenty-one is 27.99975 -- twenty-seven
       * pixels, not twenty-eight. Arial at twenty-seven asked for eight has an
       * average of twelve: two thirds rounds up to 43691, and times
       * twenty-seven is 18.0001 -- eighteen, as the one division says.
       * **Recorded**, both: Windows draws all thirty-six glyphs of the first
       * request one column narrower than twenty-eight gives and every one
       * agrees at twenty-seven; the second request's text extents are the
       * eighteen pixel ones. Truncating the ratio instead gets the first right
       * and the second wrong (five records of the `font` fixture); the one
       * division gets the second right and the first wrong (twenty-one
       * glyphs). Nearest is the only reading that has both.
       */
      const ratio = Math.round((width * 65536) / average);

      return (ppem * ratio) / 65536;
    };

    /* A negative height asks for the em rather than the cell, which for an
     * outline is the pixel size directly.
     *
     * **Zero asks for the mapper's default, and that is a size too rather than
     * a cell** -- twelve points, which is sixteen pixels of em at ninety-six
     * dots to the inch. All three outline faces answer a height of zero at
     * exactly sixteen pixels per em and at three different cell heights: Arial
     * and Courier New at eighteen, Times New Roman at nineteen. **Recorded**,
     * and the varying cell is what says it is the em being asked for.
     *
     * Reading it as a cell of eighteen instead gets two of the three right by
     * arithmetic -- eighteen is what sixteen pixels of Arial comes out at --
     * and Times New Roman wrong, because nineteen pixels does not fit in
     * eighteen and the size below it does. The strike path already had this
     * right; only this one did not.
     */
    if (height <= 0) {
      const size = height < 0 ? -height : Math.round((FontManager.DEFAULT_POINTS * 96) / 72);
      const extent = font.extentAt(size);

      return extent
        ? {
            entry: null,
            ppem: size,
            xPpem: stretched(size),
            ascent: extent.ascent,
            descent: extent.descent,
          }
        : null;
    }

    const found = font.sizeForHeight(height);

    if (!found) {
      return null;
    }

    /* A slant Windows synthesises keeps the upright's size and loses its
     * hinting.
     *
     * The size is still the one `VDMX` chooses -- Symbol slanted at twelve
     * pixels is nine per em, though ten per em would have filled the cell
     * exactly -- but the ascent and descent reported for it are the design
     * values scaled and rounded, not the fitted ones the table holds: at nine
     * per em the descender is 1.98 pixels, which hinting carries to 3 and
     * Windows reports as 2. The glyphs said it first: the slant is drawn from
     * the raw outline with no program run, so there is nothing fitted to report.
     */
    const synthetic = !!request.italic && !font.italicFace;

    return {
      entry: null,
      ppem: found.ppem,
      xPpem: stretched(found.ppem),
      ascent: synthetic ? Math.round((font.ascender * found.ppem) / font.unitsPerEm) : found.ascent,
      descent: synthetic
        ? Math.round((font.descender * found.ppem) / font.unitsPerEm)
        : found.descent,
    };
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

    /* Each strike answers for itself how many times over it may be drawn, and
     * then the largest of those that fits is taken.
     *
     * The second half of that is not the rule Windows uses and is known not to
     * be: Courier asked for 38 pixels answers 39, its thirteen row strike three
     * times over, when 32 was available and fits.
     *
     * The rule it does use has been read out of `GDI.EXE`. It is a weighted
     * penalty over the candidates, and its height term is a distance with a
     * two-to-one bias: the mapper works out what cell this candidate would have
     * to be realised at and charges two per pixel when the candidate is taller
     * than that and one per pixel when it is shorter. So a strike that is too
     * small beats one that is too big by the same amount. `FONTS.md` section 3
     * has the whole weights table and where in the image it sits.
     *
     * That rule is now what this does. Each strike is scored once, the stretch
     * is part of its score rather than a separate choice, and the weights are
     * GDI's own. See `FONTS.md` section 3 for the whole of it and for where in
     * the image each piece sits.
     *
     * Thirteen heights of 302 are still wrong and every one is at seventy-five
     * pixels or more, where we take a smaller strike stretched further than
     * Windows will and it takes a larger one. Some term that grows with the
     * multiple is still missing.
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
      /* How many times over this strike would be drawn.
       *
       * A quarter of the strike's own height is added before the division --
       * `sar cx,2` at `seg3:1bf7` -- so the step up to the next multiple comes
       * a little before the multiple is reached, which is why a request can
       * come back taller than it asked for. A strike at least as tall as the
       * request is never stretched, and proof quality never stretches at all.
       */
      const stretching = request.quality !== FontManager.PROOF_QUALITY && measured < target;

      const times = stretching
        ? Math.min(FontManager.MAX_STRETCH, Math.floor((target + (measured >> 2)) / measured))
        : 1;

      /* Refused outright when the multiple plus two is not less than the
       * strike's own height, which is why the three row and five row strikes of
       * Small Fonts are barely stretched: three never can be, five only
       * doubled.
       */
      if (stretching && times + 2 >= measured) {
        continue;
      }

      const size = measured * times;

      /* The score, with the mapper's own weights: twenty a multiple for the
       * stretch, a hundred and fifty a pixel of height error either way, and
       * six hundred more, flat, for erring on the tall side. All of them are
       * multiplied by 1024 as GDI builds its table, which leaves the low bits
       * free -- and GDI uses them, folding the multiple in with an `or` rather
       * than an add, as a tie-break between candidates that cost the same.
       */
      let cost = stretching ? (FontManager.STRETCH_PENALTY * times) | ((times - 1) << 3) : 0;

      cost +=
        size > target
          ? FontManager.HEIGHT_PENALTY * (size - target) + FontManager.TALLER_PENALTY
          : FontManager.HEIGHT_PENALTY * (target - size);

      /* And the aspect, which is what stops a small strike being stretched a
       * long way.
       *
       * A request naming no width is answered by comparing the shape the strike
       * would come out at against the shape of a device pixel. Stretching a
       * strike six times upward and only five across -- five being the cap, at
       * `seg3:1d8c` -- leaves it seventeen hundredths off square, and that is
       * charged 30 a hundredth. The taller the stretch the worse it gets, which
       * is the term that decides between a small strike drawn many times and a
       * larger one drawn few.
       *
       * The device's own aspect is a hundred here, because a VGA pixel is
       * square; the general form is `MulDiv(100, aspectX, aspectY)`.
       */
      const shape = FontManager.muldiv(
        100,
        entry.header.dfHorizRes || 1,
        entry.header.dfVertRes || 1
      );

      const perTime = FontManager.muldiv(shape, 1, times);

      let across = 1;

      if (stretching && perTime + (perTime >> 1) < FontManager.SQUARE) {
        across = Math.min(
          FontManager.MAX_WIDTH_STRETCH,
          FontManager.muldiv(FontManager.SQUARE, 1, perTime)
        );

        cost = (cost + FontManager.STRETCH_PENALTY * across) | (across - 1);
      }

      cost +=
        FontManager.ASPECT_PENALTY *
        Math.abs(FontManager.SQUARE - FontManager.muldiv(shape, across, times));

      /* And last, the two multiples against each other.
       *
       * Not how far off square the letter comes out, which is the term above,
       * but how far the one stretch is from the other: the larger over the
       * smaller, in hundredths, at 4 a hundredth. Six times up against five
       * across is 120, so 480 -- which is what settles a strike drawn six times
       * against one drawn five, and it was the last thing missing.
       */
      if (times !== across) {
        cost +=
          FontManager.RATIO_PENALTY *
          (times > across
            ? FontManager.muldiv(FontManager.SQUARE, times, across)
            : FontManager.muldiv(FontManager.SQUARE, across, times));
      }

      if (!smallest || size < smallest.size) {
        smallest = { entry, scale: times, size };
      }

      if (!best || cost < best.cost) {
        best = { entry, scale: times, size, cost };
      }
    }

    /* Nothing fits under a request smaller than anything installed, and the
     * answer is the smallest there is rather than nothing: asking for a single
     * pixel of MS Sans Serif gives its eight point strike.
     */
    best = best ?? smallest;

    /* Sideways the strike is drawn at most five times over, however many times
     * it is drawn upward.
     *
     * The two multiples are the same until the fifth, and then they part.
     * Courier asked for ninety-six pixels answers a cell of 96 -- its sixteen
     * row strike six times -- with an average width of 45, which is its own
     * nine *five* times and not six. Small Fonts asked for eighty-seven answers
     * a cell of 88, its eleven row strike eight times over, with an average of
     * 25: five fives. **Recorded**, across a sweep of every height from one to
     * a hundred and twenty.
     */
    let horizontal = Math.min(best.scale, FontManager.MAX_WIDTH_STRETCH);

    if (width > 0) {
      const average = best.entry.header.dfAvgWidth;

      horizontal = Math.max(1, Math.round(width / (average || 1)));
    }

    return { entry: best.entry, scale: best.scale, horizontal, cost: best.cost ?? 0 };
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
