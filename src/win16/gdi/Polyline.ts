'use strict';

import { FALSE, TRUE } from '../consts.js';
import { LineTo } from './LineTo.js';

/**
 * Draws a chain of lines through points, with the selected pen.
 *
 * **Recorded** by `polyline`: it is a move to the first point and a
 * `LineTo` to each after it, so the last point is not drawn and a pixel two
 * lines cross is drawn twice -- `R2_NOT` takes it out again -- and the
 * points are mapped as `LineTo`'s are. The current position is left where
 * it was. Fewer than two points answer nought and draw nothing; two the
 * same answer `TRUE` and draw nothing.
 *
 * @param {Types.HDC} hdc - The device context to draw on.
 * @param {Types.FARPTR} lpPoints - Points to `nCount` `POINT`s, each two
 *                                  signed words.
 * @param {Types.INT} nCount - The number of points.
 *
 * @returns {Types.BOOL} Whether the chain was drawn.
 */
export function Polyline(this: any, hdc: number, lpPoints: number, nCount: number) {
  const surface = this.handles.resolve(hdc);

  if (!surface || !lpPoints || (nCount << 16) >> 16 < 2) {
    return FALSE;
  }

  const core = this.machine.cpu.core;
  const segment = (lpPoints >>> 16) & 0xffff;
  const offset = lpPoints & 0xffff;
  const signed = (word: number) => (word & 0x8000 ? word - 0x10000 : word);
  const at = (index: number, half: number) =>
    signed(core.read16(segment, (offset + index * 4 + half * 2) & 0xffff));
  const position = { x: surface.data.x, y: surface.data.y };

  surface.data.x = at(0, 0);
  surface.data.y = at(0, 1);

  for (let index = 1; index < nCount; index++) {
    LineTo.call(this, hdc, at(index, 0), at(index, 1));
  }

  surface.data.x = position.x;
  surface.data.y = position.y;

  return TRUE;
}
