'use strict';

/**
 * Sets how the pen and the brush mix with the pixels already there, and
 * answers the mode that was set before. A mode is one of the sixteen ways of
 * combining two values bit by bit, `R2_BLACK` 1 to `R2_WHITE` 16; a device
 * context starts in `R2_COPYPEN`, 13.
 *
 * **Recorded** by `mixmode`, which sets each of the sixteen in turn and reads
 * back what was set before and what `GetROP2` says after, on four displays.
 *
 * @param {Types.HDC} hdc - The device context.
 * @param {Types.INT} fnDrawMode - The new mode.
 *
 * @returns {Types.INT} The mode before.
 */
export function SetROP2(hdc, fnDrawMode) {
  const surface = this.handles.resolve(hdc);

  if (!surface) {
    return 0;
  }

  const old = surface.rop2 ?? 13;

  surface.rop2 = fnDrawMode;

  return old;
}

/**
 * The drawing mode `SetROP2` last set, `R2_COPYPEN` until then.
 *
 * @param {Types.HDC} hdc - The device context.
 *
 * @returns {Types.INT} The mode.
 */
export function GetROP2(hdc) {
  const surface = this.handles.resolve(hdc);

  return surface ? (surface.rop2 ?? 13) : 0;
}

/**
 * A drawing mode as the raster operation a `PatBlt` would carry out, the pen
 * or brush standing for the pattern.
 *
 * The mode's value less one is its table: bit `2p + d` is the result for a
 * pen bit `p` over a pixel bit `d`, so `R2_COPYPEN`, 13, is `1100` and
 * `R2_NOT`, 6, is `0101`. A raster operation's table has a bit for every
 * pattern, source and destination bit, `4p + 2s + d`, and this one ignores
 * the source.
 */
export function ropOfMode(mode: number) {
  const two = (mode - 1) & 15;
  let table = 0;

  for (let bit = 0; bit < 8; bit++) {
    if (two & (1 << (((bit >> 2) & 1) * 2 + (bit & 1)))) {
      table |= 1 << bit;
    }
  }

  return table << 16;
}
