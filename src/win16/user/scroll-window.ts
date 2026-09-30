'use strict';

import { ClipRegion } from '../../raster/clip-region.js';
import { DeviceBitmap } from '../../raster/device-bitmap.js';
import { Surface } from '../../raster/surface.js';
import { regionOf } from '../gdi/regions.js';
import { InvalidateRect } from './InvalidateRect.js';
import { RasterWindow } from './raster-window.js';

/**
 * Scrolling what is drawn: `ScrollWindow`, `ScrollWindowEx` and `ScrollDC`.
 * **Recorded** by `scrolls`, on a window 32 by 24 of blocks of colour, read
 * back pixel by pixel straight after each call:
 *
 * * The pixels inside both the scroll rectangle -- the whole client area when
 *   none is given -- and the clip rectangle move by the amount asked, and
 *   land only inside the clip: nothing is brought in from outside it. The
 *   pixels the move uncovers keep what they had.
 * * What is left to paint is the scroll rectangle, cut to the clip, less
 *   where its pixels went: an L for a move both ways, whose box is the whole
 *   of it, a complex region.
 * * `ScrollWindow` invalidates that; `ScrollWindowEx` only with
 *   `SW_INVALIDATE`, and answers the region's kind whether it invalidates or
 *   not. `ScrollDC` invalidates nothing and answers TRUE. The two that take
 *   them fill in the update rectangle, the region's box, and the update
 *   region.
 * * `ScrollWindow` with no scroll rectangle moves the window's children with
 *   its pixels; with one, it leaves them. `ScrollWindowEx` moves them only
 *   with `SW_SCROLLCHILDREN`.
 *
 * Not recorded: what a child moved is sent, which here is nothing; pixels
 * of the window that another window covers, which a scroll here copies as
 * they are on the screen; and whether an update is erased, taken from the
 * documentation: `ScrollWindow` erases, `ScrollWindowEx` with `SW_ERASE`.
 */

const SW_SCROLLCHILDREN = 0x0001;
const SW_INVALIDATE = 0x0002;
const SW_ERASE = 0x0004;

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function cut(a: Box, b: Box): Box {
  return {
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  };
}

const regionOfBox = (box: Box) => ClipRegion.rect(box.left, box.top, box.right, box.bottom);

/**
 * Moves the pixels of `bitmap` inside `scroll` and `clip` by `dx`, `dy`,
 * changing only those inside `clip`, and answers what is left to paint.
 */
function scrollPixels(
  bitmap: DeviceBitmap,
  dx: number,
  dy: number,
  scroll: Box | null,
  clip: Box | null
) {
  const whole = { left: 0, top: 0, right: bitmap.width, bottom: bitmap.height };
  const to = cut(clip ?? whole, whole);
  const from = cut(scroll ?? whole, to);
  const width = from.right - from.left;
  const height = from.bottom - from.top;

  if (width > 0 && height > 0) {
    const kept = new Uint8Array(width * height);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        kept[y * width + x] = bitmap.indexAt(from.left + x, from.top + y) ?? 0;
      }
    }

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const tx = from.left + x + dx;
        const ty = from.top + y + dy;

        if (tx >= to.left && tx < to.right && ty >= to.top && ty < to.bottom) {
          bitmap.put(tx, ty, kept[y * width + x]);
        }
      }
    }
  }

  const moved = {
    left: from.left + dx,
    top: from.top + dy,
    right: from.right + dx,
    bottom: from.bottom + dy,
  };

  return regionOfBox(from).subtract(regionOfBox(moved));
}

/** An update's box into a program's rectangle, and its shape into its region. */
function tell(system: any, left: ClipRegion, hrgnUpdate: number, lprcUpdate: any) {
  if (lprcUpdate) {
    Object.assign(lprcUpdate, left.box);
  }

  const region = hrgnUpdate ? regionOf(system, hrgnUpdate) : null;

  if (region) {
    region.shape = left;
  }
}

async function scrollWindow(
  system: any,
  hwnd: number,
  dx: number,
  dy: number,
  scroll: Box | null,
  clip: Box | null,
  { children, invalidate, erase }: { children: boolean; invalidate: boolean; erase: boolean }
) {
  const owner = system.handles.resolve(hwnd);

  if (!(owner instanceof RasterWindow)) {
    return null;
  }

  const window = owner.window;
  const left = scrollPixels(window.surface.bitmap as DeviceBitmap, dx, dy, scroll, clip);

  if (children) {
    for (const child of owner.desktop.windows.filter((other: any) => other.parent === window)) {
      owner.desktop.place(child, child.left + dx, child.top + dy, child.width, child.height);
    }
  }

  if (invalidate && left.kind > 1) {
    await InvalidateRect.call(system, hwnd, { ...left.box }, erase ? 1 : 0);
  }

  return left;
}

export async function ScrollWindow(
  this: any,
  hwnd: number,
  dx: number,
  dy: number,
  lprcScroll: Box | null,
  lprcClip: Box | null
) {
  await scrollWindow(this, hwnd, dx, dy, lprcScroll, lprcClip, {
    children: !lprcScroll,
    invalidate: true,
    erase: true,
  });
}

export async function ScrollWindowEx(
  this: any,
  hwnd: number,
  dx: number,
  dy: number,
  prcScroll: Box | null,
  prcClip: Box | null,
  hrgnUpdate: number,
  prcUpdate: any,
  flags: number
) {
  const left = await scrollWindow(this, hwnd, dx, dy, prcScroll, prcClip, {
    children: (flags & SW_SCROLLCHILDREN) !== 0,
    invalidate: (flags & SW_INVALIDATE) !== 0,
    erase: (flags & SW_ERASE) !== 0,
  });

  if (!left) {
    return 0;
  }

  tell(this, left, hrgnUpdate, prcUpdate);

  return left.kind;
}

export function ScrollDC(
  this: any,
  hdc: number,
  dx: number,
  dy: number,
  lprcScroll: Box | null,
  lprcClip: Box | null,
  hrgnUpdate: number,
  lprcUpdate: any
) {
  const surface = this.handles.resolve(hdc);

  if (!(surface instanceof Surface) || !(surface.bitmap instanceof DeviceBitmap)) {
    return 0;
  }

  tell(this, scrollPixels(surface.bitmap, dx, dy, lprcScroll, lprcClip), hrgnUpdate, lprcUpdate);

  return 1;
}
