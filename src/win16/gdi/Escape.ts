'use strict';

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
      return display.escapes?.[39] ? (display.mouseTrails ?? 0) : 0;
  }

  return 0;
}
