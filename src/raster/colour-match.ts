'use strict';

import { DevicePalette } from './device-palette.js';

/**
 * Which of its colours a display driver draws a colour as: what
 * `GetNearestColor` answers, and what the driver's `RealizeObject` makes of a
 * pen's or a solid brush's colour before anything is drawn. Read out of the
 * drivers' own code -- `ColorInfo`, export 2, and the routine it and
 * `RealizeObject` share -- and held to the `dither` probe's `nearest` records,
 * 194 of 194 on each display.
 *
 * It is not the nearest colour by any distance. The sixteen-colour drivers
 * sort the colour's channels, largest first, and look at its shape: the
 * largest of what the biggest channel has over the middle one, what the middle
 * has over the smallest, and the smallest. Whichever is largest says whether
 * the colour is one channel, two, or a grey, and each has a list of levels
 * and the colours they stand for; the level nearest the biggest channel wins,
 * the lower on a tie. Red 192, green 128, blue 0 is two channels, and nearest
 * 255, so yellow; with blue 64 it is one channel, and red.
 *
 * The EGA's list for greys has its own two greys, `40` and `82`, where the
 * VGA's has `80` and `c0`. The Hercules draws white where red, green and blue
 * add up to 382 or more.
 */

interface Shape {
  /** The levels, and the index bits each stands for, largest channel first. */
  levels: number[];
  bits: number[];
}

/** The VGA's shapes, from `VGA.DRV`'s tables: one channel, two, and grey. */
const VGA: Shape[] = [
  { levels: [0x00, 0x80, 0xff], bits: [0x0, 0x1, 0x9] },
  { levels: [0x00, 0x80, 0xff], bits: [0x0, 0x3, 0xb] },
  { levels: [0x00, 0x80, 0xc0, 0xff], bits: [0x0, 0x7, 0x8, 0xf] },
];

/** The EGA's, from `EGA.DRV`'s: the same, but for its greys. */
const EGA: Shape[] = [
  VGA[0],
  VGA[1],
  { levels: [0x00, 0x40, 0x82, 0xff], bits: [0x0, 0x8, 0x7, 0xf] },
];

/**
 * Which shape each ordering of the three parts is, by the driver's code for
 * the ordering: which of its three comparisons swapped.
 */
const SHAPE_OF = [0, 1, 0, 0, 2, 1, 2, 0];

/**
 * The sixteen-colour indices a two-colour bitmap takes as white, from the
 * flags the drivers keep beside their colours: light grey, green, yellow,
 * magenta, cyan and white on the VGA; the EGA's index 8 is its dark grey, and
 * is not.
 */
const WHITE_ON_MONO = new Set([8, 10, 11, 13, 14, 15]);
const WHITE_ON_MONO_EGA = new Set([10, 11, 13, 14, 15]);

/**
 * Sorts three values largest first as the drivers do, swapping first and
 * last, then middle and last, then first and middle, and says which swapped.
 */
function sort(a: number, b: number, c: number) {
  let swaps = 0;

  if (a < c) {
    [a, c] = [c, a];
    swaps |= 4;
  }

  if (b < c) {
    [b, c] = [c, b];
    swaps |= 2;
  }

  if (a < b) {
    [a, b] = [b, a];
    swaps |= 1;
  }

  return { values: [a, b, c], swaps };
}

/** The sixteen-colour index a driver draws `red, green, blue` as. */
function sixteen(shapes: Shape[], red: number, green: number, blue: number) {
  const {
    values: [max, mid, min],
    swaps,
  } = sort(red, green, blue);

  if (max === 0) {
    return 0;
  }

  const shape = shapes[SHAPE_OF[sort(max - mid, mid - min, min).swaps]];
  let best = 0;

  shape.levels.forEach((level, at) => {
    if (Math.abs(level - max) < Math.abs(shape.levels[best] - max)) {
      best = at;
    }
  });

  /* The bits are for the channels largest first; undo the sort, last swap
   * first. */
  const bits = shape.bits[best];
  let [first, second, third] = [bits & 1, (bits >> 1) & 1, (bits >> 2) & 1];

  if (swaps & 1) {
    [first, second] = [second, first];
  }

  if (swaps & 2) {
    [second, third] = [third, second];
  }

  if (swaps & 4) {
    [first, third] = [third, first];
  }

  return (bits & 8) | (third << 2) | (second << 1) | first;
}

/**
 * The index in `palette`, a bitmap's on `display`, that the display's driver
 * draws `red, green, blue` as.
 */
export function matchedIndex(
  display: any,
  palette: DevicePalette,
  red: number,
  green: number,
  blue: number
) {
  const ega = display?.palette === 'ega';
  const shapes = ega ? EGA : VGA;

  if (palette.size === 2) {
    if (DevicePalette.depthOf(display) === 1) {
      return red + green + blue >= 382 ? 1 : 0;
    }

    const white = ega ? WHITE_ON_MONO_EGA : WHITE_ON_MONO;

    return white.has(sixteen(shapes, red, green, blue)) ? 1 : 0;
  }

  if (palette.size === 16) {
    return sixteen(shapes, red, green, blue);
  }

  return palette.index(red, green, blue);
}
