'use strict';

import { Util } from '../util.js';
import { Executable } from '../executable.js';
import { Color } from './color.js';
import { Font } from './font.js';

/**
 * A single bitmap font entry from a bitmap font.
 *
 * Generally, this depicts a bitmap font of a particular style or size that
 * is contained among many within a single font file or resource.
 */
export class BitmapFontEntry {
  declare _chars: any;
  declare _device: any;
  declare _header: any;
  declare _name: any;
  declare _view: any;
  constructor(data, options: any = {}) {
    this._view = new DataView(data);

    // The character cache
    this._chars = {};
  }

  get header() {
    if (!this._header) {
      this._header = Util.readStructure(this._view, BitmapFont.FNTHeader, 0, true);
    }

    return this._header;
  }

  get name() {
    if (!this._name) {
      this._name = Util.readString(this._view, this.header.dfFace);
    }

    return this._name;
  }

  get device() {
    if (!this._device) {
      const offset = this.header.dfDevice;
      if (offset) {
        this._device = Util.readString(this._view, this.header.dfDevice);
      }
    }

    return this._device || '';
  }

  /**
   * Returns the version of the font specification being used.
   */
  get version() {
    const major = this._view.getUint8(1);
    const minor = this._view.getUint8(0);

    return major.toString() + '.' + minor.toString();
  }

  /**
   * Returns the weight of the font on a scale from 1 to 1000.
   *
   * The weight of a regular font is 400.
   */
  get weight() {
    return this.header.dfWeight;
  }

  /**
   * The point size of this bitmap font.
   */
  get size() {
    return this.header.dfPoints;
  }

  get charSet(): any {
    // FIXME(ts-migration): unimplemented; returns undefined as before.
    return undefined;
  }

  /**
   * Draws the bitmap font to the given 2d canvas context.
   */
  draw(ctx, x, y, text, options: any = {}) {
    let color = options.color || 0x0;
    const weight = options.weight || 400;
    const italic = options.italic || false;
    const allowAnnotation = options.allowAnnotation || false;

    if (text === '') {
      return;
    }

    /* How many times over the strike is drawn.
     *
     * A face has a handful of strikes and is asked for every size, so a size
     * with no strike near enough may be answered by drawing a smaller one a
     * whole number of times over instead -- MS Serif asked for twenty has no
     * twenty row strike and doubles its ten row one. The mapper decides this
     * and the metrics already report it; drawing has to do it as well, or a
     * doubled face measures twice as wide as it draws.
     */
    const up = options.scale || 1;
    const across = options.horizontal || up;

    // Measure the text
    const metrics = this.measure(text, options);
    const height = metrics.height * up;

    /* How far the topmost row leans, which is also what Windows reports as the
     * overhang. Everything below it leans less; nothing leans more.
     */
    const overhang = (height - 1) >> 1;

    /* Room for the lean. A slanted row is drawn to the right of where an
     * upright one would be, and the region the pixels are written into is
     * measured without it -- so the top of every letter fell off the end,
     * which looked exactly like a glyph whose right-hand side was missing.
     */
    const width = metrics.width * across + (italic ? overhang : 0);

    // Pull out the image data for that region
    const imageData = ctx.getImageData(x, y, width, height);
    const data = imageData.data;

    if (!(color instanceof Color)) {
      color = new Color(color);
    }

    // Paint over the canvas
    let relativeX = 0;
    let annotate = false;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);

      if (annotate && text[i] == '&') {
        annotate = false;
      } else if (allowAnnotation && text[i] == '&') {
        annotate = true;
        continue;
      }

      const info = this.characterEntryFor(code);

      /* The scaling multiplies the stored width; the emboldening adds one
       * device pixel to it, once, however many times over the strike is drawn.
       * That is the same arithmetic the metrics do.
       */
      let charWidth = info.width * across;

      if (this.weight <= 400 && weight > 400) {
        // Bold style is emulated and increase character width by 1
        charWidth++;
      }

