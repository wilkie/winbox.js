import { readFontResource, type FontResource } from '../raster/font-resource';
import { BitmapFont } from '../raster/bitmap-font.js';
import { Stream } from '../stream.js';
import { LogicalFont } from '../raster/logical-font.js';
import { TrueTypeFont } from '../raster/truetype-font.js';

export class FontManager {
  declare _callback: any;
  declare _fonts: any;
  declare _outlines: any;
  /** What the installer's `.FOT` files say about each `.TTF`, by file name. */
  declare _resources: Record<string, FontResource>;
  declare _loading: any;
  declare _waitPromise: any;
  constructor() {
    this._fonts = {};
    this._outlines = {};
    this._resources = {};
    /* Where each strike stands in GDI's font directory, which is the order the
     * files were loaded and, within a file, the order of its resources. The
     * mapper's ties go to the earliest. */
    this._order = 0;
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

        entry.order = this._order++;

        if (!this._fonts[face]) {
          this._fonts[face] = [];
        }

        this._fonts[face].push(entry);
      });
      return;
    }

    /* The installer's resource for a TrueType face, which is where the pitch
     * and family GDI reports come from; see `font-resource.ts`. The `.FOT`
     * may arrive before or after its `.TTF`, so it is kept by file name and
     * applied whichever comes second. */
    if (file.name.toLowerCase().endsWith('.fot')) {
      const resource = readFontResource(new Uint8Array(await file.read(0, file.size)));

      if (!resource) {
        return;
      }

      this._resources[resource.file] = resource;

      for (const family of Object.values(this._outlines) as any[]) {
        for (const font of Object.values(family) as any[]) {
          if (font.fileName === resource.file) {
            font.resource = resource;
          }
        }
      }

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

      font.fileName = file.name.toUpperCase();
      font.resource = this._resources[font.fileName] ?? null;

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
  static FF_SWISS = 0x20;
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

  /** Above this weight the family's bold file is opened rather than smeared. */
  static BOLD_FILE = 600;
  static ASPECT_PENALTY = 30 * 1024;
  static RATIO_PENALTY = 4 * 1024;

  /* What a candidate pays for not being the face that was asked for, from the
   * same table: the mapper adds `AddAtom` on the candidate's name and charges
   * this when it matches neither the name requested nor its alias. It dwarfs
   * every other term, which is why a request that names a face gets that face
   * -- until the height term outgrows it. See `map`.
   */
  static FACE_PENALTY = 10000 * 1024;

  /* The rest of the table, in the order `0x39c` holds it. Each names the
   * instruction that charges it; see `FONTS.md` section 3.
   */
  /** `18d2`: the candidate's `dfCharSet` is not the one asked for. */
  static CHARSET_PENALTY = 65000 * 1024;
  /** `19b1`: fixed pitch asked for and a variable one got. */
  static FIXED_PENALTY = 15000 * 1024;
  /** `19c8`: variable pitch asked for and a fixed one got. */
  static VARIABLE_PENALTY = 350 * 1024;
  /** `19e0`: no pitch asked for at all and a fixed one got. */
  static PITCH_PENALTY = 1 * 1024;
  /** `1a37`: the family asked for is not the candidate's. */
  static FAMILY_PENALTY = 9000 * 1024;
  /** `1a44`: the same, where the candidate claims no family. */
  static NO_FAMILY_PENALTY = 8000 * 1024;
  /** `1a26`: and 50 more when only one of the two is above `FF_MODERN`. */
  static FAMILY_SIDE_PENALTY = 50 * 1024;
  /** `1f35`: three for every ten of weight, after the synthesis adjustment. */
  static WEIGHT_PENALTY = 3 * 1024;
  /** `1fa4`: the candidate is slanted and the request is not, or the reverse. */
  static ITALIC_PENALTY = 4 * 1024;
  /** `1f86`: a slant the candidate does not have and can be given. */
  static SLANT_PENALTY = 1 * 1024;
  /** `1fe0` and `201c`: an underline or a strikeout that does not match. */
  static UNDERLINE_PENALTY = 3 * 1024;
  static STRIKEOUT_PENALTY = 3 * 1024;

  /** `1ee8`: over this much heavier than the candidate and a bold is made. */
  static SMEAR_ABOVE = 150;
  /** And the candidate is treated as this much heavier once one is. */
  static SMEAR_BY = 120;

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
   * Twelve is where it stops because `seg3:13f3` is `cmp ax,0xb`, and the
   * scattered pattern is because what runs below it is a lookup in exactly two
   * faces rather than a search of all of them. See `SMALL_FACES` and `FONTS.md`
   * section 3.
   */
  static OUTLINE_FLOOR = 12;

  /**
   * The order the mapper's ties resolve in, measured rather than derived.
   *
   * Two faces can both have a strike at the height asked for -- MS Serif and
   * Small Fonts both have a 10 and an 11 -- and the recording says MS Serif
   * wins both, for a request for Arial and for a request for Times New Roman
   * alike. It is not the family that decides it, since those two requests are
   * FF_SWISS and FF_ROMAN and get the same answer.
   *
   * It is **not installation order** either, which is what this list was once
   * read as. `WIN.INI` lists MS Sans Serif first on both displays, and on an
   * EGA -- where MS Sans Serif and MS Serif both carry a ten pixel strike, with
   * the same average of five and maximum of eleven, so nothing about the
   * metrics separates them -- Windows answers with MS Serif. A rule that
   * followed the file would answer with MS Sans Serif. Putting MS Serif first
   * takes those two rows and costs nothing anywhere: `font`, `glyphs`, `sizes`,
   * `styles` and `widths` do not move, and neither does the VGA sweep.
   *
   * What orders it, for the sizes that turn on it, is now read: below twelve
   * pixels GDI does not consult a list at all but asks MS Serif and then Small
   * Fonts by atom, which is why MS Serif takes ten and eleven. See
   * `SMALL_FACES`. Above twelve the order here still stands in for GDI's own
   * font directory, which `_compete` walks by load order instead.
   */
  static INSTALLED_ORDER = [
    'MS Serif',
    'MS Sans Serif',
    'Courier',
    'Symbol',
    'Roman',
    'Script',
    'Modern',
    'Small Fonts',
  ];

  /* The two faces a small request may be answered from, and nothing else.
   *
   * **Read out of `GDI.EXE`.** Below twelve pixels the realiser does not score
   * anything: at `seg3:126a` it looks the request up by atom in exactly two
   * faces, `[0x384]` and `[0x386]`, and only falls through to the mapper when
   * neither has a strike of the height asked for. Those two atoms are the
   * second and third entries of the name table segment 2 holds at `+0x4b4` --
   * `Terminal`, `Small Fonts`, `MS Serif`, `Symbol`, ... `Helv`, `TmsRmn`,
   * `Tms Rmn` -- and `Helv` and `Tms Rmn` are the pair already identified as
   * the substitute atoms at `[0x38e]` and `[0x392]`, which fixes the numbering.
   * A request whose family is `FF_SWISS` gets only `Small Fonts`; anything else
   * gets `MS Serif` first and `Small Fonts` after it.
   */
  static SMALL_FACES = ['MS Serif', 'Small Fonts'];
  static SMALL_SWISS = ['Small Fonts'];

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
   * The earliest strike in the directory installed at exactly the height
   * asked for, in the character set asked for; see `map`. A positive height
   * is a cell and a negative one the characters within it.
   */
  _exactStrike(height, charset, weight) {
    const wantCharset =
      charset === FontManager.DEFAULT_CHARSET ? FontManager.ANSI_CHARSET : charset;

    /* The weight is the one other term that separates exact strikes here:
     * System's sixteen row strike is bold and comes first in the directory,
     * and Windows passes it over for MS Sans Serif's at a request of four
     * hundred. Nearest weight, then the earliest. */
    let best: any = null;
    const distance = (entry) => Math.abs((entry.header.dfWeight || 400) - weight);

    for (const name of Object.keys(this._fonts)) {
      for (const entry of this._fonts[name]) {
        if (entry.isVector || entry.header.dfCharSet !== wantCharset) {
          continue;
        }

        const cell = entry.header.dfPixHeight;
        const exact =
          height > 0 ? cell === height : cell - entry.header.dfInternalLeading === -height;

        if (
          exact &&
          (!best ||
            distance(entry) < distance(best.entry) ||
            (distance(entry) === distance(best.entry) && entry.order < best.entry.order))
        ) {
          best = { name, entry };
        }
      }
    }

    return best ? { name: best.name, entries: [best.entry] } : null;
  }

  _strikeAt(
    height,
    charset,
    fixedPitch,
    only = null,
    ownName = false,
    weight = 400,
    width = 0,
    order = null
  ) {
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
    for (const name of only ? [only] : (order ?? FontManager.INSTALLED_ORDER)) {
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
            entry.header.dfCharSet !== FontManager.OEM_CHARSET) &&
          /* A width asked for is answered exactly or not at all: a strike is
           * not stretched sideways to meet one. */
          (!width || entry.header.dfAvgWidth === width)
      );

      if (matching.length > 0) {
        /* A face's own strike answers only in the weight class it was asked
         * in, and the two classes are the same two the outline files are
         * chosen by: over six hundred is bold and anything else is not.
         *
         * An EGA installs `ARIALB.FON` and `TIMESB.FON`, and each holds four
         * strikes -- eleven and thirteen rows at four hundred, twelve and
         * fourteen at seven hundred. Windows answers a request for eleven
         * pixels of Arial with the eleven row strike when it asks for four
         * hundred and with the *outline* when it asks for seven, and answers
         * twelve pixels the other way about: the outline at four hundred and
         * the twelve row strike at seven. So the strike is not a nearest-weight
         * match that may be emboldened, it is an exact answer to the class or
         * no answer at all. **Recorded**, eight rows of the EGA sweep at four
         * heights and two weights each.
         *
         * This had been read as nearest weight not over the one asked for,
         * which gets the four hundred requests right and hands every seven
         * hundred one a four hundred strike to smear.
         *
         * It holds only where the family has the class to offer. `SYMBOLE.FON`
         * carries nothing but four hundred, and Symbol asked for bold at
         * sixteen pixels on a VGA is still its own sixteen row strike with a
         * smear rather than the outline -- the same answer the plain request
         * gets, one pixel wider. So the class decides between strikes the
         * family *has*, and a family that has none of the class asked for
         * answers with what it has. **Recorded** both ways: 13 glyph cells and
         * the whole `styles` sweep turn on it.
         */
        const heavy = weight > FontManager.BOLD_FILE;
        const classed = (entry) => (entry.header.dfWeight || 400) > FontManager.BOLD_FILE === heavy;

        const light = ownName && entries.some(classed) ? matching.filter(classed) : matching;

        if (light.length === 0) {
          continue;
        }

        const distance = (entry) => weight - (entry.header.dfWeight || 400);
        const nearest = Math.min(...light.map(distance));

        return { name, entries: light.filter((entry) => distance(entry) === nearest) };
      }
    }

    return null;
  }

  /**
   * Everything the penalty routine charges a candidate that is not its size.
   *
   * **Read out of `GDI.EXE`**, at `seg3:17b4`; `FONTS.md` section 3 has the
   * whole table with the instruction that charges each term. This is the half
   * that a scalable candidate pays too -- `1ba6` sends it past every size term
   * and straight to the end -- so it is written once and used by both passes.
   */
  static _named(header, name, request) {
    let cost = 0;

    /* The name, by atom. A request that named none charges nothing to anyone,
     * which is what lets the other terms decide. */
    if (request.face) {
      const asked = String(request.face).toLowerCase();
      const alias = FontManager.SUBSTITUTES[asked];

      if (name.toLowerCase() !== asked) {
        cost += alias && name.toLowerCase() === String(alias).toLowerCase() ? 500 * 1024 : FontManager.FACE_PENALTY;
      }
    }

    if (header.dfCharSet !== (request.charset ?? 0)) {
      cost += FontManager.CHARSET_PENALTY;
    }

    /* The pitch, in the two encodings that do not agree: `lfPitchAndFamily`
     * counts 1 as fixed and 2 as variable, and `dfPitchAndFamily` carries a
     * bit that is set when the face is variable. */
    const pitch = (request.pitchAndFamily ?? 0) & 3;
    const fixed = !(header.dfPitchAndFamily & FontManager.FIXED_PITCH);

    if (pitch === 0) {
      cost += fixed ? FontManager.PITCH_PENALTY : 0;
    } else if (pitch === 1) {
      cost += fixed ? 0 : FontManager.FIXED_PENALTY;
    } else if (pitch === 2) {
      cost += fixed ? FontManager.VARIABLE_PENALTY : 0;
    }

    const wantFamily = (request.pitchAndFamily ?? 0) & 0xf0;
    const hasFamily = header.dfPitchAndFamily & 0xf0;

    if (wantFamily !== 0 && wantFamily !== hasFamily) {
      if (hasFamily === 0) {
        cost += FontManager.NO_FAMILY_PENALTY;
      } else {
        const together =
          (wantFamily <= FontManager.FF_MODERN && hasFamily <= FontManager.FF_MODERN) ||
          (wantFamily > FontManager.FF_MODERN && hasFamily > FontManager.FF_MODERN);

        cost += together ? FontManager.FAMILY_PENALTY : FontManager.FAMILY_PENALTY + FontManager.FAMILY_SIDE_PENALTY;
      }
    }

    /* The weight, three for every ten -- and before it is taken the candidate
     * is made bold where the request is more than 150 heavier, which is the
     * threshold measured from outside as "bold is synthesised above 550". */
    const asked = request.weight ?? 0;
    let has = header.dfWeight || 400;
    let smeared = false;

    if (asked) {
      if (has + FontManager.SMEAR_ABOVE < asked) {
        has += FontManager.SMEAR_BY;
        smeared = true;
      }

      cost += FontManager.WEIGHT_PENALTY * FontManager.muldiv(1, Math.abs(asked - has), 10);
    } else {
      cost += FontManager.WEIGHT_PENALTY * FontManager.muldiv(1, Math.abs(400 - has), 20);
    }

    const slanted = !!header.dfItalic;

    if (request.italic && !slanted) {
      cost += FontManager.SLANT_PENALTY;
    } else if (!!request.italic !== slanted) {
      cost += FontManager.ITALIC_PENALTY;
    }

    /* An underline or a strikeout the candidate does not have is drawn on
     * rather than charged for; only the other direction costs anything. */
    if (!request.underline && header.dfUnderline) {
      cost += FontManager.UNDERLINE_PENALTY;
    }

    if (!request.strikeout && header.dfStrikeOut) {
      cost += FontManager.STRIKEOUT_PENALTY;
    }

    return { cost, smeared };
  }

  /**
   * Scores every face in the directory and answers with the cheapest.
   *
   * This is what GDI does when nothing has answered by name: `seg3:0550` walks
   * the raster and vector faces first, keeping the lowest penalty, and then
   * walks the scalable ones with that as a limit -- and the second walk has to
   * come in **strictly** under it to displace the first. A tie therefore goes to
   * the raster answer, which is why a request naming no face at sixteen pixels
   * is MS Sans Serif on a VGA, where that face has an exact sixteen row strike
   * and pays nothing, and Arial on an EGA, where every strike pays the
   * off-square term and nothing is free. See `FONTS.md` section 3.
   */
  _compete(request) {
    let best = null;

    /* In the order GDI's directory holds them, which is the order the files
     * were loaded and, within a file, the order of its resources. Ties go to
     * the earliest, and two faces can both be exact: Wingdings asked for in the
     * ANSI set at ten pixels answers Small Fonts and not MS Serif, whose ten
     * row strike sits after Small Fonts' own in `SMALLE.FON`.
     */
    const directory = [];

    for (const name of Object.keys(this._fonts)) {
      for (const entry of this._fonts[name]) {
        directory.push({ name, entry });
      }
    }

    directory.sort((one, other) => one.entry.order - other.entry.order);

    {
      for (const { name, entry } of directory) {
        const { cost, smeared } = FontManager._named(entry.header, name, request);
        const sized = FontManager.choose([entry], request);

        if (!sized) {
          continue;
        }

        const total = cost + sized.cost;

        if (!best || total < best.total) {
          best = { total, name, entry, sized, smeared };
        }
      }
    }

    let outline = null;

    for (const installed of Object.keys(this._outlines)) {
      for (const font of Object.values(this._outlines[installed]) as any[]) {
        const stub = font.resource;
        const header = {
          dfCharSet: stub ? stub.charSet : font.symbolic ? FontManager.SYMBOL_CHARSET : 0,
          dfPitchAndFamily: stub ? stub.pitchAndFamily : 0,
          dfWeight: font.boldFace ? 700 : 400,
          dfItalic: font.italicFace ? 1 : 0,
          dfUnderline: 0,
          dfStrikeOut: 0,
        };

        const { cost } = FontManager._named(header, installed, request);

        /* A scalable candidate pays nothing at all for size, except where the
         * request is within two pixels of nothing; `1e9e`. A height of nought
         * never reaches that test: `05a0` has already replaced it with twelve
         * points of the device, as a negative height. */
        const height =
          request.height ||
          -FontManager.muldiv(FontManager.DEFAULT_POINTS, request.logPixelsY || 96, 72);
        const total =
          cost +
          (height >= -2 && height <= 2
            ? FontManager.HEIGHT_PENALTY + FontManager.TALLER_PENALTY
            : 0);

        if ((!outline || total < outline.total) && (!best || total < best.total)) {
          outline = { total, name: installed, font };
        }
      }
    }

    if (outline) {
      const chosen = FontManager.realiseOutline(outline.font, request);

      if (chosen) {
        return {
          ...chosen,
          outline: outline.font,
          face: outline.name,
          exactStyle: true,
          faceBold: outline.font.boldFace,
          outlineFamily: true,
        };
      }
    }

    if (!best) {
      return null;
    }

    return { ...best.sized, face: best.name, outlineFamily: false };
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

      if (!named || !named.font.symbolic) {
        /* A name that is not itself a symbol face answers nothing in the symbol
         * set, so nothing has answered by name and the competition runs. It is
         * not "Symbol" by fiat: on an EGA it comes back Wingdings, because both
         * symbol outlines pay the same wrong name and Wingdings is the earlier
         * of the two in `WIN.INI`, while on a VGA Symbol's exact sixteen row
         * strike pays nothing for its height and the raster pass keeps it.
         */
        const competed = this._compete(request);

        if (competed) {
          return competed;
        }
      }

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
      /* A request that names no face at all is not given a family default: it
       * goes to the scored competition, which is what `seg3:0550` does once
       * `0e95` has failed to answer it by name. See `_compete`.
       */
      const competed = this._compete(request);

      if (competed) {
        return competed;
      }

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
    const wantsBold = (request.weight ?? 0) > FontManager.BOLD_FILE;
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
      /* And only a *symbol* face keeps its own strike.
       *
       * Symbol at sixteen pixels answers with the sixteen row strike out of
       * `SYMBOLE.FON`, which is what the exception was measured on. Nothing on
       * a VGA could say whether it held for the rest, because no other outline
       * family installed there has a strike of its own name. An EGA does
       * install them -- `ARIALB.FON` is "Arial 8,10 (EGA res)" and `TIMESB.FON`
       * its Times equivalent -- and Windows passes both over: Arial asked for
       * at twelve or fourteen pixels comes back as the outline, and at ten it
       * comes back as `MS Serif` rather than as Arial's own ten row strike.
       * **Recorded**, four rows of the EGA sweep.
       */
      const own = this.lookup(outline.name) ? outline.name : null;

      /* And a request that names a width does not go to a strike at all.
       *
       * `OUTLINE_FLOOR` is about answering with a strike below the size at
       * which outlines win outright, and a width request takes that away
       * entirely: Arial asked for at eight or ten pixels with any width from
       * one to thirty-two comes back as Arial, reporting an average of exactly
       * the width asked for. With no width it comes back as `Small Fonts`, as
       * it always did.
       *
       * Not even a strike of the face's own name survives it, which is the one
       * exception the floor itself carries. An EGA installs `ARIALB.FON`, so
       * Arial has a strike of its own there, and Windows still answers a width
       * request with the outline: keeping the exception costs 119 records of
       * the EGA sweep and nothing on the VGA, where no outline family has a
       * strike of its own name to be tempted by.
       *
       * **Recorded** by `maxwidth` on both displays: 122 of the VGA's records
       * and 119 more of the EGA's turn on this, and nothing else moves --
       * `font` stays at 5,057 of 5,057 and `widths` at 2,479 of 2,480.
       */
      const symbolic = outline.font.symbolic;
      /* Zero is `lfWeight`'s "no preference", not a weight of nothing. */
      const wanted = request.weight || 400;

      /* Whether a small request may be answered from a strike at all.
       *
       * **Read out of `GDI.EXE`.** The test at `seg3:13f3` is `cmp ax,0xb`:
       * eleven pixels or fewer -- or a negative height of ten or fewer -- and
       * the realiser does not consult the scalable walk at all. But it only
       * gets that far when the two bytes `11d9` and `11df` left behind are
       * right: those are the `dfPitchAndFamily` and `dfCharSet` of the TrueType
       * face the name was found in, and `13db` requires the charset to be
       * nought and `13e1` requires bit 0 of the pitch -- an ANSI face of
       * variable pitch.
       *
       * That is the whole of why `OUTLINE_FLOOR` has exceptions. Courier New is
       * fixed pitch, so eight pixel Courier New is Courier New and not Small
       * Fonts; Symbol and Wingdings are charset two, so eight pixel Symbol is
       * Symbol, seven rows of it. Both were **recorded** as exceptions before
       * this was read, and this is the rule they are exceptions to.
       */
      const stub = outline.font.resource;
      const small = !stub || (stub.charSet === 0 && (stub.pitchAndFamily & 1) === 1);

      /* A face's own strike is tried first and on its own terms -- it is not a
       * fallback, so `OUTLINE_FLOOR` does not apply to it -- and where it has
       * none at the height asked for, the ordinary search runs as it always
       * did. Restricting the search to the face's own name instead of trying it
       * first is what made Arial at eight pixels stop being `MS Serif`.
       */
      const strike =
        (own && !symbolic
          ? this._strikeAt(
              request.height ?? 0,
              charset,
              outline.font.fixedPitch,
              own,
              true,
              wanted,
              request.width || 0
            )
          : null) ??
        (request.width || (!symbolic && !small)
          ? null
          : this._strikeAt(
              request.height ?? 0,
              charset,
              outline.font.fixedPitch,
              symbolic ? (own ?? outline.name) : null,
              symbolic && Boolean(own),
              wanted,
              0,
              (pitchAndFamily & 0xf0) === FontManager.FF_SWISS
                ? FontManager.SMALL_FACES.slice(1)
                : FontManager.SMALL_FACES
            ));

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
           *
           * It is the strike that answered that decides it, not whether the
           * family has one somewhere. An EGA installs `ARIALB.FON`, so Arial
           * has strikes of its own at eleven and thirteen rows; asked for at
           * eight it still falls to `MS Serif`, and that is a fallback and
           * answers 255. Reading it as "the family has a strike" instead makes
           * every small Arial and Times New Roman on an EGA answer 1, and takes
           * the emboldening floor off them as well -- `emboldens` reads the
           * same flag. **Recorded**, eighteen records of the EGA sweep.
           */
          outlineFamily: strike.name !== outline.name,
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

    /* A name the directory holds but cannot answer in this character set --
     * Wingdings asked for in the ANSI set -- is scored like any other: every
     * candidate carries the same name mismatch, so the other terms decide. That
     * is the competition, and it is what runs here now: the searches in
     * `seg3:0e95` all require the charset to match, so a name they will not
     * accept is a name that answered nothing, and `0550` scores the directory.
     *
     * **Recorded** on both displays: at ten Windows answers Small Fonts, at
     * sixteen, twenty and twenty-four MS Sans Serif on a VGA -- exact strikes
     * pay nothing and the raster pass keeps the tie -- and on an EGA, where the
     * off-square term makes every strike cost 210, Arial at sixteen.
     */
    if (outline && !usable && !wantsItalic && charset !== FontManager.OEM_CHARSET) {
      const competed = this._compete(request);

      if (competed) {
        return competed;
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

    /* A name whose only strikes the charset refuses has answered nothing, and
     * the competition runs. Terminal asked for in the ANSI set is the case:
     * every strike it has is an OEM one, so none of the searches in `0e95` will
     * take it, and `0550` scores the directory -- MS Sans Serif on a VGA, whose
     * sixteen row strike is exact and free, and Arial on an EGA, where it is
     * not. **Recorded** on both.
     */
    if (!found && request.face && this.lookup(face)) {
      const competed = this._compete(request);

      if (competed) {
        return competed;
      }
    }

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
    /* A family with no candidate at all costs more than any name does, so it
     * loses to an outline the same way a family whose best strike is too
     * expensive does. See `choose`, which answers nothing rather than its
     * smallest when every strike it has was refused for being stretched too
     * far.
     */
    if (!chosen || (found && chosen.cost > FontManager.FACE_PENALTY)) {
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

    if (!chosen) {
      return null;
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
    /* The horizontal size before any width is asked for, which is the vertical
     * one only where the pixel is square.
     *
     * A display reports a logical resolution each way, and an EGA's is ninety-six
     * dots to the inch across and seventy-two down. An outline realised at `n`
     * pixels vertically there is realised at `4n/3` horizontally, before
     * `lfWidth` enters at all: Arial asked for sixteen pixels comes back with an
     * average of eight and a maximum of eighteen, where the vertical size alone
     * gives six and fifteen. **Recorded** by the `maxwidth` sweep on both
     * displays -- of the 23 rows that ask for no width, 21 come out right on the
     * average and the maximum at once with this and nothing else, and the two
     * that do not are a cell height realised differently rather than an aspect.
     * A VGA's two resolutions are equal, so this is the identity there and the
     * whole recorded corpus, which was taken on one, does not move.
     */
    /* The horizontal size is not a size GDI carries: it is a *denominator*.
     *
     * **Read out of the binary.** The realiser at `seg3:0x21fb` builds the
     * physical header from the design one, and the em it divides a horizontal
     * quantity by is
     *
     *     hDenom = MulDiv(dfPoints, logPixelsY, (logPixelsX * ratio) >> 8)
     *
     * with `ratio` the width stretch in 8.8, so that a design width becomes
     * `MulDiv(width, ppem, hDenom)`. With no width asked for the ratio is 256
     * and this is `MulDiv(dfPoints, logPixelsY, logPixelsX)` -- 2048 on a square
     * pixel and 1536 on an EGA, which is the whole of the aspect. Expressed as
     * a size, which is what the rest of this wants, that is
     * `ppem * unitsPerEm / hDenom`.
     *
     * The `>> 8` is where the bits go. `logPixelsX * ratio` is truncated to a
     * whole number before it becomes a denominator, so the horizontal size lands
     * on one of a coarse set of values -- and that is why the plain
     * `ppem * lfWidth / average` is right exactly where the average divides and
     * low everywhere else. **Scored**: 0 of 3,861 records wrong across thirteen
     * recordings of the `maxwidth` sweep, against 158 without the cap below,
     * 981 for the 8.8 ratio applied as a size and 1,024 for the exact ratio.
     * See `FONTS.md`.
     */
    const mulDiv = (a, b, c) => Math.floor((a * b + Math.floor(c / 2)) / c);

    /* Ninety-six each way is what every display this has been recorded on
     * reports across, and the standard VGA driver reports down; a caller that
     * does not name a display gets the square pixel that implies, which is what
     * this did before the aspect was known about at all. */
    const logX = request.logPixelsX || 96;
    const logY = request.logPixelsY || 96;

    /* `dfPoints` for all three outline faces is the em, and the stub carries
     * both, so the em stands in for it. */
    /* The denominator stops at what a sixteen bit word holds.
     *
     * `MulDiv` is a sixteen bit function, and a small enough stretch sends this
     * past its range: Courier New at thirty-two pixels asked for one on a VGA
     * wants 39,322, and a stub with `dfAvgWidth` at four ems wants 65,536.
     * **Measured**, three ways -- the ruler stub reads Courier New's maximum
     * there as 18 where the unclamped denominator gives 15, the four-em stub
     * answers 5 for a width of one where it gives 3, and the sixteen-em stub
     * answers a flat 7 for widths one through nine where it gives 0 and 1 and
     * climbs. All three land on a denominator of 32,768, and the EGA's own
     * over-range row lands there too, where flooring the *ratio* instead gets
     * the VGA right and the EGA wrong.
     *
     * 32,767 fits the recorded corpus exactly as well as 32,768 does; nothing
     * here separates them.
     */
    const emDenom = (ratio) => {
      const shifted = (logX * ratio) >> 8;

      return shifted > 0 ? Math.min(0x8000, mulDiv(font.unitsPerEm, logY, shifted)) : 0x8000;
    };

    const across = (ppem) => (ppem * font.unitsPerEm) / emDenom(256);

    /* The mapper's own arithmetic, at `seg3:0x2a9c`: 256 times the width, plus
     * half the average, divided by the average. 256 -- the identity -- when no
     * width is asked for.
     */
    const ratioFor = (vertical) => {
      if (!(width > 0) || !font.averageAdvance) {
        return 256;
      }

      const average = mulDiv(font.averageAdvance, vertical, emDenom(256));

      return average > 0 ? Math.floor((256 * width + (average >> 1)) / average) : 256;
    };

    const stretched = (vertical) => (vertical * font.unitsPerEm) / emDenom(ratioFor(vertical));

    /* The whole horizontal size the scaler runs the hint program at.
     *
     * It is the 8.8 stretch applied to the size and truncated -- the same
     * multiply-and-shift the denominator is built from -- and **not** the floor
     * of the fractional size the metrics use. The two differ by a pixel wherever
     * the fractional size lands a hair under a whole one: Arial at
     * thirty-two pixels asked for twenty is 44.993 pixels across and runs at 45,
     * Times New Roman at the same request 48.935 and runs at 49, and Windows's
     * text extents for both are the ones those whole sizes give.
     */
    const whole = (vertical) => {
      /* Two steps, in this order: the 8.8 stretch is applied to the *vertical*
       * size and truncated, and that whole number is then carried across the
       * aspect with `MulDiv`. On a square pixel the second step is the identity
       * and this is the rule the VGA measured; on an EGA the two steps do not
       * commute, and the advances say which way round they go.
       *
       * **Measured** against the `charscal` sweep recorded on an EGA: for each
       * of its 594 rows the whole size was solved for by recomputing all 224
       * advances at every candidate within three pixels, and 584 of them have
       * one. This reproduces all 584. Stretching the horizontal base instead
       * gets 385, taking the whole size across the aspect before the stretch
       * 270, and rounding rather than truncating anywhere between 269 and 293.
       */
      return mulDiv((vertical * ratioFor(vertical)) >> 8, logX, logY);
    };

    /* Which of `VDMX`'s ratio groups the realisation falls in.
     *
     * The table holds one set of fitted extents per aspect ratio -- 4:3, 5:3,
     * 2:1 and a catch-all -- and the ratio to look it up by is the em against
     * the horizontal denominator, which is exact and whole where the size
     * derived from it is not. With no width on a square pixel that is 1:1 and
     * only the catch-all matches; an EGA is 4:3; and a width that makes the em
     * exactly twice as wide as it is tall is 2:1.
     *
     * **Measured.** Courier New's four groups differ at nine and ten pixels per
     * em and nowhere else: the catch-all fits nine per em into a cell of twelve
     * and the other three into thirteen. Windows answers a request for twelve
     * pixels on a VGA with twelve at every width but ten, and with thirteen at
     * ten -- which is exactly the width that makes the denominator half the em.
     * On an EGA the same face answers eight for requests of eight, ten and
     * twelve, because in the 4:3 group there is no cell between eight and
     * thirteen.
     */
    const ratioOf = (vertical) => [font.unitsPerEm, emDenom(ratioFor(vertical))];

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
     *
     * Sixteen is what twelve points comes to at ninety-six dots to the inch,
     * and it is the device's own vertical resolution that says so: an EGA's is
     * seventy-two, twelve points is twelve pixels there, and all three outline
     * faces answer a height of zero with a cell of fifteen. **Recorded** on
     * both displays.
     */
    if (height <= 0) {
      const size =
        height < 0 ? -height : mulDiv(FontManager.DEFAULT_POINTS, request.logPixelsY || 96, 72);
      const extent = font.extentAt(size, ...ratioOf(size));

      return extent
        ? {
            entry: null,
            ppem: size,
            xBase: across(size),
            xPpem: stretched(size),
            xWhole: whole(size),
            ascent: extent.ascent,
            descent: extent.descent,
          }
        : null;
    }

    /* The size is searched for at the aspect the request has before a width
     * enters -- the mapper settles the height first, at `seg3:0x29e5`, and only
     * then works out the stretch -- and the extent reported for it is read again
     * at the aspect the realisation ends up with. That is how a width can move
     * the cell height without moving the size. */
    const found = font.sizeForHeight(height, font.unitsPerEm, emDenom(256));

    if (!found) {
      return null;
    }

    const fitted = font.extentAt(found.ppem, ...ratioOf(found.ppem)) ?? found;

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
      xBase: across(found.ppem),
      xPpem: stretched(found.ppem),
      xWhole: whole(found.ppem),
      ascent: synthetic
        ? Math.round((font.ascender * found.ppem) / font.unitsPerEm)
        : fitted.ascent,
      descent: synthetic
        ? Math.round((font.descender * found.ppem) / font.unitsPerEm)
        : fitted.descent,
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

    /* What a pixel of this device is shaped like, in hundredths: a hundred
     * where it is square, and a hundred and twenty-six on an EGA.
     *
     * **Read out of the binary.** The penalty routine at `seg3:17b4` forms it
     * at `1d34` as `MulDiv(100, arg, arg)` from two words the mapper's loop at
     * `2841` passes it, and those two are `[si+0x2a]` and `[si+0x28]` of the
     * device's `GDIINFO` -- `dpAspectY` and `dpAspectX`, which `GetDeviceCaps`
     * answers `ASPECTY` and `ASPECTX` from. Not the logical resolution: a VGA
     * reports 36 and 36 and an EGA 38 and 48, so this is 100 and 126 where the
     * resolution would say 100 and 133. A square display cannot tell the two
     * apart, which is why the EGA recording is what settled it.
     */
    const square = FontManager.muldiv(100, request.aspectY || 96, request.aspectX || 96);

    /* No height named means the mapper's own default, which is twelve points.
     * That is a size rather than a cell, so it is compared the way a negative
     * height is -- against the characters rather than against the cell around
     * them -- and lands on the same strike Windows picks.
     *
     * Twelve points is a size on the page and not a count of rows, so how many
     * rows it comes to is the device's own vertical resolution: sixteen on a
     * VGA and twelve on an EGA. Asked for nothing at all on an EGA, Windows
     * answers MS Sans Serif's twelve point strike -- fifteen rows around twelve
     * characters -- where the VGA's sixteen would have taken the fourteen point
     * one. **Recorded.**
     */
    const target = height
      ? Math.abs(height)
      : FontManager.muldiv(FontManager.DEFAULT_POINTS, request.logPixelsY || 96, 72);

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

      /* A negative height asks for the characters rather than the cell, and
       * the leading is a fixed fraction of the design, so the cell it implies
       * follows from it.
       *
       * Zero asks for the mapper's default, and that is the same twelve points
       * a bitmap face gets rather than a size of its own. It had been read as a
       * flat eighteen pixels, which is what twelve points comes to on a VGA
       * once the design's own leading is put back: twelve points is sixteen
       * pixels at ninety-six dots to the inch, and sixteen characters inside
       * Roman's twenty-eight row design make an eighteen row cell. On an EGA,
       * where the vertical resolution is seventy-two, twelve points is twelve
       * pixels and the cell is fourteen -- which is what Windows answers.
       * **Recorded**, for all three plotter fonts on both displays.
       */
      const design = entry.header.dfPixHeight;
      const em = design - entry.header.dfInternalLeading;

      let cell = Math.abs(height);

      if (height <= 0) {
        const characters = height
          ? -height
          : FontManager.muldiv(FontManager.DEFAULT_POINTS, request.logPixelsY || 96, 72);

        cell = Math.round((characters * design) / em);
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
      /* And the device's own aspect on top of the design's, which is the
       * identity on a square pixel and four thirds on an EGA. The plotter fonts
       * are the only faces whose width is arrived at this way, and the EGA's
       * glyph sweep is the only recording that separates the two aspects. */
      const average =
        width > 0
          ? width
          : Math.floor(
              (entry.header.dfAvgWidth * cell * entry.header.dfVertRes * (request.aspectY || 96)) /
                (entry.header.dfPixHeight * entry.header.dfHorizRes * (request.aspectX || 96))
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
       * The device's own aspect is a hundred on a VGA, whose pixel is square,
       * and `MulDiv(100, aspectX, aspectY)` in general -- 133 on an EGA, which
       * is ninety-six dots across to seventy-two down. That is what decides
       * between a small strike drawn many times and a larger one drawn few, and
       * on a display that is not square it decides differently.
       */
      const shape = FontManager.muldiv(
        100,
        entry.header.dfHorizRes || 1,
        entry.header.dfVertRes || 1
      );

      const perTime = FontManager.muldiv(shape, 1, times);

      let across = 1;

      if (stretching && perTime + (perTime >> 1) < square) {
        across = Math.min(FontManager.MAX_WIDTH_STRETCH, FontManager.muldiv(square, 1, perTime));

        cost = (cost + FontManager.STRETCH_PENALTY * across) | (across - 1);
      }

      cost +=
        FontManager.ASPECT_PENALTY * Math.abs(square - FontManager.muldiv(shape, across, times));

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

    /* And a family every one of whose strikes was refused answers with nothing
     * at all, which is not the same thing as answering with its smallest.
     *
     * The refusal above -- a strike may not be drawn so many times over that
     * the multiple plus two reaches its own height -- can take every strike a
     * family has, and then the family is simply not a candidate. On an EGA,
     * whose strikes are three quarters the height of a VGA's, Fixedsys is a
     * single ten row strike and Small Fonts tops out at nine, so a request from
     * seventy-eight pixels upward leaves both with nothing: eight times over is
     * the most GDI will draw a strike, and ten is where eight plus two reaches.
     * Windows answers those requests with Arial. **Recorded**, by the `font`
     * sweep on an EGA -- 41 requests, every one of them Fixedsys or Small Fonts
     * at a height of seventy-eight or more, and every one of them answered
     * `Arial`. The same sweep on a VGA has no such request, because there the
     * same two faces carry thirteen and eleven row strikes.
     */
    if (!best) {
      return null;
    }

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
