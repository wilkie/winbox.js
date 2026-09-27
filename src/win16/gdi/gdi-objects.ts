'use strict';

/**
 * A region: here only a rectangle, and a handle for it. The handle is a GDI
 * object's, with the low bits every GDI handle has (see `HandleManager`), and
 * `DeleteObject` frees it. What a region does -- combining, filling, clipping
 * -- is not followed yet.
 */
export class Region {
  constructor(
    readonly left: number,
    readonly top: number,
    readonly right: number,
    readonly bottom: number
  ) {}
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
  system._defaultPalette ??= system.handles.allocate(new LogicalPalette()) ?? 0;

  return system._defaultPalette;
}

export function CreateRectRgn(this: any, nLeftRect: number, nTopRect: number, nRightRect: number, nBottomRect: number) {
  const signed = (value: number) => (value << 16) >> 16;

  return (
    this.handles.allocate(
      new Region(signed(nLeftRect), signed(nTopRect), signed(nRightRect), signed(nBottomRect))
    ) ?? 0
  );
}

export function CreateRectRgnIndirect(this: any, lprc: any) {
  return lprc ? CreateRectRgn.call(this, lprc.left, lprc.top, lprc.right, lprc.bottom) : 0;
}