      for (let j = 0; j < height; j++) {
        /* Slanting is done as the rows are written, in pairs counted from the
         * *top* of the cell: the first two rows lean by the whole overhang and
         * every two rows after that lean one pixel less, down to nothing.
         * Nothing ever leans left, so the baseline is not the anchor and
         * neither is the bottom of the cell -- the top is.
         *
         * Counting the pairs from the bottom instead is the natural way to
         * write it and agrees exactly half the time: the two readings differ
         * only where the cell has an odd number of rows, since that is where
         * the leftover row falls at a different end. **Measured** over eight
         * sizes of seven faces -- Fixedsys, whose only strike is fifteen rows,
         * disagreed at every size and every letter, and MS Sans Serif and
         * Courier disagreed at exactly the sizes their thirteen row strike
         * answers and nowhere else.
         */
        const lean = italic ? overhang - (j >> 1) : 0;

        const row = info.glyph[Math.floor(j / up)] ?? [];

        let lastPixel = 0;
        for (let i = relativeX; i < relativeX + charWidth; i++) {
          const nextPixel = row[Math.floor((i - relativeX) / across)] || 0;
          let pixel = nextPixel;

          if (!pixel && this.weight <= 400 && weight > 400) {
            // Bold emulation copies over the pixels
            pixel = lastPixel;
          }

          if (pixel && i + lean >= 0 && i + lean < width) {
            const position = (j * width + i + lean) * 4;

            data[position + 0] = color.red;
            data[position + 1] = color.green;
            data[position + 2] = color.blue;
            data[position + 3] = 0xff;
          }

          lastPixel = nextPixel;
        }
      }

      if (annotate) {
        annotate = false;

        // Draw the underline for this annotation character
        const j = height - 1;
        for (let i = relativeX; i < relativeX + charWidth; i++) {
          const position = (j * width + i) * 4;

          data[position + 0] = color.red;
          data[position + 1] = color.green;
          data[position + 2] = color.blue;
          data[position + 3] = 0xff;
        }
      }

