'use strict';

import { mapped, scale } from './mapping.js';

import { turnedLength } from '../../raster/surface.js';

import { justifiedExtent } from './justify.js';

/**
 * The **GetTextExtent** function computes the width and height of a line of
 * text, using the current font to compute the dimensions.
 *
 * The current clipping region does not affect the width and height returned by
 * the **GetTextExtent** function.
 *
 * Since some devices do not place characters in regular cell arrays (that is,
 * they kern characters), the sum of the extents of the characters in a string
 * may not be equal to the extent of the string.
 *
 * **See also**:
 * {@link Gdi.GetTabbedTextExtent GetTabbedTextExtent}
 * {@link Gdi.SetTextJustification SetTextJustification}
 *
 * @static
 * @function GetTextExtent
 * @memberof Gdi
 *
 * @param {Types.HDC} hdc - Identifies the device context.
 * @param {Types.LPCSTR} lpszString - Points to a character string.
 * @param {Types.INT} cbString - Specifies the number of bytes in the string.
 *
 * @return {Types.DWORD} The low-order word of the return value contains the
 *                       string width, in logical units, if the function is
 *                       successful; the high-order word contains the string
 *                       height.
 */
export function GetTextExtent(hdc, lpszString, cbString) {
  // Get the surface instance
  const surface = this.handles.resolve(hdc);

  // Draw the text
  const text = lpszString.slice(0, cbString);
  const metrics = surface.measureText(text);
  /* With the character extra after every character, and the justification:
   * **recorded** by `justify`, "a b c" with an extra of one measured five
   * more. */
  const width =
    turnedLength(surface.font, metrics.width, cbString) +
    (surface.charExtra ?? 0) * text.length +
    justifiedExtent(surface, text);

  /* In logical units, under a mapping mode: the device's extent scaled by
   * the extents' sizes, whichever way an axis runs -- **recorded** by
   * `fillext`, 77 by 16 on the VGA being 250 by 52 in MM_LOMETRIC. */
  const m = mapped(surface);
  const across = m ? scale(width, Math.abs(m.wex), Math.abs(m.vex)) : width;
  const down = m ? scale(metrics.height, Math.abs(m.wey), Math.abs(m.vey)) : metrics.height;

  // Return the DWORD consisting of the dimensions
  return ((across & 0xffff) | ((down & 0xffff) << 16)) >>> 0;
}

/**
 * `GetTextExtent`'s width and height, written to a `SIZE`: **recorded** by
 * `fillext`, the same two numbers for each string, in logical units under
 * a mapping mode, and nought and nought for an empty one; it answers 1.
 *
 * @param {Types.HDC} hdc - The device context.
 * @param {Types.LPCSTR} lpszString - The string.
 * @param {Types.INT} cbString - Its length.
 * @param {Types.FARPTR} lpSize - Where the `SIZE` goes.
 *
 * @returns {Types.BOOL} Whether there was a device context.
 */
export function GetTextExtentPoint(
  this: any,
  hdc: number,
  lpszString: string,
  cbString: number,
  lpSize: number
) {
  if (!this.handles.resolve(hdc)) {
    return 0;
  }

  const both = GetTextExtent.call(this, hdc, lpszString, cbString) >>> 0;
  const core = this.machine.cpu.core;
  const segment = (lpSize >>> 16) & 0xffff;
  const offset = lpSize & 0xffff;

  core.write16(segment, offset, both & 0xffff);
  core.write16(segment, (offset + 2) & 0xffff, (both >>> 16) & 0xffff);

  return 1;
}
