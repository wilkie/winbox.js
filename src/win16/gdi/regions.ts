'use strict';

import { ClipRegion } from '../../raster/clip-region.js';
import { roundPoints } from '../../raster/curves.js';
import { polygonSpans } from '../../raster/polygon.js';
import { FillRect } from '../user/FillRect.js';
import { InvertRect } from '../user/InvertRect.js';
import { Region } from './gdi-objects.js';

/**
 * Regions: made from rectangles, ellipses, rounded rectangles and polygons,
 * combined, asked about and painted. **Recorded** by `regions`, pixel for
 * pixel on a monochrome bitmap.
 *
 * A region is bands of rows, each a set of runs of columns (`ClipRegion`).
 * Its kind is nought for no region, 1 for an empty one, 2 for a rectangle
 * and 3 for anything else, however it was made.
 */

const ERROR = 0;

const RGN_AND = 1;
const RGN_OR = 2;
const RGN_XOR = 3;
const RGN_DIFF = 4;
const RGN_COPY = 5;

const WINDING = 2;

const signed = (value: number) => (value << 16) >> 16;

function regionOf(system: any, hrgn: number): Region | null {
  const region = system.handles.resolve(hrgn);

  return region instanceof Region ? region : null;
}

function core(system: any) {
  return system.machine.cpu.core;
}

/** The points at a far pointer, `[x, y]` each. */
function pointsAt(system: any, far: number, count: number, from = 0) {
  const points: number[][] = [];

  for (let index = from; index < from + count; index++) {
    const at = (far & 0xffff) + index * 4;

    points.push([
      signed(core(system).read16(far >>> 16, at & 0xffff)),
      signed(core(system).read16(far >>> 16, (at + 2) & 0xffff)),
    ]);
  }

  return points;
}

function allocate(system: any, shape: ClipRegion) {
  return system.handles.allocate(new Region(shape)) ?? 0;
}

/**
 * Two regions' pixels into a third: both (`RGN_AND`), either (`RGN_OR`), one
 * and not the other (`RGN_XOR`), the first less the second (`RGN_DIFF`), or
 * the first alone (`RGN_COPY`). **Recorded**: mode 0 is taken as `RGN_DIFF`
 * and mode 6 as `RGN_COPY`.
 *
 * @param {Types.HRGN} hrgnDest - The region made.
 * @param {Types.HRGN} hrgnSrc1 - The first.
 * @param {Types.HRGN} hrgnSrc2 - The second.
 * @param {Types.INT} fnCombineMode - How.
 *
 * @returns {Types.INT} The kind of region made, or nought.
 */
export function CombineRgn(
  this: any,
  hrgnDest: number,
  hrgnSrc1: number,
  hrgnSrc2: number,
  fnCombineMode: number
) {
  const dest = regionOf(this, hrgnDest);
  const one = regionOf(this, hrgnSrc1);
  const mode = signed(fnCombineMode);
  const copy = mode >= RGN_COPY;
  const two = copy ? null : regionOf(this, hrgnSrc2);

  if (!dest || !one || (!copy && !two)) {
    return ERROR;
  }

  const keep: Record<number, (a: boolean, b: boolean) => boolean> = {
    [RGN_AND]: (a, b) => a && b,
    [RGN_OR]: (a, b) => a || b,
    [RGN_XOR]: (a, b) => a !== b,
    [RGN_DIFF]: (a, b) => a && !b,
  };

  dest.shape = copy
    ? one.shape
    : ClipRegion.combine(one.shape, two!.shape, keep[mode] ?? keep[RGN_DIFF]);

  return dest.shape.kind;
}

/**
 * The smallest rectangle around a region, all nought for an empty one.
 *
 * @param {Types.HRGN} hrgn - The region.
 * @param {Types.RECT} lprc - Where to put it.
 *
 * @returns {Types.INT} The region's kind, or nought.
 */
export function GetRgnBox(this: any, hrgn: number, lprc: any) {
  const region = regionOf(this, hrgn);

  if (!region || !lprc) {
    return ERROR;
  }

  Object.assign(lprc, region.shape.box);

  return region.shape.kind;
}

/**
 * Whether a point is in a region.
 *
 * @param {Types.HRGN} hrgn - The region.
 * @param {Types.INT} x - Across.
 * @param {Types.INT} y - Down.
 *
 * @returns {Types.BOOL} Whether it is.
 */
export function PtInRegion(this: any, hrgn: number, x: number, y: number) {
  return regionOf(this, hrgn)?.shape.contains(signed(x), signed(y)) ? 1 : 0;
}

/**
 * Whether any of a rectangle is in a region. **Recorded**: a rectangle the
 * wrong way round is turned, and the answer for yes is 101h.
 *
 * @param {Types.HRGN} hrgn - The region.
 * @param {Types.RECT} lprc - The rectangle.
 *
 * @returns {Types.BOOL} 101h if so, else nought.
 */
