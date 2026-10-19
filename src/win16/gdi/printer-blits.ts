'use strict';

import { GlobalAlloc } from '../kernel/GlobalAlloc.js';
import { GlobalFree } from '../kernel/GlobalFree.js';
import { GlobalLock } from '../kernel/GlobalLock.js';
import { DWORD, UINT } from '../types.js';
import { clipOf } from './clipping.js';
import { bitsSize, formatOf, readByte, rowBytes, writeByte } from './ddb.js';
import { devicePoint } from './mapping.js';
import {
  caps,
  callDriver,
  drawingOf,
  drawMode,
  onStackBytes,
  proc,
  words,
} from './printer-output.js';
import type { PDevice } from './printer-driver.js';

/**
 * Bitmaps drawn through a printer's driver, as Windows' GDI hands them to
 * it: `BitBlt` and `PatBlt` to the driver's `BitBlt`, `StretchBlt` to its
 * `StretchBlt` and `SetDIBitsToDevice` to its `DIBToDevice`; what GDI
 * draws itself for a driver that cannot is `printer-stretch.ts`. The twin
 * of `crates/winbox-win16/src/gdi/printer_blits.rs`.
 *
 * Not followed: a memory context's own drawing through its printer's
 * driver, but for what GDI draws into bitmaps of its own.
 */

const BIT_BLT = 1;
const DIB_TO_DEVICE = 21;
const STRETCH_BLT = 27;
const DP_RASTER = 0x26;
const RC_DIBTODEV = 0x200;
const RC_STRETCHBLT = 0x800;

type Rect = [number, number, number, number];

function core(system: any) {
  return system.machine.cpu.core;
}

/**
 * The rectangles of the visible region within a rectangle, GDI's walk of
 * them for a blit (seg1 `2b62`, its flags 183h at first): from the top
 * down or the bottom up, and in each band from the left or from the right.
 */
export function blitRects(
  surface: any,
  within: Rect,
  topDown: boolean,
  leftToRight: boolean
): Rect[] {
  const bands = [...clipOf(surface).bands];
  const rects: Rect[] = [];

  if (!topDown) {
    bands.reverse();
  }

  for (const band of bands) {
    const top = Math.max(band.top, within[1]);
    const bottom = Math.min(band.bottom, within[3]);

    if (top >= bottom) {
      continue;
    }

    const spans = leftToRight ? band.spans : [...band.spans].reverse();

    for (const [left, right] of spans) {
      const l = Math.max(left, within[0]);
      const r = Math.min(right, within[2]);

      if (l < r) {
        rects.push([l, top, r, bottom]);
      }
    }
  }

  return rects;
}

/**
 * A blit's rectangle in device terms (seg1 `312c`): its corner and its
 * extents mapped, the corners put in order.
 */