      // Go to next character
      relativeX += charWidth;
    }

    ctx.putImageData(imageData, x, y);

    return metrics;
  }

  /**
   * Measures the text and returns the dimensions of the given string.
   */
  measure(text, options: any = {}) {
    const weight = options.weight || 400;
    const allowAnnotation = options.allowAnnotation || false;

    /* A string with nothing in it occupies nothing at all, not a zero-width
     * strip of the font's height -- `GetTextExtent("")` on Windows is zero by
     * zero, and layout code divides by the result.
     */
    if (text.length === 0) {
      return { width: 0, height: 0 };
    }

    const ret = {
      width: 0,
      height: this.header.dfPixHeight,
    };

    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);

      if (allowAnnotation && text[i] == '&') {
        continue;
      }

      const info = this.characterEntryFor(code);
      ret.width += info.width;

      if (this.weight <= 400 && weight > 400) {
        // Bold style is emulated and increase character width by 1
        ret.width++;
      }
    }

    return ret;
  }

  /**
   * Returns an image with the given text rendered in the given color.
   */
  dataFor(text, options: any = {}) {
    const color = options.color || 0x0;
    const weight = options.weight || 400;
    let width = options.width || 0;

    // Measure the text
    const metrics = this.measure(text, options);

    let lines = [text];
    let height = 0;

    // We may need to measure with word-wrap

    if (width > 0) {
      // Word wrap!
      // For every word...
      let words = text.split(' ');
      const spaceInfo = this.measure(' ', options);
      let line = '';
      let y = 0;
      let maxWidth = 0;

      lines = [];

      // For each line...
      while (words.length > 0) {
        // Determine the words on this current line
        let x = 0;
        let i = 0;
        for (; i < words.length; i++) {
          const wordMetrics = this.measure(words[i], options);
          if (i > 0 && wordMetrics.width + x > width) {
            // Stop here
            break;
          }
          x += wordMetrics.width + spaceInfo.width;
        }

        x -= spaceInfo.width;
        maxWidth = Math.max(maxWidth, x);

        line = words.slice(0, i).join(' ');
        words = words.slice(i, words.length);

        // Push the line
        lines.push(line);

        // Go to the next line
        y += metrics.height;
      }

      width = maxWidth;
      height = y;
    } else {
      // Just measure the line
      width = metrics.width;
      height = metrics.height;
    }

    // Use an internal canvas
    const canvas = document.createElement('canvas');
    canvas.setAttribute('width', width);
    canvas.setAttribute('height', String(height));

    const ctx = canvas.getContext('2d');

    let y = 0;
    lines.forEach((line) => {
      this.draw(ctx, 0, y, line, options);
      y += metrics.height;
    });
    return canvas.toDataURL('image/png');
  }

  /**
   * Whether this font is strokes rather than pixels.
   *
   * The low bit of `dfType` says so. Windows calls these plotter fonts, and
   * three of them ship with 3.1 -- Roman, Modern and Script. They have one
   * design apiece rather than a set of strikes, and GDI draws them at whatever
   * size is asked for, which makes them a different kind of thing from
   * everything else in this file however similar the container looks.
   */
  get isVector() {
    return (this.header.dfType & 0x01) === 1;
  }

  /**
   * Where the character table begins.
   *
   * A 3.x font puts it after a 148 byte header and a 2.x font after 118. The
   * vector fonts are version 1.0 and put it at 119, which is not a number any
   * documentation to hand gives: it was found by reading the table at each
   * candidate offset and seeing which one reproduces the widths the header
   * itself reports in `dfAvgWidth` and `dfMaxWidth`. Only 119 does, for all
   * three of them.
   */
  get tableOffset() {
    if (this.isVector) {
      return 119;
    }

    return this.header.dfVersion <= 0x200 ? 118 : 148;
  }

  /** How wide the character table's entries are, in bytes. */
  get entrySize() {
    return this.header.dfVersion <= 0x200 ? 4 : 6;
  }

  /**
   * The strokes that draw one character, as runs of points to join up.
   *
   * The data is a stream of signed byte pairs. A `0x80` byte lifts the pen and
   * the pair after it is an absolute position to move to; any other byte is
   * the first of a pair of offsets from where the pen already is, and the pen
   * draws as it goes. So a character is a handful of polylines, in the design
   * coordinates of the font.
   */
  strokesFor(code) {
    if (typeof code === 'string') {
      code = code.charCodeAt(0);
    }

    const info = this.characterEntryFor(code);
    const runs: number[][][] = [];

    let at = this.header.dfBitsOffset + info.offset;
    const end = Math.min(at + info.length, this._view.byteLength);

    let run: number[][] | null = null;
    let x = 0;
    let y = 0;

    const signed = (byte) => (byte > 0x7f ? byte - 0x100 : byte);

    while (at < end - 1) {
      const marker = this._view.getUint8(at);

      if (marker === 0x80) {
        // Pen up: the pair that follows is where to put it down again.
        x = signed(this._view.getUint8(at + 1));
        y = signed(this._view.getUint8(at + 2));

        run = [[x, y]];
        runs.push(run);
        at += 3;
        continue;
      }

      x += signed(this._view.getUint8(at));
      y += signed(this._view.getUint8(at + 1));

      if (!run) {
        run = [[x, y]];
        runs.push(run);
      } else {
        run.push([x, y]);
      }

      at += 2;
    }

    return runs;
  }

  /**
   * Returns the character information for the given codepoint.
   */
  characterEntryFor(code) {
    if (!this._chars[code]) {
      if (typeof code === 'string') {
        code = code.charCodeAt(0);
      }

      if (code < this.header.dfFirstChar || code > this.header.dfLastChar) {
        return this.characterEntryFor(this.header.dfDefaultChar + this.header.dfFirstChar);
      }

      const entrySize = this.entrySize;
      const entryDefinition =
        entrySize === 4 ? BitmapFont.FNT2CharacterEntry : BitmapFont.FNT3CharacterEntry;

      let offset = code - this.header.dfFirstChar;
      offset *= entrySize;
      offset += this.tableOffset;

      const info = Util.readStructure(this._view, entryDefinition, offset);

      if (this.isVector) {
        /* A stroke character has no raster to read. How much of the stroke
         * data belongs to it is the distance to whatever the next character
         * points at, which is how the runs know where to stop.
         */
        const next = Util.readStructure(this._view, entryDefinition, offset + entrySize);

        info.length = Math.max(0, (next.offset || info.offset) - info.offset);
        info.glyph = null;

        this._chars[code] = info;

        return info;
      }

      // Read raster data
      offset = info.offset;

      info.glyph = new Array(this.header.dfPixHeight);

      // Read each scanline 8 pixels at a time
      for (let i = 0; i < info.width; i += 8) {
        // Read an entire 8 pixel column
        for (let j = 0; j < this.header.dfPixHeight; j++) {
          if (info.glyph[j] === undefined) {
            info.glyph[j] = [];
          }
          let b = this._view.getUint8(offset);
          for (let sb = 0; sb < 8; sb++) {
            if (i + sb < info.width) {
              info.glyph[j].push((b & 0x80) >> 7);
              b <<= 1;
            }
          }
          offset++;
        }
      }

      this._chars[code] = info;
    }

    return this._chars[code];
  }
}