export function RectInRegion(this: any, hrgn: number, lprc: any) {
  const region = regionOf(this, hrgn);

  if (!region || !lprc) {
    return 0;
  }

  const rect = ClipRegion.rect(
    Math.min(lprc.left, lprc.right),
    Math.min(lprc.top, lprc.bottom),
    Math.max(lprc.left, lprc.right),
    Math.max(lprc.top, lprc.bottom)
  );

  return region.shape.intersect(rect).kind > 1 ? 0x101 : 0;
}

/**
 * Whether two regions hold the same pixels.
 *
 * @param {Types.HRGN} hrgnSrc1 - One.
 * @param {Types.HRGN} hrgnSrc2 - The other.
 *
 * @returns {Types.BOOL} Whether they do; nought for no region.
 */
export function EqualRgn(this: any, hrgnSrc1: number, hrgnSrc2: number) {
  const one = regionOf(this, hrgnSrc1);
  const two = regionOf(this, hrgnSrc2);

  if (!one || !two) {
    return ERROR;
  }

  return ClipRegion.combine(one.shape, two.shape, (a, b) => a !== b).kind === 1 ? 1 : 0;
}

/**
 * Moves a region.
 *
 * @param {Types.HRGN} hrgn - The region.
 * @param {Types.INT} nXOffset - Across.
 * @param {Types.INT} nYOffset - Down.
 *
 * @returns {Types.INT} Its kind, or nought.
 */
export function OffsetRgn(this: any, hrgn: number, nXOffset: number, nYOffset: number) {
  const region = regionOf(this, hrgn);

  if (!region) {
    return ERROR;
  }

  region.shape = region.shape.offset(signed(nXOffset), signed(nYOffset));

  return region.shape.kind;
}

/**
 * Makes a region a rectangle.
 *
 * @param {Types.HRGN} hrgn - The region.
 * @param {Types.INT} nLeftRect - Its left.
 * @param {Types.INT} nTopRect - Its top.
 * @param {Types.INT} nRightRect - Its right.
 * @param {Types.INT} nBottomRect - Its bottom.
 */
export function SetRectRgn(
  this: any,
  hrgn: number,
  nLeftRect: number,
  nTopRect: number,
  nRightRect: number,
  nBottomRect: number
) {
  const region = regionOf(this, hrgn);

  if (region) {
    region.shape = ClipRegion.rect(
      signed(nLeftRect),
      signed(nTopRect),
      signed(nRightRect),
      signed(nBottomRect)
    );
  }
}

/** A shape's region, or none when it holds no pixel: **recorded**. */
function allocateShape(system: any, shape: ClipRegion) {
  return shape.kind === 1 ? 0 : allocate(system, shape);
}

/**
 * An ellipse's region: the pixels `Ellipse` fills with no pen, the right and
 * bottom edges outside it. **Recorded**: a rectangle the wrong way round is
 * turned, and one that holds no pixel makes no region. A rounded rectangle
 * with a corner nought across or down is a rectangle's region
 * (`GDI.EXE` seg9 `01cb`), its right and bottom edges where they were given.
 */
function ellipse(
  system: any,
  left: number,
  top: number,
  right: number,
  bottom: number,
  corner: number[] | null
) {
  if (corner && (!corner[0] || !corner[1])) {
    return allocate(system, ClipRegion.rect(left, top, right, bottom));
  }

  const l = Math.min(left, right);
  const r = Math.max(left, right);
  const t = Math.min(top, bottom);
  const b = Math.max(top, bottom);
  const cw = corner ? Math.min(Math.abs(corner[0]), r - 1 - l) : r - 1 - l;
  const ch = corner ? Math.min(Math.abs(corner[1]), b - 1 - t) : b - 1 - t;

  return allocateShape(
    system,
    ClipRegion.fromSpans(polygonSpans(roundPoints(l, t, r - 1, b - 1, cw, ch)))
  );
}

export function CreateEllipticRgn(
  this: any,
  nLeftRect: number,
  nTopRect: number,
  nRightRect: number,
  nBottomRect: number
) {
  return ellipse(
    this,
    signed(nLeftRect),
    signed(nTopRect),
    signed(nRightRect),
    signed(nBottomRect),
    null
  );
}

export function CreateEllipticRgnIndirect(this: any, lprc: any) {
  return lprc ? ellipse(this, lprc.left, lprc.top, lprc.right, lprc.bottom, null) : 0;
}

