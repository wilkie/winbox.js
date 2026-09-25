'use strict';

import { BitmapFont } from '../../raster/bitmap-font.js';

import { FALSE, TRUE } from '../consts.js';

/**
 * Draws a string at a point in the selected font.
 *
 * What is drawn is `Surface.fillText`'s: the ground behind the text under the
 * background mode and colour, the glyphs, and the underline and strikeout,
 * each as recorded (see `kb/gdi/textout.md`). The selected brush plays no
 * part: `textbk` drew with the black stock brush selected, in both modes, and
 * the cell came back as it would with the white one. An earlier version filled
 * the string's measured box with the brush first.
 *
 * @param {Types.HDC} hdc - The device context to draw on.
 * @param {Types.INT} nXStart - Where the string starts, across.
 * @param {Types.INT} nYStart - Where the string starts, down.
 * @param {Types.LPCSTR} lpszString - The string.
 * @param {Types.INT} cbString - How many of its characters to draw.
 *
 * @returns {Types.BOOL} Whether there was a device context to draw on.
 */
export function TextOut(hdc, nXStart, nYStart, lpszString, cbString) {
  const surface = this.handles.resolve(hdc);

  if (!surface) {
    return FALSE;
  }

  surface.fillText(nXStart, nYStart, lpszString.slice(0, cbString));

  return TRUE;
}
