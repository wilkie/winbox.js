'use strict';

import { BitmapContext } from '../../raster/bitmap-context.js';
import { matchedIndex } from '../../raster/colour-match.js';
import { DeviceBitmap } from '../../raster/device-bitmap.js';
import { colourOf } from '../../raster/palette-colour.js';
import { Surface } from '../../raster/surface.js';
import { FALSE, TRUE } from '../consts.js';
import { INT, LPARAM } from '../types.js';
import { clipOf } from './clipping.js';
import { dibAt } from './dib-to-device.js';
import { wideStroke } from './LineTo.js';
import { devicePoint, mapped } from './mapping.js';

/**
 * GDI's drawing functions `gdidraw` recorded first: `FloodFill`,
 * `ExtFloodFill`, `LineDDA`, `PolyPolygon` and `SetDIBits`. See each.
 */

const FLOODFILLSURFACE = 1;

const signed = (value: number) => (value << 16) >> 16;

/**
 * Fills outward from a point with the brush, to its four neighbours at a
 * time, over pixels that are not the border colour, or, with
 * `FLOODFILLSURFACE`, that are the surface colour. **Recorded** by
 * `gdidraw`: a fill inside a black frame stops at a diagonal line a pixel
 * wide -- it does not pass corner to corner -- and a fill of a red area fills
 * only the red. Started on the border colour, it fills nothing and answers
 * nought; otherwise it answers TRUE.
 */
export function ExtFloodFill(
  this: any,
  hdc: number,
  x: number,
  y: number,
  crColor: number,
  fuFillType: number
) {
  const surface = this.handles.resolve(hdc);

  if (!(surface instanceof Surface) || !(surface.bitmap instanceof DeviceBitmap)) {
    return FALSE;
  }

  const bitmap = surface.bitmap;
  let [px, py] = [signed(x), signed(y)];

  if (mapped(surface)) {
    [px, py] = devicePoint(surface, px, py);
  }

  const colour = colourOf(crColor, surface);
  const index = matchedIndex(
    this.display,
    bitmap.devicePalette,
    colour.red,
    colour.green,
    colour.blue
  );
  const surfaceMode = fuFillType === FLOODFILLSURFACE;
  const clip = clipOf(surface);
  const viewClip = bitmap.context.clip;
  const { width, height } = bitmap;
  const fills = (fx: number, fy: number) => {
    if (fx < 0 || fy < 0 || fx >= width || fy >= height) {
      return false;
    }

    if (!clip.contains(fx, fy) || (viewClip && !viewClip(fx, fy))) {
      return false;
    }

    const at = bitmap.indexAt(fx, fy);

    return surfaceMode ? at === index : at !== index;
  };

  if (!fills(px, py)) {
    return FALSE;
  }

  const seen = new Uint8Array(width * height);
  const stack = [[px, py]];

  seen[py * width + px] = 1;

  while (stack.length) {
    const [cx, cy] = stack.pop()!;

    for (const [nx, ny] of [
      [cx + 1, cy],
      [cx - 1, cy],
      [cx, cy + 1],
      [cx, cy - 1],
    ]) {
      if (
        nx >= 0 &&
        ny >= 0 &&
        nx < width &&
        ny < height &&
        !seen[ny * width + nx] &&
        fills(nx, ny)
      ) {
        seen[ny * width + nx] = 1;
        stack.push([nx, ny]);
      }
    }
  }

  /* Painted with the brush a row's run at a time, as it lies. */
  for (let row = 0; row < height; row++) {
    let start = -1;

    for (let column = 0; column <= width; column++) {
      const inside = column < width && seen[row * width + column];

      if (inside && start < 0) {
        start = column;
      } else if (!inside && start >= 0) {
        surface.fillRect(start, row, column - start, 1);
        start = -1;
      }
    }
  }

  return TRUE;
}

export function FloodFill(this: any, hdc: number, x: number, y: number, crColor: number) {
  return ExtFloodFill.call(this, hdc, x, y, crColor, 0);
}

/**
 * Calls a procedure with each point of a line but its last: along the longer
 * axis a step at a time, the other rounded to the nearest, halves away from
 * the start. **Recorded** by `gdidraw` for lines each way, steep and
 * shallow; a line of one point calls it not at all. How a half rounds is
 * not recorded: none of the lines had one.
 */
