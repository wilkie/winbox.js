'use strict';

import { DevicePalette } from './device-palette.js';

/**
 * How a solid brush of a colour the display lacks is drawn: the pattern of
 * the colours it has that the display driver realises the brush as. Read off
 * the `dither` probe's recordings, which it reproduces on the VGA, the Super
 * VGA, the EGA and the Hercules, every pixel of every fill.
 *
 * Every pattern is eight pixels square and anchored to the device context's
 * origin, not to the rectangle filled -- the screen's corner for the screen,
 * a window's client area for the window's own device context, as a window's
 * controls show -- and every one orders its pixels by the same
 * table, `ORDER`: a pixel lower in it takes the darker part of the mixture.
 *
 * **The colour displays.** A colour the palette holds is solid. Any other is
 * mixed from two cubes of colours: the dark one, whose channels are 0 or 128,
 * and the bright one, whose channels are 0 or 255. In thirty-seconds -- pairs
 * of the order -- the brightest channel says how many pixels are bright,
 * `(max - 127) >> 2` when it is over 128, and the rest are dark. Each channel
 * then puts its value first into dark pixels, 128 a pixel, `(v + 1) >> 2` of
 * them at most; what is left over goes into bright pixels, 255 a pixel,
 * rounded to the nearest. In either part a channel is on in the pixels
 * highest in the order. The EGA's palette is not the VGA's, but the colours
 * it mixes are the same ones. See `DevicePalette.EGA`.
 *
 * **Two colours.** The Hercules's screen, and a monochrome bitmap on any
 * display. A number of the sixty-four pixels are white, the lowest in the
 * order, except at a few counts that have patterns of their own. What counts
 * and which order are the driver's:
 *
 * * The Hercules weighs the three channels alike, `(red + green + blue + 3) /
 *   12`, and has its own patterns at sixteen and forty-eight, a quarter and
 *   three quarters.
 * * The VGA and the Super VGA weigh green double, `(red + 2 * green + blue +
 *   MONO_ROUNDING) / 16`, and share the Hercules's order and its patterns.
 * * The EGA weighs them as the VGA does, in an order of its own, with its own
 *   patterns at thirty-two and forty-eight.
 */

/** The order of the pixels in a pattern, by y and x modulo eight. */
const ORDER = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
];

/**
 * The EGA's order for a monochrome bitmap. Its patterns at thirty-two and
 * forty-eight hide where those two counts start, and 31 and 47 are the only
 * numbers that make it an order of all sixty-four.
 */
const ORDER_EGA_MONO = [
  [0, 32, 16, 48, 2, 34, 18, 50],
  [24, 56, 8, 40, 26, 58, 10, 42],
  [4, 36, 20, 52, 6, 38, 22, 54],
  [28, 60, 12, 44, 30, 62, 14, 46],
  [3, 35, 19, 51, 1, 33, 17, 49],
  [27, 59, 11, 43, 25, 57, 9, 41],
  [7, 39, 23, 55, 5, 37, 21, 53],
  [31, 63, 15, 47, 29, 61, 13, 45],
];

/**
 * Patterns at a count of white pixels that are not the order's, two rows of
 * a byte each, repeated down: a set bit white, the leftmost pixel the most
 * significant. A quarter is every fourth pixel on a diagonal, three quarters
 * every fourth black, and a half a checkerboard. The same holds for `ORDER`:
 * its 15 and 47 are hidden by the patterns and are what make it an order.
 */
const QUARTER = [0x88, 0x22];
const HALF = [0xaa, 0x55];
const THREE_QUARTERS = [0xdd, 0x77];

/** How a display driver makes a monochrome pattern. */
interface Monochrome {
  white(red: number, green: number, blue: number): number;
  order: number[][];
  patterns: Record<number, number[]>;
}

/**
 * Added to `red + 2 * green + blue` before the division by sixteen. The greys
 * in steps of four allow 4 to 11; `monoramp`'s every level of grey, red, green
 * and blue allows only 4, on all three colour displays, 1,024 of 1,024.
 */
const MONO_ROUNDING = 4;

const HERCULES: Monochrome = {
  white: (red, green, blue) => Math.floor((red + green + blue + 3) / 12),
  order: ORDER,
  patterns: { 16: QUARTER, 48: THREE_QUARTERS },
};

const VGA: Monochrome = {
  white: (red, green, blue) => (red + 2 * green + blue + MONO_ROUNDING) >> 4,
  order: ORDER,
  patterns: { 16: QUARTER, 48: THREE_QUARTERS },
};

const EGA: Monochrome = {
  white: VGA.white,
  order: ORDER_EGA_MONO,
  patterns: { 32: HALF, 48: THREE_QUARTERS },
};

/** The monochrome patterns of a display's driver. */
function monochromeOf(display: any) {
  return DevicePalette.depthOf(display) === 1 ? HERCULES : display?.palette === 'ega' ? EGA : VGA;
}

/** A channel of a pixel of a colour display's pattern: 0, 128 or 255. */
function channel(value: number, bright: number, rank: number) {
  const dark = 32 - bright;
  const level = (value + 1) >> 2;

  if (rank < dark) {
    return rank >= dark - Math.min(dark, level) ? 128 : 0;
  }

  /* What 128 in each dark pixel leaves over, in 255s. `rest * 32 / 255` is
   * never exactly a half, so how a half would round is not a question. */
  const over = level > dark ? Math.round(((value - 4 * dark) * 32) / 255) : 0;

  return rank >= 32 - over ? 255 : 0;
}

/**
 * The palette index a brush of `red, green, blue` draws at device pixel
 * `x, y` of a bitmap with `palette` on `display`, or `null` where the colour
 * is drawn solid.
 */
export function ditheredIndex(
  display: any,
  palette: DevicePalette,
  red: number,
  green: number,
  blue: number,
  x: number,
  y: number
) {
  if (palette.holds(red, green, blue)) {
    return null;
  }

  if (palette.size === 2) {
    const mono = monochromeOf(display);
    const white = mono.white(red, green, blue);
    const pattern = mono.patterns[white];

    if (pattern) {
      return (pattern[y & 1] >> (7 - (x & 7))) & 1;
    }

    return mono.order[y & 7][x & 7] < white ? 1 : 0;
  }

  if (palette.size !== 16) {
    return null;
  }

  const order = ORDER[y & 7][x & 7];

  const max = Math.max(red, green, blue);
  const bright = max > 128 ? (max - 127) >> 2 : 0;
  const rank = order >> 1;

  return palette.index(
    channel(red, bright, rank),
    channel(green, bright, rank),
    channel(blue, bright, rank)
  );
}

/**
 * The pattern a brush is realised as, eight by eight by device pixel modulo
 * eight, row by row; or `null` for a brush drawn in one colour.
 */
export function ditherTile(
  display: any,
  palette: DevicePalette,
  red: number,
  green: number,
  blue: number
) {
  if (ditheredIndex(display, palette, red, green, blue, 0, 0) === null) {
    return null;
  }

  const tile = new Uint8Array(64);

  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      tile[(y << 3) | x] = ditheredIndex(display, palette, red, green, blue, x, y)!;
    }
  }

  return tile;
}
