'use strict';

import { Palette } from './palette.js';

/**
 * The colours a device-dependent bitmap's pixels index, by depth.
 *
 * A raster operation works on these indices, bit by bit, not on red, green and
 * blue, so the order of the colours is part of the behaviour. Recorded by the
 * `bitblt` probe on a sixteen-colour VGA: red `SRCAND` blue is light grey,
 * and all sixteen colours exclusive-ored and anded onto each of the sixteen fix
 * every index up to the order of its four bits, which no operation can see.
 * The order is the Windows palette's, with light grey and dark grey swapped.
 *
 * Monochrome is black at 0 and white at 1, as a set bit of a monochrome bitmap
 * is white. The 256-colour order is the one this project already used and is
 * not recorded.
 */
export class DevicePalette {
  /** Each index's colour, as red, green and blue. */
  readonly colours: [number, number, number][];

  /** Colours already matched, by `0xRRGGBB`. */
  readonly #found = new Map<number, number>();

  constructor(colours: [number, number, number][]) {
    this.colours = colours;

    colours.forEach(([red, green, blue], index) => {
      const key = (red << 16) | (green << 8) | blue;

      if (!this.#found.has(key)) {
        this.#found.set(key, index);
      }
    });
  }

  get size() {
    return this.colours.length;
  }

  /**
   * The index of a colour: exact where the palette holds it, and otherwise the
   * nearest by distance in red, green and blue. How a colour outside the palette
   * is matched is not recorded.
   */
  index(red: number, green: number, blue: number) {
    const key = (red << 16) | (green << 8) | blue;
    const found = this.#found.get(key);

    if (found !== undefined) {
      return found;
    }

    let best = 0;
    let distance = Infinity;

    this.colours.forEach(([r, g, b], index) => {
      const d = (r - red) ** 2 + (g - green) ** 2 + (b - blue) ** 2;

      if (d < distance) {
        distance = d;
        best = index;
      }
    });

    this.#found.set(key, best);

    return best;
  }

  /** A `COLORREF`, `0x00BBGGRR`, for an index. */
  colorref(index: number) {
    const [red, green, blue] = this.colours[index] ?? [0, 0, 0];

    return (blue << 16) | (green << 8) | red;
  }

  static readonly MONO = new DevicePalette([
    [0x00, 0x00, 0x00],
    [0xff, 0xff, 0xff],
  ]);

  static readonly SIXTEEN = new DevicePalette([
    [0x00, 0x00, 0x00],
    [0x80, 0x00, 0x00],
    [0x00, 0x80, 0x00],
    [0x80, 0x80, 0x00],
    [0x00, 0x00, 0x80],
    [0x80, 0x00, 0x80],
    [0x00, 0x80, 0x80],
    [0x80, 0x80, 0x80],
    [0xc0, 0xc0, 0xc0],
    [0xff, 0x00, 0x00],
    [0x00, 0xff, 0x00],
    [0xff, 0xff, 0x00],
    [0x00, 0x00, 0xff],
    [0xff, 0x00, 0xff],
    [0x00, 0xff, 0xff],
    [0xff, 0xff, 0xff],
  ]);

  static readonly TWO_FIFTY_SIX = new DevicePalette(
    Array.from({ length: 256 }, (_, index) => {
      const [red, green, blue] = Palette.PALETTEWIN256[index] ?? [0, 0, 0];

      return [red, green, blue] as [number, number, number];
    })
  );

  /** The palette for a depth in bits per pixel. */
  static forDepth(depth: number) {
    return depth === 1
      ? DevicePalette.MONO
      : depth === 4
        ? DevicePalette.SIXTEEN
        : DevicePalette.TWO_FIFTY_SIX;
  }

  /** The depth of a display's bitmaps: a bit, four, or eight. */
  static depthOf(display: any) {
    const colors = display?.colors ?? 16;

    return colors <= 2 ? 1 : colors <= 16 ? 4 : 8;
  }
}
