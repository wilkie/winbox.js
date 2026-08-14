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
  static SUBSTITUTES = {
    helv: 'MS Sans Serif',
    'tms rmn': 'MS Serif',
    times: 'Times New Roman',
    helvetica: 'Arial',
  };

  /** Every size of a face that has been loaded, after substitution. */
  lookup(name) {
    const face = FontManager.SUBSTITUTES[String(name).toLowerCase()] ?? name;

    return this._fonts[face];
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
