'use strict';

import { gdiDataSelector } from './gdi-data.js';
import { DevicePalette } from '../../raster/device-palette.js';
import { Struct, DWORD, FARPTR, INT, LPARAM, UINT } from '../types.js';

/**
 * `EnumObjects`: the pens and brushes a display offers, each handed to a
 * callback, as Paintbrush asks for its colours.
 *
 * **Recorded** by `enumobj` on the VGA, the EGA, the Super VGA and the
 * Hercules:
 *
 * * Pens: each style from solid, 0, to dot-dot, 4, and in each the display's
 *   colours from its last to its first, a width of nought.
 * * Brushes: 125 solid ones first, the same on every display, red stepping
 *   slowest and blue fastest, each through `ff`, `c0`, `80`, `40` and `00`.
 *   Then the hatched ones, from hatch 5 down to 0, each in the display's
 *   colours from last to first.
 * * The answer is the callback's last; a callback answering nought stops the
 *   walk.
 *
 * The colours are the display's own, as its bitmaps index them: sixteen, the
 * EGA's with `404040`, or the Hercules's two.
 */

export class LOGPEN extends Struct {
  constructor() {
    super([
      ['lopnStyle', UINT],
      ['lopnWidthX', INT],
      ['lopnWidthY', INT],
      ['lopnColor', DWORD],
    ]);
  }
}

export class LOGBRUSH extends Struct {
  constructor() {
    super([
      ['lbStyle', UINT],
      ['lbColor', DWORD],
      ['lbHatch', INT],
    ]);
  }
}

const OBJ_PEN = 1;
const OBJ_BRUSH = 2;
const LEVELS = [0xff, 0xc0, 0x80, 0x40, 0x00];

/** The display's colours as `COLORREF`s, last first. */
function deviceColours(system: any) {
  return DevicePalette.forDisplay(system.display)
    .colours.map(([red, green, blue]) => red | (green << 8) | (blue << 16))
    .reverse();
}

/** The pens and brushes, in the order they are handed over. */
export function enumeratedObjects(system: any, kind: number) {
  const colours = deviceColours(system);

  if (kind === OBJ_PEN) {
    return [0, 1, 2, 3, 4].flatMap((style) =>
      colours.map((colour) => {
        const pen: any = new LOGPEN();

        pen.lopnStyle = style;
        pen.lopnWidthX = 0;
        pen.lopnWidthY = 0;
        pen.lopnColor = colour;

        return pen;
      })
    );
  }

  if (kind === OBJ_BRUSH) {
    const brush = (style: number, colour: number, hatch: number) => {
      const logical: any = new LOGBRUSH();

      logical.lbStyle = style;
      logical.lbColor = colour;
      logical.lbHatch = hatch;

      return logical;
    };

    const solids = LEVELS.flatMap((red) =>
      LEVELS.flatMap((green) =>
        LEVELS.map((blue) => brush(0, red | (green << 8) | (blue << 16), 0))
      )
    );
    const hatched = [5, 4, 3, 2, 1, 0].flatMap((hatch) =>
      colours.map((colour) => brush(2, colour, hatch))
    );

    return [...solids, ...hatched];
  }

  return [];
}

/**
 * Hands each pen or brush the display offers to a callback. **Recorded** by
 * `enumregs`: the object 40 bytes up the stack from the procedure's entry
 * for a pen and 38 for a brush, and AX and DS GDI's data segment, ES the
 * stack's (seg4 `08de`); a procedure needs `MakeProcInstance` to find its
 * own data.
 *
 * @param {Types.HDC} hdc - The device context.
 * @param {Types.INT} nObjectType - `OBJ_PEN` or `OBJ_BRUSH`.
 * @param {Types.FARPTR} lpObjectFunc - The callback.
 * @param {Types.LPARAM} lParam - Handed to the callback.
 *
 * @returns {Types.INT} The callback's last answer.
 */
export async function EnumObjects(
  this: any,
  hdc: number,
  nObjectType: number,
  lpObjectFunc: any,
  lParam: number
) {
  if (!this.handles.resolve(hdc)) {
    return 0;
  }

  let answer = 0;

  for (const object of enumeratedObjects(this, nObjectType)) {
    answer =
      typeof lpObjectFunc === 'function'
        ? await lpObjectFunc(object, lParam)
        : (((await this.scheduler.callProc(
            lpObjectFunc,
            [
              [[object, nObjectType === OBJ_PEN ? 40 : 38], FARPTR],
              [lParam >>> 0, LPARAM],
            ],
            {
              ax: gdiDataSelector(this),
              ds: gdiDataSelector(this),
              es: this.machine.cpu.core.ss,
            }
          )) &
            0xffff) <<
            16) >>
          16;

    if (!answer) {
      return 0;
    }
  }

  return answer;
}
