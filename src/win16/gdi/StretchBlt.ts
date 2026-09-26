'use strict';

import { DeviceBitmap } from '../../raster/device-bitmap.js';
import { DevicePalette } from '../../raster/device-palette.js';
import { rasterOp, tableOf, usesSource } from '../../raster/raster-op.js';
import { stretchColumns, stretchMap, stretchRows } from '../../raster/stretch.js';

import { TRUE, FALSE } from '../consts.js';

/** `SRCCOPY`. */
const SRCCOPY = 0x00cc0020;

/** `BLACKONWHITE`, `WHITEONBLACK` and `COLORONCOLOR`. */
const BLACKONWHITE = 1;
const COLORONCOLOR = 3;

/**
 * A rectangle's edge and extent put in order: a negative extent from `at`
 * covers `at + extent + 1` to `at + 1`, and mirrors (seg32 `11bb`).
 */
function ordered(at: number, extent: number) {
  return extent < 0
    ? { at: at + extent + 1, size: -extent, mirror: true }
    : { at, size: extent, mirror: false };
}

/**
 * Copies a rectangle of one device context into a rectangle of another of a
 * different size, stretching or shrinking it, under a raster operation.
 *
 * GDI does the stretching itself, as no display driver does (`GDI.EXE` seg32
 * `03ba`). It puts each rectangle in order; a negative extent on one side
 * mirrors that axis, and on both sides does not. Rectangles the same size are
 * a `BitBlt`. Otherwise the source is copied, stretched into a bitmap the
 * destination's size, and that is combined into the destination under the
 * operation. Which columns and rows are shown is `stretchColumns` and
 * `stretchRows`. Shrinking, the stretch mode says what becomes of those that
 * fall together: `COLORONCOLOR` shows one of them, `BLACKONWHITE` ands their
 * colour indices and `WHITEONBLACK` ors them.
 *
 * **Recorded** by `stretch` on the VGA, and **read out**: see
 * `src/raster/stretch.ts`. The indices anded and ored are those of GDI's own
 * sixteen-colour copy of the pixels, whose colour table is the display
 * driver's, and so its bitmaps' own order.
 *
 * Not read out, and followed only as the scroll bar's arrows are
 * (`stretchMap`): a stretch between monochrome bitmaps and another depth
 * (seg32 `0000`), and rectangles within a pixel of each other's size (seg32
 * `04fb`), there mirrored by walking the source backwards. The mapping mode is
 * taken to be `MM_TEXT`.
 *
 * @param {Types.HDC} hdcDest - Where to draw.
 * @param {Types.INT} nXDest - The destination rectangle's left edge.
 * @param {Types.INT} nYDest - Its top edge.
 * @param {Types.INT} nWidthDest - Its width, negative to mirror.
 * @param {Types.INT} nHeightDest - Its height, negative to mirror.
 * @param {Types.HDC} hdcSrc - Where the pixels come from.
 * @param {Types.INT} nXSrc - The source rectangle's left edge.
 * @param {Types.INT} nYSrc - Its top edge.
 * @param {Types.INT} nWidthSrc - Its width, negative to mirror.
 * @param {Types.INT} nHeightSrc - Its height, negative to mirror.
 * @param {Types.DWORD} dwRop - The raster operation.
 *
 * @returns {Types.BOOL} Whether there was a destination to draw on.
 */
