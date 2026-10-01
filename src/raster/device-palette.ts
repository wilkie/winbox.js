'use strict';

/** The 256-colour display's static colours, the first ten and the last ten. */
const STATIC_LOW: [number, number, number][] = [
  [0x00, 0x00, 0x00],
  [0x80, 0x00, 0x00],
  [0x00, 0x80, 0x00],
  [0x80, 0x80, 0x00],
  [0x00, 0x00, 0x80],
  [0x80, 0x00, 0x80],
  [0x00, 0x80, 0x80],
  [0xc0, 0xc0, 0xc0],
  [0xc0, 0xdc, 0xc0],
  [0xa6, 0xca, 0xf0],
];
const STATIC_HIGH: [number, number, number][] = [
  [0xff, 0xfb, 0xf0],
  [0xa0, 0xa0, 0xa4],
  [0x80, 0x80, 0x80],
  [0xff, 0x00, 0x00],
  [0x00, 0xff, 0x00],
  [0xff, 0xff, 0x00],
  [0x00, 0x00, 0xff],
  [0xff, 0x00, 0xff],
  [0x00, 0xff, 0xff],
  [0xff, 0xff, 0xff],
];

/** The levels of the 256-colour driver's own colours. */
const CUBE = [0x3f, 0x5f, 0x7f, 0x9f, 0xbf, 0xdf, 0xff];

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
 * The EGA's sixteen are not the VGA's: its driver's table, which `EGA.DRV`
 * keeps where `VGA.DRV` keeps its own, has dark grey `404040` where the VGA has
 * light grey `c0c0c0`, and the `dither` probe's `GetNearestColor` and
 * `GetPixel` answer those colours on an EGA and no other.
 *
 * Monochrome is black at 0 and white at 1, as a set bit of a monochrome bitmap
 * is white. The 256-colour order is the Super VGA 256-colour driver's, recorded
 * by `palsys`.
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

  /**
   * An entry changed in place, as WinG changes the colour table of a bitmap
   * that is drawn on (`WinGSetDIBColorTable`): everything holding the palette
   * sees it, and the colours matched before are forgotten.
   */
  recolour(index: number, red: number, green: number, blue: number) {
    this.colours[index] = [red, green, blue];
    this.#found.clear();
    this.colours.forEach(([r, g, b], at) => {
      const key = (r << 16) | (g << 8) | b;

      if (!this.#found.has(key)) {
        this.#found.set(key, at);
      }
    });
  }

  /** Whether the palette holds a colour exactly. */
  holds(red: number, green: number, blue: number) {
    const key = (red << 16) | (green << 8) | blue;

    return this.colours.some(([r, g, b]) => ((r << 16) | (g << 8) | b) === key);
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

  /** The EGA's, from its display driver: the VGA's with `404040` for `c0c0c0`. */
  static readonly EGA = new DevicePalette(
    DevicePalette.SIXTEEN.colours.map(([red, green, blue], index) =>
      index === 8 ? ([0x40, 0x40, 0x40] as [number, number, number]) : [red, green, blue]
    )
  );

  /**
   * The 256-colour display's palette as the driver sets it up, before any
   * program realizes a palette of its own. **Recorded** by `palsys` on the
   * Super VGA 256-colour driver: the twenty static colours at 0 to 9 and 246
   * to 255, and between them the driver's own cube -- red, then green, then
   * blue, over `3f`, `5f`, `7f`, `9f`, `bf`, `df`, `ff`, starting a step in.
   */
  static readonly TWO_FIFTY_SIX = new DevicePalette(
    Array.from({ length: 256 }, (_, index): [number, number, number] => {
      if (index < 10) {
        return STATIC_LOW[index];
      }

      if (index >= 246) {
        return STATIC_HIGH[index - 246];
      }

      const step = index - 9;

      return [CUBE[step % 7], CUBE[Math.floor(step / 7) % 7], CUBE[Math.floor(step / 49)]];
    })
  );

  /** The indices of the static colours, which are all a 256-colour driver matches a colour to. */
  static readonly STATICS = [...Array(10).keys(), ...Array.from({ length: 10 }, (_, at) => 246 + at)];

  /** The palette for a depth in bits per pixel. */
  static forDepth(depth: number) {
    return depth === 1
      ? DevicePalette.MONO
      : depth === 4
        ? DevicePalette.SIXTEEN
        : DevicePalette.TWO_FIFTY_SIX;
  }

  /**
   * The palette of a display's own bitmaps, and of any bitmap at its depth: a
   * display mode may name one of its driver's own.
   */
  static forDisplay(display: any, depth = DevicePalette.depthOf(display)) {
    if (depth === DevicePalette.depthOf(display) && display?.palette === 'ega') {
      return DevicePalette.EGA;
    }

    return DevicePalette.forDepth(depth);
  }

  /** The depth of a display's bitmaps: a bit, four, or eight. */
  static depthOf(display: any) {
    const colors = display?.colors ?? 16;

    return colors <= 2 ? 1 : colors <= 16 ? 4 : 8;
  }
}