export function CreateRoundRectRgn(
  this: any,
  nLeftRect: number,
  nTopRect: number,
  nRightRect: number,
  nBottomRect: number,
  nWidthEllipse: number,
  nHeightEllipse: number
) {
  return ellipse(
    this,
    signed(nLeftRect),
    signed(nTopRect),
    signed(nRightRect),
    signed(nBottomRect),
    [signed(nWidthEllipse), signed(nHeightEllipse)]
  );
}

/**
 * A polygon's region: the rows its fill covers, by `ALTERNATE` or `WINDING`.
 * **Read out** (`GDI.EXE` seg24 `0254`) and **recorded**: fewer than two
 * points answer 1, which is no region's handle, and more than 3FFDh answer
 * nought; a last point the same as the first is dropped.
 */
export function CreatePolygonRgn(this: any, lppt: number, cPoints: number, fnPolyFillMode: number) {
  const count = cPoints & 0xffff;

  if (count > 0x3ffd) {
    return 0;
  }

  if (count < 2) {
    return 1;
  }

  const points = pointsAt(this, lppt >>> 0, count);

  return allocateShape(
    this,
    ClipRegion.fromSpans(polygonSpans(points, fnPolyFillMode === WINDING))
  );
}

/**
 * Several polygons' region. **Read out** (`GDI.EXE` seg24 `02e5`): GDI hands
 * its polygon builder the count of polygons where the count of points goes,
 * so **recorded**, one polygon or two make no region. Not followed: what it
 * makes of three or more, which is not their union; here it is.
 */
export function CreatePolyPolygonRgn(
  this: any,
  lppt: number,
  lpnPolyCounts: number,
  cPolygons: number,
  fnPolyFillMode: number
) {
  if (!lppt || !lpnPolyCounts || signed(cPolygons) < 3) {
    return 0;
  }

  let from = 0;
  const spans: [number, number, number][] = [];

  for (let index = 0; index < signed(cPolygons); index++) {
    const count = signed(
      core(this).read16(lpnPolyCounts >>> 16, ((lpnPolyCounts & 0xffff) + index * 2) & 0xffff)
    );

    spans.push(
      ...polygonSpans(pointsAt(this, lppt >>> 0, count, from), fnPolyFillMode === WINDING)
    );
    from += count;
  }

  return allocateShape(this, ClipRegion.fromSpans(spans));
}

/** Each rectangle of a region, as a `RECT`. */
function rectsOf(shape: ClipRegion) {
  return shape.bands.flatMap((band) =>
    band.spans.map(([left, right]) => ({ left, top: band.top, right, bottom: band.bottom }))
  );
}

/**
 * Fills a region with a brush.
 *
 * @returns {Types.BOOL} Whether it was filled.
 */
export function FillRgn(this: any, hdc: number, hrgn: number, hbr: number) {
  const region = regionOf(this, hrgn);

  if (!region || !this.handles.resolve(hdc) || !this.handles.resolve(hbr)) {
    return 0;
  }

  for (const rect of rectsOf(region.shape)) {
    FillRect.call(this, hdc, rect, hbr);
  }

  return 1;
}

/** Fills a region with the device context's brush. */
export function PaintRgn(this: any, hdc: number, hrgn: number) {
  const surface = this.handles.resolve(hdc);
  const brush = surface?.brush;
  const handle = brush ? this.handles.lookup(brush) : 0;

  return handle ? FillRgn.call(this, hdc, hrgn, handle) : 0;
}

/** Turns every pixel of a region. */
export function InvertRgn(this: any, hdc: number, hrgn: number) {
  const region = regionOf(this, hrgn);

  if (!region || !this.handles.resolve(hdc)) {
    return 0;
  }

  for (const rect of rectsOf(region.shape)) {
    InvertRect.call(this, hdc, rect);
  }

  return 1;
}

/**
 * Draws a frame inside a region's edge with a brush, `nWidth` across and
 * `nHeight` down: the region less what is left of it moved each way by
 * those, straight and diagonally. **Recorded**: a pixel diagonally that far
 * from a hole is framed.
 */
export function FrameRgn(
  this: any,
  hdc: number,
  hrgn: number,
  hbr: number,
  nWidth: number,
  nHeight: number
) {
  const region = regionOf(this, hrgn);

  if (!region) {
    return 0;
  }

  const w = signed(nWidth);
  const h = signed(nHeight);
  const shape = region.shape;
  const inner = [
    [w, 0],
    [-w, 0],
    [0, h],
    [0, -h],
    [w, h],
    [-w, h],
    [w, -h],
    [-w, -h],
  ].reduce((kept, [dx, dy]) => kept.intersect(shape.offset(dx, dy)), shape);
  const frame = shape.subtract(inner);
  const handle = allocate(this, frame);
  const answer = FillRgn.call(this, hdc, handle, hbr);

  this.handles.free?.(handle);

  return answer;
}
