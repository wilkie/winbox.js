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
