'use strict';

import { Gdi } from '../gdi.js';

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
export const STOCK_FONTS = {
  [Gdi.SYSTEM_FONT]: { face: 'System', points: 10 },
  [Gdi.SYSTEM_FIXED_FONT]: { face: 'Fixedsys', points: 12 },
  [Gdi.ANSI_VAR_FONT]: { face: 'Helv', points: 8 },
  [Gdi.ANSI_FIXED_FONT]: { face: 'Courier', points: 10 },
  [Gdi.OEM_FIXED_FONT]: { face: 'Terminal', points: 12 },
  [Gdi.DEVICE_DEFAULT_FONT]: { face: 'Courier', points: 12 },
};
