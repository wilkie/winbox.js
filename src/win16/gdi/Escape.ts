'use strict';

import { printerEscape } from './printing.js';

/**
 * A device's own function, by number, through its driver. **Recorded** by
 * `escapes` on four displays:
 *
 * * `QUERYESCSUPPORT` (8) answers what the driver says for the escape named
 *   by the word at `lpInData`: on the colour displays 1 for 5
 *   (`GETCOLORTABLE`) and 8, and -7 for `MOUSETRAILS` (39); on the Hercules,
 *   1 for 5 and 8, and nought for the rest. See `display-modes.ts`.
 * * `MOUSETRAILS` answers 7 on the colour displays, nought on the Hercules,
 *   and writes nothing.
 * * An escape the driver has not answers nought.
 * * A memory device context's driver is GDI's own for bitmaps, and answers
 *   nought to everything, `QUERYESCSUPPORT` too.
 *
 * **Read out** of GDI (`GDI.EXE` seg7 `0042`-`0526`): on a screen's context
 * every escape goes to the driver's `Control`, whose answer is the answer --
 * but for 0Fh, which GDI answers nought, and 100h to BFFh, which GDI keeps
 * for itself: it calls the driver for those only where a flag of the
 * context's is set (byte 0Bh, bit 2, seg7 `04be`), and they answer nought
 * here as before. So an escape a
 * driver has not got answers what its `Control` does for one: nought on
 * every driver but `8514.DRV`'s, which answers the escape's own number
 * (seg1 `1b28`-`1b35`; `controlAnswersNumber`), `MOUSETRAILS` among them.
 *
 * Not followed: what `GETCOLORTABLE` answers.
 *
 * @param {Types.HDC} hdc - The device context.
 * @param {Types.INT} nEscape - Which.
 * @param {Types.INT} cbInput - The size of what `lpInData` points to.
 * @param {Types.FARPTR} lpInData - What it is given.
 * @param {Types.FARPTR} lpOutData - Where it answers into.
 *
 * @returns {Types.INT} What the driver answers.
 */
export function Escape(
  this: any,
  hdc: number,
  nEscape: number,
  _cbInput: number,
  lpInData: number,
  _lpOutData: number
) {
  const surface = this.handles.resolve(hdc);

  if (!surface || surface.memoryContext) {
    return 0;
  }

  /* A printer's escapes for printing a document (`printing.ts`). */
  if (surface.printer) {
    const printed = printerEscape(this, hdc, (nEscape << 16) >> 16, _cbInput, lpInData);

    return printed.then((answer) => answer ?? 0);
  }

  const display = this.display ?? {};
  const escape = (nEscape << 16) >> 16;

  switch (escape) {
    case 8: {
      if (!lpInData) {
        return 0;
      }

      const core = this.machine.cpu.core;
      const asked = (core.read16(lpInData >>> 16, lpInData & 0xffff) << 16) >> 16;

      return (display.escapes?.[asked] ?? 0) & 0xffff;
    }

    case 39:
      if (display.escapes?.[39]) {
        return display.mouseTrails ?? 0;
      }
  }

  return driverAnswer(display, escape);
}

/** What GDI passes back of the driver's `Control` for an escape it has not got. */
function driverAnswer(display: any, escape: number) {
  const gdis = escape === 0x0f || (escape >= 0x100 && escape <= 0xbff);

  if (gdis || !display.controlAnswersNumber || display.escapes?.[escape]) {
    return 0;
  }

  return escape & 0xffff;
}
