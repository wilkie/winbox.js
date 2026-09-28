'use strict';

import { DeviceBitmap } from '../../raster/device-bitmap.js';
import { Surface } from '../../raster/surface.js';
import { InvalidateRect } from './InvalidateRect.js';
import { RasterWindow } from './raster-window.js';

/**
 * One window at a time kept from drawing on the screen. **Recorded** by
 * `lockupd`:
 *
 * * Locking answers 1; locking while a window is locked, the same one or
 *   another, answers nought, and so does unlocking with none locked.
 * * What a device context from `GetDC` draws on the locked window does not
 *   show, and nothing is made invalid while it is locked.
 * * Unlocking makes invalid what was drawn -- its rectangle, not the whole
 *   window -- and it is painted as any invalid part is.
 *
 * Here the device context draws on a bitmap of its own, the client area's
 * size, which keeps the rectangle drawn on. Not recorded: the locked
 * window's children, and `BeginPaint` while it is locked.
 */

interface Lock {
  hwnd: number;
  surfaces: Surface[];
}

export function LockWindowUpdate(this: any, hwndLock: number) {
  const lock: Lock | null = this._windowLock ?? null;

  if (hwndLock) {
    if (lock || !(this.handles.resolve(hwndLock) instanceof RasterWindow)) {
      return 0;
    }

    this._windowLock = { hwnd: hwndLock, surfaces: [] } satisfies Lock;
    return 1;
  }

  if (!lock) {
    return 0;
  }

  this._windowLock = null;

  let drawn: { left: number; top: number; right: number; bottom: number } | null = null;

  for (const surface of lock.surfaces) {
    const dirty = (surface.bitmap as DeviceBitmap).context.takeDirty();

    if (dirty) {
      drawn = drawn
        ? {
            left: Math.min(drawn.left, dirty.left),
            top: Math.min(drawn.top, dirty.top),
            right: Math.max(drawn.right, dirty.right),
            bottom: Math.max(drawn.bottom, dirty.bottom),
          }
        : dirty;
    }
  }

  if (drawn) {
    InvalidateRect.call(this, lock.hwnd, drawn, 1);
  }

  return 1;
}

/** For `GetDC` of the locked window: a surface of its own to draw on, or null for any other window. */
export function lockedSurface(system: any, hwnd: number) {
  const lock: Lock | null = system._windowLock ?? null;
  const window = system.handles.resolve(hwnd);

  if (!lock || lock.hwnd !== hwnd || !(window instanceof RasterWindow)) {
    return null;
  }

  const shown: any = window.window;
  const screen = shown.surface.bitmap as DeviceBitmap;
  const surface = Surface.memory();

  surface.bitmap = new DeviceBitmap(
    Math.max(1, shown.clientWidth),
    Math.max(1, shown.clientHeight),
    screen.depth,
    undefined,
    screen.devicePalette
  );
  (surface.bitmap as DeviceBitmap).context.takeDirty();
  lock.surfaces.push(surface);

  return surface;
}
