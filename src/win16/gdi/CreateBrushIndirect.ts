'use strict';

import { Brush } from '../../raster/brush.js';
import { Color } from '../../raster/color.js';
import { isPaletteRef } from '../../raster/palette-colour.js';

import { NULL } from '../consts.js';

import { CreatePatternBrush } from './CreatePatternBrush.js';

const BS_NULL = 1;
const BS_HATCHED = 2;
const BS_PATTERN = 3;

/**
 * The eight by eight cells of each hatch, set where its line is, as the VGA
 * paints them (`brushind`): lines through the fifth row and column, and
 * diagonals through the corners.
 */
const HATCHES: ((x: number, y: number) => boolean)[] = [
  (_x, y) => y === 4,
  (x) => x === 4,
  (x, y) => x === y,
  (x, y) => x === 7 - y,
  (x, y) => x === 4 || y === 4,
  (x, y) => x === y || x === 7 - y,
];

/** A hatch's cells, or null for a hatch there is none of. */
export function hatchCells(hatch: number): Uint8Array | null {
  const line = HATCHES[hatch];

  if (!line) {
    return null;
  }

  const cells = new Uint8Array(64);

  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      cells[y * 8 + x] = line(x, y) ? 1 : 0;
    }
  }

  return cells;
}

/** A brush of a `LOGBRUSH`'s style, colour and hatch: its handle, or nought. */
function brushOf(this: any, style: number, colorref: number, hatch: number) {
  let handle: number;
  let brush: Brush;

  if (style === BS_PATTERN) {
    handle = CreatePatternBrush.call(this, hatch & 0xffff);
    brush = this.handles.resolve(handle);

    if (!handle || !brush) {
      return NULL;
    }
  } else {
    const components = Color.colorToBgr(colorref);

    brush = new Brush(
      new Color(components.r, components.g, components.b, style === BS_NULL ? 0 : 255)
    );

    if (isPaletteRef(colorref)) {
      brush.colorref = colorref >>> 0;
    }

    if (style === BS_HATCHED) {
      brush.hatch = hatchCells(hatch);
    }

    handle = this.handles.allocate(brush);
  }

  brush.logbrush = { style, color: colorref >>> 0, hatch: hatch & 0xffff };

  return handle;
}

/**
 * A brush of any style, from a `LOGBRUSH`: its style, colour and hatch.
 *
 * **Recorded** by `brushind`:
 *
 * * `GetObject` answers the `LOGBRUSH` as it was given, the colour and the
 *   hatch word kept whatever the style.
 * * `BS_NULL` makes a brush of its own, not the stock `NULL_BRUSH`, and
 *   `FillRect` with it paints nothing.
 * * `BS_HATCHED` lines are the brush's colour over the device context's
 *   background colour, which `FillRect` paints even in `TRANSPARENT` mode.
 *   A hatch past `HS_DIAGCROSS`, and a style past those there are, paint as
 *   `BS_SOLID` does.
 * * `BS_PATTERN` takes the bitmap's handle in the hatch word, as
 *   `CreatePatternBrush` does.
 *
 * @param {Types.FARPTR} lplb - The `LOGBRUSH`.
 *
 * @returns {Types.HBRUSH} The brush, or nought.
 */
export function CreateBrushIndirect(this: any, lplb: number) {
  if (!lplb) {
    return NULL;
  }

  const core = this.machine.cpu.core;
  const segment = (lplb >>> 16) & 0xffff;
  const offset = lplb & 0xffff;
  const style = core.read16(segment, offset);
  const colorref =
    (core.read16(segment, offset + 2) | (core.read16(segment, offset + 4) << 16)) >>> 0;
  const hatch = core.read16(segment, offset + 6);
  return brushOf.call(this, style, colorref, hatch);
}

/**
 * A hatched brush: `CreateBrushIndirect` of `BS_HATCHED`, the same `LOGBRUSH`
 * after (`brushind`).
 *
 * @param {Types.INT} fnStyle - The hatch.
 * @param {Types.COLORREF} clrref - The lines' colour.
 *
 * @returns {Types.HBRUSH} The brush.
 */
export function CreateHatchBrush(this: any, fnStyle: number, clrref: number) {
  return brushOf.call(this, BS_HATCHED, clrref >>> 0, fnStyle);
}
