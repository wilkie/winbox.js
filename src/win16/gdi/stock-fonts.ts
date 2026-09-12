'use strict';

/**
 * What each stock font actually is.
 *
 * Not from a manual. Every one of these was matched against what real Windows
 * reports for it, recorded in `oracle/fixtures/text.json`: the face is what
 * `GetTextFace` answers, and the point size is the one whose metrics agree
 * field for field with `GetTextMetrics` -- height, ascent, average and maximum
 * width, weight, and the character range.
 *
 * Two of them are worth pointing at. `ANSI_VAR_FONT` asks for Helv, which no
 * installed file provides; `WIN.INI` substitutes MS Sans Serif, and the
 * reported face stays Helv. And `DEVICE_DEFAULT_FONT` is Courier on this
 * display driver, not a system font at all -- the name suggests otherwise,
 * which is why it was worth measuring rather than assuming.
 *
 * The size is a **cell height in pixels**, and an EGA is what says so. Read as
 * a point size, `ANSI_VAR_FONT` is MS Sans Serif at eight points, which is
 * thirteen rows on a VGA and ten on an EGA; Windows draws it twelve rows tall
 * on an EGA, which is that face's *ten* point strike. Read as thirteen pixels
 * it is the thirteen row strike on a VGA and the twelve row one on an EGA --
 * the nearest either way, and where two are equally near the shorter, which is
 * the mapper's own two-to-one preference. **Recorded**: six cells of the EGA
 * glyph sweep turn on it and every other stock font on both displays is
 * unmoved.
 */
/* Keyed by the stock font constants as numbers rather than through `Gdi`.
 * These are keys of an object literal, so they are evaluated while this module
 * is being loaded -- and `gdi.ts` imports the function that imports this one,
 * so reaching back into it here reads a class that has not finished
 * initialising. The switch statements elsewhere get away with it because they
 * run when they are called.
 */
export const STOCK_FONTS = {
  10: { face: 'Terminal', cell: 12 }, // OEM_FIXED_FONT
  11: { face: 'Courier', cell: 13 }, // ANSI_FIXED_FONT
  12: { face: 'Helv', cell: 13 }, // ANSI_VAR_FONT
  13: { face: 'System', cell: 16 }, // SYSTEM_FONT
  14: { face: 'Courier', cell: 16 }, // DEVICE_DEFAULT_FONT
  16: { face: 'Fixedsys', cell: 15 }, // SYSTEM_FIXED_FONT
};

/** The font every device context starts with, before anything selects one. */
export const SYSTEM_FONT = 13;

/**
 * Realises a stock font and hands back its handle.
 *
 * `GetStockObject` is the obvious caller, but not the only one: a device
 * context has the system font in it before a program selects anything, so
 * `GetDC` needs the same font by the same route. Doing it here means the two
 * cannot come to different conclusions about what the system font is.
 *
 * @param {Object} context - The module the call is running in.
 * @param {number} index - One of the stock font constants.
 * @returns {number|null} The font's handle, or null if it cannot be realised.
 */
export function stockFontHandle(context, index) {
  const wanted = STOCK_FONTS[index];

  if (!wanted) {
    return null;
  }

  /* A stock font is a face at a size, and both halves matter: the same file
   * holds Courier at thirteen rows and at twenty.
   */
  const font = context.fonts.realize(wanted.face, wanted.cell);

  if (!font) {
    return null;
  }

  return context.handles.lookup(font) || context.handles.allocate(font);
}