function blitBox(surface: any, x: number, y: number, width: number, height: number): Rect {
  const [x0, y0] = devicePoint(surface, x, y);
  const [x1, y1] = devicePoint(surface, x + width, y + height);

  return [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
}

const isEmpty = (rect: Rect) => rect[0] === rect[2] || rect[1] === rect[3];

/**
 * A bitmap as GDI hands it to a driver: its `BITMAP` -- the type nought,
 * the width, the height, the bytes a row, the planes, the bits a pixel,
 * the bits' far pointer and the bytes a plane -- and its bits after it, in
 * rows padded to words. Given to `body` as a far pointer, and let go
 * after; where the driver draws into it, its bits read back first.
 */
export async function withBlock<T>(
  system: any,
  bitmap: any,
  body: (far: number) => Promise<T>,
  readBack = false
) {
  const { planes, bits } = formatOf(bitmap);
  const size = bitsSize(bitmap);
  const handle = GlobalAlloc.call(system, 0x2042, 0x20 + size);
  const far = handle ? GlobalLock.call(system, handle) >>> 0 : 0;

  if (!far) {
    return body(0);
  }

  const widthBytes = rowBytes(bits, bitmap.width);
  const segment = (far >>> 16) & 0xffff;
  const at = (offset: number) => ((far & 0xffff) + offset) & 0xffff;
  const write16 = (offset: number, value: number) =>
    core(system).write16(segment, at(offset), value & 0xffff);

  write16(0, 0);
  write16(2, bitmap.width);
  write16(4, bitmap.height);
  write16(6, widthBytes);
  core(system).write8(segment, at(8), planes);
  core(system).write8(segment, at(9), bits);
  write16(0x0a, at(0x20));
  write16(0x0c, segment);
  write16(0x0e, (widthBytes * bitmap.height) & 0xffff);
  write16(0x10, (widthBytes * bitmap.height) >>> 16);

  for (let offset = 0; offset < size; offset++) {
    core(system).write8(segment, at(0x20 + offset), readByte(bitmap, offset));
  }

  try {
    const answer = await body(far);

    if (readBack) {
      for (let offset = 0; offset < size; offset++) {
        writeByte(bitmap, offset, core(system).read8(segment, at(0x20 + offset)));
      }
    }

    return answer;
  } finally {
    GlobalFree.call(system, handle);
  }
}

/**
 * Whether a source can be given to a driver: a context of the same
 * driver, or a memory context made compatible with one, with a bitmap
 * (seg1 `2e06`-`2e10`: where either is a device, their drivers must be the
 * same).
 */
export function sameDriver(pdevice: PDevice, source: any) {
  const other: PDevice | undefined = source?.driverDevice ?? source?.compatibleDevice;

  return Boolean(other && other.driver === pdevice.driver && source.bitmap);
}

/**
 * `BitBlt` or `PatBlt` on a driver's context (`GDI.EXE` seg1 `305b`,
 * `2d0d`): the destination's rectangle in device terms, empty answering 1;
 * a source not of the same driver answers nought; else `blitDevice`.
 */
export async function driverBitBlt(
  system: any,
  surface: any,
  dest: { x: number; y: number; width: number; height: number },
  source: any,
  from: { x: number; y: number },
  rop: number
) {
  const pdevice: PDevice = surface.driverDevice;
  const within = blitBox(surface, dest.x, dest.y, dest.width, dest.height);

  if (isEmpty(within)) {
    return 1;
  }

  const origin = source ? blitBox(source, from.x, from.y, dest.width, dest.height) : within;

  if (source && isEmpty(origin)) {
    return 1;
  }

  if ((source && !sameDriver(pdevice, source)) || !proc(pdevice, BIT_BLT)) {
    return 0;
  }

  return blitDevice(system, surface, within, source?.bitmap ?? null, [origin[0], origin[1]], rop);
}

/**
 * A blit in device terms to a driver's context (seg1 `2d0d`): the
 * driver's `BitBlt` once for each of the visible region's rectangles
 * within the destination -- and within `limit`, a clip rectangle GDI sets
 * itself -- from the bottom up where the source is above, from the right
 * where it is to the left (`2da8`), with that rectangle's corner, the
 * source and its corner moved as far, the extent, the raster operation,
 * the realized brush and the `DRAWMODE` (`2e92`); 1.
 */
export async function blitDevice(
  system: any,
  surface: any,
  within: Rect,
  bitmap: any,
  origin: [number, number],
  rop: number,
  limit: Rect | null = null
) {
  const pdevice: PDevice = surface.driverDevice;
  const procedure = proc(pdevice, BIT_BLT);

  if (!procedure) {
    return 0;
  }

  const area: Rect = limit
    ? [
        Math.max(within[0], limit[0]),
        Math.max(within[1], limit[1]),
        Math.min(within[2], limit[2]),
        Math.min(within[3], limit[3]),
      ]
    : within;
  const drawing = drawingOf(surface);
  const run = async (sourceFar: number) => {
    const rects =
      area[0] < area[2] && area[1] < area[3]
        ? blitRects(surface, area, origin[1] >= within[1], origin[0] >= within[0])
        : [];

    for (const rect of rects) {
      await callDriver(system, procedure, [
        [pdevice.lpPDevice, DWORD],
        [rect[0] & 0xffff, UINT],
        [rect[1] & 0xffff, UINT],
        [sourceFar, DWORD],
        [(rect[0] - within[0] + origin[0]) & 0xffff, UINT],
        [(rect[1] - within[1] + origin[1]) & 0xffff, UINT],
        [(rect[2] - rect[0]) & 0xffff, UINT],
        [(rect[3] - rect[1]) & 0xffff, UINT],
        [rop >>> 0, DWORD],
        [drawing.brush?.far ?? 0, DWORD],
        [drawMode(system, surface), DWORD],
      ]);
    }

    return 1;
  };

  return bitmap ? withBlock(system, bitmap, run) : run(0);
}

/**
 * `StretchBlt` on a driver's context (`GDI.EXE` seg1 `305b`, seg32
 * `03ba`): both rectangles in device terms, either with no width or height
 * answering 1 (seg1 `312c`); extents alike a copy (`30bc`); from a memory
 * context, a far corner beyond its bitmap answers nought (`30da`); else
 * `stretchOnDriver`. Null where winbox.js does not follow what GDI does.
 */
export async function driverStretchBlt(
  system: any,
  surface: any,
  dest: { x: number; y: number; width: number; height: number },
  source: any,
  from: { x: number; y: number; width: number; height: number },
  rop: number,
  hdcDest: number,
  hdcSrc: number
): Promise<number | null> {
  const [x0, y0] = devicePoint(surface, dest.x, dest.y);
  const [x1, y1] = devicePoint(surface, dest.x + dest.width, dest.y + dest.height);
  const [s0, t0] = devicePoint(source, from.x, from.y);
  const [s1, t1] = devicePoint(source, from.x + from.width, from.y + from.height);

  if (x0 === x1 || y0 === y1 || s0 === s1 || t0 === t1) {
    return 1;
  }

  if (x1 - x0 === s1 - s0 && y1 - y0 === t1 - t0) {
    return driverBitBlt(system, surface, dest, source, from, rop);
  }

  const bitmap = source.memoryContext ? source.bitmap : null;

  if (bitmap && (s1 > bitmap.width || t1 > bitmap.height)) {
    return 0;
  }

  const { stretchOnDriver } = await import('./printer-stretch.js');

  return stretchOnDriver(
    system,
    surface,
    hdcDest,
    source,
    hdcSrc,
    [x0, y0, x1, y1],
    [s0, t0, s1, t1],
    rop
  );
}

/**
 * The driver's own `StretchBlt`, where its `dpRaster` has `RC_STRETCHBLT`
 * (`GDI.EXE` seg32 `05fa`): the destination put in order, a destination
 * given the wrong way round starting a pixel on from its far edge
 * (`11bb`); a flip made the source's, its corner its far edge and its
 * extent negative (`0658`); the driver's `StretchBlt` once for each of the
 * visible region's rectangles within the destination, that rectangle as
 * the clip (`0687`). 1; null where the driver cannot, or answers below
 * nought, and GDI stretches for it.
 */
export async function driverStretch(
  system: any,
  surface: any,
  source: any,
  [x0, y0, x1, y1]: Rect,
  [s0, t0, s1, t1]: Rect,
  rop: number
): Promise<number | null> {
  const pdevice: PDevice = surface.driverDevice;
  const procedure = proc(pdevice, STRETCH_BLT);

  if (!procedure || !(caps(pdevice, DP_RASTER) & RC_STRETCHBLT) || !sameDriver(pdevice, source)) {
    return null;
  }

  const within: Rect = [
    x1 < x0 ? x1 + 1 : x0,
    y1 < y0 ? y1 + 1 : y0,
    x1 < x0 ? x0 + 1 : x1,
    y1 < y0 ? y0 + 1 : y1,
  ];
  let sx = Math.min(s0, s1);
  let sy = Math.min(t0, t1);
  let sw = Math.abs(s1 - s0);
  let sh = Math.abs(t1 - t0);

  if (x1 < x0 !== s1 < s0) {
    sx += sw;
    sw = -sw;
  }

  if (y1 < y0 !== t1 < t0) {
    sy += sh;
    sh = -sh;
  }

  const drawing = drawingOf(surface);

  return withBlock(system, source.bitmap, async (sourceFar) => {
    for (const rect of blitRects(surface, within, true, true)) {
      const answer = await onStackBytes(system, words(...rect), (clip) =>
        callDriver(system, procedure, [
          [pdevice.lpPDevice, DWORD],
          [within[0] & 0xffff, UINT],
          [within[1] & 0xffff, UINT],
          [(within[2] - within[0]) & 0xffff, UINT],
          [(within[3] - within[1]) & 0xffff, UINT],
          [sourceFar, DWORD],
          [sx & 0xffff, UINT],
          [sy & 0xffff, UINT],
          [sw & 0xffff, UINT],
          [sh & 0xffff, UINT],
          [rop >>> 0, DWORD],
          [drawing.brush?.far ?? 0, DWORD],
          [drawMode(system, surface), DWORD],
          [clip, DWORD],
        ])
      );

      if (answer & 0x8000) {
        return null;
      }
    }

    return 1;
  });
}

/**
 * `SetDIBitsToDevice` on a driver's context whose `dpRaster` has
 * `RC_DIBTODEV` (`GDI.EXE` seg11 `0b13`): the destination's corner in
 * device terms; the driver given that corner less the source's x, and
 * moved down so the rows given land where they belong -- the corner's y,
 * the source's y and the height, less the DIB's height (`0c61`-`0c78`) --,
 * the first scan and the count, the visible region's rectangle within the
 * destination as the clip, the `DRAWMODE`, the bits, the `BITMAPINFO` and
 * no translation (`0cac`). The answer the driver's; the count of scans
 * where nothing is visible. Null where GDI draws the DIB for the driver
 * itself.
 */
export async function driverDIBToDevice(
  system: any,
  surface: any,
  args: {
    x: number;
    y: number;
    width: number;
    height: number;
    srcX: number;
    srcY: number;
    start: number;
    count: number;
    bits: number;
    info: number;
    usage: number;
  }
): Promise<number | null> {
  const pdevice: PDevice = surface.driverDevice;
  const procedure = proc(pdevice, DIB_TO_DEVICE);

  if (!procedure || !(caps(pdevice, DP_RASTER) & RC_DIBTODEV) || args.usage) {
    return null;
  }

  const cpu = core(system);
  const dibHeight = (cpu.read16(args.info >>> 16, ((args.info & 0xffff) + 8) & 0xffff) << 16) >> 16;
  const [dx, dy] = devicePoint(surface, args.x, args.y);
  const within: Rect = [dx, dy, dx + args.width, dy + args.height];
  let answer = args.count;

  for (const rect of blitRects(surface, within, true, true)) {
    const given = await onStackBytes(system, words(...rect), (clip) =>
      callDriver(system, procedure, [
        [pdevice.lpPDevice, DWORD],
        [(dx - args.srcX) & 0xffff, UINT],
        [(dy + args.srcY + args.height - dibHeight) & 0xffff, UINT],
        [args.start & 0xffff, UINT],
        [args.count & 0xffff, UINT],
        [clip, DWORD],
        [drawMode(system, surface), DWORD],
        [args.bits >>> 0, DWORD],
        [args.info >>> 0, DWORD],
        [0, DWORD],
      ])
    );

    if (given & 0x8000) {
      return null;
    }

    answer = given & 0xffff;
  }

  return answer;
}
