'use strict';

import { ClipRegion } from '../../raster/clip-region.js';
import { DeviceBitmap } from '../../raster/device-bitmap.js';

import { Region } from './gdi-objects.js';

/**
 * A device context's clip region, and what it answers.
 *
 * **Recorded** by `clipdc`, on a memory device context:
 *
 * * Each call answers the kind of region that is left: 1 empty, 2 a
 *   rectangle, 3 anything else. A region is a rectangle whenever that is all
 *   it is: a rectangle with a hole in it is 3, and stays 3 once an edge is
 *   cut from it.
 * * The region is the bitmap's pixels until something narrows it. A new
 *   memory device context, with the bitmap every one starts with, has none:
 *   an empty region.
 * * `IntersectClipRect` with its edges the wrong way round leaves nothing.
 * * `SelectClipRgn` takes a copy of the region: the region can be changed or
 *   deleted after. With no region it lets the whole bitmap be drawn on again.
 * * Selecting another bitmap keeps the region.
 * * Everything that draws stays inside it: `PatBlt`, `FillRect`, `Rectangle`,
 *   `LineTo`, `TextOut`, `SetPixel`, `BitBlt` and `StretchBlt` through a
 *   rectangle with a hole, all recorded pixel by pixel.
 *
 * Not recorded: a window's device context, where the region is also kept
 * inside what is to be painted, and `OffsetClipRgn` with no region.
 */

/** What can be drawn on at all: the bitmap, or nothing for the one a memory device context starts with. */
function visible(surface: any) {
  const bitmap = surface.bitmap;

  if (bitmap instanceof DeviceBitmap && bitmap.placeholder) {
    return ClipRegion.EMPTY;
  }

  return ClipRegion.rect(0, 0, surface.width || 0, surface.height || 0);
}

/** The region drawing is kept to: the clip region within what is visible. */
export function clipOf(surface: any) {
  const shown = visible(surface);

  return surface.clipRegion ? surface.clipRegion.intersect(shown) : shown;
}

/** Narrows the clip region, and answers the kind that is left. */
function narrow(surface: any, how: (region: ClipRegion) => ClipRegion) {
  surface.clipRegion = how(surface.clipRegion ?? visible(surface));

  return clipOf(surface).kind;
}

const signed = (value: number) => (value << 16) >> 16;

/**
 * Keeps drawing inside a rectangle as well.
 *
 * @param {Types.HDC} hdc - The device context.
 * @param {Types.INT} nLeftRect - The rectangle's left edge.
 * @param {Types.INT} nTopRect - Its top edge.
 * @param {Types.INT} nRightRect - Its right edge, outside it.
 * @param {Types.INT} nBottomRect - Its bottom edge, outside it.
 *
 * @returns {Types.INT} The kind of region left, or nought for no device context.
 */
export function IntersectClipRect(hdc, nLeftRect, nTopRect, nRightRect, nBottomRect) {
  const surface = this.handles.resolve(hdc);

  if (!surface) {
    return 0;
  }

  const rect = ClipRegion.rect(
    signed(nLeftRect),
    signed(nTopRect),
    signed(nRightRect),
    signed(nBottomRect)
  );

  return narrow(surface, (region) => region.intersect(rect));
}

/**
 * Keeps drawing out of a rectangle.
 *
 * @param {Types.HDC} hdc - The device context.
 * @param {Types.INT} nLeftRect - The rectangle's left edge.
 * @param {Types.INT} nTopRect - Its top edge.
 * @param {Types.INT} nRightRect - Its right edge, outside it.
 * @param {Types.INT} nBottomRect - Its bottom edge, outside it.
 *
 * @returns {Types.INT} The kind of region left, or nought for no device context.
 */
export function ExcludeClipRect(hdc, nLeftRect, nTopRect, nRightRect, nBottomRect) {
  const surface = this.handles.resolve(hdc);

  if (!surface) {
    return 0;
  }

  const rect = ClipRegion.rect(
    signed(nLeftRect),
    signed(nTopRect),
    signed(nRightRect),
    signed(nBottomRect)
  );

  return narrow(surface, (region) => region.subtract(rect));
}

/**
 * Makes a copy of a region the clip region, or with none, drops it.
 *
 * @param {Types.HDC} hdc - The device context.
 * @param {Types.HRGN} hrgn - The region, or nought.
 *
 * @returns {Types.INT} The kind of region drawing is kept to, or nought for
 *                      no device context or no such region.
 */
export function SelectClipRgn(hdc, hrgn) {
  const surface = this.handles.resolve(hdc);

  if (!surface) {
    return 0;
  }

  if (!hrgn) {
    surface.clipRegion = null;

    return clipOf(surface).kind;
  }

  const region = this.handles.resolve(hrgn);

  if (!(region instanceof Region)) {
    return 0;
  }

  surface.clipRegion = ClipRegion.rect(region.left, region.top, region.right, region.bottom);

  return clipOf(surface).kind;
}

/**
 * Moves the clip region.
 *
 * @param {Types.HDC} hdc - The device context.
 * @param {Types.INT} x - How far across.
 * @param {Types.INT} y - How far down.
 *
 * @returns {Types.INT} The kind of region drawing is kept to, or nought for no device context.
 */
export function OffsetClipRgn(hdc, x, y) {
  const surface = this.handles.resolve(hdc);

  if (!surface) {
    return 0;
  }

  if (surface.clipRegion) {
    surface.clipRegion = surface.clipRegion.offset(signed(x), signed(y));
  }

  return clipOf(surface).kind;
}

/**
 * The smallest rectangle around what can be drawn on.
 *
 * @param {Types.HDC} hdc - The device context.
 * @param {Types.RECT} lprc - Where the rectangle goes.
 *
 * @returns {Types.INT} The kind of region, or nought for no device context.
 */
export function GetClipBox(hdc, lprc) {
  const surface = this.handles.resolve(hdc);

  if (!surface) {
    return 0;
  }

  const region = clipOf(surface);

  Object.assign(lprc, region.box);

  return region.kind;
}
