'use strict';

import { ClipRegion } from '../../raster/clip-region.js';
import { Surface } from '../../raster/surface.js';
import { narrow } from '../gdi/clipping.js';
import { regionOf } from '../gdi/regions.js';
import { type DesktopWindow } from './desktop.js';
import { RasterWindow } from './raster-window.js';

/**
 * What a window is due to paint, as a region: `InvalidateRgn`,
 * `ValidateRgn`, `GetUpdateRgn` and `ExcludeUpdateRgn`, and `InvalidateRect`
 * and `ValidateRect` through the same. **Recorded** by `updrgn`:
 *
 * * The update is a region, not its box: two parts invalidated apart are a
 *   complex region, a point between them is not in it, and the paint that
 *   follows is clipped to the two parts -- `BeginPaint`'s `rcPaint` is the
 *   box, but a fill of the whole client area leaves the gap between them.
 * * A part validated is cut from it.
 * * `InvalidateRgn` of NULL is the whole client area; `ValidateRgn` of NULL
 *   leaves nothing.
 * * `ExcludeUpdateRgn` cuts the update from a device context's clip and
 *   answers the kind of what is left.
 *
 * The desktop keeps a window's update as `dirtyRect`, the box, which
 * everything else reads; the region beside it is `dirtyShape`, which counts
 * only while `dirtyShapeFor` is that very box. Whatever sets `dirtyRect` its
 * own way leaves the box to count, as before.
 */

const union = (a: ClipRegion, b: ClipRegion) => ClipRegion.combine(a, b, (x, y) => x || y);

/** A window's client area on the screen. */
function clientOf(window: DesktopWindow) {
  const left = window.left + window.client.left;
  const top = window.top + window.client.top;

  return ClipRegion.rect(left, top, left + window.clientWidth, top + window.clientHeight);
}

/** What a window is due to paint, on the screen: nothing, its region, its box, or all of it. */
export function updateOf(window: DesktopWindow): ClipRegion {
  const shown: any = window;

  if (!window.needsPaint) {
    return ClipRegion.EMPTY;
  }

  const box = shown.dirtyRect;

  if (!box) {
    return clientOf(window);
  }

  if (shown.dirtyShape && shown.dirtyShapeFor === box) {
    return shown.dirtyShape;
  }

  return ClipRegion.rect(box[0], box[1], box[2], box[3]);
}

/** Sets what a window is due to paint, on the screen, as a region. */
export function setUpdate(window: DesktopWindow, shape: ClipRegion, erase: boolean) {
  const shown: any = window;

  if (shape.kind <= 1) {
    window.needsPaint = false;
    window.needsErase = false;
    shown.dirtyRect = undefined;
    shown.dirtyShape = undefined;
    shown.dirtyShapeFor = undefined;
    return;
  }

  const { left, top, right, bottom } = shape.box;
  const box = [left, top, right, bottom];

  shown.dirtyRect = box;
  shown.dirtyShape = shape;
  shown.dirtyShapeFor = box;
  window.needsPaint = true;
  window.needsErase ||= erase;
}

/** The part of a paint's clip it is still due, the shape `aboutToPaint` passes on. */
export function shapeOf(window: DesktopWindow, box: number[] | undefined) {
  const shown: any = window;

  return box && shown.dirtyShape && shown.dirtyShapeFor === box ? shown.dirtyShape : undefined;
}

/** A program's region, in a window's client area, on the screen and cut to it. */
function onScreen(system: any, window: DesktopWindow, hrgn: number) {
  const region = regionOf(system, hrgn);
  const client = clientOf(window);

  if (!region) {
    return null;
  }

  return region.shape.offset(client.box.left, client.box.top).intersect(client);
}

export function InvalidateRgn(this: any, hwnd: number, hrgn: number, fErase: number) {
  const owner = this.handles.resolve(hwnd);

  if (!(owner instanceof RasterWindow)) {
    return;
  }

  const window: any = owner.window;

  if (!hrgn) {
    window.dirtyRect = undefined;
    window.dirtyShape = undefined;
    window.needsPaint = true;
    window.needsErase ||= fErase !== 0;
    return;
  }

  const part = onScreen(this, window, hrgn);

  if (part) {
    setUpdate(window, union(updateOf(window), part), fErase !== 0);
  }
}

export function ValidateRgn(this: any, hwnd: number, hrgn: number) {
  const owner = this.handles.resolve(hwnd);

  if (!(owner instanceof RasterWindow)) {
    return;
  }

  const window = owner.window;
  const part = hrgn ? onScreen(this, window, hrgn) : null;

  setUpdate(window, part ? updateOf(window).subtract(part) : ClipRegion.EMPTY, false);
}

/**
 * What a window is due to paint, into a program's region, in its client
 * area; answers the region's kind.
 */
export function GetUpdateRgn(this: any, hwnd: number, hrgn: number, _fErase: number) {
  const owner = this.handles.resolve(hwnd);
  const region = regionOf(this, hrgn);

  if (!(owner instanceof RasterWindow) || !region) {
    return 0;
  }

  const window = owner.window;
  const client = clientOf(window);

  region.shape = updateOf(window).intersect(client).offset(-client.box.left, -client.box.top);

  return region.shape.kind;
}

/** Cuts what a window is due to paint from a device context's clip. */
export function ExcludeUpdateRgn(this: any, hdc: number, hwnd: number) {
  const surface = this.handles.resolve(hdc);
  const owner = this.handles.resolve(hwnd);

  if (!(surface instanceof Surface) || !(owner instanceof RasterWindow)) {
    return 0;
  }

  const window = owner.window;
  const client = clientOf(window);
  const update = updateOf(window).intersect(client).offset(-client.box.left, -client.box.top);

  return narrow(surface, (clip) => clip.subtract(update));
}