/**
 * Loads one or more bitmap fonts from a given font resource.
 */
export class BitmapFont extends Font {
  declare _entries: any;
  declare _stream: any;
  declare static FNT2CharacterEntry: any;
  declare static FNT3CharacterEntry: any;
  declare static FNTHeader: any;
  declare static SLANT: any;
  declare static _cache: any;
  declare static _promiseCache: any;
  async load(options: any = {}) {
    if ((await this._stream.read16(0)) == 0x5a4d) {
      // This is an executable, pull fonts from resources
      const executable = new Executable('FONT', 'C:\\FONT.FON', this._stream);
      await executable.parse();

      // Get font resources
      const resources = executable.resources;
      for (let i = 0; i < resources.length; i++) {
        const resourceType = resources[i];
        if (resourceType.id == Executable.RESOURCES.Font) {
          const entries = resourceType.entries;
          for (let j = 0; j < entries.length; j++) {
            const resource = entries[j];
            const subData = await executable.readResource(resource);
            const font = new BitmapFontEntry(subData, options);
            this._entries.push(font);
          }
        }
      }
    } else {
      // Likely its own font
      this._entries.push(new BitmapFontEntry(this._stream, options));
    }
  }

  constructor(stream, options: any = {}) {
    super();

    this._stream = stream;
    this._entries = [];
  }

  /**
   * Retrieves a list of BitmapFontEntry objects for each contained font.
   */
  get entries() {
    return this._entries.slice();
  }

  fontFor(size) {
    let ret = null;

    this._entries.forEach((entry) => {
      if (ret == null || Math.abs(entry.size - size) < Math.abs(entry.size - ret.size)) {
        ret = entry;
      }
    });

    return ret;
  }
}

BitmapFont._promiseCache = {};
BitmapFont._cache = {};

// https://www.undocprint.org/formats/font_formats

/**
 * How far a synthesised italic leans, per pixel of height above the baseline.
 *
 * Swept against what Windows draws. A half is what the recorded overhang
 * implies -- `floor((cell - 1) / 2)` across the whole cell -- and what the
 * pixels agree with.
 */
BitmapFont.SLANT = 0.5;

BitmapFont.FNTHeader = {
  dfVersion: [0, 2],
  dfSize: [2, 4],
  dfCopyright: [6, '60'],
  dfType: [66, 2],
  dfPoints: [68, 2],
  dfVertRes: [70, 2],
  dfHorizRes: [72, 2],
  dfAscent: [74, 2],
  dfInternalLeading: [76, 2],
  dfExternalLeading: [78, 2],
  dfItalic: [80, 1],
  dfUnderline: [81, 1],
  dfStrikeOut: [82, 1],
  dfWeight: [83, 2],
  dfCharSet: [85, 1],
  dfPixWidth: [86, 2],
  dfPixHeight: [88, 2],
  dfPitchAndFamily: [90, 1],
  dfAvgWidth: [91, 2],
  dfMaxWidth: [93, 2],
  dfFirstChar: [95, 1],
  dfLastChar: [96, 1],
  dfDefaultChar: [97, 1],
  dfBreakChar: [98, 1],
  dfWidthBytes: [99, 2],
  dfDevice: [101, 4], // Offset to string naming the device name
  dfFace: [105, 4], // Offset to string naming the font
  dfBitsPointer: [109, 4], // Absolute address of the bitmap
  dfBitsOffset: [113, 4], // Offset to bitmap information
  dfReserved: [117, 1],
  dfFlags: [118, 4],
  dfAspace: [122, 2],
  dfBspace: [124, 2],
  dfCspace: [126, 2],
  dfColorPointer: [128, 4],
  dfReserved1: [132, 16],
};

/**
 * Character entry for a 2.x font.
 */
BitmapFont.FNT2CharacterEntry = {
  width: [0, 2],
  offset: [2, 2],
};

/**
 * Character entry for a 3.x font.
 */
BitmapFont.FNT3CharacterEntry = {
  width: [0, 2],
  offset: [2, 4],
};

export default BitmapFont;
