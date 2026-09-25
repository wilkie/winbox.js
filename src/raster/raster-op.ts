'use strict';

import { BitmapContext } from './bitmap-context.js';
import { DeviceBitmap } from './device-bitmap.js';
import { DevicePalette } from './device-palette.js';

/**
 * `BitBlt` and `PatBlt`: a rectangle of pixels combined from the brush, a
 * source and the destination under a raster operation.
 *
 * A raster operation's code carries its own truth table: bit `k` of the byte in
 * its high word is the result for brush bit `k >> 2`, source bit `(k >> 1) & 1`
 * and destination bit `k & 1`. It applies bit by bit to the pixels' palette
 * indices, not to red, green and blue. Recorded by the `bitblt` probe: all
 * fifteen named operations between monochrome bitmaps, under a black brush and
 * a white one; and on a sixteen-colour display, red `SRCAND` blue is light grey,
 * which is index arithmetic and not colour.
 *
 * Where the two sides differ in depth, a pixel is carried across as `bitblt`
 * recorded: a monochrome source's white bits become the destination's
 * background colour and its black bits the text colour, and a colour source
 * becomes white exactly where it is the source's background colour.
 *
 * Each side is a device-dependent bitmap selected into a memory device context,
 * worked on as indices in place, or any other surface -- a window, or an RGBA
 * offscreen surface -- whose colours are taken to be the display's and read
 * back only when the operation reads the destination.
 */

/** The truth table in a raster operation's code. */
export const tableOf = (rop: number) => (rop >>> 16) & 0xff;

/** Whether an operation reads the source, and the destination. */
export const usesSource = (table: number) => ((table >> 2) & 0x33) !== (table & 0x33);
export const usesDestination = (table: number) => ((table >> 1) & 0x55) !== (table & 0x55);

/** One result, `bits` bits wide, from pattern, source and destination values. */
export function combine(table: number, p: number, s: number, d: number, mask: number) {
  let out = 0;

  for (let k = 0; k < 8; k++) {
    if (table & (1 << k)) {
      out |= (k & 4 ? p : ~p) & (k & 2 ? s : ~s) & (k & 1 ? d : ~d);
    }
  }

  return out & mask;
}

/** One side of the operation: indices read and written in its own palette. */
interface Side {
  depth: number;
  palette: DevicePalette;
  width: number;
  height: number;
  read(x: number, y: number): number;
  write?(x: number, y: number, index: number): void;
  finish?(): void;
}

/** An RGBA colour, `Color`, as an index of a palette. */
const indexOfColour = (palette: DevicePalette, colour: any) =>
  colour ? palette.index(colour.red, colour.green, colour.blue) : 0;

function sideOf(
  surface: any,
  display: any,
  x: number,
  y: number,
  width: number,
  height: number,
  reads: boolean
): Side {
  const bitmap = surface.bitmap;

  if (bitmap instanceof DeviceBitmap) {
    return {
      depth: bitmap.depth,
      palette: bitmap.devicePalette,
      width: bitmap.width,
      height: bitmap.height,
      read: (px, py) => bitmap.indices[py * bitmap.width + px],
      write: (px, py, index) => {
        bitmap.indices[py * bitmap.width + px] = index;
      },
      finish: () => bitmap.context.markRect(x, y, x + width, y + height),
    };
  }

  /* A surface of colours: a window, or an RGBA offscreen surface. Its pixels
   * are the display's colours, so they are indices of the display's palette,
   * read back only if the operation needs them. */
  const depth = DevicePalette.depthOf(display);
  const palette = DevicePalette.forDepth(depth);
  const context = surface.context;
  const image = reads
    ? context.getImageData(x, y, width, height)
    : context instanceof BitmapContext || typeof context.createImageData !== 'function'
      ? { width, height, data: new Uint8ClampedArray(width * height * 4) }
      : context.createImageData(width, height);
  const data = image.data;

  return {
    depth,
    palette,
    width: surface.width,
    height: surface.height,
    read: (px, py) => {
      const at = ((py - y) * width + (px - x)) * 4;
      return palette.index(data[at], data[at + 1], data[at + 2]);
    },
    write: (px, py, index) => {
      const at = ((py - y) * width + (px - x)) * 4;
      const [red, green, blue] = palette.colours[index] ?? [0, 0, 0];

      data[at] = red;
      data[at + 1] = green;
      data[at + 2] = blue;
      data[at + 3] = 0xff;
    },
    finish: () => {
      context.putImageData(image, x, y);

      if (surface) {
        surface._stale = true;
      }
    },
  };
}

/**
 * Carries out one raster operation from `source` (or none) onto `dest`, a
 * rectangle `width` by `height` at `x, y`, the source's at `sx, sy`.
 */
export function rasterOp(
  display: any,
  dest: any,
  x: number,
  y: number,
  width: number,
  height: number,
  rop: number,
  source: any | null,
  sx: number,
  sy: number
) {
  const table = tableOf(rop);

  if (width <= 0 || height <= 0) {
    return;
  }

  /* Clip to the destination, and to the source where there is one. */
  let left = Math.max(x, 0);
  let top = Math.max(y, 0);
  let right = Math.min(x + width, dest.width);
  let bottom = Math.min(y + height, dest.height);

  const readsSource = !!source && usesSource(table);

  if (readsSource) {
    left = Math.max(left, x - sx);
    top = Math.max(top, y - sy);
    right = Math.min(right, x - sx + source.width);
    bottom = Math.min(bottom, y - sy + source.height);
  }

  if (right <= left || bottom <= top) {
    return;
  }

  const w = right - left;
  const h = bottom - top;
  const to = sideOf(dest, display, left, top, w, h, usesDestination(table));
  const from = readsSource
    ? sideOf(source, display, left - x + sx, top - y + sy, w, h, true)
    : null;
  const mask = (1 << to.depth) - 1;

  /* The brush, as the destination's index. */
  const p = indexOfColour(to.palette, dest.brush?.color);

  /* A source pixel, carried into the destination's terms. */
  let carry: (index: number) => number = (index) => index;

  if (from && from.depth === 1 && to.depth > 1) {
    const text = indexOfColour(to.palette, dest.textColor ?? { red: 0, green: 0, blue: 0 });
    const back = indexOfColour(to.palette, dest.backcolor);

    carry = (bit) => (bit ? back : text);
  } else if (from && from.depth > 1 && to.depth === 1) {
    const back = indexOfColour(from.palette, source.backcolor);

    carry = (index) => (index === back ? 1 : 0);
  } else if (from && from.palette !== to.palette) {
    carry = (index) => {
      const [red, green, blue] = from.palette.colours[index] ?? [0, 0, 0];
      return to.palette.index(red, green, blue);
    };
  }

  /* The table for every pattern, source and destination value, where the
   * depth is small enough to have one. */
  let result: (s: number, d: number) => number;

  if (to.depth <= 4) {
    const size = 1 << to.depth;
    const cells = new Uint8Array(size * size);

    for (let s = 0; s < size; s++) {
      for (let d = 0; d < size; d++) {
        cells[s * size + d] = combine(table, p, s, d, mask);
      }
    }

    result = (s, d) => cells[s * size + d];
  } else {
    result = (s, d) => combine(table, p, s, d, mask);
  }

  for (let py = top; py < bottom; py++) {
    for (let px = left; px < right; px++) {
      const s = from ? carry(from.read(px - x + sx, py - y + sy)) : 0;
      const d = to.read(px, py);

      to.write!(px, py, result(s, d));
    }
  }

  to.finish?.();
}
