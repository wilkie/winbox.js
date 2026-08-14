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
 * installed file provides; `WIN.INI` substitutes MS Sans Serif, whose eight
 * point entry matches exactly, and the reported face stays Helv. And
 * `DEVICE_DEFAULT_FONT` is Courier at twelve points on this display driver,
 * not a system font at all -- the name suggests otherwise, which is why it was
 * worth measuring rather than assuming.
 */
/* Keyed by the stock font constants as numbers rather than through `Gdi`.
 * These are keys of an object literal, so they are evaluated while this module
 * is being loaded -- and `gdi.ts` imports the function that imports this one,
 * so reaching back into it here reads a class that has not finished
 * initialising. The switch statements elsewhere get away with it because they
 * run when they are called.
 */
export const STOCK_FONTS = {
  10: { face: 'Terminal', points: 12 }, // OEM_FIXED_FONT
  11: { face: 'Courier', points: 10 }, // ANSI_FIXED_FONT
  12: { face: 'Helv', points: 8 }, // ANSI_VAR_FONT
  13: { face: 'System', points: 10 }, // SYSTEM_FONT
  14: { face: 'Courier', points: 12 }, // DEVICE_DEFAULT_FONT
  16: { face: 'Fixedsys', points: 12 }, // SYSTEM_FIXED_FONT
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
   * holds Courier at ten points and at fifteen, and they are thirteen and
   * twenty pixels tall.
   */
  const font = context.fonts.realize(wanted.face, wanted.points);

  if (!font) {
    return null;
  }

  return context.handles.lookup(font) || context.handles.allocate(font);
}
