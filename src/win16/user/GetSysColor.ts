'use strict';

/**
 * One of the system colours, as a `COLORREF`: the display's default for the
 * `COLOR_` index, recorded by the `chrome` probe on each display. See
 * `sysColors` in `display-modes.ts`. A `[colors]` section in `WIN.INI`, which
 * would override them, is not read yet.
 *
 * @param {Types.INT} nIndex - The `COLOR_` index.
 *
 * @returns {Types.COLORREF} The colour, or black for an index with none.
 */
export function GetSysColor(nIndex) {
  return this.display?.sysColors?.[nIndex] ?? 0;
}