export async function LineDDA(
  this: any,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  lpLineFunc: number,
  lParam: number
) {
  const [ax, ay, bx, by] = [signed(x1), signed(y1), signed(x2), signed(y2)];
  const dx = bx - ax;
  const dy = by - ay;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  const along = (i: number, delta: number) =>
    Math.sign(delta) * Math.floor((2 * i * Math.abs(delta) + steps) / (2 * steps));

  for (let i = 0; i < steps; i++) {
    await this.scheduler.callProc(
      lpLineFunc,
      [
        [ax + along(i, dx), INT],
        [ay + along(i, dy), INT],
        [lParam >>> 0, LPARAM],
      ],
      this.scheduler.stackRegisters()
    );
  }
}

/**
 * Several polygons, filled together under the fill mode and each outlined
 * with the pen. **Recorded** by `gdidraw`, on Windows 3.1: no ring is
 * closed. Each is outlined through its points and not back to its first,
 * and filled between those same edges alone, under `ALTERNATE` by pairs of
 * crossings and under `WINDING` between any two where the count is not
 * nought. A program that wants a ring closed repeats its first point.
 */
export function PolyPolygon(
  this: any,
  hdc: number,
  lpPoints: number,
  lpPolyCounts: number,
  nCount: number
) {
  const surface = this.handles.resolve(hdc);

  if (!surface || !lpPoints || !lpPolyCounts || nCount <= 0) {
    return FALSE;
  }

  const core = this.machine.cpu.core;
  const word = (far: number, at: number) =>
    signed(core.read16((far >>> 16) & 0xffff, ((far & 0xffff) + at) & 0xffff));
  const rings: number[][][] = [];
  let at = 0;

  for (let ring = 0; ring < nCount; ring++) {
    const count = word(lpPolyCounts, ring * 2);
    const points: number[][] = [];

    for (let index = 0; index < count; index++, at++) {
      points.push([word(lpPoints, at * 4), word(lpPoints, at * 4 + 2)]);
    }

    rings.push(points);
  }

  if (surface.brush?.color?.alpha && surface.context instanceof BitmapContext) {
    surface.fillPolygons(rings, surface.brush.color, (surface.polyFillMode ?? 1) === 2, false);
  }

  for (const points of rings) {
    if (points.length < 2 || !surface.pen?.color?.alpha) {
      continue;
    }

    if (wideStroke(this, surface, points as [number, number][])) {
      continue;
    }

    for (let index = 0; index + 1 < points.length; index++) {
      const [x, y] = points[index];
      const [x2, y2] = points[index + 1];

      surface.drawLine(x, y, x2, y2);
    }
  }

  return TRUE;
}

/**
 * A DIB's scan lines into a bitmap of the display's kind: `cScanLines` of
 * them from `uStartScan`, counted from its bottom row as a DIB is stored,
 * the rest of the bitmap left as it was. Answers how many it set.
 * **Recorded** by `gdidraw`: a four-bit and a one-bit DIB, whole, into a
 * bitmap 8 by 4, and two scan lines from the second.
 */
export function SetDIBits(
  this: any,
  hdc: number,
  hbmp: number,
  uStartScan: number,
  cScanLines: number,
  lpvBits: number,
  lpbmi: number,
  _fuColorUse: number
) {
  const target = this.handles.resolve(hbmp);

  if (!(target instanceof DeviceBitmap) || !lpvBits || !lpbmi) {
    return 0;
  }

  const found = dibAt(this, { bitmap: target }, lpbmi, lpvBits, cScanLines);

  if (!found) {
    return 0;
  }

  const core = this.machine.cpu.core;
  const dword = (at: number) =>
    (core.read16((lpbmi >>> 16) & 0xffff, ((lpbmi & 0xffff) + at) & 0xffff) |
      (core.read16((lpbmi >>> 16) & 0xffff, ((lpbmi & 0xffff) + at + 2) & 0xffff) << 16)) >>>
    0;
  const coreHeader = dword(0) === 12;
  const fullHeight = Math.abs(
    coreHeader
      ? signed(core.read16((lpbmi >>> 16) & 0xffff, ((lpbmi & 0xffff) + 6) & 0xffff))
      : dword(8) | 0
  );
  const source = found.bitmap;
  const width = Math.min(source.width, target.width);
  let set = 0;

  for (let row = 0; row < found.height; row++) {
    /* The source's top row is the last scan line given. */
    const scan = uStartScan + found.height - 1 - row;
    const y = fullHeight - 1 - scan;

    if (y < 0 || y >= target.height) {
      continue;
    }

    for (let x = 0; x < width; x++) {
      target.indices[y * target.width + x] = source.indexAt(x, row) ?? 0;
    }

    set++;
  }

  target.context.markRect(0, 0, target.width, target.height);

  void hdc;

  return set;
}
