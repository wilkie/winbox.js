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
  const width = turnedLength(surface.font, metrics.width);

  // Return the DWORD consisting of the dimensions
  return (width & 0xffff) | ((metrics.height & 0xffff) << 16);
}

/**
 * The length of a turned string on a pixel that is not square.
 *
 * A turned TrueType font's widths are sums across the page, and on a device
 * whose two resolutions differ GDI scales that sum by the length of the
 * baseline's unit step as it lands on the device: `GDI.EXE` seg1 `6ab0` asks
 * seg3 `2615` for a factor and keeps `sum * factor >> 8`. The factor is the
 * square root of `a^2 + b^2`, where `a` is the angle's sine times
 * `256 * V / H` rounded and `b` its cosine times 256, each through seg33's
 * multiplies -- the vertical part of the step shrunk by the resolutions'
 * ratio, the horizontal part not.
 *
 * **Recorded** by `rotherc`: all 216 turned records on a Hercules. The square
 * root truncated; rounded, it is 215. A square pixel has a factor of 256 at
 * every angle and nothing changes, which is why GDI only asks where the two
 * resolutions differ.
 */
function turnedLength(font, width) {
  const style = font?.style ?? {};
  const H = style.horizontalRes ?? 96;
  const V = style.verticalRes ?? 96;
  const escapement = font?.escapement ?? 0;

  if (!font?.outline || escapement === 0 || H === V) {
    return width;
  }

  const radians = (escapement * Math.PI) / 1800;
  const fixed = (value) => Math.round(value * 65536);
  const fixMul = (value, factor) => Math.floor((value * factor + 32768) / 65536);
  const ratio = Math.floor((256 * V + Math.floor(H / 2)) / H);
  const a = fixMul(ratio, fixed(Math.sin(radians)));
  const b = fixMul(256, fixed(Math.cos(radians)));
  const factor = Math.floor(Math.sqrt(a * a + b * b));

  return Math.floor((width * factor) / 256);
}
