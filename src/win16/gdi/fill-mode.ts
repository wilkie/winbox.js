'use strict';

/**
 * The fill mode Polygon fills by. **Recorded** by `fillext`: a device
 * context starts in `ALTERNATE`, 1; `SetPolyFillMode` answers the mode
 * before and keeps whatever it is given, 0 and 3 as well; `WINDING`, 2,
 * fills a five-pointed star's middle and `ALTERNATE` leaves it.
 *
 * @param {Types.HDC} hdc - The device context.
 * @param {Types.INT} nPolyFillMode - The new mode.
 *
 * @returns {Types.INT} The mode before.
 */
export function SetPolyFillMode(this: any, hdc: number, nPolyFillMode: number) {
  const surface = this.handles.resolve(hdc);

  if (!surface) {
    return 0;
  }

  const before = surface.polyFillMode ?? 1;

  surface.polyFillMode = nPolyFillMode;

  return before;
}

/**
 * The fill mode `SetPolyFillMode` last set, `ALTERNATE` until then.
 *
 * @param {Types.HDC} hdc - The device context.
 *
 * @returns {Types.INT} The mode.
 */
export function GetPolyFillMode(this: any, hdc: number) {
  const surface = this.handles.resolve(hdc);

  return surface ? (surface.polyFillMode ?? 1) : 0;
}
