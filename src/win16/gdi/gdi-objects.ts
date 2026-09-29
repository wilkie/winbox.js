'use strict';

import { stockHandle } from '../handle-manager.js';

import { ClipRegion } from '../../raster/clip-region.js';

/**
 * A region: the pixels it holds, as bands of rows, and a handle for it. The
 * handle is a GDI object's, with the low bits every GDI handle has (see
 * `HandleManager`), and `DeleteObject` frees it. See `regions.ts`.
 */
export class Region {
  constructor(public shape: ClipRegion) {}

  get left() {
    return this.shape.box.left;
  }

  get top() {
    return this.shape.box.top;
  }

  get right() {
    return this.shape.box.right;
  }

  get bottom() {
    return this.shape.box.bottom;
  }
}

/**
 * A logical palette: only the default one, which `GetStockObject` gives out,
 * so far. Its handle is a GDI object's; what a palette holds and does is not
 * followed yet.
 */
export class LogicalPalette {
  /** Its entries -- red, green, blue and flags -- or none for the stock palette's own. */
  entries: [number, number, number, number][] | null = null;
}

/** The stock `DEFAULT_PALETTE`: one object, the same handle each time. */
export function defaultPalette(system: any): number {
  /* At the stock palette's own handle (`gdinum`). */
  if (!system._defaultPalette) {
    system._defaultPalette = stockHandle(15);
    system.handles.assign(system._defaultPalette, new LogicalPalette());
  }

  return system._defaultPalette;
}

export function CreateRectRgn(this: any, nLeftRect: number, nTopRect: number, nRightRect: number, nBottomRect: number) {
  const signed = (value: number) => (value << 16) >> 16;

  /* A rectangle given the wrong way round is empty, not turned: **recorded**
   * by `regions`. */
  return (
    this.handles.allocate(
      new Region(
        ClipRegion.rect(signed(nLeftRect), signed(nTopRect), signed(nRightRect), signed(nBottomRect))
      )
    ) ?? 0
  );
}

export function CreateRectRgnIndirect(this: any, lprc: any) {
  return lprc ? CreateRectRgn.call(this, lprc.left, lprc.top, lprc.right, lprc.bottom) : 0;
}
