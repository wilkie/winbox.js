'use strict';

import { BitmapContext } from './bitmap-context.js';
import { DeviceBitmap } from './device-bitmap.js';
import { DevicePalette } from './device-palette.js';
import { ditherTile } from './dither.js';
import { colourOf, realizedMatch } from './palette-colour.js';
import { matchedIndex } from './colour-match.js';

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

/**
 * A colour of one bitmap's palette as an index of another's. Onto the
 * 256-colour display's, the nearest static colour, as its driver matches
 * any colour: a WinG bitmap's colour table, blitted to the screen with no
 * palette realized, comes out so (`wingapi`). Onto any other, the nearest
 * of its colours.
 */
function across(
  display: any,
  palette: DevicePalette,
  red: number,
  green: number,
  blue: number,
  realized: ((red: number, green: number, blue: number) => number) | null = null
) {
  if (realized && palette.size === 256) {
    return realized(red, green, blue);
  }

  return palette.size === 256
    ? matchedIndex(display, palette, red, green, blue)
    : palette.index(red, green, blue);
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

/** An RGBA colour, `Color`, as the index of a palette the display's driver
 * draws it as. See `matchedIndex`. */
const indexOfColour = (display: any, palette: DevicePalette, colour: any) =>
  colour?.slot !== undefined && palette.size === 256
    ? colour.slot
    : colour
      ? matchedIndex(display, palette, colour.red, colour.green, colour.blue)
      : 0;

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
      read: (px, py) => bitmap.indexAt(px, py) ?? 0,
      write: (px, py, index) => bitmap.put(px, py, index),
      finish: () => bitmap.context.markRect(x, y, x + width, y + height),
    };
  }

  /* A surface of colours: a window, or an RGBA offscreen surface. Its pixels
   * are the display's colours, so they are indices of the display's palette,
   * read back only if the operation needs them. */
  const depth = DevicePalette.depthOf(display);
  const palette = DevicePalette.forDisplay(display);
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

  /* A palette realized where it draws: a source's colours are its nearest
   * entries' slots (`paldib`, WinG's bitmaps). */
  const realized = realizedMatch(dest);

  /* The brush, as the destination's index: its nearest colour, or where the
   * display driver realises it as a pattern, that pattern's index at each
   * pixel. A driver makes patterns for its own format and for monochrome, and
   * for nothing else. See `ditheredIndex`. */
  const brush =
    dest.brush?.colorref !== null && dest.brush?.colorref !== undefined
      ? colourOf(dest.brush.colorref, dest)
      : dest.brush?.color;
  const solid = indexOfColour(display, to.palette, brush);
  const own = to.depth === 1 || to.palette === DevicePalette.forDisplay(display);
  const tile =
    own && brush && (brush as any).slot === undefined
      ? ditherTile(display, to.palette, brush.red, brush.green, brush.blue)
      : null;
  /* Anchored where the brush was realised: the device context's origin
   * when it was first selected, kept, though it is used in another, until
   * `UnrealizeObject` (`brushrlz`). See `ditherTile`. */
  const origin = brushOriginIn(dest);
  let pattern = tile
    ? (px: number, py: number) => tile[(((py - origin.y) & 7) << 3) | ((px - origin.x) & 7)]
    : (_px: number, _py: number) => solid;

  /* A hatched brush: its lines its colour, and between them the background
   * colour. See `CreateBrushIndirect`. */
  const hatch = dest.brush?.hatch;

  if (hatch && brush) {
    const back = indexOfColour(display, to.palette, dest.backcolor);

    pattern = (px, py) =>
      hatch[(((py - origin.y) & 7) << 3) | ((px - origin.x) & 7)] ? solid : back;
  }

  /* A pattern brush's own pixels, from where it was realised, carried into
   * the destination's terms as a source is: a monochrome pattern's set bits
   * the background colour and its clear bits the text colour, as the
   * destination has them now -- into a monochrome bitmap too, where a white
   * text colour and a black background turn the pattern over (`patmono`).
   * See `CreatePatternBrush`. */
  const painted = dest.brush?.pattern;

  if (painted) {
    let bring: (index: number) => number = (index) => index;

    if (painted.depth === 1) {
      const text = indexOfColour(
        display,
        to.palette,
        dest.textColor ?? { red: 0, green: 0, blue: 0 }
      );
      const back = indexOfColour(display, to.palette, dest.backcolor);

      bring = (bit) => (bit ? back : text);
    } else if (painted.depth > 1 && to.depth === 1) {
      const back = indexOfColour(display, painted.palette, dest.backcolor);

      bring = (index) => (index === back ? 1 : 0);
    } else if (painted.palette !== to.palette) {
      bring = (index) => {
        const [red, green, blue] = painted.palette.colours[index] ?? [0, 0, 0];

        return across(display, to.palette, red, green, blue, realized);
      };
    }

    const cells = Array.from(painted.indices as Uint8Array, bring);

    pattern = (px, py) => cells[(((py - origin.y) & 7) << 3) | ((px - origin.x) & 7)];
  }

  /* A source pixel, carried into the destination's terms. */
  let carry: (index: number) => number = (index) => index;

  if (from && from.depth === 1 && to.depth > 1) {
    const text = indexOfColour(
      display,
      to.palette,
      dest.textColor ?? { red: 0, green: 0, blue: 0 }
    );
    const back = indexOfColour(display, to.palette, dest.backcolor);

    carry = (bit) => (bit ? back : text);
  } else if (from && from.depth > 1 && to.depth === 1) {
    const back = indexOfColour(display, from.palette, source.backcolor);

    carry = (index) => (index === back ? 1 : 0);
  } else if (from && from.palette !== to.palette) {
    carry = (index) => {
      const [red, green, blue] = from.palette.colours[index] ?? [0, 0, 0];
      return across(display, to.palette, red, green, blue, realized);
    };
  }

  /* The table for every pattern, source and destination value, where the
   * depth is small enough to have one. */
  let result: (p: number, s: number, d: number) => number;

  if (to.depth <= 4) {
    const size = 1 << to.depth;
    const cells = new Uint8Array(size * size * size);

    for (let p = 0; p < size; p++) {
      for (let s = 0; s < size; s++) {
        for (let d = 0; d < size; d++) {
          cells[(p * size + s) * size + d] = combine(table, p, s, d, mask);
        }
      }
    }

    result = (p, s, d) => cells[(p * size + s) * size + d];
  } else {
    result = (p, s, d) => combine(table, p, s, d, mask);
  }

  for (let py = top; py < bottom; py++) {
    for (let px = left; px < right; px++) {
      const s = from ? carry(from.read(px - x + sx, py - y + sy)) : 0;
      const d = to.read(px, py);

      to.write!(px, py, result(pattern(px, py), s, d));
    }
  }

  to.finish?.();
}

/**
 * Where a device context's brush's pattern starts, in the context's own
 * terms: where the brush was realised, on the screen, less the context's
 * corner there; its corner, for a brush not yet realised.
 */
export function brushOriginIn(dest: any) {
  const realised = dest.brush?.realised;

  if (!realised) {
    return { x: 0, y: 0 };
  }

  const corner = dest.screenOrigin?.() ?? { x: 0, y: 0 };

  return { x: realised.x - corner.x, y: realised.y - corner.y };
}