export function StretchBlt(
  hdcDest,
  nXDest,
  nYDest,
  nWidthDest,
  nHeightDest,
  hdcSrc,
  nXSrc,
  nYSrc,
  nWidthSrc,
  nHeightSrc,
  dwRop
) {
  const destination = this.handles.resolve(hdcDest);

  if (!destination) {
    return FALSE;
  }

  const rop = dwRop >>> 0;
  const source = hdcSrc ? this.handles.resolve(hdcSrc) : null;
  const dx = ordered(nXDest, nWidthDest);
  const dy = ordered(nYDest, nHeightDest);

  if (!source || !usesSource(tableOf(rop))) {
    rasterOp(this.display, destination, dx.at, dy.at, dx.size, dy.size, rop, null, 0, 0);

    return TRUE;
  }

  if (nWidthDest === nWidthSrc && nHeightDest === nHeightSrc) {
    rasterOp(
      this.display,
      destination,
      nXDest,
      nYDest,
      nWidthDest,
      nHeightDest,
      rop,
      source,
      nXSrc,
      nYSrc
    );

    return TRUE;
  }

  const sx = ordered(nXSrc, nWidthSrc);
  const sy = ordered(nYSrc, nHeightSrc);

  if (!dx.size || !dy.size || !sx.size || !sy.size) {
    return TRUE;
  }

  /* The source's pixels, in its own format. */
  const like = source.bitmap instanceof DeviceBitmap ? source.bitmap : null;
  const depth = like ? like.depth : DevicePalette.depthOf(this.display);
  const palette = like ? like.devicePalette : DevicePalette.forDisplay(this.display);
  const band = new DeviceBitmap(sx.size, sy.size, depth, undefined, palette);

  rasterOp(
    this.display,
    { bitmap: band, width: sx.size, height: sy.size },
    0,
    0,
    sx.size,
    sy.size,
    SRCCOPY,
    source,
    sx.at,
    sy.at
  );

  const mirrorX = dx.mirror !== sx.mirror;
  const mirrorY = dy.mirror !== sy.mirror;
  const mode =
    destination.stretchMode >= 1 && destination.stretchMode <= 3 ? destination.stretchMode : 2;
  const within = Math.abs(sx.size - dx.size) <= 1 && Math.abs(sy.size - dy.size) <= 1;
  const target =
    destination.bitmap instanceof DeviceBitmap
      ? destination.bitmap.depth
      : DevicePalette.depthOf(this.display);
  const mono = depth === 1 || target === 1;
  const stretched = new DeviceBitmap(dx.size, dy.size, depth, undefined, palette);
  const pixel = (x: number, y: number) => band.indices[y * sx.size + x];

  if (within || (mono && !mirrorX && !mirrorY)) {
    const rows = stretchMap(sy.size, dy.size, sx.size, dx.size, 'rows', mono);
    const columns = stretchMap(sx.size, dx.size, sy.size, dy.size, 'columns', mono);

    for (let y = 0; y < dy.size; y++) {
      const row = mirrorY ? sy.size - 1 - rows[y] : rows[y];

      for (let x = 0; x < dx.size; x++) {
        const column = mirrorX ? sx.size - 1 - columns[x] : columns[x];

        stretched.indices[y * dx.size + x] = pixel(column, row);
      }
    }
  } else {
    const columns = stretchColumns(sx.size, dx.size, mirrorX);
    const rows = stretchRows(sy.size, dy.size, mode !== COLORONCOLOR);
    const all = (1 << depth) - 1;

    if (mirrorY) {
      rows.reverse();
    }

    for (let y = 0; y < dy.size; y++) {
      for (let x = 0; x < dx.size; x++) {
        let value = mode === BLACKONWHITE ? all : 0;

        for (const row of rows[y] ?? []) {
          if (mode === COLORONCOLOR) {
            value = pixel(columns[x][columns[x].length - 1], row);
            continue;
          }

          for (const column of columns[x]) {
            value = mode === BLACKONWHITE ? value & pixel(column, row) : value | pixel(column, row);
          }
        }

        stretched.indices[y * dx.size + x] = value;
      }
    }
  }

  rasterOp(
    this.display,
    destination,
    dx.at,
    dy.at,
    dx.size,
    dy.size,
    rop,
    { bitmap: stretched, width: dx.size, height: dy.size, backcolor: source.backcolor },
    0,
    0
  );

  return TRUE;
}

/**
 * Sets how `StretchBlt` shrinks into a device context: `BLACKONWHITE` (1),
 * `WHITEONBLACK` (2) or `COLORONCOLOR` (3).
 *
 * @param {Types.HDC} hdc - The device context.
 * @param {Types.INT} nStretchMode - The mode.
 *
 * @returns {Types.INT} The mode it had, or nought for no device context.
 */
export function SetStretchBltMode(hdc, nStretchMode) {
  const surface = this.handles.resolve(hdc);

  if (!surface) {
    return 0;
  }

  const old = surface.stretchMode ?? BLACKONWHITE;

  surface.stretchMode = nStretchMode;

  return old;
}

/**
 * The mode `SetStretchBltMode` set.
 *
 * @param {Types.HDC} hdc - The device context.
 *
 * @returns {Types.INT} The mode, or nought for no device context.
 */
export function GetStretchBltMode(hdc) {
  const surface = this.handles.resolve(hdc);

  return surface ? (surface.stretchMode ?? BLACKONWHITE) : 0;
}
