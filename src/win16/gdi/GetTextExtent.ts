'use strict';

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
  const metrics = surface.measureText(lpszString.slice(0, cbString));

  // Return the DWORD consisting of the dimensions
  return (metrics.width & 0xffff) | ((metrics.height & 0xffff) << 16);
}
