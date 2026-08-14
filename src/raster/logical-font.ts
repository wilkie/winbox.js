'use strict';

import { Font } from './font.js';

/**
 * A font as a program asked for it, resolved to one it can be drawn with.
 *
 * The two are not the same thing and the difference is visible. A program asks
 * for "Helv" at eight points; `WIN.INI` says `Helv=MS Sans Serif`, so what
 * actually gets measured and drawn is MS Sans Serif -- but `GetTextFace` still
 * answers "Helv", because the name belongs to the request rather than to the
 * file that satisfied it.
 *
 * The size matters just as much. A `.FON` file holds several sizes of the same
 * face, and which one is meant is part of what was asked for: `ANSI_FIXED_FONT`
 * is Courier at ten points, thirteen pixels tall, while the same file's fifteen
 * point entry is twenty. Handing round the file and picking a size later is how
 * that gets lost.
 */
export class LogicalFont extends Font {
  declare _face: any;
  declare _points: any;
  declare _entry: any;

  /**
   * @param {string} face - The typeface as it was asked for.
   * @param {number} points - The point size as it was asked for.
   * @param {object} entry - The `BitmapFontEntry` that satisfies it.
   */
  constructor(face, points, entry) {
    super();

    this._face = face;
    this._points = points;
    this._entry = entry;
  }

  /** The typeface as it was asked for, which is what `GetTextFace` reports. */
  get face() {
    return this._face;
  }

  get points() {
    return this._points;
  }

  /** The font that will actually be measured and drawn. */
  get entry() {
    return this._entry;
  }

  get header() {
    return this._entry.header;
  }

  measure(text, options: any = {}) {
    return this._entry.measure(text, options);
  }

  dataFor(text, options: any = {}) {
    return this._entry.dataFor(text, options);
  }
}
