'use strict';

/**
 * The **GetGlyphOutline** function retrieves the outline curve or bitmap for
 * an outline character in the current font.
 *
 * What Windows 3.1 answers is the character as `TextOut` would draw it
 * upright at the realised font's size, hinted: the font's escapement does
 * not turn it and a bold GDI synthesises does not smear it. See
 * `Surface.glyphOutline`. Only a TrueType font has an answer; for a strike
 * the function fails, which is what Windows does for Symbol at sixteen pixels
 * upright, where the mapper hands out a bitmap face.
 *
 * `GGO_METRICS` fills the metrics alone and `GGO_BITMAP` the bitmap as well:
 * one bit a pixel, the top row first, each row padded to a doubleword, and
 * the return value is the bitmap's size. `GGO_NATIVE` -- the outline as
 * curves -- is not implemented and fails. The matrix is read but only the
 * identity has been recorded, and it is what is drawn.
 *
 * @static
 * @function GetGlyphOutline
 * @memberof Gdi
 *
 * @param {Types.HDC} hdc - Identifies the device context.
 * @param {Types.UINT} uChar - Specifies the character.
 * @param {Types.UINT} fuFormat - `GGO_METRICS`, `GGO_BITMAP` or `GGO_NATIVE`.
 * @param {Gdi.GLYPHMETRICS} lpgm - Receives the glyph's placement.
 * @param {Types.DWORD} cbBuffer - The size of the buffer, or nought to ask it.
 * @param {Types.FARPTR} lpBuffer - Receives the bitmap.
 * @param {Gdi.MAT2} lpmat2 - The transformation matrix.
 *
 * @return {Types.DWORD} The size of the buffer the data needs, or -1.
 */
export function GetGlyphOutline(hdc, uChar, fuFormat, lpgm, cbBuffer, lpBuffer, lpmat2) {
  const FAILED = 0xffffffff;
  const surface = this.handles.resolve(hdc);
  const glyph = surface?.glyphOutline ? surface.glyphOutline(uChar & 0xff) : null;

  if (!glyph || fuFormat > 1) {
    return FAILED;
  }

  if (lpgm) {
    lpgm.gmBlackBoxX = glyph.width;
    lpgm.gmBlackBoxY = glyph.height;
    lpgm.gmptGlyphOriginX = glyph.originX;
    lpgm.gmptGlyphOriginY = glyph.originY;
    lpgm.gmCellIncX = glyph.advance;
    lpgm.gmCellIncY = 0;
  }

  if (fuFormat === 0) {
    return 0;
  }

  const stride = ((glyph.width + 31) >> 5) * 4;
  const size = stride * glyph.height;

  if (!cbBuffer || !lpBuffer) {
    return size;
  }

  const cpu = this.machine.cpu.core;
  const segment = (lpBuffer >> 16) & 0xffff;
  const offset = lpBuffer & 0xffff;

  for (let at = 0; at < Math.min(size, cbBuffer); at++) {
    const row = glyph.rows[Math.floor(at / stride)];
    const first = (at % stride) * 8;
    let byte = 0;

    for (let bit = 0; bit < 8; bit++) {
      byte = (byte << 1) | (row[first + bit] ?? 0);
    }

    cpu.write8(segment, offset + at, byte);
  }

  return size;
}
